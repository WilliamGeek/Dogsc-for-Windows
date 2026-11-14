/**
 * ExportServer.ts
 *
 * Local HTTP streaming export server for DogSC Windows.
 * Serves web assets (with TypeScript stripping), pre-decoded JPEG source frames,
 * GET /api/plan, POST /api/frame/:n (strict sequential RGBA validation & piping to ffmpeg stdin),
 * and POST /api/done.
 * Strictly adheres to docs/CONTRACTS.md §4 and §5.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, normalize, extname, dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import type { VideoEncoderKind } from '../capture/ScreenRecorder.ts';
import type { PointerEventRecord } from '../core/ZoomAnimation.ts';

export interface ExportFfmpegArgsOptions {
  width: number;
  height: number;
  fps: number;
  encoder: VideoEncoderKind;
  outFile: string;
}

/**
 * Pure function: builds ffmpeg rawvideo RGBA stdin -> flipped H.264 MP4 arguments per CONTRACTS §4.
 */
export function buildExportFfmpegArgs(o: ExportFfmpegArgsOptions): string[] {
  const fps = o.fps > 0 ? o.fps : 60;
  const width = o.width > 0 ? o.width : 1920;
  const height = o.height > 0 ? o.height : 1080;

  const baseArgs = [
    '-y',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    '-s',
    `${width}x${height}`,
    '-r',
    String(fps),
    '-i',
    '-',
    '-vf',
    'vflip',
  ];

  if (o.encoder === 'h264_nvenc') {
    return [
      ...baseArgs,
      '-c:v',
      'h264_nvenc',
      '-preset',
      'p4',
      '-rc',
      'vbr',
      '-cq',
      '23',
      '-b:v',
      '0',
      '-pix_fmt',
      'yuv420p',
      o.outFile,
    ];
  }

  return [
    ...baseArgs,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    o.outFile,
  ];
}

export interface ExportPlanPayload {
  fps: number;
  width: number;
  height: number;
  frameCount: number;
  sourceFrameCount: number;
  durationSeconds: number;
  framesBaseUrl: string;
  project: Record<string, unknown>;
  pointerEvents: PointerEventRecord[];
}

export interface ExportServerOptions {
  rootDir: string;
  framesDir: string;
  plan: ExportPlanPayload;
  outFile: string;
  encoder?: VideoEncoderKind;
  port?: number;
  ffmpegCommand?: { command: string; args: string[] };
  onProgress?: (frameIndex: number, frameCount: number) => void;
}

export interface ExportServerHandle {
  port: number;
  receivedFrames: () => number;
  waitForDone(): Promise<{ receivedFrames: number }>;
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
  '.ico': 'image/x-icon',
};

async function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  const payload = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

