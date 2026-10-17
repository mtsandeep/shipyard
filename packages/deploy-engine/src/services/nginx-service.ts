import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { staticSiteLocations } from './static-site';

const BASE_DOMAIN = process.env.BASE_DOMAIN || 'thakur.dev';
const CERTBOT_WEBROOT = process.env.CERTBOT_WEBROOT || '/var/www/certbot';
const DASHBOARD_ORIGIN = process.env.DASHBOARD_ORIGIN || `https://deploy.${BASE_DOMAIN}`;

async function runChecked(command: string[]) {
  const proc = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`${command.join(' ')} failed: ${stderr.trim() || stdout.trim()}`);
  }
}

function getNginxDirs(): { available: string; enabled: string } {
  // If explicitly configured and not default platform-sites
  if (process.env.NGINX_SITES_DIR && process.env.NGINX_SITES_DIR !== '/etc/nginx/platform-sites') {
    return { available: process.env.NGINX_SITES_DIR, enabled: process.env.NGINX_SITES_DIR };
  }

  // Standard Ubuntu / Debian Nginx sites-available and sites-enabled
  if (existsSync('/etc/nginx/sites-available') && existsSync('/etc/nginx/sites-enabled')) {
    return { available: '/etc/nginx/sites-available', enabled: '/etc/nginx/sites-enabled' };
  }

  // If platform-sites directory already exists on host
  if (existsSync('/etc/nginx/platform-sites')) {
    return { available: '/etc/nginx/platform-sites', enabled: '/etc/nginx/platform-sites' };
  }

  // Default to standard Ubuntu sites-available / sites-enabled
  return { available: '/etc/nginx/sites-available', enabled: '/etc/nginx/sites-enabled' };
}

async function writeNginxFile(
  targetPath: string,
  content: string,
  needsCertbot = true,
): Promise<void> {
  const dir = dirname(targetPath);
  if (!existsSync(dir)) {
    await runChecked(['sudo', 'mkdir', '-p', dir]);
    await runChecked(['sudo', 'chmod', '755', dir]);
  }

  // Ensure CERTBOT_WEBROOT exists and is readable by Nginx
  if (needsCertbot && !existsSync(CERTBOT_WEBROOT)) {
    await runChecked(['sudo', 'mkdir', '-p', CERTBOT_WEBROOT]);
    await runChecked(['sudo', 'chmod', '755', CERTBOT_WEBROOT]);
  }

  try {
    await Bun.write(targetPath, content);
  } catch {
    // If direct write fails (e.g. permission denied), write to /tmp and move with sudo
    const tmpPath = `/tmp/nginx-${Date.now()}-${Math.random().toString(36).slice(2)}.conf`;
    await Bun.write(tmpPath, content);
    await runChecked(['sudo', 'mv', tmpPath, targetPath]);
    await runChecked(['sudo', 'chmod', '644', targetPath]);
  }
}

async function linkNginxFile(available: string, enabled: string): Promise<void> {
  if (available === enabled) return;
  const enabledDir = dirname(enabled);
  if (!existsSync(enabledDir)) {
    await runChecked(['sudo', 'mkdir', '-p', enabledDir]);
  }
  await runChecked(['sudo', 'ln', '-sf', available, enabled]);
}

async function removeNginxFile(filePath: string): Promise<void> {
  if (existsSync(filePath)) {
    await runChecked(['sudo', 'rm', '-f', filePath]);
  }
}

const RESERVED = [
  'www',
  'api',
  'admin',
  'dashboard',
  'deploy',
  'git',
  'db',
  'mail',
  'staging',
  'dev',
];

