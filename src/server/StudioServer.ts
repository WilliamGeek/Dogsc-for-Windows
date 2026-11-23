/**
 * StudioServer.ts
 *
 * Local HTTP backend & control server for DogSC Studio (`web/studio.html`).
 * Provides recording enumeration, validated atomic `project.json` persistence,
 * pre-decoded JPEG frame streaming, hardware device enumeration, background capture,
 * and multi-spec cancellable MP4/M4A export jobs.
 * Security: every filesystem path goes through `resolveSafeChildPath` (CONTRACTS §4).
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { extname, join, resolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { resolveSafeChildPath } from './SafePath.ts';
import { startExportServer, type ExportServerHandle } from './ExportServer.ts';
import {
  decodeRecorderProject,
  encodeRecorderProject,
  type RecorderProject,
} from '../core/ProjectMediaModel.ts';
import { ProjectValidator } from '../core/ProjectValidator.ts';
import {
  canvasStylePixelDimensions,
  type CanvasResolution,
} from '../core/ProjectModel.ts';
import {
  exportSettingsOutputDimensions,
  makeExportSettings,
  type ExportQuality,
  type ExportVideoCodec,
} from '../core/ExportSettings.ts';
import { ExportEncodingPolicy } from '../core/ExportPolicy.ts';
import { makeOutputFrameSchedule } from '../core/OutputFrameSchedule.ts';
import { TimelineMap } from '../core/TimelineMap.ts';
import type { OutputFrameRate } from '../core/CaptureConfiguration.ts';
import { makePointerEventRecord } from '../core/ZoomAnimation.ts';
import { parsePointerJsonl } from '../capture/PointerJsonl.ts';
import { extractFrames } from '../capture/FrameExtractor.ts';
import { extractCameraFrames } from '../capture/CameraRecorder.ts';
import { enumerateDisplays } from '../capture/DisplayEnumeration.ts';
import { enumerateWindows } from '../capture/WindowEnumeration.ts';
import { enumerateDirectShowDevices } from '../capture/MediaDevices.ts';
import { recordSession, type RecordSessionOptions } from '../capture/RecordingSession.ts';
import { detectEncoder } from '../capture/ScreenRecorder.ts';
import {
  buildAudioMixFilterGraph,
  buildAudioOnlyM4aArgs,
  buildSessionAudioTracks,
  extractAudioSourceSlices,
} from '../render/AudioMixPlan.ts';

const EDGE_EXE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SAFE_RECORDING_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

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

export interface StudioServerOptions {
  rootDir: string;
  recordingsDir?: string;
  port?: number;
  allowShellOpen?: boolean;
}

export interface StudioServerHandle {
  port: number;
  url: string;
  close(): Promise<void>;
}

export interface ResolvedStudioExportSpec {
  format: 'mp4' | 'm4a';
  width: number;
  height: number;
  fps: OutputFrameRate;
  resolution: CanvasResolution;
  quality: ExportQuality;
  videoCodec: ExportVideoCodec;
  estimatedBytes: number;
  durationSeconds: number;
}

export interface StudioExportJobState {
  id: string;
  recordingId: string;
  format: 'mp4' | 'm4a';
  status: 'running' | 'completed' | 'cancelled' | 'error';
  doneFrames: number;
  totalFrames: number;
  width: number;
  height: number;
  fps: number;
  quality: ExportQuality;
  videoCodec: ExportVideoCodec;
  outFile: string;
  estimatedBytes: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

interface InternalExportJob extends StudioExportJobState {
  cancelRequested: boolean;
  server?: ExportServerHandle | null;
  childProc?: ChildProcess | null;
  tmpProfile?: string | null;
}

export interface StudioRecordJobState {
  status: 'idle' | 'recording' | 'completed' | 'error';
  sessionId: string | null;
  error: string | null;
  startedAt: string | null;
}

/**
 * Pure function: validates a recording directory identifier so hidden/legacy/traversal
 * names like `..`, `.git`, `_legacy-invalid`, or slash-containing strings are rejected.
 */
