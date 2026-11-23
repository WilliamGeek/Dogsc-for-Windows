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
import { readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { resolve, extname, dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { resolveSafeChildPath } from './SafePath.ts';
import type { VideoEncoderKind } from '../capture/ScreenRecorder.ts';
import type { PointerEventRecord } from '../core/ZoomAnimation.ts';

export interface ExportFfmpegArgsOptions {
  width: number;
  height: number;
  fps: number;
  encoder: VideoEncoderKind;
  outFile: string;
  videoCodec?: 'h264' | 'hevc';
  quality?: 'compact' | 'high' | 'maximum';
  audioInputs?: readonly string[];
  audioFilterComplex?: string;
  audioMapLabel?: string;
  audioBitrate?: string;
}

/**
 * Pure function: builds ffmpeg rawvideo RGBA stdin -> flipped H.264/HEVC MP4 arguments per CONTRACTS §4,
 * optionally muxing pre-built audio filtergraphs (`audioInputs` + `audioFilterComplex`).
 */
export function buildExportFfmpegArgs(o: ExportFfmpegArgsOptions): string[] {
  const fps = o.fps > 0 ? o.fps : 60;
  const width = o.width > 0 ? o.width : 1920;
  const height = o.height > 0 ? o.height : 1080;
  const videoCodec = o.videoCodec ?? 'h264';
  const quality = o.quality ?? 'high';
  const nvencCq = quality === 'compact' ? '28' : quality === 'maximum' ? '17' : '23';
  const x26xCrf = quality === 'compact' ? '25' : quality === 'maximum' ? '16' : '20';

  const hasAudioMux = Boolean(
    o.audioInputs &&
      o.audioInputs.length > 0 &&
      o.audioFilterComplex &&
      o.audioMapLabel
  );

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
  ];

  if (hasAudioMux) {
    for (const audioPath of o.audioInputs!) {
      baseArgs.push('-i', audioPath);
    }
    baseArgs.push(
      '-filter_complex',
      `[0:v]vflip[vout];${o.audioFilterComplex}`,
      '-map',
      '[vout]',
      '-map',
      o.audioMapLabel!
    );
  } else {
    baseArgs.push('-vf', 'vflip');
  }

  let videoCodecArgs: string[];
  if (videoCodec === 'hevc') {
    videoCodecArgs =
      o.encoder === 'h264_nvenc'
        ? [
            '-c:v',
            'hevc_nvenc',
            '-preset',
            'p4',
            '-rc',
            'vbr',
            '-cq',
            nvencCq,
            '-b:v',
            '0',
            '-pix_fmt',
            'yuv420p',
            '-tag:v',
            'hvc1',
          ]
        : [
            '-c:v',
            'libx265',
            '-preset',
            'veryfast',
            '-crf',
            x26xCrf,
            '-pix_fmt',
            'yuv420p',
            '-tag:v',
            'hvc1',
          ];
  } else {
    videoCodecArgs =
      o.encoder === 'h264_nvenc'
        ? [
            '-c:v',
            'h264_nvenc',
            '-preset',
            'p4',
            '-rc',
            'vbr',
            '-cq',
            nvencCq,
            '-b:v',
            '0',
            '-pix_fmt',
            'yuv420p',
          ]
        : [
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            x26xCrf,
            '-pix_fmt',
            'yuv420p',
          ];
  }

  if (hasAudioMux) {
    return [
      ...baseArgs,
      ...videoCodecArgs,
      '-c:a',
      'aac',
      '-b:a',
      o.audioBitrate ?? '192k',
      '-shortest',
      o.outFile,
    ];
  }

  return [...baseArgs, ...videoCodecArgs, o.outFile];
}

export interface ExportPlanPayload {
  fps: number;
  sourceFps?: number;
  width: number;
  height: number;
  frameCount: number;
  sourceFrameCount: number;
  durationSeconds: number;
  framesBaseUrl: string;
  cameraFramesBaseUrl?: string | null;
  assetsBaseUrl?: string | null;
  project: Record<string, unknown>;
  pointerEvents: PointerEventRecord[];
}

/**
 * T12.8: 2176x1812 WebGL readback + HTTP upload can exceed 500ms/frame on a
 * laptop GPU. A 500ms/frame budget falsely killed a real 568-frame export at
 * frame 510. The inactivity watchdog still catches genuine stalls.
 */
export function defaultTotalTimeoutMs(frameCount: number): number {
  return Math.max(120_000, Math.max(1, frameCount) * 1500);
}

export interface ExportServerOptions {
  rootDir: string;
  framesDir: string;
  cameraFramesDir?: string;
  sessionDir?: string;
  plan: ExportPlanPayload;
  outFile: string;
  encoder?: VideoEncoderKind;
  videoCodec?: 'h264' | 'hevc';
  quality?: 'compact' | 'high' | 'maximum';
  audioMix?: {
    inputs: readonly string[];
    filterComplex: string;
    audioMapLabel: string;
    audioBitrate?: string;
  };
  port?: number;
  ffmpegCommand?: { command: string; args: string[] };
  /** No-frame watchdog. Defaults to 30 seconds. */
  inactivityTimeoutMs?: number;
  /** Whole-export watchdog. Defaults to max(120s, frameCount * 1.5s). */
  totalTimeoutMs?: number;
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
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.dmhtml': 'text/html; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
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
  const cameraFramesDir = o.cameraFramesDir ? resolve(o.cameraFramesDir) : null;
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
      videoCodec: o.videoCodec,
      quality: o.quality,
      audioInputs: o.audioMix?.inputs,
      audioFilterComplex: o.audioMix?.filterComplex,
      audioMapLabel: o.audioMix?.audioMapLabel,
      audioBitrate: o.audioMix?.audioBitrate,
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
    failExport(new Error(`Encoder stdin error: ${err.message}`));
  });

  let procExited = false;
  let procExitCode: number | null = null;
  const procExitPromise = new Promise<number | null>((resolveExit, rejectExit) => {
    proc.on('error', (err) => {
      procExited = true;
      rejectExit(err);
      failExport(new Error(`Encoder failed to start: ${err.message}`));
    });
    proc.on('close', (code) => {
      procExited = true;
      procExitCode = code;
      resolveExit(code);
      if (code !== 0 && !doneCalled) {
        failExport(new Error(`Encoder exited unexpectedly with code ${code}:\n${stderr}`));
      }
    });
  });

  let expectedFrame = 0;
  let doneCalled = false;
  let doneSettled = false;

  let resolveDone!: (value: { receivedFrames: number }) => void;
  let rejectDone!: (reason?: unknown) => void;
  const donePromise = new Promise<{ receivedFrames: number }>((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });
  // Prevent unhandled rejection if caller closes server early without waiting
  donePromise.catch(() => {});

  const inactivityTimeoutMs = o.inactivityTimeoutMs ?? 30_000;
  const totalTimeoutMs = o.totalTimeoutMs ?? defaultTotalTimeoutMs(o.plan.frameCount);

  let inactivityTimer: NodeJS.Timeout | null = null;
  let totalTimer: NodeJS.Timeout | null = null;

  function clearWatchdogs(): void {
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
    if (totalTimer) {
      clearTimeout(totalTimer);
      totalTimer = null;
    }
  }

  function removePartialOutput(): void {
    // A fake encoder is a test seam and may deliberately not create outFile.
    if (o.ffmpegCommand) return;
    const cleanup = () => {
      try {
        rmSync(o.outFile, { force: true });
      } catch {
        // Ignore if still locked; final retry happens on procExitPromise.
      }
    };
    cleanup();
    // On Windows ffmpeg may still hold the file handle immediately after SIGKILL; retry after close.
    void procExitPromise.then(cleanup, cleanup);
  }

  function failExport(error: Error): void {
    clearWatchdogs();
    doneCalled = true;
    if (doneSettled) return;
    doneSettled = true;

    try {
      proc.kill('SIGKILL');
    } catch {
      // Already exited.
    }
    removePartialOutput();
    rejectDone(error);
  }

  function armInactivity(): void {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    if (doneSettled) return;
    inactivityTimer = setTimeout(() => {
      failExport(
        new Error(
          `Export inactivity timeout: no valid frame received within ${inactivityTimeoutMs}ms`
        )
      );
    }, inactivityTimeoutMs);
  }

  function startWatchdogs(): void {
    clearWatchdogs();

    totalTimer = setTimeout(() => {
      failExport(
        new Error(
          `Export total timeout: export did not finish within ${totalTimeoutMs}ms`
        )
      );
    }, totalTimeoutMs);

    armInactivity();
  }

  startWatchdogs();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const reqUrl = req.url ?? '/';
      const rawPathOnly = reqUrl.split('?')[0] ?? '/';
      const rawDecoded = decodeURIComponent(rawPathOnly);
      if (rawDecoded.split(/[\\/]/).includes('..')) {
        sendText(res, 403, '403 Forbidden: Path traversal prohibited');
        return;
      }
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

        // A valid frame proves the browser/renderer is still alive.
        armInactivity();
        o.onProgress?.(expectedFrame, o.plan.frameCount);
        sendJson(res, 200, { ok: true, frame: frameIndex });
        return;
      }

      // 3. POST /api/error — browser-side fatal error (WebGL context lost, etc.)
      if (req.method === 'POST' && decodedPath === '/api/error') {
        const body = await readRequestBody(req);
        let message = 'Browser reported an unknown export error';
        let frameIndex: number | null = null;
        try {
          const parsedError = JSON.parse(body.toString('utf8'));
          if (typeof parsedError?.message === 'string' && parsedError.message.length > 0) {
            message = parsedError.message;
          }
          if (Number.isFinite(parsedError?.frameIndex)) {
            frameIndex = Number(parsedError.frameIndex);
          }
        } catch {
          // Keep the generic message for malformed JSON, but still abort.
        }

        const error = new Error(
          `${message}${frameIndex === null ? '' : ` (frame ${frameIndex})`}`
        );
        failExport(error);
        sendJson(res, 200, { ok: true, error: error.message });
        return;
      }

      // 4. POST /api/done
      if (req.method === 'POST' && decodedPath === '/api/done') {
        if (expectedFrame !== o.plan.frameCount) {
          const err = new Error(
            `Incomplete export: expected ${o.plan.frameCount} frames, received ${expectedFrame}`
          );
          failExport(err);
          sendText(res, 409, err.message);
          return;
        }

        if (!doneCalled) {
          doneCalled = true;
          proc.stdin?.end();
        }
        const code = await procExitPromise;
        if (code !== 0) {
          const err = new Error(`Encoder exited with code ${code}:\n${stderr}`);
          failExport(err);
          sendText(res, 500, err.message);
          return;
        }
        clearWatchdogs();
        if (!doneSettled) {
          doneSettled = true;
          resolveDone({ receivedFrames: expectedFrame });
        }
        sendJson(res, 200, { ok: true, receivedFrames: expectedFrame });
        return;
      }

      // 4. GET /frames/<name>
      if (decodedPath.startsWith('/frames/')) {
        const relFrame = decodedPath.slice('/frames/'.length);
        const targetFramePath = resolveSafeChildPath(framesDir, relFrame);
        if (!targetFramePath) {
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

      // 4b. GET /camera_frames/<name>
      if (decodedPath.startsWith('/camera_frames/')) {
        if (!cameraFramesDir) {
          sendText(res, 404, '404 Camera Frames Disabled');
          return;
        }
        const relFrame = decodedPath.slice('/camera_frames/'.length);
        const targetFramePath = resolveSafeChildPath(cameraFramesDir, relFrame);
        if (!targetFramePath) {
          sendText(res, 403, '403 Forbidden: Path traversal prohibited');
          return;
        }
        if (!existsSync(targetFramePath) || statSync(targetFramePath).isDirectory()) {
          sendText(res, 404, '404 Camera Frame Not Found');
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

      // 4c. GET /assets/<relPath>
      if (decodedPath.startsWith('/assets/')) {
        if (!o.sessionDir) {
          sendText(res, 404, '404 Session Assets Disabled');
          return;
        }
        const relAsset = decodedPath.slice('/assets/'.length);
        const sessionRoot = resolve(o.sessionDir);
        const directSafe = resolveSafeChildPath(sessionRoot, relAsset);
        if (!directSafe) {
          sendText(res, 403, '403 Forbidden: Path traversal prohibited');
          return;
        }
        const safeAsset =
          existsSync(directSafe) && !statSync(directSafe).isDirectory()
            ? directSafe
            : resolveSafeChildPath(sessionRoot, `assets/${relAsset}`);
        if (!safeAsset || !existsSync(safeAsset) || statSync(safeAsset).isDirectory()) {
          sendText(res, 404, '404 Asset Not Found');
          return;
        }
        const buf = readFileSync(safeAsset);
        const mime = MIME_MAP[extname(safeAsset).toLowerCase()] ?? 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': mime,
          'Content-Length': buf.length,
          'Cache-Control': 'no-cache',
        });
        res.end(buf);
        return;
      }

      // 5. Static files & .ts dynamic stripping from rootDir
      const targetPath = resolveSafeChildPath(rootDir, decodedPath);
      if (!targetPath) {
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
    server.once('error', (err) => {
      clearWatchdogs();
      rejectServer(err);
    });

    server.listen(o.port ?? 0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      resolveServer({
        port,
        receivedFrames: () => expectedFrame,
        waitForDone: () => donePromise,
        close: async () => {
          clearWatchdogs();
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
