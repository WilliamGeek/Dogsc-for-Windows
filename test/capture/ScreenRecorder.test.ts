// Test for: F:\dogsc-win\src\capture\ScreenRecorder.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildFfmpegArgs,
  detectEncoder,
  startScreenRecording,
} from '../../src/capture/ScreenRecorder.ts';

const execFileAsync = promisify(execFile);

test('T10.3: buildFfmpegArgs for h264_nvenc contains near-lossless parameters and display index', () => {
  const args = buildFfmpegArgs({
    outFile: 'out.mp4',
    fps: 60,
    encoder: 'h264_nvenc',
    outputIdx: 1,
  });

  assert.ok(args.includes('-i'));
  const inputArg = args[args.indexOf('-i') + 1];
  assert.equal(inputArg, 'ddagrab=output_idx=1:framerate=60');

  assert.ok(args.includes('-c:v'));
  assert.equal(args[args.indexOf('-c:v') + 1], 'h264_nvenc');

  assert.ok(args.includes('-preset'));
  assert.equal(args[args.indexOf('-preset') + 1], 'p4');

  assert.ok(args.includes('-rc'));
  assert.equal(args[args.indexOf('-rc') + 1], 'vbr');

  assert.ok(args.includes('-cq'));
  assert.equal(args[args.indexOf('-cq') + 1], '23');

  assert.ok(args.includes('-b:v'));
  assert.equal(args[args.indexOf('-b:v') + 1], '0');

  assert.ok(args.includes('-pix_fmt'));
  assert.equal(args[args.indexOf('-pix_fmt') + 1], 'yuv420p');

  assert.ok(args.includes('-fps_mode'));
  assert.equal(args[args.indexOf('-fps_mode') + 1], 'cfr');

  assert.equal(args[args.length - 1], 'out.mp4');
});

test('T10.3: buildFfmpegArgs for libx264 contains quality CRF and preset', () => {
  const args = buildFfmpegArgs({
    outFile: 'backup.mp4',
    fps: 30,
    encoder: 'libx264',
    outputIdx: 0,
  });

  assert.ok(args.includes('-i'));
  assert.equal(args[args.indexOf('-i') + 1], 'ddagrab=output_idx=0:framerate=30');

  assert.ok(args.includes('-c:v'));
  assert.equal(args[args.indexOf('-c:v') + 1], 'libx264');

  assert.ok(args.includes('-preset'));
  assert.equal(args[args.indexOf('-preset') + 1], 'veryfast');

  assert.ok(args.includes('-crf'));
  assert.equal(args[args.indexOf('-crf') + 1], '20');

  assert.ok(args.includes('-pix_fmt'));
  assert.equal(args[args.indexOf('-pix_fmt') + 1], 'yuv420p');

  assert.ok(args.includes('-fps_mode'));
  assert.equal(args[args.indexOf('-fps_mode') + 1], 'cfr');

  assert.equal(args[args.length - 1], 'backup.mp4');
});

test('T10.3: detectEncoder identifies available video encoder', async () => {
  const encoder = await detectEncoder();
  assert.ok(
    encoder === 'h264_nvenc' || encoder === 'libx264',
    `Encoder must be h264_nvenc or libx264, got: ${encoder}`
  );
});

test('T12.2: stop rejects with ffmpeg stderr when the process exits non-zero', async () => {
  const recorder = startScreenRecording({
    outFile: 'out/t122_fake.mp4',
    fps: 30,
    encoder: 'libx264',
    ffmpegBin: process.execPath,
    ffmpegArgsPrefix: [
      '-e',
      "console.error('Failed to enumerate DXGI output 9'); process.exit(1)",
      '--',
    ],
  });

  const exit = await recorder.exited;
  assert.equal(exit.code, 1, 'fake ffmpeg should close with code 1');
  await assert.rejects(recorder.stop(), (err: Error) =>
    err.message.includes('Failed to enumerate DXGI output 9')
  );
});

test(
  'T10.3: E2E startScreenRecording records real screen for 2s and produces valid MP4',
  { skip: !process.env.DOGSC_E2E },
  async () => {
    const testOut = resolve('out/test_rec_2s.mp4');
    if (existsSync(testOut)) {
      unlinkSync(testOut);
    }

    const encoder = await detectEncoder();
    const recorder = startScreenRecording({
      outFile: testOut,
      fps: 60,
      encoder,
    });

    assert.ok(typeof recorder.screenStartUnixMs === 'number' && recorder.screenStartUnixMs > 0);

    // Wait 2.2 seconds of recording
    await new Promise((r) => setTimeout(r, 2200));

    await recorder.stop();

    assert.ok(existsSync(testOut), `Output MP4 file should exist at ${testOut}`);

    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'csv=p=0',
        testOut,
      ]);
      const duration = parseFloat(stdout.trim());
      assert.ok(Number.isFinite(duration), `Duration is valid number: ${duration}`);
      assert.ok(duration >= 1.5 && duration <= 3.5, `Duration ${duration}s should be in [1.5, 3.5]`);
    } finally {
      if (existsSync(testOut)) {
        unlinkSync(testOut);
      }
    }
  }
);
