import { request, type RequestOptions } from 'https';

/** Probe the local TLS virtual host with the correct SNI, bypassing DNS/CDN caches. */
export function requestNginxOrigin(
  domain: string,
  timeoutMs = 1000,
  options: Pick<RequestOptions, 'port' | 'ca' | 'path'> = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port: options.port || 443,
        ca: options.ca,
        servername: domain,
        agent: false,
        headers: { Host: domain, 'Cache-Control': 'no-cache' },
        path: options.path || '/',
        method: 'GET',
        signal: AbortSignal.timeout(timeoutMs),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(res.headers)) {
            if (value !== undefined)
              headers.set(name, Array.isArray(value) ? value.join(', ') : value);
          }
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode || 502,
              headers,
            }),
          );
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}
