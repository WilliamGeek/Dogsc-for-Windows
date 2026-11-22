// Tests for: F:\dogsc-win\src\capture\MediaDevices.ts and F:\dogsc-win\src\capture\MicRecorder.ts

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseDshowDevicesOutput,
  selectDirectShowInputSpec,
  enumerateDirectShowDevices,
} from '../../src/capture/MediaDevices.ts';
import {
  buildMicFfmpegArgs,
  startMicRecording,
} from '../../src/capture/MicRecorder.ts';

test('T15.3: parseDshowDevicesOutput parses modern, legacy, and CJK devices with alternative names & dedup', () => {
  const modernOutput = [
    '[dshow @ 000001e] "HD Pro Webcam C920" (video)',
    '[dshow @ 000001e]   Alternative name "@device_pnp_\\\\?\\usb#vid_046d"',
    '[in#0 @ 00000240c9cc41c0] "HP True Vision FHD Camera" (video)',
    '[in#0 @ 00000240c9cc41c0]   Alternative name "@device_pnp_\\\\?\\usb#vid_30c9"',
    '[dshow @ 000001e] "HD Pro Webcam C920" (video)',
    '[dshow @ 000001e]   Alternative name "@device_pnp_\\\\?\\usb#vid_046d"',
    '[in#0 @ 00000240c9cc41c0] "麦克风 (Realtek(R) Audio)" (audio)',
    '[in#0 @ 00000240c9cc41c0]   Alternative name "@device_cm_{33D9A762}\\wave_{1}"',
    '[dshow @ 000001e] "USB Audio Device" (audio, none)',
    '[dshow @ 000001e]   Alternative name "@device_cm_{33D9A762}\\wave_{2}"',
    '[dshow @ 000001e] Could not enumerate audio only devices.',
  ].join('\n');

  const modern = parseDshowDevicesOutput(modernOutput);
  assert.equal(modern.video.length, 2);
  assert.equal(modern.video[0].name, 'HD Pro Webcam C920');
  assert.equal(selectDirectShowInputSpec(modern.video[0]), '@device_pnp_\\\\?\\usb#vid_046d');
  assert.equal(modern.video[1].name, 'HP True Vision FHD Camera');
  assert.equal(selectDirectShowInputSpec(modern.video[1]), '@device_pnp_\\\\?\\usb#vid_30c9');
  assert.equal(modern.audio.length, 2);
  assert.equal(modern.audio[0].name, '麦克风 (Realtek(R) Audio)');
  assert.equal(modern.audio[1].name, 'USB Audio Device');

  const legacyOutput = [
    '[dshow @ 000002a] DirectShow video devices (some may be both video and audio devices)',
    '[dshow @ 000002a]  "OBS Virtual Camera"',
    '[dshow @ 000002a] DirectShow audio devices',
    '[dshow @ 000002a]  "Stereo Mix"',
  ].join('\n');

  const legacy = parseDshowDevicesOutput(legacyOutput);
  assert.equal(legacy.video.length, 1);
  assert.equal(selectDirectShowInputSpec(legacy.video[0]), 'OBS Virtual Camera');
  assert.equal(legacy.audio.length, 1);
  assert.equal(legacy.audio[0].name, 'Stereo Mix');

  assert.deepEqual(parseDshowDevicesOutput('no devices found'), { video: [], audio: [] });
});

test('T15.3: buildMicFfmpegArgs constructs valid dshow PCM arguments and validates inputs', () => {
  const args = buildMicFfmpegArgs({
    deviceName: '@device_cm_wave_1',
    outFile: 'F:\\rec\\mic.wav',
    sampleRate: 44100,
    channels: 1,
    audioBufferSizeMs: 15,
  });
  assert.ok(args.includes('dshow'));
  assert.equal(args[args.indexOf('-audio_buffer_size') + 1], '15');
  assert.equal(args[args.indexOf('-i') + 1], 'audio=@device_cm_wave_1');
  assert.equal(args[args.indexOf('-acodec') + 1], 'pcm_s16le');
  assert.equal(args[args.indexOf('-ar') + 1], '44100');
  assert.equal(args[args.indexOf('-ac') + 1], '1');
  assert.equal(args[args.length - 1], 'F:\\rec\\mic.wav');

  assert.throws(() => buildMicFfmpegArgs({ deviceName: ' ', outFile: 'm.wav' }), /deviceName/);
  assert.throws(() => buildMicFfmpegArgs({ deviceName: 'Mic', outFile: '' }), /outFile/);
});

test('T15.3: enumerateDirectShowDevices and startMicRecording seams handle progress, graceful stop & errors', async () => {
  const listed = await enumerateDirectShowDevices({
    ffmpegBin: process.execPath,
    ffmpegArgsPrefix: [
      '-e',
      'console.error("[dshow @ 1] \\"Fake Mic\\" (audio)"); process.exit(1);',
      '--',
    ],
  });
  assert.equal(listed.audio.length, 1);
  assert.equal(listed.audio[0].name, 'Fake Mic');

  const fakeMicScript = [
    'console.log("out_time_us=12000");',
    'process.stdin.setEncoding("utf8");',
    'process.stdin.on("data", (d) => { if (d.includes("q")) process.exit(0); });',
    'setTimeout(() => process.exit(0), 5000);',
  ].join('\n');

  const mic = startMicRecording({
    deviceName: 'Fake Mic',
    outFile: 'mic-test.wav',
    ffmpegBin: process.execPath,
    ffmpegArgsPrefix: ['-e', fakeMicScript, '--'],
  });

  const ts = await mic.ready;
  assert.ok(Number.isFinite(ts) && ts > 0);
  assert.ok(mic.firstSampleUnixMs !== null);
  await mic.stop();
  const exit = await mic.exited;
  assert.equal(exit.code, 0);

  const failMic = startMicRecording({
    deviceName: 'Missing Mic',
    outFile: 'mic-fail.wav',
    ffmpegBin: process.execPath,
    ffmpegArgsPrefix: ['-e', 'console.error("Could not find audio device"); process.exit(1);', '--'],
  });
  await assert.rejects(failMic.ready, /Could not find audio device/);
  const failExit = await failMic.exited;
  assert.equal(failExit.code, 1);
});