export async function startExportServer(o: ExportServerOptions): Promise<ExportServerHandle> {
  const rootDir = resolve(o.rootDir);
  const framesDir = resolve(o.framesDir);
  const encoder: VideoEncoderKind = o.encoder ?? 'h264_nvenc';
  const expectedByteLength = o.plan.width * o.plan.height * 4;

  if (!o.ffmpegCommand) {
    await mkdir(dirname(resolve(o.outFile)), { recursive: true });
  }

  const cmd = o.ffmpegCommand?.command ?? 'ffmpeg';
  const args =
    o.ffmpegCommand?.args ??
    buildExportFfmpegArgs({
      width: o.plan.width,
      height: o.plan.height,
      fps: o.plan.fps,
      encoder,
      outFile: resolve(o.outFile),
    });

  const proc: ChildProcess = spawn(cmd, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderr = '';
  proc.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  let stdinError: Error | null = null;
  proc.stdin?.on('error', (err) => {
    stdinError = err;
  });

  let procExited = false;
  let procExitCode: number | null = null;
  const procExitPromise = new Promise<number | null>((resolveExit, rejectExit) => {
    proc.on('error', (err) => {
      procExited = true;
      rejectExit(err);
    });
    proc.on('close', (code) => {
      procExited = true;
      procExitCode = code;
      resolveExit(code);
    });
  });

  let expectedFrame = 0;
  let doneCalled = false;

  let resolveDone!: (value: { receivedFrames: number }) => void;
  let rejectDone!: (reason?: unknown) => void;
  const donePromise = new Promise<{ receivedFrames: number }>((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });
  // Prevent unhandled rejection if caller closes server early without waiting
  donePromise.catch(() => {});

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const reqUrl = req.url ?? '/';
      const parsed = new URL(reqUrl, 'http://127.0.0.1');
      const decodedPath = decodeURIComponent(parsed.pathname);

      // 1. GET /api/plan
      if (req.method === 'GET' && decodedPath === '/api/plan') {
        sendJson(res, 200, o.plan);
        return;
      }

      // 2. POST /api/frame/:n
      if (req.method === 'POST' && decodedPath.startsWith('/api/frame/')) {
        const indexStr = decodedPath.slice('/api/frame/'.length);
        if (!/^\d+$/.test(indexStr)) {
          sendText(res, 400, `Invalid frame index: ${indexStr}`);
          return;
        }
        const frameIndex = Number.parseInt(indexStr, 10);
        const body = await readRequestBody(req);

        if (body.byteLength !== expectedByteLength) {
          sendText(
            res,
            400,
            `Frame byte length mismatch: expected ${expectedByteLength}, got ${body.byteLength}`
          );
          return;
        }

        if (doneCalled || frameIndex !== expectedFrame) {
          sendText(
            res,
            409,
            `Out-of-order frame: expected ${expectedFrame}, got ${frameIndex}`
          );
          return;
        }

        if (procExited || stdinError || !proc.stdin || !proc.stdin.writable) {
          sendText(
            res,
            500,
            `Encoder stdin closed unexpectedly: ${stdinError?.message ?? stderr}`
          );
          return;
        }

        expectedFrame++;
        const canContinue = proc.stdin.write(body);
        if (!canContinue) {
          await once(proc.stdin, 'drain');
        }

        o.onProgress?.(expectedFrame, o.plan.frameCount);
        sendJson(res, 200, { ok: true, frame: frameIndex });
        return;
      }

      // 3. POST /api/done
      if (req.method === 'POST' && decodedPath === '/api/done') {
        if (!doneCalled) {
          doneCalled = true;
          proc.stdin?.end();
        }
        const code = await procExitPromise;
        if (code !== 0) {
          const err = new Error(`Encoder exited with code ${code}:\n${stderr}`);
          rejectDone(err);
          sendText(res, 500, err.message);
          return;
        }
        const result = { receivedFrames: expectedFrame };
        resolveDone(result);
        sendJson(res, 200, { ok: true, ...result });
        return;
      }

      // 4. GET /frames/<name>
      if (decodedPath.startsWith('/frames/')) {
        const relFrame = decodedPath.slice('/frames/'.length);
        const targetFramePath = normalize(resolve(framesDir, relFrame));
        if (!targetFramePath.startsWith(framesDir)) {
          sendText(res, 403, '403 Forbidden: Path traversal prohibited');
          return;
        }
        if (!existsSync(targetFramePath) || statSync(targetFramePath).isDirectory()) {
          sendText(res, 404, '404 Frame Not Found');
          return;
        }
        const buf = readFileSync(targetFramePath);
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Content-Length': buf.length,
          'Cache-Control': 'no-cache',
        });
        res.end(buf);
        return;
      }

      // 5. Static files & .ts dynamic stripping from rootDir
      const targetPath = normalize(resolve(rootDir, '.' + decodedPath));
      if (!targetPath.startsWith(rootDir)) {
        sendText(res, 403, '403 Forbidden: Path traversal prohibited');
        return;
      }
      if (!existsSync(targetPath) || statSync(targetPath).isDirectory()) {
        sendText(res, 404, '404 Not Found');
        return;
      }

      const ext = extname(targetPath).toLowerCase();
      const contentType = MIME_MAP[ext] ?? 'application/octet-stream';
      if (ext === '.ts') {
        const rawCode = readFileSync(targetPath, 'utf-8');
        const stripped = stripTypeScriptTypes(rawCode);
        res.writeHead(200, {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Content-Length': Buffer.byteLength(stripped),
          'Cache-Control': 'no-cache',
        });
        res.end(stripped);
        return;
      }

      const buffer = readFileSync(targetPath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': buffer.length,
        'Cache-Control': 'no-cache',
      });
      res.end(buffer);
    } catch (err: any) {
      sendText(res, 500, `500 ExportServer Error: ${err?.message ?? String(err)}`);
    }
  });

  return new Promise<ExportServerHandle>((resolveServer, rejectServer) => {
    server.once('error', (err) => rejectServer(err));

    server.listen(o.port ?? 0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      resolveServer({
        port,
        receivedFrames: () => expectedFrame,
        waitForDone: () => donePromise,
        close: async () => {
          if (!procExited) {
            try {
              proc.stdin?.end();
            } catch {
              // ignore
            }
            const timer = setTimeout(() => {
              if (!procExited) {
                try {
                  proc.kill('SIGKILL');
                } catch {
                  // ignore
                }
              }
            }, 1500);
            try {
              await Promise.race([
                procExitPromise.catch(() => {}),
                new Promise((r) => setTimeout(r, 2000)),
              ]);
            } finally {
              clearTimeout(timer);
            }
          }

          await new Promise<void>((res) => {
            if (typeof (server as any).closeAllConnections === 'function') {
              (server as any).closeAllConnections();
            }
            server.close(() => res());
          });

          // If closed with proc already exited cleanly via direct EOF (no /api/done call), settle cleanly
          if (procExited && procExitCode !== 0 && !doneCalled) {
            rejectDone(new Error(`Encoder exited with code ${procExitCode}:\n${stderr}`));
          }
        },
      });
    });
  });
}