export function validateRecordingId(id: string): boolean {
  if (!id || typeof id !== 'string') return false;
  if (id === '.' || id === '..' || id === '_legacy-invalid') return false;
  if (id.includes('..') || id.includes('/') || id.includes('\\') || id.includes('\0')) {
    return false;
  }
  return SAFE_RECORDING_ID_RE.test(id);
}

/**
 * Pure function: computes aligned export dimensions, bitrate, and estimated file size
 * matching `ExportPolicy.ts` and `ProjectModel.ts`.
 */
export function resolveExportSpec(options: {
  project: RecorderProject;
  meta: Record<string, any>;
  format?: 'mp4' | 'm4a';
  resolution?: CanvasResolution;
  fps?: OutputFrameRate;
  quality?: ExportQuality;
  videoCodec?: ExportVideoCodec;
  includesAudio?: boolean;
  durationSeconds?: number;
}): ResolvedStudioExportSpec {
  const format: 'mp4' | 'm4a' = options.format === 'm4a' ? 'm4a' : 'mp4';
  const rawSourceDuration = Math.max(Number(options.meta?.durationSeconds) || 1, 0.05);
  const durationSeconds =
    typeof options.durationSeconds === 'number' &&
    Number.isFinite(options.durationSeconds) &&
    options.durationSeconds > 0
      ? options.durationSeconds
      : Math.max(
          0.05,
          new TimelineMap(options.project.timeline.sourceSequence, rawSourceDuration).outputDuration
        );

  const srcW = Math.max(Math.trunc(Number(options.meta?.width) || 1920), 2);
  const srcH = Math.max(Math.trunc(Number(options.meta?.height) || 1080), 2);
  const fps = (options.fps ?? options.project.exportSettings.frameRate ?? 60) as OutputFrameRate;
  const resolution: CanvasResolution =
    options.resolution ?? options.project.exportSettings.resolution ?? '原始素材';
  const quality: ExportQuality =
    options.quality ?? options.project.exportSettings.quality ?? 'high';
  const videoCodec: ExportVideoCodec =
    options.videoCodec ?? options.project.exportSettings.videoCodec ?? 'h264';

  const settings = makeExportSettings({
    frameRate: fps,
    resolution,
    videoCodec,
    quality,
  });

  const crop = options.project.canvas.crop;
  const croppedAspect = (srcW / srcH) * (crop.width / Math.max(crop.height, 0.01));
  const requested = canvasStylePixelDimensions(
    options.project.canvas,
    resolution,
    croppedAspect,
    { width: srcW, height: srcH }
  );
  const dims = exportSettingsOutputDimensions(settings, requested);
  const evenW = Math.max(2, Math.trunc(dims.width / 2) * 2);
  const evenH = Math.max(2, Math.trunc(dims.height / 2) * 2);

  const includesAudio = options.includesAudio ?? false;
  const bitsPerSec =
    format === 'm4a'
      ? ExportEncodingPolicy.audioBitrate
      : ExportEncodingPolicy.videoBitrate(evenW, evenH, fps, videoCodec, quality) +
        (includesAudio ? ExportEncodingPolicy.audioBitrate : 0);

  const estimatedBytes = Math.max(0, Math.round((bitsPerSec * durationSeconds) / 8));

  return {
    format,
    width: evenW,
    height: evenH,
    fps,
    resolution,
    quality,
    videoCodec,
    estimatedBytes,
    durationSeconds,
  };
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text.trim().length > 0 ? JSON.parse(text) : {};
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function countJpegFrames(dirPath: string): number {
  if (!existsSync(dirPath)) return 0;
  try {
    return readdirSync(dirPath).filter((name) => /^\d{6}\.jpg$/.test(name)).length;
  } catch {
    return 0;
  }
}

function killEdgeTree(proc: ChildProcess | null | undefined): void {
  if (!proc) return;
  try {
    if (!proc.killed) proc.kill('SIGKILL');
    if (process.platform === 'win32' && proc.pid) {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { stdio: 'ignore' });
    }
  } catch {
    // ignore
  }
}

