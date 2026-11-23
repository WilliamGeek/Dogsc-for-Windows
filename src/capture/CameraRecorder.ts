/**
 * CameraRecorder.ts
 *
 * Records Windows DirectShow camera video to H.264 MP4 via FFmpeg with
 * `-vf showinfo` first-frame timestamp capture for clock synchronization,
 * and pre-decodes camera_frames/%06d.jpg for WebGL2 PiP compositing.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { extractFrames } from './FrameExtractor.ts';
import { parseShowinfoFirstFramePts, type VideoEncoderKind } from './ScreenRecorder.ts';
import { makeMediaSyncAnchor, type MediaSyncAnchor } from '../core/MediaTimeline.ts';

const STDERR_TAIL_LIMIT = 16 * 1024;
const STOP_TIMEOUT_MS = 5000;

export interface CameraFfmpegArgsOptions {
  deviceName: string;
  outFile: string;
  fps?: number;
  width?: number;
  height?: number;
  encoder?: VideoEncoderKind;
}

export interface CameraRecorderOptions extends CameraFfmpegArgsOptions {
  /** Test seam binary (defaults to `ffmpeg`). */
  ffmpegBin?: string;
  /** Leading args before ffmpeg args (test seam). */
  ffmpegArgsPrefix?: string[];
}

export interface CameraRecorderExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  spawnError: Error | null;
}

export interface CameraRecorderHandle {
  readonly cameraStartUnixMs: number;
  readonly firstFrameUnixMs: number | null;
  readonly ready: Promise<number>;
  readonly process: ChildProcess;
  readonly exited: Promise<CameraRecorderExit>;
  stop(): Promise<void>;
}

/**
 * Pure function: constructs FFmpeg DirectShow camera capture arguments with `showinfo`
 * so stderr `n:   0` provides the exact first captured camera frame timestamp.
 */
export function buildCameraFfmpegArgs(o: CameraFfmpegArgsOptions): string[] {
  const deviceName = o.deviceName?.trim() ?? '';
  if (!deviceName) {
    throw new Error('摄像头录制需要非空的 DirectShow deviceName');
  }
  if (!o.outFile || !o.outFile.trim()) {
    throw new Error('摄像头录制需要有效的 outFile 路径');
  }

  const fps = o.fps && o.fps > 0 ? Math.trunc(o.fps) : 30;
  const encoder: VideoEncoderKind = o.encoder ?? 'h264_nvenc';

  const args: string[] = [
    '-y',
    '-progress',
    'pipe:1',
    '-stats_period',
    '0.05',
    '-f',
    'dshow',
    '-framerate',
    String(fps),
  ];

  if (
    o.width !== undefined &&
    o.height !== undefined &&
    Number.isFinite(o.width) &&
    Number.isFinite(o.height) &&
    o.width > 0 &&
    o.height > 0
  ) {
    args.push('-video_size', `${Math.trunc(o.width)}x${Math.trunc(o.height)}`);
  }

  args.push(
    '-i',
    `video=${deviceName}`,
    '-vf',
    'showinfo,format=yuv420p',
    '-r',
    String(fps),
    '-fps_mode',
    'cfr'
  );

  if (encoder === 'h264_nvenc') {
    args.push(
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
      '-bf',
      '0',
      '-rc-lookahead',
      '0'
    );
  } else {
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20');
  }

  args.push('-pix_fmt', 'yuv420p', '-movflags', '+faststart', o.outFile);
  return args;
}

/**
 * Pure function: computes offset (seconds) of camera's first frame vs screen's first frame.
 * Positive => camera started after screen (`startOffset > 0`);
 * Negative => camera started before screen (`sourceStartTime > 0`).
 */
export function computeCameraOffsetSeconds(
  cameraFirstFrameUnixMs: number,
  screenFirstFrameUnixMs: number
): number {
  if (!Number.isFinite(cameraFirstFrameUnixMs) || !Number.isFinite(screenFirstFrameUnixMs)) {
    return 0;
  }
  return (cameraFirstFrameUnixMs - screenFirstFrameUnixMs) / 1000;
}

/**
 * Pure function: creates a clamped MediaSyncAnchor aligning camera timeline to screen frame 0.
 */
export function buildCameraSyncAnchor(
  cameraFirstFrameUnixMs: number,
  screenFirstFrameUnixMs: number
): MediaSyncAnchor {
  return makeMediaSyncAnchor({
    sourceTime: 0,
    offset: computeCameraOffsetSeconds(cameraFirstFrameUnixMs, screenFirstFrameUnixMs),
  });
}

function formatExitError(result: CameraRecorderExit, timedOut: boolean): string {
  const tail = result.stderr.trim().slice(-500);
  const reason = timedOut
    ? `摄像头 ffmpeg 停止超时 (${STOP_TIMEOUT_MS}ms)`
    : result.spawnError
      ? `摄像头 ffmpeg 启动失败: ${result.spawnError.message}`
      : `摄像头 ffmpeg 非零退出 (code ${String(result.code)})`;
  return tail ? `${reason}: ${tail}` : reason;
}

/**
 * Starts DirectShow camera recording to MP4 via FFmpeg.
 */
