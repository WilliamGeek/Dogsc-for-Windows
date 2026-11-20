/**
 * ScreenRecorder.ts
 *
 * Screen capture using ffmpeg with Desktop Duplication API (ddagrab) and NVENC / libx264.
 * Strictly adheres to docs/CONTRACTS.md §3, §5, and user-aligned parameters:
 * - Default 60fps CFR
 * - Visual near-lossless NVENC (p4, vbr, cq 23, b:v 0) / libx264 fallback
 * - output_idx display targeting
 *
 * T12.2: ffmpeg exit status is part of the recording contract. A recorder that
 * dies early (invalid display, missing encoder, permission failure) must reject
 * instead of producing a session directory that looks successful.
 */

import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const STDERR_TAIL_LIMIT = 16 * 1024;
const STOP_TIMEOUT_MS = 5000;

export type VideoEncoderKind = 'h264_nvenc' | 'libx264';

export interface FfmpegArgsOptions {
  outFile: string;
  fps: number;
  encoder: VideoEncoderKind;
  outputIdx?: number;
  /** Draw the OS cursor into the capture. Defaults to false (T12.3). */
  drawMouse?: boolean;
}

export interface ScreenRecorderOptions {
  outFile: string;
  fps?: number;
  outputIdx?: number;
  encoder?: VideoEncoderKind;
  /** Draw the OS cursor into the capture. Defaults to false (T12.3). */
  drawMouse?: boolean;
  /** ffmpeg binary; test seam for a fake command. Defaults to `ffmpeg`. */
  ffmpegBin?: string;
  /** Leading args before ffmpeg args; test seam only. */
  ffmpegArgsPrefix?: string[];
}

/** Result of the ffmpeg process closing, including its stderr tail. */
export interface ScreenRecorderExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  spawnError: Error | null;
}

export interface ScreenRecorderHandle {
  screenStartUnixMs: number;
  process: ChildProcess;
  /** Resolves when ffmpeg closes; never rejects. */
  exited: Promise<ScreenRecorderExit>;
  stop(): Promise<void>;
}

function formatExitError(result: ScreenRecorderExit, timedOut: boolean): string {
  const tail = result.stderr.trim().slice(-500);
  const reason = timedOut
    ? `ffmpeg 停止超时 (${STOP_TIMEOUT_MS}ms)`
    : result.spawnError
      ? `ffmpeg 启动失败: ${result.spawnError.message}`
      : `ffmpeg 非零退出 (code ${String(result.code)})`;
  return tail ? `${reason}: ${tail}` : reason;
}

/**
 * Pure function: constructs the command-line argument list for ffmpeg screen recording.
 */
export function buildFfmpegArgs(o: FfmpegArgsOptions): string[] {
  const outputIdx = o.outputIdx ?? 0;
  const fps = o.fps > 0 ? o.fps : 60;
  const drawMouse = o.drawMouse ?? false;

  const baseArgs: string[] = [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `ddagrab=output_idx=${outputIdx}:framerate=${fps}:draw_mouse=${drawMouse ? 1 : 0}`,
    '-vf',
    'hwdownload,format=bgra,format=yuv420p',
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
      '-r',
      String(fps),
      '-fps_mode',
      'cfr',
      o.outFile,
    ];
  } else {
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
      '-r',
      String(fps),
      '-fps_mode',
      'cfr',
      o.outFile,
    ];
  }
}

/**
 * Detects whether hardware-accelerated h264_nvenc is supported by the installed ffmpeg.
 *
 * Listing the encoder is not enough: a GPU/driver mismatch can make the
 * encoder visible but unusable. T12.3 performs a one-frame null-output
 * probe and falls back to libx264 on any failure.
 */
export async function detectEncoder(
  options: { ffmpegBin?: string; ffmpegArgsPrefix?: string[] } = {}
): Promise<VideoEncoderKind> {
  const bin = options.ffmpegBin ?? 'ffmpeg';
  const prefix = options.ffmpegArgsPrefix ?? [];

  try {
    const { stdout } = await execFileAsync(bin, [...prefix, '-hide_banner', '-encoders'], {
      timeout: 5000,
    });
    if (!stdout.includes('h264_nvenc')) {
      return 'libx264';
    }

    await execFileAsync(
      bin,
      [
        ...prefix,
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=256x256:d=0.04',
        '-frames:v',
        '1',
        '-c:v',
        'h264_nvenc',
        '-f',
        'null',
        '-',
      ],
      { timeout: 3000 }
    );
    return 'h264_nvenc';
  } catch {
    // Missing ffmpeg, missing NVENC, or a real GPU probe failure all fall back.
    return 'libx264';
  }
}

