/**
 * scripts/studio.ts
 *
 * Launches DogSC Studio local backend and opens it in Microsoft Edge App Mode (`--app`)
 * for a frameless native-like desktop experience without external Electron/npm dependencies.
 * Usage: node scripts/studio.ts [--port <N>] [--recordings <dir>] [--no-browser]
 */

import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { parseArgs } from 'node:util';
import { startStudioServer } from '../src/server/StudioServer.ts';

const EDGE_EXE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      port: { type: 'string' },
      recordings: { type: 'string' },
      'no-browser': { type: 'boolean' },
    },
    strict: false,
  });

  const rootDir = path.resolve(import.meta.dirname, '..');
  const port =
    typeof values.port === 'string' && /^\d+$/.test(values.port)
      ? Number.parseInt(values.port, 10)
      : 0;
  const recordingsDir =
    typeof values.recordings === 'string' && values.recordings.length > 0
      ? path.resolve(values.recordings)
      : path.join(rootDir, 'recordings');

  const handle = await startStudioServer({
    rootDir,
    recordingsDir,
    port,
  });

  console.log(`[Studio] DogSC Studio 运行中: ${handle.url}`);
  console.log(`[Studio] 录制目录: ${recordingsDir}`);

  let edgeProc: ChildProcess | null = null;
  let closing = false;

  const shutdown = async () => {
    if (closing) return;
    closing = true;
    console.log('\n[Studio] 正在安全关闭服务...');
    await handle.close().catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  if (!values['no-browser']) {
    if (existsSync(EDGE_EXE)) {
      const profileDir = path.join(os.tmpdir(), 'dogsc-studio-app-profile');
      edgeProc = spawn(
        EDGE_EXE,
        [
          `--app=${handle.url}`,
          `--user-data-dir=${profileDir}`,
          '--window-size=1440,920',
          '--no-first-run',
          '--no-default-browser-check',
        ],
        { stdio: 'ignore' }
      );
      edgeProc.on('close', () => {
        void shutdown();
      });
    } else {
      console.log('[Studio] 未找到 Edge 浏览器，请手动在浏览器访问上述 URL。');
    }
  }
}

main().catch((err) => {
  console.error('[Studio] 启动失败:', err);
  process.exit(1);
});
