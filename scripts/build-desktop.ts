/**
 * scripts/build-desktop.ts
 *
 * Compiles `desktop/DogSC.cs` into `dist/DogSC.exe` using Windows built-in .NET 4.x `csc.exe`,
 * embeds generated brand `.ico` (`desktop/assets/dogsc.ico`), and runs `--version` & `--check` gates.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildCscArgs,
  generateBrandIconIco,
  resolveCscPath,
} from '../src/desktop/DesktopBuilder.ts';

export async function buildDesktopBinary(options?: {
  rootDir?: string;
  outExe?: string;
  skipCheck?: boolean;
}): Promise<{ exePath: string; iconPath: string; sizeBytes: number; versionJson: unknown }> {
  const rootDir = options?.rootDir ?? path.resolve(import.meta.dirname, '..');
  const sourceCs = path.join(rootDir, 'desktop', 'DogSC.cs');
  const iconPath = path.join(rootDir, 'desktop', 'assets', 'dogsc.ico');
  const outExe = options?.outExe ?? path.join(rootDir, 'dist', 'DogSC.exe');

  const csc = resolveCscPath();
  if (!csc) {
    throw new Error('未找到 Windows .NET 4.x 编译器 csc.exe，无法构建 DogSC.exe');
  }

  await fs.mkdir(path.dirname(iconPath), { recursive: true });
  await fs.mkdir(path.dirname(outExe), { recursive: true });

  const icoBuf = generateBrandIconIco();
  await fs.writeFile(iconPath, icoBuf);

  const args = buildCscArgs({ sourceCs, outExe, iconPath });
  const compiled = spawnSync(csc, args, { encoding: 'utf8' });
  if (compiled.status !== 0) {
    throw new Error(
      `csc.exe 编译失败 (exit=${compiled.status}):\n${compiled.stdout ?? ''}\n${compiled.stderr ?? ''}`
    );
  }

  const stat = await fs.stat(outExe);
  const ver = spawnSync(outExe, ['--version'], { encoding: 'utf8' });
  if (ver.status !== 0) {
    throw new Error(`DogSC.exe --version 失败 (exit=${ver.status}): ${ver.stderr ?? ''}`);
  }
  const versionJson = JSON.parse((ver.stdout ?? '').trim());

  if (!options?.skipCheck) {
    const chk = spawnSync(outExe, ['--check', '--root', rootDir], { encoding: 'utf8' });
    if (chk.status !== 0) {
      throw new Error(`DogSC.exe --check 失败 (exit=${chk.status}):\n${chk.stdout ?? ''}\n${chk.stderr ?? ''}`);
    }
    console.log('[BuildDesktop] 环境自检通过:', (chk.stdout ?? '').trim());
  }

  return { exePath: outExe, iconPath, sizeBytes: stat.size, versionJson };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() ===
    path.resolve(import.meta.filename).toLowerCase();

if (isMain) {
  buildDesktopBinary()
    .then((res) => {
      console.log(
        `[BuildDesktop] 编译成功: ${res.exePath} (${res.sizeBytes} bytes, version=${JSON.stringify(res.versionJson)})`
      );
    })
    .catch((err) => {
      console.error('[BuildDesktop] 失败:', err);
      process.exit(1);
    });
}
