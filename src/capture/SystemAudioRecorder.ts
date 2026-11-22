/**
 * SystemAudioRecorder.ts
 *
 * Manages zero-dependency Windows WASAPI Loopback capture via tools/wasapi-loopback.ps1.
 * Synchronizes audio start clock with the recorded video's first-frame timestamp.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STDERR_TAIL_LIMIT = 16 * 1024;
const STOP_TIMEOUT_MS = 5000;

export interface SystemAudioHeader {
  hdr: 1;
  startUnixMs: number;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  formatTag: number;
}

export interface SystemAudioRecorderOptions {
  outFile: string;
  scriptPath?: string;
  /** Test seam command (defaults to powershell.exe). */
  command?: string;
  /** Leading arguments before PowerShell args (test seam). */
  argsPrefix?: string[];
}

export interface SystemAudioExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  spawnError: Error | null;
}

export interface SystemAudioRecorderHandle {
  audioStartUnixMs: number;
  header: SystemAudioHeader | null;
  ready: Promise<SystemAudioHeader>;
  process: ChildProcess;
  exited: Promise<SystemAudioExit>;
  stop(): Promise<void>;
}

export function getDefaultWasapiScriptPath(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const rootDir = resolve(dirname(currentFile), '../..');
  return resolve(rootDir, 'tools/wasapi-loopback.ps1');
}

/**
 * Pure function: constructs safe powershell.exe invocation without ExecutionPolicy Bypass.
 */
export function buildWasapiCommand(o: {
  scriptPath?: string;
  outFile: string;
}): { command: string; args: string[] } {
  if (!o.outFile || !o.outFile.trim()) {
    throw new Error('WASAPI 系统音频采集需要有效的 outFile 路径');
  }
  const scriptPath = o.scriptPath ?? getDefaultWasapiScriptPath();
  return {
    command: 'powershell.exe',
    args: ['-NoProfile', '-Sta', '-File', scriptPath, '-OutFile', o.outFile],
  };
}

/**
 * Pure function: validates and parses the single-line JSON header emitted by wasapi-loopback.ps1.
 */
export function parseWasapiHeaderLine(line: string): SystemAudioHeader {
  const trimmed = line.replace(/^\uFEFF/, '').trim();
  if (!trimmed) {
    throw new Error('WASAPI 音频表头为空');
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`WASAPI 音频表头 JSON 无效: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object' || parsed.hdr !== 1) {
    throw new Error('WASAPI 音频表头缺少 hdr=1');
  }
  const startUnixMs = Number(parsed.startUnixMs);
  const sampleRate = Number(parsed.sampleRate);
  const channels = Number(parsed.channels);
  const bitsPerSample = Number(parsed.bitsPerSample);
  const formatTag = Number(parsed.formatTag);

  if (
    !Number.isFinite(startUnixMs) ||
    !Number.isInteger(sampleRate) ||
    sampleRate <= 0 ||
    !Number.isInteger(channels) ||
    channels <= 0 ||
    !Number.isInteger(bitsPerSample) ||
    bitsPerSample <= 0 ||
    !Number.isFinite(formatTag) ||
    formatTag <= 0
  ) {
    throw new Error('WASAPI 音频表头字段数值无效');
  }

  return {
    hdr: 1,
    startUnixMs,
    sampleRate,
    channels,
    bitsPerSample,
    formatTag,
  };
}

/**
 * Pure function: computes the timing offset (seconds) of the audio track relative to video first frame.
 * Positive values mean audio started after the video's first frame and must be delayed on mix.
 */
export function computeAudioOffsetSeconds(
  audioStartUnixMs: number,
  videoFirstFrameUnixMs: number
): number {
  if (!Number.isFinite(audioStartUnixMs) || !Number.isFinite(videoFirstFrameUnixMs)) {
    throw new Error('音视频时钟同步时间戳必须为有限数字');
  }
  return (audioStartUnixMs - videoFirstFrameUnixMs) / 1000;
}

function formatExitError(result: SystemAudioExit, timedOut: boolean): string {
  const tail = result.stderr.trim().slice(-500);
  const reason = timedOut
    ? `WASAPI 音频录制停止超时 (${STOP_TIMEOUT_MS}ms)`
    : result.spawnError
      ? `WASAPI 进程启动失败: ${result.spawnError.message}`
      : `WASAPI 音频录制非零退出 (code ${String(result.code)})`;
  return tail ? `${reason}: ${tail}` : reason;
}

/**
 * Starts zero-dependency WASAPI loopback system audio recording.
 */
export function startSystemAudioRecording(
  o: SystemAudioRecorderOptions
): SystemAudioRecorderHandle {
  const built = buildWasapiCommand({ scriptPath: o.scriptPath, outFile: o.outFile });
  const command = o.command ?? built.command;
  const args = [...(o.argsPrefix ?? []), ...built.args];
  const audioStartUnixMs = Date.now();

  const proc = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let header: SystemAudioHeader | null = null;
  let readySettled = false;
  let resolveReady!: (hdr: SystemAudioHeader) => void;
  let rejectReady!: (err: Error) => void;
  const ready = new Promise<SystemAudioHeader>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });
  ready.catch(() => {});

  let stdoutBuffer = '';
  let stderrTail = '';
  let spawnError: Error | null = null;
  let closeResult: SystemAudioExit | null = null;
  let resolveExited!: (result: SystemAudioExit) => void;
  const exited = new Promise<SystemAudioExit>((res) => {
    resolveExited = res;
  });

  proc.stdout?.on('data', (chunk: Buffer | string) => {
    if (readySettled) return;
    stdoutBuffer += String(chunk);
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? '';
    for (const rawLine of lines) {
      if (!rawLine.trim()) continue;
      readySettled = true;
      try {
        header = parseWasapiHeaderLine(rawLine);
        resolveReady(header);
      } catch (err) {
        rejectReady(err as Error);
      }
      break;
    }
  });

  proc.stderr?.on('data', (chunk: Buffer | string) => {
    stderrTail = (stderrTail + String(chunk)).slice(-STDERR_TAIL_LIMIT);
  });

  const finalizeExit = (result: SystemAudioExit) => {
    if (closeResult) return;
    closeResult = result;
    if (!readySettled) {
      readySettled = true;
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

      const settle = (result: SystemAudioExit | null) => {
        if (settled) return;
        settled = true;
        if (stopTimer) clearTimeout(stopTimer);
        if (killTimer) clearTimeout(killTimer);

        const finalResult: SystemAudioExit = result ?? {
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
    audioStartUnixMs,
    get header() {
      return header;
    },
    ready,
    process: proc,
    exited,
    stop,
  };
}