// Bounded retry helper
async function retry(fn: () => Promise<void>, retries = 3, delayMs = 300) {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < retries - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

export const NginxService = {
  staticConfigPath(projectId: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) throw new Error('Invalid project ID');
    // Keep runtime listeners separate from the public domain/SSL configuration.
    return join(getNginxDirs().available, `shipyard-static-${projectId}.conf`);
  },

  generateStaticConfig(root: string, port: number) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error('Invalid static site port');
    }
    if (!root.startsWith('/') || /[\r\n\0"\\$]/.test(root)) {
      throw new Error('Invalid static site directory');
    }
    return `server {
    listen 127.0.0.1:${port};
    server_name localhost;
    root "${root}";
${staticSiteLocations()}
}
`;
  },

  hasStaticConfig(projectId: string) {
    return existsSync(this.staticConfigPath(projectId));
  },

  async createStaticConfig(
    projectId: string,
    root: string,
    port: number,
    verify?: () => Promise<void>,
  ) {
    const path = this.staticConfigPath(projectId);
    const enabled = join(getNginxDirs().enabled, `shipyard-static-${projectId}.conf`);
    const previous = existsSync(path) ? readFileSync(path, 'utf8') : null;
    try {
      await writeNginxFile(path, this.generateStaticConfig(root, port), false);
      await linkNginxFile(path, enabled);
      await this.reload();
      await verify?.();
    } catch (error) {
      if (previous !== null) {
        await writeNginxFile(path, previous, false);
      } else {
        await removeNginxFile(enabled);
        if (path !== enabled) await removeNginxFile(path);
      }
      await this.reload();
      throw error;
    }
  },

  async removeStaticConfig(projectId: string) {
    const path = this.staticConfigPath(projectId);
    if (!existsSync(path)) return;
    const enabled = join(getNginxDirs().enabled, `shipyard-static-${projectId}.conf`);
    await removeNginxFile(enabled);
    if (path !== enabled) await removeNginxFile(path);
    await this.reload();
  },

  isSubdomainAllowed(sub: string) {
    if (!sub) return false;
    const s = sub.toLowerCase().trim();
    if (RESERVED.includes(s)) return false;
    if (!/^[a-z0-9-]+$/.test(s)) return false;
    if (s.startsWith('-') || s.endsWith('-')) return false;
    return true;
  },

  /**
   * Generate nginx config with per-domain SSL certificate paths.
   * Uses the domain's own Let's Encrypt cert instead of a wildcard cert.
   */
  generateConfig(sub: string, port: number) {
    const fullDomain = `${sub}.${BASE_DOMAIN}`;
    return `
server {
    listen 80;
    server_name ${fullDomain};

    # ACME challenge for Let's Encrypt certificate renewal
    location /.well-known/acme-challenge/ {
        root ${CERTBOT_WEBROOT};
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name ${fullDomain};

    # Per-domain SSL certificate (issued by Let's Encrypt)
    ssl_certificate     /etc/letsencrypt/live/${fullDomain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${fullDomain}/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # The isolated preview route can be embedded only by the ShipYard dashboard.
    # Keep these header changes scoped here; the public application route below
    # preserves the app's own framing policy.
    location = /__shipyard_preview {
        return 301 /__shipyard_preview/;
    }

    location ^~ /__shipyard_preview/ {
        proxy_pass http://localhost:${port}/;
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        proxy_hide_header X-Frame-Options;
        proxy_hide_header Content-Security-Policy;
        add_header Content-Security-Policy "frame-ancestors ${DASHBOARD_ORIGIN}" always;

        proxy_read_timeout 300;
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
    }

    location / {
        proxy_pass http://localhost:${port};
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;

        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        proxy_read_timeout 300;
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
    }
}
`;
  },

  /**
   * Generate a temporary HTTP-only config for a subdomain.
   * Used BEFORE SSL cert is issued — only serves ACME challenge + proxy.
   * This allows certbot webroot validation to work.
   */
  generateHttpOnlyConfig(sub: string, port: number) {
    const fullDomain = `${sub}.${BASE_DOMAIN}`;
    return `
server {
    listen 80;
    server_name ${fullDomain};

    # ACME challenge for Let's Encrypt certificate issuance
    location /.well-known/acme-challenge/ {
        root ${CERTBOT_WEBROOT};
    }

    location / {
        proxy_pass http://localhost:${port};
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;

        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
`;
  },

  async createConfig(sub: string, port: number) {
    if (!this.isSubdomainAllowed(sub)) {
      throw new Error(`Invalid or reserved subdomain: ${sub}`);
    }

    const { available, enabled } = getNginxDirs();
    const availablePath = join(available, `${sub}.conf`);
    const enabledPath = join(enabled, `${sub}.conf`);

    const previous = existsSync(availablePath) ? readFileSync(availablePath, 'utf8') : null;
    try {
      await writeNginxFile(availablePath, this.generateConfig(sub, port));
      await linkNginxFile(availablePath, enabledPath);
      await this.reload();
    } catch (error) {
      // A failed reload must not leave an invalid file blocking every later deploy.
      if (previous !== null) {
        await writeNginxFile(availablePath, previous);
      } else {
        await removeNginxFile(enabledPath);
        if (availablePath !== enabledPath) await removeNginxFile(availablePath);
      }
      await this.reload();
      throw error;
    }
  },

  async ensurePreviewConfig(sub: string, port: number) {
    if (!this.isSubdomainAllowed(sub)) {
      throw new Error(`Invalid or reserved subdomain: ${sub}`);
    }

    const { available, enabled } = getNginxDirs();
    const availablePath = join(available, `${sub}.conf`);
    const enabledPath = join(enabled, `${sub}.conf`);
    if (existsSync(availablePath) && existsSync(enabledPath)) {
      try {
        const config = readFileSync(availablePath, 'utf8');
        if (
          config.includes('location ^~ /__shipyard_preview/') &&
          config.includes(`proxy_pass http://localhost:${port}/;`)
        ) {
          return;
        }
      } catch {
        // Rebuild the config below if it cannot be read.
      }
    }

    await this.createConfig(sub, port);
  },

  /**
   * Create an HTTP-only nginx config (no SSL) for ACME challenge serving.
   * Used during initial domain provisioning before SSL cert is issued.
   */
  async createHttpOnlyConfig(sub: string, port: number) {
    if (!this.isSubdomainAllowed(sub)) {
      throw new Error(`Invalid or reserved subdomain: ${sub}`);
    }

    const { available, enabled } = getNginxDirs();
    const availablePath = join(available, `${sub}.conf`);
    const enabledPath = join(enabled, `${sub}.conf`);

    await writeNginxFile(availablePath, this.generateHttpOnlyConfig(sub, port));
    await linkNginxFile(availablePath, enabledPath);
    await this.reload();
  },

  /**
   * Upgrade an existing HTTP-only config to full HTTPS after SSL cert is issued.
   */
  async upgradeToHttps(sub: string, port: number) {
    const { available } = getNginxDirs();
    const availablePath = join(available, `${sub}.conf`);

    // Overwrite with the full HTTPS config
    await writeNginxFile(availablePath, this.generateConfig(sub, port));
    await this.reload();
  },

  async removeConfig(sub: string) {
    const { available, enabled } = getNginxDirs();
    const availablePath = join(available, `${sub}.conf`);
    const enabledPath = join(enabled, `${sub}.conf`);

    await removeNginxFile(enabledPath);
    if (availablePath !== enabledPath) {
      await removeNginxFile(availablePath);
    }

    await this.reload();
  },

  async createDefaultConfig() {
    const content = `
server {
    listen 80;
    server_name _ *.${BASE_DOMAIN};

    # ACME challenge for Let's Encrypt
    location /.well-known/acme-challenge/ {
        root ${CERTBOT_WEBROOT};
    }

    add_header Content-Type text/plain;
    return 404 "Unknown subdomain. No project deployed.\\n";
}

server {
    listen 443 ssl;
    server_name _ *.${BASE_DOMAIN};

    # Fallback wildcard cert (if available), otherwise self-signed
    ssl_certificate     /etc/letsencrypt/live/${BASE_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${BASE_DOMAIN}/privkey.pem;

    add_header Content-Type text/plain;
    return 404 "Unknown subdomain. No project deployed.\\n";
}
`;

    const { available } = getNginxDirs();
    const file = join(available, '00-default.conf');

    await writeNginxFile(file, content);
    await this.reload();
  },

  async reload() {
    await retry(async () => {
      const test = Bun.spawn(['sudo', 'nginx', '-t']);
      await test.exited;
      if (test.exitCode !== 0) {
        throw new Error('nginx config validation failed');
      }

      const reload = Bun.spawn(['sudo', 'systemctl', 'reload', 'nginx']);
      await reload.exited;
      if (reload.exitCode !== 0) {
        throw new Error('nginx reload failed');
      }
    });
  },
};
