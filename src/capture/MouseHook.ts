/**
 * MouseHook.ts
 *
 * Spawns and manages the background PowerShell mouse hook process.
 * Emits raw JSONL lines through an AsyncIterable interface.
 * Adheres strictly to docs/CONTRACTS.md §2 and §5.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export interface MouseHookHandle {
  process: ChildProcess;
  lines: AsyncIterable<string>;
  stop(): Promise<void>;
}

/**
 * Resolves the default absolute path to tools/mousehook.ps1.
 */
export function getDefaultMouseHookScriptPath(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const rootDir = resolve(dirname(currentFile), '../..');
  return resolve(rootDir, 'tools/mousehook.ps1');
}

/**
 * Pure function: constructs the command and arguments for spawning the mouse hook.
 * Strictly adheres to CONTRACTS §5: NEVER includes ExecutionPolicy Bypass or bypass arguments.
 */
export function buildMouseHookCommand(scriptPath?: string): { command: string; args: string[] } {
  const resolvedPath = scriptPath ?? getDefaultMouseHookScriptPath();
  return {
    command: 'powershell.exe',
    args: ['-NoProfile', '-File', resolvedPath],
  };
}

/**
 * Spawns the PowerShell mouse hook process and returns an asynchronous line reader and stop handle.
 */
export function startMouseHook(options: { scriptPath?: string } = {}): MouseHookHandle {
  const { command, args } = buildMouseHookCommand(options.scriptPath);

  const proc = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const rl = createInterface({
    input: proc.stdout,
    crlfDelay: Infinity,
  });

  const lines: AsyncIterable<string> = (async function* () {
    for await (const line of rl) {
      yield line;
    }
  })();

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

      // Send exit command 'q' and end stdin stream
      try {
        if (proc.stdin && !proc.stdin.destroyed) {
          proc.stdin.write('q\n');
          proc.stdin.end();
        }
      } catch {
        // Stdin may already be closed
      }

      // 2000ms timeout fallback as per task requirements
      const timer = setTimeout(() => {
        if (!isSettled) {
          try {
            proc.kill();
          } catch {
            // Process may have exited concurrently
          }
          finish();
        }
      }, 2000);

      if (typeof timer.unref === 'function') {
        timer.unref();
      }
    });

    return stopPromise;
  };

  return {
    process: proc,
    lines,
    stop,
  };
}
