import { statSync } from 'fs';
import { join, resolve } from 'path';

/** Never activate a successful build command that did not produce a static site. */
export function getStaticDirectory(cwd: string, outputDirectory = 'dist'): string {
  const directory = resolve(cwd, outputDirectory);
  try {
    if (statSync(join(directory, 'index.html')).isFile()) return directory;
  } catch {
    // Report the expected output, rather than starting a server that only returns 404.
  }
  throw new Error(
    `Static build output missing: ${join(directory, 'index.html')}. Ensure the build command produces ${outputDirectory}/index.html.`,
  );
}

/** Shared by host Nginx and the Vite container. HTML must be revalidated on deploy. */
export function staticSiteLocations(): string {
  return `
    index index.html;

    location = /index.html {
        add_header Cache-Control "no-cache" always;
    }

    # Missing bundles must return 404, never HTML with a JavaScript MIME type.
    location /assets/ {
        try_files $uri =404;
    }

    location ~* \\.(?:js|mjs|css|map|json|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|wasm|txt|xml|webmanifest)$ {
        try_files $uri =404;
    }

    # Browser-history routes (including dotted route parameters) use the SPA shell.
    location / {
        try_files $uri $uri/ /index.html;
    }
`;
}
