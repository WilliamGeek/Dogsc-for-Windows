/**
 * DevServer.ts
 *
 * Local HTTP static file server with on-the-fly TypeScript type stripping.
 * Serves native ES Modules directly to the browser (Edge/Chrome) with zero build tools.
 * Adheres strictly to docs/CONTRACTS.md §4 and §5.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { resolveSafeChildPath } from './SafePath.ts';

export interface DevServerOptions {
  rootDir: string;
  port?: number;
}

export interface DevServerHandle {
  port: number;
  close(): Promise<void>;
}

const MIME_MAP: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon',
};

/**
 * Starts a local HTTP server serving rootDir.
 * For `.ts` files, strips TypeScript types and serves as `text/javascript`.
 * For path traversal attempts, responds with 403 Forbidden.
 */
export function startDevServer(o: DevServerOptions): Promise<DevServerHandle> {
  const root = resolve(o.rootDir);

  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      try {
        const reqUrl = req.url ?? '/';
        const parsed = new URL(reqUrl, 'http://127.0.0.1');
        const decodedPath = decodeURIComponent(parsed.pathname);

        // Security: Prevent path traversal and same-prefix sibling escapes.
        const targetPath = resolveSafeChildPath(root, decodedPath);
        if (!targetPath) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('403 Forbidden: Path traversal prohibited');
          return;
        }

        if (!existsSync(targetPath) || statSync(targetPath).isDirectory()) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('404 Not Found');
          return;
        }

        const ext = extname(targetPath).toLowerCase();
        const contentType = MIME_MAP[ext] ?? 'application/octet-stream';

        res.setHeader('Connection', 'close');
        if (ext === '.ts') {
          const rawCode = readFileSync(targetPath, 'utf-8');
          const stripped = stripTypeScriptTypes(rawCode);
          res.writeHead(200, {
            'Content-Type': 'text/javascript; charset=utf-8',
            'Cache-Control': 'no-cache',
            'Connection': 'close',
          });
          res.end(stripped);
          return;
        }

        const buffer = readFileSync(targetPath);
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': buffer.length,
          'Cache-Control': 'no-cache',
          'Connection': 'close',
        });
        res.end(buffer);
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Connection': 'close' });
        res.end(`500 Server Error: ${err.message || err}`);
      }
    });

    server.once('error', (err) => {
      rejectPromise(err);
    });

    server.listen(o.port ?? 0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolvePromise({
        port,
        close: () =>
          new Promise<void>((res) => {
            if (typeof (server as any).closeAllConnections === 'function') {
              (server as any).closeAllConnections();
            }
            server.close(() => res());
          }),
      });
    });
  });
}