/**
 * Starts screen recording via ffmpeg.
 *
 * @param o Configuration options for output file, frame rate, encoder, and display index.
 * @returns Handle containing screenStartUnixMs, process, exited status, and stop().
 */
export function startScreenRecording(o: ScreenRecorderOptions): ScreenRecorderHandle {
  const fps = o.fps ?? 60;
  const encoder = o.encoder ?? 'h264_nvenc';
  const outputIdx = o.outputIdx ?? 0;

  const args = buildFfmpegArgs({
    outFile: o.outFile,
    fps,
    encoder,
    outputIdx,
    drawMouse: o.drawMouse,
  });

  // Contract §3: screenStartUnixMs is sampled immediately before spawning ffmpeg.
  // T12.7 will replace this with the first-frame timestamp.
  const screenStartUnixMs = Date.now();

  const proc = spawn(o.ffmpegBin ?? 'ffmpeg', [...(o.ffmpegArgsPrefix ?? []), ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stderrTail = '';
  let spawnError: Error | null = null;
  let closeResult: ScreenRecorderExit | null = null;
  let resolveExited!: (result: ScreenRecorderExit) => void;

  const exited = new Promise<ScreenRecorderExit>((resolve) => {
    resolveExited = resolve;
  });

  const finalizeExit = (result: ScreenRecorderExit) => {
    if (closeResult) return;
    closeResult = result;
    resolveExited(result);
  };

  proc.stderr?.on('data', (chunk: Buffer | string) => {
    stderrTail = (stderrTail + String(chunk)).slice(-STDERR_TAIL_LIMIT);
  });

  proc.on('error', (err: Error) => {
    spawnError = err;
    // A spawn failure may not emit close on every platform.
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
      let isSettled = false;
      let timedOut = false;
      let stopTimer: NodeJS.Timeout | null = null;
      let killTimer: NodeJS.Timeout | null = null;

      const settle = (result: ScreenRecorderExit | null) => {
        if (isSettled) return;
        isSettled = true;
        if (stopTimer) clearTimeout(stopTimer);
        if (killTimer) clearTimeout(killTimer);

        const finalResult =
          result ?? {
            code: proc.exitCode,
            signal: null,
            stderr: stderrTail,
            spawnError,
          };

        if (timedOut) {
          reject(new Error(formatExitError(finalResult, true)));
          return;
        }
        if (finalResult.spawnError) {
          reject(new Error(formatExitError(finalResult, false)));
          return;
        }
        if (finalResult.code !== 0) {
          reject(new Error(formatExitError(finalResult, false)));
          return;
        }
        resolve();
      };

      exited.then((result) => {
        settle(result);
      });

      // If already closed, settle immediately through the exited result.
      if (closeResult) {
        settle(closeResult);
        return;
      }

      // Send 'q' to ffmpeg stdin to gracefully close and write MP4 moov atom.
      try {
        if (proc.stdin && !proc.stdin.destroyed) {
          proc.stdin.write('q\n');
          proc.stdin.end();
        }
      } catch {
        // Stdin may already be closed.
      }

      stopTimer = setTimeout(() => {
        timedOut = true;
        try {
          proc.kill();
        } catch {
          // Already exited.
        }
        // Give the OS a short grace period to emit close; never hang forever.
        killTimer = setTimeout(() => {
          if (!isSettled) {
            settle({
              code: proc.exitCode,
              signal: null,
              stderr: stderrTail,
              spawnError,
            });
          }
        }, 500);
      }, STOP_TIMEOUT_MS);

      if (typeof stopTimer.unref === 'function') {
        stopTimer.unref();
      }
      if (killTimer && typeof killTimer.unref === 'function') {
        killTimer.unref();
      }
    });

    return stopPromise;
  };

  return {
    screenStartUnixMs,
    process: proc,
    exited,
    stop,
  };
}
