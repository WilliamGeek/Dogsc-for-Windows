// Tests for: F:\dogsc-win\src\capture\SystemAudioRecorder.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWasapiCommand,
  parseWasapiHeaderLine,
  computeAudioOffsetSeconds,
  startSystemAudioRecording,
} from '../../src/capture/SystemAudioRecorder.ts';

test('T15.2: buildWasapiCommand constructs PowerShell args without ExecutionPolicy Bypass', () => {
  const cmd = buildWasapiCommand({
    scriptPath: 'F:\\dogsc-win\\tools\\wasapi-loopback.ps1',
    outFile: 'F:\\dogsc-win\\recordings\\test\\system-audio.wav',
  });
  assert.equal(cmd.command, 'powershell.exe');
  assert.deepEqual(cmd.args, [
    '-NoProfile',
    '-Sta',
    '-File',
    'F:\\dogsc-win\\tools\\wasapi-loopback.ps1',
    '-OutFile',
    'F:\\dogsc-win\\recordings\\test\\system-audio.wav',
  ]);
  const joined = cmd.args.join(' ').toLowerCase();
  assert.ok(!joined.includes('bypass'));
  assert.throws(() => buildWasapiCommand({ outFile: '   ' }), /outFile/);
});

test('T15.2: parseWasapiHeaderLine validates hdr=1 and numeric audio format fields', () => {
  const hdr = parseWasapiHeaderLine(
    '\uFEFF{"hdr":1,"startUnixMs":1700000000250,"sampleRate":48000,"channels":2,"bitsPerSample":32,"formatTag":3}'
  );
  assert.deepEqual(hdr, {
    hdr: 1,
    startUnixMs: 1700000000250,
    sampleRate: 48000,
    channels: 2,
    bitsPerSample: 32,
    formatTag: 3,
  });

  assert.throws(() => parseWasapiHeaderLine(''), /为空/);
  assert.throws(() => parseWasapiHeaderLine('{not json'), /JSON 无效/);
  assert.throws(() => parseWasapiHeaderLine('{"hdr":2,"sampleRate":48000}'), /hdr=1/);
  assert.throws(
    () =>
      parseWasapiHeaderLine(
        '{"hdr":1,"startUnixMs":1000,"sampleRate":0,"channels":2,"bitsPerSample":16,"formatTag":1}'
      ),
    /数值无效/
  );
});

test('T15.2: computeAudioOffsetSeconds computes delta relative to video first frame', () => {
  assert.equal(computeAudioOffsetSeconds(1000.5 * 1000, 1000 * 1000), 0.5);
  assert.ok(Math.abs(computeAudioOffsetSeconds(999_880, 1_000_000) - -0.12) < 1e-9);
  assert.throws(() => computeAudioOffsetSeconds(NaN, 1000), /有限数字/);
});

test('T15.2: startSystemAudioRecording resolves header from fake seam and handles graceful stop & failure', async () => {
  const fakeScript = [
    'console.log(JSON.stringify({ hdr: 1, startUnixMs: 1732000000123, sampleRate: 48000, channels: 2, bitsPerSample: 32, formatTag: 3 }));',
    'process.stdin.setEncoding("utf8");',
    'process.stdin.on("data", (d) => { if (d.includes("q")) process.exit(0); });',
    'setTimeout(() => process.exit(0), 5000);',
  ].join('\n');

  const handle = startSystemAudioRecording({
    outFile: 'fake-sys.wav',
    command: process.execPath,
    argsPrefix: ['-e', fakeScript, '--'],
  });

  const hdr = await handle.ready;
  assert.equal(hdr.sampleRate, 48000);
  assert.equal(handle.header?.startUnixMs, 1732000000123);
  await handle.stop();
  const exit = await handle.exited;
  assert.equal(exit.code, 0);

  // Early non-zero failure rejects both ready and stop/exited cleanly
  const failHandle = startSystemAudioRecording({
    outFile: 'fail-sys.wav',
    command: process.execPath,
    argsPrefix: ['-e', 'console.error("no render endpoint"); process.exit(2);', '--'],
  });

  await assert.rejects(failHandle.ready, /no render endpoint/);
  const failExit = await failHandle.exited;
  assert.equal(failExit.code, 2);
});
