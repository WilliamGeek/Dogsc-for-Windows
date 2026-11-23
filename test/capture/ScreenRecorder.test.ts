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
  parseShowinfoFirstFramePts,
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
  assert.equal(inputArg, 'ddagrab=output_idx=1:framerate=60:draw_mouse=0');

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
  assert.equal(args[args.indexOf('-i') + 1], 'ddagrab=output_idx=0:framerate=30:draw_mouse=0');

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

test('T12.3: buildFfmpegArgs drawMouse true preserves the OS cursor, default omits it', () => {
  const hidden = buildFfmpegArgs({
    outFile: 'hidden.mp4',
    fps: 60,
    encoder: 'libx264',
    drawMouse: false,
  });
  assert.equal(
    hidden[hidden.indexOf('-i') + 1],
    'ddagrab=output_idx=0:framerate=60:draw_mouse=0'
  );

  const visible = buildFfmpegArgs({
    outFile: 'visible.mp4',
    fps: 60,
    encoder: 'libx264',
    drawMouse: true,
  });
  assert.equal(
    visible[visible.indexOf('-i') + 1],
    'ddagrab=output_idx=0:framerate=60:draw_mouse=1'
  );
});

test('T12.3: detectEncoder falls back to libx264 when the NVENC probe fails', async () => {
  const script = [
    "const args = process.argv.slice(2);",
    "if (args.includes('-encoders')) { console.log('h264_nvenc'); process.exit(0); }",
    "console.error('NVENC probe failed'); process.exit(1);",
  ].join(' ');

  const encoder = await detectEncoder({
    ffmpegBin: process.execPath,
    ffmpegArgsPrefix: ['-e', script, '--'],
  });
  assert.equal(encoder, 'libx264');
});

test('T12.9: parseShowinfoFirstFramePts parses n: 0 and ignores n >= 1 or non-showinfo lines', () => {
  assert.equal(
    parseShowinfoFirstFramePts('[Parsed_showinfo_2 @ 000001] n:   0 pts:      0 pts_time:0.0166667 fmt:bgra'),
    0.0166667
  );
  assert.equal(
    parseShowinfoFirstFramePts('[Parsed_showinfo_2 @ 000001] n:   1 pts:    512 pts_time:0.0333333 fmt:bgra'),
    null
  );
  assert.equal(parseShowinfoFirstFramePts('frame=1 out_time_us=0'), null);
});

test('T12.9: buildFfmpegArgs includes showinfo and zero-lookahead NVENC flags', () => {
  const nvenc = buildFfmpegArgs({
    outFile: 'out.mp4',
    fps: 60,
    encoder: 'h264_nvenc',
    outputIdx: 0,
  });
  assert.ok(nvenc[nvenc.indexOf('-vf') + 1].includes('showinfo'));
  assert.equal(nvenc[nvenc.indexOf('-bf') + 1], '0');
  assert.equal(nvenc[nvenc.indexOf('-rc-lookahead') + 1], '0');
});

test('T12.9: showinfo n: 0 on stderr resolves ready BEFORE delayed -progress pipe:1', async () => {
  const script = [
    "console.error('[Parsed_showinfo_2 @ 0x1] n:   0 pts:      0 pts_time:0');",
    "setTimeout(() => { console.log('frame=1'); console.log('out_time_us=50000'); }, 350);",
    "setTimeout(() => process.exit(0), 420);",
  ].join(' ');

  const startedAt = Date.now();
  const recorder = startScreenRecording({
    outFile: 'out/t129_showinfo.mp4',
    fps: 60,
    encoder: 'h264_nvenc',
    ffmpegBin: process.execPath,
    ffmpegArgsPrefix: ['-e', script, '--'],
  });

  const firstFrameUnixMs = await recorder.ready;
  const elapsedMs = firstFrameUnixMs - startedAt;
  assert.ok(elapsedMs < 250, `Expected showinfo n:0 to resolve immediately (<250ms), took ${elapsedMs}ms`);
  await recorder.stop();
});

test('T12.7: parses -progress pipe:1 and derives firstFrameUnixMs from out_time_us', async () => {
  const script = [
    "console.log('frame=1');",
    "console.log('out_time_us=50000');",
    "console.log('progress=continue');",
    'setTimeout(() => process.exit(0), 100);',
  ].join(' ');

  const recorder = startScreenRecording({
    outFile: 'out/t127_fake.mp4',
    fps: 30,
    encoder: 'libx264',
    ffmpegBin: process.execPath,
    ffmpegArgsPrefix: ['-e', script, '--'],
  });

  const firstFrame = await recorder.ready;
  const observedAt = Date.now();
  assert.ok(firstFrame <= observedAt, 'first frame must not be in the future');
  const age = observedAt - firstFrame;
  assert.ok(age >= 20 && age <= 300, `firstFrame age should reflect 50ms out_time_us, got ${age}ms`);
  await recorder.stop();
});

test('T10.3: detectEncoder identifies available video encoder', async () => {
  const encoder = await detectEncoder();
  assert.ok(
    encoder === 'h264_nvenc' ||
      encoder === 'h264_amf' ||
      encoder === 'h264_qsv' ||
      encoder === 'libx264',
    `Encoder must be one of tri-vendor hardware or libx264, got: ${encoder}`
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
