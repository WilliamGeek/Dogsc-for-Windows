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
    assert.equal(chkObj.captureProtectedMemo, true);
    assert.equal(chkObj.updateChecker, true);
    assert.equal(chkObj.portableNodeBundled, false);

    // T19.2: Capture-protected teleprompter memo window check
    const memoChk = spawnSync(exePath, ['--memo-check'], { encoding: 'utf8' });
    assert.equal(memoChk.status, 0, `--memo-check failed:\n${memoChk.stdout}\n${memoChk.stderr}`);
    const memoObj = JSON.parse(memoChk.stdout.trim());
    assert.equal(memoObj.ok, true);
    assert.equal(memoObj.affinityApplied, true);

    // T19.2: In-app update manifest check & SHA-256 verification
    const manifestPath = path.join(tmpDir, 'update-manifest.json');
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        version: '9.9.9',
        downloadUrl: 'https://github.com/laogou717/dogsc/releases',
        sha256: '0123456789abcdef',
      }),
      'utf8'
    );
    const upd = spawnSync(exePath, ['--check-update', '--manifest', manifestPath], {
      encoding: 'utf8',
    });
    assert.equal(upd.status, 0, `${upd.stdout}\n${upd.stderr}`);
    const updObj = JSON.parse(upd.stdout.trim());
    assert.equal(updObj.ok, true);
    assert.equal(updObj.updateAvailable, true);
    assert.equal(updObj.latestVersion, '9.9.9');

    const { createHash } = await import('node:crypto');
    const payloadFile = path.join(tmpDir, 'sample-artifact.txt');
    const payloadBuf = Buffer.from('dogsc-sha256-test-payload', 'utf8');
    await fs.writeFile(payloadFile, payloadBuf);
    const expectedHash = createHash('sha256').update(payloadBuf).digest('hex');

    const vOk = spawnSync(
      exePath,
      ['--check-update', '--verify-file', payloadFile, '--expected-sha256', expectedHash],
      { encoding: 'utf8' }
    );
    assert.equal(vOk.status, 0, `${vOk.stdout}\n${vOk.stderr}`);
    assert.equal(JSON.parse(vOk.stdout.trim()).ok, true);

    const vBad = spawnSync(
      exePath,
      ['--check-update', '--verify-file', payloadFile, '--expected-sha256', 'deadbeef'],
      { encoding: 'utf8' }
    );
    assert.notEqual(vBad.status, 0);
    assert.equal(JSON.parse(vBad.stdout.trim()).ok, false);

    // T19.3: Bundled portable runtime\node.exe priority discovery
    const runtimeDir = path.join(sourceStageDir, 'runtime');
    await fs.mkdir(runtimeDir, { recursive: true });
    const fakeBundledNode = path.join(runtimeDir, 'node.exe');
    await fs.writeFile(fakeBundledNode, 'MZ-stub', 'utf8');
    const portableChk = spawnSync(exePath, ['--check', '--root', sourceStageDir], { encoding: 'utf8' });
    const portableObj = JSON.parse(portableChk.stdout.trim());
    assert.equal(portableObj.portableNodeBundled, true);
    assert.equal(path.resolve(portableObj.node).toLowerCase(), path.resolve(fakeBundledNode).toLowerCase());

    // Prepare tiny isolated stage source to verify --install & --uninstall end-to-end
    await fs.rm(runtimeDir, { recursive: true, force: true });
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