export async function startStudioServer(o: StudioServerOptions): Promise<StudioServerHandle> {
  const rootDir = resolve(o.rootDir);
  const recordingsDir = resolve(o.recordingsDir ?? join(rootDir, 'recordings'));
  const exportJobs = new Map<string, InternalExportJob>();
  const saveLocks = new Map<string, Promise<void>>();
  let recordState: StudioRecordJobState = {
    status: 'idle',
    sessionId: null,
    error: null,
    startedAt: null,
  };

  function resolveSessionDir(recordingId: string): string | null {
    if (!validateRecordingId(recordingId)) return null;
    return resolveSafeChildPath(recordingsDir, recordingId);
  }

  function listRecordingsSummary() {
    if (!existsSync(recordingsDir)) return [];
    const entries = readdirSync(recordingsDir, { withFileTypes: true });
    const items: Array<Record<string, unknown>> = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || !validateRecordingId(entry.name)) continue;
      const dir = resolve(recordingsDir, entry.name);
      const metaPath = join(dir, 'meta.json');
      const projectPath = join(dir, 'project.json');
      const screenPath = join(dir, 'screen.mp4');
      if (!existsSync(metaPath) || !existsSync(projectPath) || !existsSync(screenPath)) continue;

      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
        const projRaw = JSON.parse(readFileSync(projectPath, 'utf8'));
        items.push({
          id: entry.name,
          title: typeof projRaw.title === 'string' ? projRaw.title : entry.name,
          createdAt: projRaw.createdAt ?? null,
          durationSeconds: Number(meta.durationSeconds) || 0,
          fps: Number(meta.fps) || 60,
          width: Number(meta.width) || 1920,
          height: Number(meta.height) || 1080,
          frameCount: Number(meta.frameCount) || 0,
          hasFrames: countJpegFrames(join(dir, 'frames')) > 0,
          hasCamera: existsSync(join(dir, 'camera.mp4')),
          hasSystemAudio: existsSync(join(dir, 'system-audio.wav')),
          hasMicAudio: existsSync(join(dir, 'mic-audio.wav')),
          hasExport: existsSync(join(dir, 'export.mp4')),
        });
      } catch {
        // Skip corrupted legacy dirs
      }
    }

    items.sort((a, b) => String(b.id).localeCompare(String(a.id)));
    return items;
  }

  async function runExportJob(
    job: InternalExportJob,
    recDir: string,
    project: RecorderProject,
    meta: Record<string, any>
  ): Promise<void> {
    try {
      const audioTracks = buildSessionAudioTracks({
        project: JSON.parse(encodeRecorderProject(project)),
        recDir,
        meta,
      });
      const sourceSlices = extractAudioSourceSlices(
        JSON.parse(encodeRecorderProject(project)),
        job.fps > 0 ? Number(meta.durationSeconds) || 1 : 1
      );

      if (job.format === 'm4a') {
        const m4aArgs = buildAudioOnlyM4aArgs(audioTracks, job.outFile, {
          durationSeconds: Number(meta.durationSeconds) || 1,
          sourceSlices,
        });
        if (!m4aArgs) {
          throw new Error('没有可导出的未静音音轨');
        }
        await fs.mkdir(resolve(job.outFile, '..'), { recursive: true });
        await new Promise<void>((resolveProc, rejectProc) => {
          const proc = spawn('ffmpeg', m4aArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
          job.childProc = proc;
          let stderr = '';
          proc.stderr?.on('data', (c) => {
            stderr += c.toString();
          });
          proc.on('error', rejectProc);
          proc.on('close', (code) => {
            if (job.cancelRequested) {
              rejectProc(new Error('导出已取消'));
              return;
            }
            if (code === 0) resolveProc();
            else rejectProc(new Error(`ffmpeg M4A 导出失败 (${code}): ${stderr.slice(-500)}`));
          });
        });
        job.doneFrames = job.totalFrames;
        job.status = 'completed';
        job.finishedAt = new Date().toISOString();
        return;
      }

      // MP4 export via ExportServer + headless Edge
      const sourceFps = Number(meta.fps) || 60;
      const framesDir = join(recDir, 'frames');
      let sourceFrameCount = countJpegFrames(framesDir);
      if (sourceFrameCount === 0) {
        sourceFrameCount = await extractFrames({
          video: join(recDir, 'screen.mp4'),
          outDir: framesDir,
          fps: sourceFps,
        });
      }
      if (job.cancelRequested) throw new Error('导出已取消');

      const cameraMp4 = join(recDir, 'camera.mp4');
      let cameraFramesDir: string | undefined;
      let cameraFramesBaseUrl: string | null = null;
      if (existsSync(cameraMp4)) {
        const camDir = join(recDir, 'camera_frames');
        let camCount = countJpegFrames(camDir);
        if (camCount === 0) {
          camCount = await extractCameraFrames({ video: cameraMp4, outDir: camDir, fps: sourceFps });
        }
        if (camCount > 0) {
          cameraFramesDir = camDir;
          cameraFramesBaseUrl = '/camera_frames';
        }
      }
      if (job.cancelRequested) throw new Error('导出已取消');

      const ptrPath = join(recDir, 'pointer.jsonl');
      let pointerEvents: ReturnType<typeof makePointerEventRecord>[] = [];
      if (existsSync(ptrPath)) {
        const parsed = parsePointerJsonl(readFileSync(ptrPath, 'utf8'));
        const offset = Number(meta.pointerOffsetSeconds) || 0;
        pointerEvents = parsed.events.map((e) =>
          makePointerEventRecord({
            time: Math.max(e.time + offset, 0),
            location: e.location,
            kind: e.kind,
            modifiers: e.modifiers,
            cursorAssetID: e.cursorAssetID,
          })
        );
      }

      const rawDur = Number(meta.durationSeconds) || 1;
      const maxSourceDur = sourceFrameCount > 0 ? Math.min(rawDur, sourceFrameCount / sourceFps) : rawDur;
      const tlMap = new TimelineMap(project.timeline.sourceSequence, maxSourceDur);
      const trueDuration = Math.max(0.05, tlMap.outputDuration);
      const schedule = makeOutputFrameSchedule(trueDuration, job.fps as OutputFrameRate);
      job.totalFrames = schedule.frameCount;

      const encoder = await detectEncoder();
      const audioMix = buildAudioMixFilterGraph(audioTracks, {
        durationSeconds: trueDuration,
        videoInputIndex: 0,
        sourceSlices,
      });

      const server = await startExportServer({
        rootDir,
        framesDir,
        cameraFramesDir,
        outFile: job.outFile,
        encoder,
        videoCodec: job.videoCodec,
        quality: job.quality,
        audioMix: audioMix ?? undefined,
        plan: {
          fps: job.fps,
          sourceFps,
          width: job.width,
          height: job.height,
          frameCount: schedule.frameCount,
          sourceFrameCount,
          durationSeconds: trueDuration,
          framesBaseUrl: '/frames',
          cameraFramesBaseUrl,
          project: JSON.parse(encodeRecorderProject(project)),
          pointerEvents,
        },
        onProgress: (done) => {
          job.doneFrames = done;
        },
      });
      job.server = server;

      const tmpProfile = await fs.mkdtemp(join(os.tmpdir(), 'dogsc-studio-export-'));
      job.tmpProfile = tmpProfile;
      const exportUrl = `http://127.0.0.1:${server.port}/web/render.html?mode=export`;
      const edge = spawn(
        EDGE_EXE,
        [
          '--headless=new',
          `--user-data-dir=${tmpProfile}`,
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-gpu-sandbox',
          '--use-angle=d3d11',
          `--window-size=${job.width},${job.height}`,
          exportUrl,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
      job.childProc = edge;

      let edgeStderr = '';
      edge.stderr?.on('data', (c) => {
        edgeStderr += c.toString();
      });

      let finished = false;
      const earlyExit = new Promise<never>((_, rej) => {
        edge.on('error', (err) => {
          if (!finished) rej(err);
        });
        edge.on('close', (code) => {
          if (!finished) {
            rej(new Error(`Edge 提前退出 (code ${code}): ${edgeStderr.slice(-400)}`));
          }
        });
      });

      await Promise.race([server.waitForDone(), earlyExit]);
      finished = true;
      job.doneFrames = job.totalFrames;
      job.status = job.cancelRequested ? 'cancelled' : 'completed';
      job.finishedAt = new Date().toISOString();
    } catch (err: any) {
      if (job.cancelRequested) {
        job.status = 'cancelled';
        job.error = '已取消导出';
      } else {
        job.status = 'error';
        job.error = err?.message ?? String(err);
      }
      job.finishedAt = new Date().toISOString();
      rmSync(job.outFile, { force: true });
    } finally {
      killEdgeTree(job.childProc);
      job.childProc = null;
      if (job.server) {
        await job.server.close().catch(() => {});
        job.server = null;
      }
      if (job.tmpProfile) {
        await fs.rm(job.tmpProfile, { recursive: true, force: true }).catch(() => {});
        job.tmpProfile = null;
      }
    }
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const rawReqUrl = req.url ?? '/';
      const rawPathOnly = rawReqUrl.split('?')[0] ?? '/';
      const rawDecoded = decodeURIComponent(rawPathOnly);
      if (rawDecoded.split(/[\\/]/).includes('..')) {
        sendText(res, 403, '403 Forbidden: Path traversal prohibited');
        return;
      }
      const parsed = new URL(rawReqUrl, 'http://127.0.0.1');
      const decodedPath = decodeURIComponent(parsed.pathname);

      // 1. Root redirect
      if (req.method === 'GET' && decodedPath === '/') {
        res.writeHead(302, { Location: '/web/studio.html' });
        res.end();
        return;
      }

      if (req.method === 'GET' && decodedPath === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }

      // 2. Health & device discovery
      if (req.method === 'GET' && decodedPath === '/api/health') {
        sendJson(res, 200, { ok: true, version: '1.0.0' });
        return;
      }

      if (req.method === 'GET' && decodedPath === '/api/devices') {
        const [displays, windows, dshow] = await Promise.all([
          enumerateDisplays().catch(() => []),
          enumerateWindows().catch(() => []),
          enumerateDirectShowDevices().catch(() => ({ video: [], audio: [] })),
        ]);
        sendJson(res, 200, {
          displays,
          windows,
          cameras: dshow.video,
          microphones: dshow.audio,
        });
        return;
      }

      // 3. Recordings list
      if (req.method === 'GET' && decodedPath === '/api/recordings') {
        sendJson(res, 200, { recordings: listRecordingsSummary() });
        return;
      }

      // 4. Background capture endpoints
      if (req.method === 'GET' && decodedPath === '/api/record/status') {
        sendJson(res, 200, recordState);
        return;
      }

      if (req.method === 'POST' && decodedPath === '/api/record/start') {
        if (recordState.status === 'recording') {
          sendJson(res, 409, { error: '已有录制任务正在运行' });
          return;
        }
        const body = (await readJsonBody(req)) as Record<string, any>;
        const opts: RecordSessionOptions = {
          seconds: Math.min(Math.max(Number(body.seconds) || 6, 1), 600),
          fps: Number(body.fps) || 60,
          outputIdx: Number(body.outputIdx) || 0,
          captureMode:
            body.captureMode === 'window' || body.captureMode === 'region'
              ? body.captureMode
              : 'display',
          windowTitle: typeof body.windowTitle === 'string' ? body.windowTitle : undefined,
          windowBounds: body.windowBounds,
          region: body.region,
          recordSystemAudio: Boolean(body.recordSystemAudio),
          micDeviceName: typeof body.micDeviceName === 'string' && body.micDeviceName ? body.micDeviceName : undefined,
          cameraDeviceName: typeof body.cameraDeviceName === 'string' && body.cameraDeviceName ? body.cameraDeviceName : undefined,
          baseDir: recordingsDir,
        };
        recordState = {
          status: 'recording',
          sessionId: null,
          error: null,
          startedAt: new Date().toISOString(),
        };
        void recordSession(opts)
          .then((sessionDir) => {
            const parts = sessionDir.replace(/[\\/]+$/, '').split(/[\\/]/);
            recordState = {
              status: 'completed',
              sessionId: parts[parts.length - 1] ?? null,
              error: null,
              startedAt: recordState.startedAt,
            };
          })
          .catch((err: any) => {
            recordState = {
              status: 'error',
              sessionId: null,
              error: err?.message ?? String(err),
              startedAt: recordState.startedAt,
            };
          });
        sendJson(res, 202, recordState);
        return;
      }

      // 5. Export job polling & cancellation
      if (req.method === 'GET' && decodedPath.startsWith('/api/export/status/')) {
        const jobId = decodedPath.slice('/api/export/status/'.length);
        const job = exportJobs.get(jobId);
        if (!job) {
          sendJson(res, 404, { error: '导出任务不存在' });
          return;
        }
        const { cancelRequested: _c, server: _s, childProc: _p, tmpProfile: _t, ...pub } = job;
        sendJson(res, 200, pub);
        return;
      }

      if (req.method === 'POST' && decodedPath.startsWith('/api/export/cancel/')) {
        const jobId = decodedPath.slice('/api/export/cancel/'.length);
        const job = exportJobs.get(jobId);
        if (!job) {
          sendJson(res, 404, { error: '导出任务不存在' });
          return;
        }
        job.cancelRequested = true;
        job.status = 'cancelled';
        job.finishedAt = new Date().toISOString();
        killEdgeTree(job.childProc);
        if (job.server) {
          await job.server.close().catch(() => {});
          job.server = null;
        }
        rmSync(job.outFile, { force: true });
        sendJson(res, 200, { ok: true, id: jobId, status: 'cancelled' });
        return;
      }

      // 6. Session frame asset streaming: /recordings/:id/frames/<name> & camera_frames
      const recFrameMatch = /^\/recordings\/([^/]+)\/(frames|camera_frames)\/(.+)$/.exec(decodedPath);
      if (req.method === 'GET' && recFrameMatch) {
        const [, recId, kindDir, relFrame] = recFrameMatch;
        const sessionDir = resolveSessionDir(recId);
        if (!sessionDir || !existsSync(sessionDir)) {
          sendText(res, 403, '403 Forbidden: Invalid recording ID');
          return;
        }
        const dir = join(sessionDir, kindDir);
        const safePath = resolveSafeChildPath(dir, relFrame);
        if (!safePath) {
          sendText(res, 403, '403 Forbidden: Path traversal prohibited');
          return;
        }
        if (!existsSync(safePath) || statSync(safePath).isDirectory()) {
          sendText(res, 404, '404 Frame Not Found');
          return;
        }
        const buf = readFileSync(safePath);
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Content-Length': buf.length,
          'Cache-Control': 'no-cache',
        });
        res.end(buf);
        return;
      }

      // 7. Recording API routes: /api/recordings/:id/...
      if (decodedPath.startsWith('/api/recordings/')) {
        const rest = decodedPath.slice('/api/recordings/'.length).split('/');
        const recId = rest[0];
        const subRoute = rest.slice(1).join('/');
        const sessionDir = resolveSessionDir(recId);
        if (!sessionDir) {
          sendJson(res, 400, { error: '录制目录 ID 非法' });
          return;
        }
        if (!existsSync(sessionDir)) {
          sendJson(res, 404, { error: '录制目录不存在' });
          return;
        }

        if (req.method === 'GET' && subRoute === '') {
          const metaPath = join(sessionDir, 'meta.json');
          const projectPath = join(sessionDir, 'project.json');
          if (!existsSync(metaPath) || !existsSync(projectPath)) {
            sendJson(res, 404, { error: '缺少 meta.json 或 project.json' });
            return;
          }
          const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
          const rawProject = JSON.parse(readFileSync(projectPath, 'utf8'));
          const decodedProject = decodeRecorderProject(rawProject);
          const normalizedProject = JSON.parse(encodeRecorderProject(decodedProject));
          const pointerPath = join(sessionDir, 'pointer.jsonl');
          let pointerEvents: ReturnType<typeof makePointerEventRecord>[] = [];
          if (existsSync(pointerPath)) {
            const parsedPtr = parsePointerJsonl(readFileSync(pointerPath, 'utf8'));
            const offset = Number(meta.pointerOffsetSeconds) || 0;
            pointerEvents = parsedPtr.events.map((e) =>
              makePointerEventRecord({
                time: Math.max(e.time + offset, 0),
                location: e.location,
                kind: e.kind,
                modifiers: e.modifiers,
                cursorAssetID: e.cursorAssetID,
              })
            );
          }

          sendJson(res, 200, {
            id: recId,
            meta,
            project: normalizedProject,
            pointerEvents,
            sourceFrameCount: countJpegFrames(join(sessionDir, 'frames')),
            cameraFrameCount: countJpegFrames(join(sessionDir, 'camera_frames')),
            hasCamera: existsSync(join(sessionDir, 'camera.mp4')),
            hasSystemAudio: existsSync(join(sessionDir, 'system-audio.wav')),
            hasMicAudio: existsSync(join(sessionDir, 'mic-audio.wav')),
            hasExport: existsSync(join(sessionDir, 'export.mp4')),
          });
          return;
        }

        if (req.method === 'PUT' && subRoute === 'project') {
          let body: unknown;
          try {
            body = await readJsonBody(req);
          } catch (err: any) {
            sendJson(res, 400, { error: `JSON 解析失败: ${err?.message ?? err}` });
            return;
          }
          let project: RecorderProject;
          try {
            project = decodeRecorderProject(body as Record<string, any>);
            ProjectValidator.validate(project);
          } catch (err: any) {
            sendJson(res, 400, { error: `工程校验失败: ${err?.message ?? err}` });
            return;
          }
          const encoded = encodeRecorderProject(project);
          const projectPath = join(sessionDir, 'project.json');
          const prevLock = saveLocks.get(recId) ?? Promise.resolve();
          const nextSave = prevLock.then(() => {
            const tmpPath = join(sessionDir, `.project.json.tmp.${process.pid}.${Date.now()}`);
            writeFileSync(tmpPath, encoded, 'utf8');
            renameSync(tmpPath, projectPath);
          });
          saveLocks.set(recId, nextSave.catch(() => {}));
          await nextSave;
          sendJson(res, 200, { ok: true, savedAt: new Date().toISOString() });
          return;
        }

        if (req.method === 'POST' && subRoute === 'prepare-frames') {
          const metaPath = join(sessionDir, 'meta.json');
          const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
          const fps = Number(meta.fps) || 60;
          const framesDir = join(sessionDir, 'frames');
          let sourceFrameCount = countJpegFrames(framesDir);
          if (sourceFrameCount === 0 && existsSync(join(sessionDir, 'screen.mp4'))) {
            sourceFrameCount = await extractFrames({
              video: join(sessionDir, 'screen.mp4'),
              outDir: framesDir,
              fps,
            });
          }
          let cameraFrameCount = countJpegFrames(join(sessionDir, 'camera_frames'));
          if (cameraFrameCount === 0 && existsSync(join(sessionDir, 'camera.mp4'))) {
            cameraFrameCount = await extractCameraFrames({
              video: join(sessionDir, 'camera.mp4'),
              outDir: join(sessionDir, 'camera_frames'),
              fps,
            });
          }
          sendJson(res, 200, { sourceFrameCount, cameraFrameCount });
          return;
        }

        if (req.method === 'POST' && subRoute === 'export') {
          const body = (await readJsonBody(req)) as Record<string, any>;
          const meta = JSON.parse(readFileSync(join(sessionDir, 'meta.json'), 'utf8'));
          const project = decodeRecorderProject(
            JSON.parse(readFileSync(join(sessionDir, 'project.json'), 'utf8'))
          );
          const hasAudio =
            existsSync(join(sessionDir, 'system-audio.wav')) ||
            existsSync(join(sessionDir, 'mic-audio.wav')) ||
            project.timeline.audioClips.length > 0;
          const spec = resolveExportSpec({
            project,
            meta,
            format: body.format === 'm4a' ? 'm4a' : 'mp4',
            resolution: body.resolution,
            fps: body.fps,
            quality: body.quality,
            videoCodec: body.videoCodec,
            includesAudio: hasAudio,
          });
          const customName =
            typeof body.fileName === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(body.fileName)
              ? body.fileName
              : spec.format === 'm4a'
                ? 'export.m4a'
                : 'export.mp4';
          const outFile = join(sessionDir, customName);
          const schedule = makeOutputFrameSchedule(spec.durationSeconds, spec.fps);
          const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const job: InternalExportJob = {
            id: jobId,
            recordingId: recId,
            format: spec.format,
            status: 'running',
            doneFrames: 0,
            totalFrames: schedule.frameCount,
            width: spec.width,
            height: spec.height,
            fps: spec.fps,
            quality: spec.quality,
            videoCodec: spec.videoCodec,
            outFile,
            estimatedBytes: spec.estimatedBytes,
            error: null,
            startedAt: new Date().toISOString(),
            finishedAt: null,
            cancelRequested: false,
          };
          exportJobs.set(jobId, job);
          void runExportJob(job, sessionDir, project, meta);
          const { cancelRequested: _c, server: _s, childProc: _p, tmpProfile: _t, ...pub } = job;
          sendJson(res, 202, pub);
          return;
        }

        if (req.method === 'POST' && subRoute === 'open-folder') {
          if (o.allowShellOpen !== false && process.platform === 'win32') {
            const child = spawn('explorer.exe', [sessionDir], {
              detached: true,
              stdio: 'ignore',
            });
            child.unref();
          }
          sendJson(res, 200, { ok: true, dir: sessionDir });
          return;
        }
      }

      // 8. Static web/src files with on-the-fly TS type stripping
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
      res.setHeader('Connection', 'close');

      if (ext === '.ts') {
        const rawCode = readFileSync(targetPath, 'utf8');
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
      sendJson(res, 500, { error: err?.message ?? String(err) });
    }
  });

  mkdirSync(recordingsDir, { recursive: true });

  return new Promise<StudioServerHandle>((resolveServer, rejectServer) => {
    server.once('error', rejectServer);
    server.listen(o.port ?? 0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const url = `http://127.0.0.1:${port}/web/studio.html`;

      resolveServer({
        port,
        url,
        close: async () => {
          for (const job of exportJobs.values()) {
            if (job.status === 'running') {
              job.cancelRequested = true;
              killEdgeTree(job.childProc);
              if (job.server) {
                await job.server.close().catch(() => {});
              }
            }
          }
          await new Promise<void>((res) => {
            if (typeof (server as any).closeAllConnections === 'function') {
              (server as any).closeAllConnections();
            }
            server.close(() => res());
          });
        },
      });
    });
  });
}