export function startCameraRecording(o: CameraRecorderOptions): CameraRecorderHandle {
  const args = buildCameraFfmpegArgs(o);
  const cameraStartUnixMs = Date.now();

  const proc = spawn(o.ffmpegBin ?? 'ffmpeg', [...(o.ffmpegArgsPrefix ?? []), ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let firstFrameUnixMs: number | null = null;
  let progressFrame = 0;
  let progressOutTimeUs = 0;
  let hasProgressOutTime = false;
  let stdoutBuffer = '';
  let stderrTail = '';
  let stderrLineBuffer = '';
  let spawnError: Error | null = null;
  let closeResult: CameraRecorderExit | null = null;

  let resolveReady!: (ts: number) => void;
  let rejectReady!: (err: Error) => void;
  const ready = new Promise<number>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });
  ready.catch(() => {});

  let resolveExited!: (res: CameraRecorderExit) => void;
  const exited = new Promise<CameraRecorderExit>((res) => {
    resolveExited = res;
  });

  const tryResolveFromProgress = () => {
    if (firstFrameUnixMs !== null || progressFrame < 1 || !hasProgressOutTime) return;
    firstFrameUnixMs = Math.round(Date.now() - progressOutTimeUs / 1000);
    resolveReady(firstFrameUnixMs);
  };

  const tryResolveFromShowinfo = (line: string) => {
    if (firstFrameUnixMs !== null) return;
    const pts = parseShowinfoFirstFramePts(line);
    if (pts === null) return;
    firstFrameUnixMs = Date.now();
    resolveReady(firstFrameUnixMs);
  };

  const parseProgressLine = (line: string) => {
    if (firstFrameUnixMs !== null) return;
    const eq = line.indexOf('=');
    if (eq < 0) return;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (key === 'frame') {
      const parsed = Number(val);
      if (Number.isFinite(parsed)) progressFrame = parsed;
      tryResolveFromProgress();
      return;
    }
    if (key === 'out_time_us') {
      const parsed = Number(val);
      if (Number.isFinite(parsed) && parsed >= 0) {
        progressOutTimeUs = parsed;
        hasProgressOutTime = true;
        tryResolveFromProgress();
      }
    }
  };

  proc.stdout?.on('data', (chunk: Buffer | string) => {
    stdoutBuffer += String(chunk);
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) parseProgressLine(line);
  });

  proc.stderr?.on('data', (chunk: Buffer | string) => {
    const text = String(chunk);
    stderrTail = (stderrTail + text).slice(-STDERR_TAIL_LIMIT);
    stderrLineBuffer += text;
    const lines = stderrLineBuffer.split(/\r?\n/);
    stderrLineBuffer = lines.pop() ?? '';
    for (const line of lines) tryResolveFromShowinfo(line);
  });

  const finalizeExit = (result: CameraRecorderExit) => {
    if (closeResult) return;
    closeResult = result;
    if (firstFrameUnixMs === null) {
      rejectReady(new Error(formatExitError(result, false)));
    }
    resolveExited(result);
  };

  proc.on('error', (err: Error) => {
    spawnError = err;
    if (proc.pid === undefined) {
      finalizeExit({ code: null, signal: null, stderr: stderrTail, spawnError });
    }
  });

  proc.on('close', (code, signal) => {
    finalizeExit({ code, signal, stderr: stderrTail, spawnError });
  });

  let stopPromise: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;

    stopPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      let timedOut = false;
      let stopTimer: NodeJS.Timeout | null = null;
      let killTimer: NodeJS.Timeout | null = null;

      const settle = (result: CameraRecorderExit | null) => {
        if (settled) return;
        settled = true;
        if (stopTimer) clearTimeout(stopTimer);
        if (killTimer) clearTimeout(killTimer);

        const finalResult: CameraRecorderExit = result ?? {
          code: proc.exitCode,
          signal: null,
          stderr: stderrTail,
          spawnError,
        };
        if (timedOut) {
          reject(new Error(formatExitError(finalResult, true)));
          return;
        }
        if (finalResult.spawnError || finalResult.code !== 0) {
          reject(new Error(formatExitError(finalResult, false)));
          return;
        }
        resolve();
      };

      exited.then((res) => settle(res));
      if (closeResult) {
        settle(closeResult);
        return;
      }

      try {
        if (proc.stdin && !proc.stdin.destroyed) {
          proc.stdin.write('q\n');
          proc.stdin.end();
        }
      } catch {
        // ignore
      }

      stopTimer = setTimeout(() => {
        timedOut = true;
        try {
          proc.kill();
        } catch {
          // ignore
        }
        killTimer = setTimeout(() => {
          if (!settled) {
            settle({
              code: proc.exitCode,
              signal: null,
              stderr: stderrTail,
              spawnError,
            });
          }
        }, 500);
      }, STOP_TIMEOUT_MS);

      if (typeof stopTimer.unref === 'function') stopTimer.unref();
      if (killTimer && typeof killTimer.unref === 'function') killTimer.unref();
    });

    return stopPromise;
  };

  return {
    cameraStartUnixMs,
    get firstFrameUnixMs() {
      return firstFrameUnixMs;
    },
    ready,
    process: proc,
    exited,
    stop,
  };
}

/**
 * Pre-decodes camera.mp4 into sequential JPEGs (`camera_frames/%06d.jpg`).
 */
export async function extractCameraFrames(options: {
  video: string;
  outDir: string;
  fps?: number;
}): Promise<number> {
  return extractFrames({
    video: options.video,
    outDir: options.outDir,
    fps: options.fps ?? 30,
  });
}
