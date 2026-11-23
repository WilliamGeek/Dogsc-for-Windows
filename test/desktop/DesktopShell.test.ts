// Test for: F:\dogsc-win\src\desktop\DesktopBuilder.ts & F:\dogsc-win\desktop\DogSC.cs

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildCscArgs,
  generateBrandIconIco,
  resolveCscPath,
} from '../../src/desktop/DesktopBuilder.ts';

test('T17.1: generateBrandIconIco builds valid 2-entry (32x32 + 64x64) PNG-in-ICO icon', () => {
  const ico = generateBrandIconIco();
  assert.ok(ico.length > 200);
  // ICO header: reserved=0, type=1, count=2
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 2);

  // Entry 0: 32x32, Entry 1: 64x64
  assert.equal(ico[6], 32);
  assert.equal(ico[7], 32);
  assert.equal(ico[22], 64);
  assert.equal(ico[23], 64);

  const pngOffset0 = ico.readUInt32LE(18);
  const pngLen0 = ico.readUInt32LE(14);
  const pngOffset1 = ico.readUInt32LE(34);
  const pngLen1 = ico.readUInt32LE(30);
  assert.equal(pngOffset0 + pngLen0, pngOffset1);
  assert.equal(pngOffset1 + pngLen1, ico.length);

  // PNG magic signatures at both offsets
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(ico.subarray(pngOffset0, pngOffset0 + 8).equals(pngSig));
  assert.ok(ico.subarray(pngOffset1, pngOffset1 + 8).equals(pngSig));
});

test('T17.1: buildCscArgs configures x64 winexe cleanly with zero ExecutionPolicy Bypass', () => {
  const args = buildCscArgs({
    sourceCs: 'desktop\\DogSC.cs',
    outExe: 'dist\\DogSC.exe',
    iconPath: 'desktop\\assets\\dogsc.ico',
  });
  assert.ok(args.includes('/target:winexe'));
  assert.ok(args.includes('/platform:x64'));
  assert.ok(args.includes('/win32icon:desktop\\assets\\dogsc.ico'));
  assert.ok(args.includes('/out:dist\\DogSC.exe'));
  assert.equal(args.join(' ').toLowerCase().includes('bypass'), false);
});

test('T17.1: DogSC.cs compiles via csc.exe and passes --version, --check, --install, and --uninstall in isolated tmpdir', async () => {
  const csc = resolveCscPath();
  assert.ok(csc, 'csc.exe should exist on Windows .NET 4.x host');

  const rootDir = path.resolve(import.meta.dirname, '..', '..');
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dogsc-shell-test-'));
  const iconPath = path.join(tmpDir, 'dogsc.ico');
  const exePath = path.join(tmpDir, 'DogSC.exe');
  const installDir = path.join(tmpDir, 'installed-app');
  const sourceStageDir = path.join(tmpDir, 'stage-src');

  try {
    await fs.writeFile(iconPath, generateBrandIconIco());
    const args = buildCscArgs({
      sourceCs: path.join(rootDir, 'desktop', 'DogSC.cs'),
      outExe: exePath,
      iconPath,
    });
    const comp = spawnSync(csc, args, { encoding: 'utf8' });
    assert.equal(comp.status, 0, `csc failed:\n${comp.stdout}\n${comp.stderr}`);
    assert.ok(existsSync(exePath));

    const ver = spawnSync(exePath, ['--version'], { encoding: 'utf8' });
    assert.equal(ver.status, 0, ver.stderr);
    const verObj = JSON.parse(ver.stdout.trim());
    assert.equal(verObj.name, 'DogSC Windows');
    assert.equal(verObj.arch, 'x64');

    const chk = spawnSync(exePath, ['--check', '--root', rootDir], { encoding: 'utf8' });
    assert.equal(chk.status, 0, `${chk.stdout}\n${chk.stderr}`);
    const chkObj = JSON.parse(chk.stdout.trim());
    assert.equal(chkObj.ok, true);
    assert.equal(chkObj.hasStudioEntry, true);

    // Prepare tiny isolated stage source to verify --install & --uninstall end-to-end
    await fs.mkdir(path.join(sourceStageDir, 'scripts'), { recursive: true });
    await fs.writeFile(path.join(sourceStageDir, 'scripts', 'studio.ts'), '// stub\n');
    await fs.writeFile(path.join(sourceStageDir, 'package.json'), '{"name":"dogsc-win"}\n');

    const inst = spawnSync(
      exePath,
      ['--install', '--source', sourceStageDir, '--target', installDir, '--silent', '--no-shortcuts', '--no-registry'],
      { encoding: 'utf8' }
    );
    assert.equal(inst.status, 0, `${inst.stdout}\n${inst.stderr}`);
    assert.ok(existsSync(path.join(installDir, 'DogSC.exe')));
    assert.ok(existsSync(path.join(installDir, 'scripts', 'studio.ts')));
    assert.ok(existsSync(path.join(installDir, 'recordings')));

    const uninst = spawnSync(
      exePath,
      ['--uninstall', '--target', installDir, '--silent', '--no-shortcuts', '--no-registry'],
      { encoding: 'utf8' }
    );
    assert.equal(uninst.status, 0, `${uninst.stdout}\n${uninst.stderr}`);
    assert.equal(existsSync(installDir), false);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});
