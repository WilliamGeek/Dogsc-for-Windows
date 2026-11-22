/**
 * MicRecorder.ts
 *
 * Records Windows DirectShow microphone input to WAV via FFmpeg with `-progress pipe:1`
 * timestamp estimation for audio/video clock alignment.
 */

import { spawn, type ChildProcess } from 'node:child_process';

const STDERR_TAIL_LIMIT = 16 * 1024;
const STOP_TIMEOUT_MS = 5000;

export interface MicFfmpegArgsOptions {
  deviceName: string;
  outFile: string;
  sampleRate?: number;
  channels?: number;
  audioBufferSizeMs?: number;
}

export interface MicRecorderOptions extends MicFfmpegArgsOptions {
  /** Test seam binary (defaults to `ffmpeg`). */
  ffmpegBin?: string;
  /** Leading args before ffmpeg args (test seam). */
  ffmpegArgsPrefix?: string[];
}

export interface MicRecorderExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  spawnError: Error | null;
}

export interface MicRecorderHandle {
  micStartUnixMs: number;
  firstSampleUnixMs: number | null;
  ready: Promise<number>;
  process: ChildProcess;
  exited: Promise<MicRecorderExit>;
  stop(): Promise<void>;
}

/**
 * Pure function: constructs FFmpeg DirectShow microphone capture arguments.
 */
export function buildMicFfmpegArgs(o: MicFfmpegArgsOptions): string[] {
  const deviceName = o.deviceName?.trim() ?? '';
  if (!deviceName) {
    throw new Error('麦克风录制需要非空的 DirectShow deviceName');
  }
  if (!o.outFile || !o.outFile.trim()) {
    throw new Error('麦克风录制需要有效的 outFile 路径');
  }
  const sampleRate = o.sampleRate && o.sampleRate > 0 ? Math.trunc(o.sampleRate) : 48000;
  const channels = o.channels && o.channels > 0 ? Math.trunc(o.channels) : 2;
  const bufferMs =
    o.audioBufferSizeMs && o.audioBufferSizeMs > 0 ? Math.trunc(o.audioBufferSizeMs) : 20;

  return [
    '-y',
    '-progress',
    'pipe:1',
    '-stats_period',
    '0.05',
    '-f',
    'dshow',
    '-audio_buffer_size',
    String(bufferMs),
    '-i',
    `audio=${deviceName}`,
    '-acodec',
    'pcm_s16le',
    '-ar',
    String(sampleRate),
    '-ac',
    String(channels),
    o.outFile,
  ];
}

function formatExitError(result: MicRecorderExit, timedOut: boolean): string {
  const tail = result.stderr.trim().slice(-500);
  const reason = timedOut
    ? `麦克风 ffmpeg 停止超时 (${STOP_TIMEOUT_MS}ms)`
    : result.spawnError
      ? `麦克风 ffmpeg 启动失败: ${result.spawnError.message}`
      : `麦克风 ffmpeg 非零退出 (code ${String(result.code)})`;
  return tail ? `${reason}: ${tail}` : reason;
}

/**
 * Starts DirectShow microphone recording to WAV.
 */
export function startMicRecording(o: MicRecorderOptions): MicRecorderHandle {
  const args = buildMicFfmpegArgs(o);
  const micStartUnixMs = Date.now();
  const proc = spawn(o.ffmpegBin ?? 'ffmpeg', [...(o.ffmpegArgsPrefix ?? []), ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let firstSampleUnixMs: number | null = null;
  let stdoutBuffer = '';
  let stderrTail = '';
  let spawnError: Error | null = null;
  let closeResult: MicRecorderExit | null = null;

  let resolveReady!: (ts: number) => void;
  let rejectReady!: (err: Error) => void;
  const ready = new Promise<number>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });
  ready.catch(() => {});

  let resolveExited!: (res: MicRecorderExit) => void;
  const exited = new Promise<MicRecorderExit>((res) => {
    resolveExited = res;
  });

  const parseProgressLine = (line: string) => {
    if (firstSampleUnixMs !== null) return;
    const eq = line.indexOf('=');
    if (eq < 0) return;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (key === 'out_time_us') {
      const us = Number(val);
      if (Number.isFinite(us) && us >= 0) {
        firstSampleUnixMs = Math.round(Date.now() - us / 1000);
        resolveReady(firstSampleUnixMs);
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
    stderrTail = (stderrTail + String(chunk)).slice(-STDERR_TAIL_LIMIT);
  });

  const finalizeExit = (result: MicRecorderExit) => {
    if (closeResult) return;
    closeResult = result;
    if (firstSampleUnixMs === null) {
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

      const settle = (result: MicRecorderExit | null) => {
        if (settled) return;
        settled = true;
        if (stopTimer) clearTimeout(stopTimer);
        if (killTimer) clearTimeout(killTimer);

        const finalResult: MicRecorderExit = result ?? {
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
    micStartUnixMs,
    get firstSampleUnixMs() {
      return firstSampleUnixMs;
    },
    ready,
    process: proc,
    exited,
    stop,
  };
}
