/**
 * scripts/package-windows.ts
 *
 * Builds Windows x64 distribution artifacts under `dist/`:
 *   1. `dist/DogSC.exe` (via `buildDesktopBinary`)
 *   2. `dist/DogSC-Windows-x64/` portable directory (plus optional `runtime/node.exe` when `--bundle-node`)
 *   3. `dist/DogSC-Windows-x64-v<version>.zip` (or `-portable-v<version>.zip`) portable archive
 *   4. `dist/DogSC-Setup-x64-v<version>.exe` self-extracting setup installer (built with `iexpress.exe`)
 *   5. `dist/SHA256SUMS.txt` cryptographic integrity manifest
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { buildDesktopBinary } from './build-desktop.ts';
import {
  buildIExpressSed,
  buildPortableRuntimeNotice,
  listPackagedRelativePaths,
  resolveIExpressPath,
  resolvePortableNodeBinary,
} from '../src/desktop/DesktopBuilder.ts';

async function sha256File(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

function escapePsSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function readAppVersion(rootDir: string): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    if (typeof pkg.version === 'string' && pkg.version.trim()) {
      return pkg.version.trim();
    }
  } catch {
    // Fallback
  }
  return '1.2.0';
}

async function copyPackagedPayload(
  rootDir: string,
  stageDir: string,
  exePath: string,
  version: string,
  bundleNode: boolean
): Promise<number> {
  await fs.rm(stageDir, { recursive: true, force: true });
  await fs.mkdir(stageDir, { recursive: true });

  const relPaths = listPackagedRelativePaths(rootDir);
  for (const rel of relPaths) {
    const src = path.join(rootDir, rel);
    const dst = path.join(stageDir, rel);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.copyFile(src, dst);
  }

  await fs.copyFile(exePath, path.join(stageDir, 'DogSC.exe'));
  await fs.mkdir(path.join(stageDir, 'recordings'), { recursive: true });

  if (bundleNode) {
    const nodeBin = resolvePortableNodeBinary();
    const runtimeDir = path.join(stageDir, 'runtime');
    await fs.mkdir(runtimeDir, { recursive: true });
    await fs.copyFile(nodeBin, path.join(runtimeDir, 'node.exe'));
    await fs.writeFile(
      path.join(runtimeDir, 'NODE_RUNTIME_NOTICE.txt'),
      buildPortableRuntimeNotice(process.version),
      'utf8'
    );
  }

  await fs.writeFile(
    path.join(stageDir, 'DogSC-Studio.cmd'),
    '@echo off\r\nstart "" "%~dp0DogSC.exe" %*\r\n',
    'utf8'
  );

  await fs.writeFile(
    path.join(stageDir, 'SIGNING_AND_DISTRIBUTION.txt'),
    [
      `DogSC Windows v${version} (x64)`,
      '============================',
      '',
      '1. Signing Status: UNSIGNED BUILD',
      `   DogSC.exe and DogSC-Setup-x64-v${version}.exe do NOT carry an Authenticode code-signing certificate.`,
      '   Verify binary integrity against SHA256SUMS.txt before execution:',
      '     Get-FileHash -Algorithm SHA256 <file>',
      '',
      bundleNode
        ? '2. Bundled Runtime: runtime\\node.exe included (FFmpeg/Edge still resolved from host).'
        : '2. External Runtime Dependencies (NOT BUNDLED):',
      ...(bundleNode ? [] : ['   - Node.js >= 22.18.0 (recommended v24.x)']),
      '   - FFmpeg & FFprobe (in PATH or WinGet Links; subject to user-installed LGPL/GPL build license)',
      '   - Microsoft Edge (msedge.exe)',
      '',
      '3. Quick Commands:',
      '   DogSC.exe                 Start tray + hotkeys + DogSC Studio desktop window',
      '   DogSC.exe --check         Verify Node / FFmpeg / Edge & bundled runtime',
      '   DogSC.exe --memo-check    Verify capture-protected teleprompter floating window',
      '   DogSC.exe --check-update  Check release version & verify SHA-256 checksums',
      '   DogSC.exe --install       Install to %LOCALAPPDATA%\\Programs\\DogSC with shortcuts',
      '   DogSC.exe --uninstall     Cleanly remove installed files, shortcuts, and HKCU keys',
      '',
    ].join('\r\n'),
    'utf8'
  );

  return relPaths.length;
}

export async function packageWindowsRelease(options?: {
  rootDir?: string;
  bundleNode?: boolean;
}): Promise<{
  exePath: string;
  portableDir: string;
  zipPath: string;
  setupExePath: string;
  shaSumsPath: string;
  packagedFileCount: number;
  checksums: Array<{ file: string; sha256: string; bytes: number }>;
}> {
  const rootDir = options?.rootDir ?? path.resolve(import.meta.dirname, '..');
  const bundleNode = Boolean(options?.bundleNode);
  const version = readAppVersion(rootDir);
  const distDir = path.join(rootDir, 'dist');
  const portableDir = path.join(
    distDir,
    bundleNode ? 'DogSC-Windows-x64-portable' : 'DogSC-Windows-x64'
  );
  const zipName = bundleNode
    ? `DogSC-Windows-x64-portable-v${version}.zip`
    : `DogSC-Windows-x64-v${version}.zip`;
  const zipPath = path.join(distDir, zipName);
  const setupName = `DogSC-Setup-x64-v${version}.exe`;
  const setupExePath = path.join(distDir, setupName);
  const shaSumsPath = path.join(distDir, 'SHA256SUMS.txt');

  const built = await buildDesktopBinary({ rootDir });
  const packagedFileCount = await copyPackagedPayload(
    rootDir,
    portableDir,
    built.exePath,
    version,
    bundleNode
  );

  await fs.rm(zipPath, { force: true });
  const compressCmd = `Compress-Archive -Path ${escapePsSingleQuoted(path.join(portableDir, '*'))} -DestinationPath ${escapePsSingleQuoted(zipPath)} -Force`;
  const zipRes = spawnSync('powershell.exe', ['-NoProfile', '-Command', compressCmd], {
    encoding: 'utf8',
  });
  if (zipRes.status !== 0) {
    throw new Error(`Compress-Archive 失败 (exit=${zipRes.status}):\n${zipRes.stdout ?? ''}\n${zipRes.stderr ?? ''}`);
  }

  const iexpressExe = resolveIExpressPath();
  if (!iexpressExe) {
    throw new Error('未找到 C:\\Windows\\System32\\iexpress.exe，无法构建 Setup 安装包');
  }

  const iexpStage = await fs.mkdtemp(path.join(os.tmpdir(), 'dogsc-iexp-'));
  try {
    await fs.copyFile(built.exePath, path.join(iexpStage, 'DogSC.exe'));
    await fs.copyFile(zipPath, path.join(iexpStage, 'payload.zip'));
    await fs.writeFile(
      path.join(iexpStage, 'setup-bootstrap.cmd'),
      [
        '@echo off',
        'setlocal',
        'set "STAGE=%TEMP%\\dogsc-setup-%RANDOM%"',
        'if exist "%STAGE%" rmdir /s /q "%STAGE%"',
        'mkdir "%STAGE%"',
        'powershell -NoProfile -Command "Expand-Archive -LiteralPath \'%~dp0payload.zip\' -DestinationPath \'%STAGE%\' -Force"',
        'if errorlevel 1 exit /b 1',
        '"%STAGE%\\DogSC.exe" --install --source "%STAGE%" %*',
        'set "EC=%ERRORLEVEL%"',
        'rmdir /s /q "%STAGE%" >nul 2>&1',
        'exit /b %EC%',
        '',
      ].join('\r\n'),
      'ascii'
    );

    const sedPath = path.join(iexpStage, 'dogsc-setup.sed');
    const sedContent = buildIExpressSed({
      targetExe: setupExePath,
      sourceDir: iexpStage,
      files: ['DogSC.exe', 'payload.zip', 'setup-bootstrap.cmd'],
      appLaunched: 'cmd.exe /c setup-bootstrap.cmd',
      friendlyName: `DogSC Studio Windows x64 v${version} Setup`,
    });
    await fs.writeFile(sedPath, sedContent, 'ascii');
    await fs.rm(setupExePath, { force: true });

    const iexpRes = spawnSync(iexpressExe, ['/N', '/Q', sedPath], {
      cwd: iexpStage,
      encoding: 'utf8',
    });
    if (iexpRes.status !== 0) {
      throw new Error(
        `iexpress.exe 构建失败 (exit=${iexpRes.status}):\n${iexpRes.stdout ?? ''}\n${iexpRes.stderr ?? ''}`
      );
    }
  } finally {
    await fs.rm(iexpStage, { recursive: true, force: true }).catch(() => {});
  }

  const targets = [
    { file: 'DogSC.exe', abs: built.exePath },
    { file: zipName, abs: zipPath },
    { file: setupName, abs: setupExePath },
  ];

  const checksums: Array<{ file: string; sha256: string; bytes: number }> = [];
  const lines: string[] = [];
  for (const t of targets) {
    const stat = await fs.stat(t.abs);
    if (stat.size <= 0) {
      throw new Error(`产物文件为空: ${t.abs}`);
    }
    const digest = await sha256File(t.abs);
    checksums.push({ file: t.file, sha256: digest, bytes: stat.size });
    lines.push(`${digest} *${t.file}`);
  }
  await fs.writeFile(shaSumsPath, lines.join('\r\n') + '\r\n', 'utf8');

  return {
    exePath: built.exePath,
    portableDir,
    zipPath,
    setupExePath,
    shaSumsPath,
    packagedFileCount,
    checksums,
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() ===
    path.resolve(import.meta.filename).toLowerCase();

if (isMain) {
  const bundleNode = process.argv.includes('--bundle-node');
  packageWindowsRelease({ bundleNode })
    .then((res) => {
      console.log(`[PackageWin] 打包完成 (${bundleNode ? '便携内置 Node' : '标准轻量版'})，共收录源码与资源文件 ${res.packagedFileCount} 项`);
      for (const item of res.checksums) {
        console.log(`  - ${item.file}: ${item.bytes} bytes | SHA256=${item.sha256}`);
      }
      console.log(`[PackageWin] 校验清单: ${res.shaSumsPath}`);
    })
    .catch((err) => {
      console.error('[PackageWin] 打包失败:', err);
      process.exit(1);
    });
}
