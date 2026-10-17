import { extname, join, resolve, sep } from 'path';
import { getStaticDirectory } from './services/static-site';

const [dir, portStr] = process.argv.slice(2);

if (!dir || !portStr) {
  console.error('Usage: bun static-server.ts <directory> <port>');
  process.exit(1);
}

const port = parseInt(portStr, 10);
const baseDir = getStaticDirectory(dir, '.');

console.log(`Starting static server for ${baseDir} on port ${port}`);

Bun.serve({
  port,
  async fetch(req) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const url = new URL(req.url);
    let filePath: string;
    try {
      filePath = decodeURIComponent(url.pathname);
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    // Default to index.html for root
    if (filePath === '/' || filePath === '') {
      filePath = '/index.html';
    }

    const fullPath = resolve(baseDir, `.${filePath}`);
    if (!fullPath.startsWith(baseDir + sep) || filePath.includes('\0')) {
      return new Response('Not Found', { status: 404 });
    }
    const file = Bun.file(fullPath);

    // Try to serve file
    if (await file.exists()) {
      return new Response(req.method === 'HEAD' ? null : file, {
        headers: {
          'Content-Type': file.type,
          ...(filePath.endsWith('/index.html') ? { 'Cache-Control': 'no-cache' } : {}),
        },
      });
    }

    const assetExtensions =
      /\.(?:js|mjs|css|map|json|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|wasm|txt|xml|webmanifest)$/i;
    if (!filePath.startsWith('/assets/') && !assetExtensions.test(extname(filePath))) {
      const index = Bun.file(join(baseDir, 'index.html'));
      if (await index.exists()) {
        return new Response(req.method === 'HEAD' ? null : index, {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  },
});
