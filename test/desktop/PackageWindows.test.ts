// Test for: F:\dogsc-win\scripts\package-windows.ts & F:\dogsc-win\THIRD_PARTY_NOTICES.md

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  buildIExpressSed,
  buildPortableRuntimeNotice,
  listPackagedRelativePaths,
  resolveIExpressPath,
  resolvePortableNodeBinary,
} from '../../src/desktop/DesktopBuilder.ts';

const ROOT_DIR = path.resolve(import.meta.dirname, '..', '..');

test('T17.2: listPackagedRelativePaths includes runtime dirs/docs and excludes recordings, tests, dist, media', () => {
  const files = listPackagedRelativePaths(ROOT_DIR);
  assert.ok(files.includes('package.json'));
  assert.ok(files.includes('LICENSE'));
  assert.ok(files.includes('LICENSE-MIT'));
  assert.ok(files.includes('THIRD_PARTY_NOTICES.md'));
  assert.ok(files.includes('README.md'));
  assert.ok(files.includes('README.en.md'));
  assert.ok(files.some((f) => f.startsWith('src/core/')));
  assert.ok(files.some((f) => f.startsWith('web/studio/')));
  assert.ok(files.some((f) => f.startsWith('scripts/')));
  assert.ok(files.some((f) => f.startsWith('tools/')));

  for (const f of files) {
    assert.equal(f.startsWith('recordings/'), false, `unexpected recordings entry: ${f}`);
    assert.equal(f.startsWith('out/'), false, `unexpected out entry: ${f}`);
    assert.equal(f.startsWith('test/'), false, `unexpected test entry: ${f}`);
    assert.equal(f.startsWith('dist/'), false, `unexpected dist entry: ${f}`);
    assert.equal(f.startsWith('audit-runs/'), false, `unexpected audit-runs entry: ${f}`);
    assert.equal(f.endsWith('.mp4'), false, `unexpected mp4 entry: ${f}`);
    assert.equal(f.endsWith('.jpg'), false, `unexpected jpg entry: ${f}`);
  }
});

test('T17.2: buildIExpressSed produces valid SED manifest without ExecutionPolicy Bypass', () => {
  const sed = buildIExpressSed({
    targetExe: 'F:\\dogsc-win\\dist\\DogSC-Setup-x64-v1.0.0.exe',
    sourceDir: 'C:\\Temp\\dogsc-stage',
    files: ['DogSC.exe', 'payload.zip', 'setup-bootstrap.cmd'],
    appLaunched: 'cmd.exe /c setup-bootstrap.cmd',
    friendlyName: 'DogSC Studio Setup',
  });

  assert.ok(sed.includes('[Version]'));
  assert.ok(sed.includes('SEDVersion=3'));
  assert.ok(sed.includes('[Options]'));
  assert.ok(sed.includes('[Strings]'));
  assert.ok(sed.includes('FILE0="DogSC.exe"'));
  assert.ok(sed.includes('FILE1="payload.zip"'));
  assert.ok(sed.includes('FILE2="setup-bootstrap.cmd"'));
  assert.ok(sed.includes('[SourceFiles]'));
  assert.ok(sed.includes('[SourceFiles0]'));
  assert.ok(sed.includes('%FILE0%='));
  assert.ok(sed.includes('%FILE2%='));
  assert.equal(sed.toLowerCase().includes('bypass'), false);
  assert.ok(resolveIExpressPath(), 'iexpress.exe should be discoverable on Windows host');
});

test('T17.2: THIRD_PARTY_NOTICES.md discloses non-bundled FFmpeg/Node/Edge and unsigned build SHA256SUMS', async () => {
  const text = await fs.readFile(path.join(ROOT_DIR, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  assert.ok(text.includes('laogou717/dogsc'));
  assert.ok(text.includes('MIT'));
  assert.ok(text.includes('FFmpeg'));
  assert.ok(text.includes('未随本项目或安装包分发'));
  assert.ok(text.includes('未附加 Authenticode'));
  assert.ok(text.includes('SHA256SUMS.txt'));
});

test('T19.3: portable runtime helpers resolve active node binary and emit disclosure notice', () => {
  const resolved = resolvePortableNodeBinary();
  assert.equal(resolved, path.resolve(process.execPath));
  const notice = buildPortableRuntimeNotice('v24.0.0');
  assert.ok(notice.includes('v24.0.0'));
  assert.ok(notice.includes('runtime\\node.exe'));
  assert.ok(notice.includes('MIT'));
});


