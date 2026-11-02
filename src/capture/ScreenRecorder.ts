/**
 * ScreenRecorder.ts
 *
 * Screen capture using ffmpeg with Desktop Duplication API (ddagrab) and NVENC / libx264.
 * Strictly adheres to docs/CONTRACTS.md §3, §5, and user-aligned parameters:
 * - Default 60fps CFR
 * - Visual near-lossless NVENC (p4, vbr, cq 23, b:v 0) / libx264 fallback
 * - output_idx display targeting
 */

import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type VideoEncoderKind = 'h264_nvenc' | 'libx264';

export interface FfmpegArgsOptions {
  outFile: string;
  fps: number;
  encoder: VideoEncoderKind;
  outputIdx?: number;
}

export interface ScreenRecorderOptions {
  outFile: string;
  fps?: number;
  outputIdx?: number;
  encoder?: VideoEncoderKind;
}

export interface ScreenRecorderHandle {
  screenStartUnixMs: number;
  process: ChildProcess;
  stop(): Promise<void>;
}

/**
 * Pure function: constructs the command-line argument list for ffmpeg screen recording.
 */
export function buildFfmpegArgs(o: FfmpegArgsOptions): string[] {
  const outputIdx = o.outputIdx ?? 0;
  const fps = o.fps > 0 ? o.fps : 60;

  const baseArgs: string[] = [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `ddagrab=output_idx=${outputIdx}:framerate=${fps}`,
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
 */
export async function detectEncoder(): Promise<VideoEncoderKind> {
  try {
    const { stdout } = await execFileAsync('ffmpeg', ['-hide_banner', '-encoders']);
    if (stdout.includes('h264_nvenc')) {
      return 'h264_nvenc';
    }
  } catch {
    // If detection fails or ffmpeg is missing, fallback to libx264
  }
  return 'libx264';
}

/**
 * Starts screen recording via ffmpeg.
 *
 * @param o Configuration options for output file, frame rate, encoder, and display index.
 * @returns Handle containing screenStartUnixMs, process, and graceful stop() function.
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
  });

  // Contract §3: screenStartUnixMs is sampled immediately before spawning ffmpeg
  const screenStartUnixMs = Date.now();

  const proc = spawn('ffmpeg', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stopPromise: Promise<void> | null = null;

  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;

    stopPromise = new Promise<void>((resolve) => {
      let isSettled = false;

      const finish = () => {
        if (!isSettled) {
          isSettled = true;
          resolve();
        }
      };

      if (proc.exitCode !== null || proc.killed) {
        finish();
        return;
      }

      proc.once('exit', () => {
        finish();
      });

      // Send 'q' to ffmpeg stdin to gracefully close and write MP4 moov atom
      try {
        if (proc.stdin && !proc.stdin.destroyed) {
          proc.stdin.write('q\n');
          proc.stdin.end();
        }
      } catch {
        // Stdin may already be closed
      }

      // 5000ms timeout fallback per task requirements
      const timer = setTimeout(() => {
        if (!isSettled) {
          try {
            proc.kill();
          } catch {
            // Already exited
          }
          finish();
        }
      }, 5000);

      if (typeof timer.unref === 'function') {
        timer.unref();
      }
    });

    return stopPromise;
  };

  return {
    screenStartUnixMs,
    process: proc,
    stop,
  };
}
