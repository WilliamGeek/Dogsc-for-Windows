// Test for: T19.1 Tri-Vendor GPU Encoder Probe (NVENC / AMD AMF / Intel QSV) & 0.5s Fragmented MP4

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFfmpegArgs,
  detectEncoder,
  HARDWARE_ENCODER_PROBE_ORDER,
} from '../../src/capture/ScreenRecorder.ts';
import { buildCameraFfmpegArgs } from '../../src/capture/CameraRecorder.ts';
import { buildExportFfmpegArgs } from '../../src/server/ExportServer.ts';

test('T19.1: detectEncoder falls back along NVENC -> AMD AMF -> Intel QSV -> libx264 chain', async () => {
  assert.deepEqual([...HARDWARE_ENCODER_PROBE_ORDER], ['h264_nvenc', 'h264_amf', 'h264_qsv']);

  // 1. NVENC probe fails -> selects h264_amf
  const amfScript = [
    "const args = process.argv.slice(2);",
    "if (args.includes('-encoders')) { console.log('h264_nvenc\\nh264_amf\\nh264_qsv'); process.exit(0); }",
    "const enc = args[args.indexOf('-c:v') + 1];",
    "if (enc === 'h264_nvenc') process.exit(1);",
    "if (enc === 'h264_amf') process.exit(0);",
    "process.exit(1);",
  ].join(' ');
  const encAmf = await detectEncoder({
    ffmpegBin: process.execPath,
    ffmpegArgsPrefix: ['-e', amfScript, '--'],
  });
  assert.equal(encAmf, 'h264_amf');

  // 2. NVENC & AMF unavailable -> selects h264_qsv
  const qsvScript = [
    "const args = process.argv.slice(2);",
    "if (args.includes('-encoders')) { console.log('h264_qsv'); process.exit(0); }",
    "const enc = args[args.indexOf('-c:v') + 1];",
    "process.exit(enc === 'h264_qsv' ? 0 : 1);",
  ].join(' ');
  const encQsv = await detectEncoder({
    ffmpegBin: process.execPath,
    ffmpegArgsPrefix: ['-e', qsvScript, '--'],
  });
  assert.equal(encQsv, 'h264_qsv');

  // 3. All hardware encoders fail probe -> falls back to libx264
  const noneScript = [
    "const args = process.argv.slice(2);",
    "if (args.includes('-encoders')) { console.log('h264_nvenc\\nh264_amf\\nh264_qsv'); process.exit(0); }",
    "process.exit(1);",
  ].join(' ');
  const encFallback = await detectEncoder({
    ffmpegBin: process.execPath,
    ffmpegArgsPrefix: ['-e', noneScript, '--'],
  });
  assert.equal(encFallback, 'libx264');
});

test('T19.1: buildFfmpegArgs and buildCameraFfmpegArgs emit AMF/QSV args and 0.5s fragmented MP4 flags', () => {
  const amfArgs = buildFfmpegArgs({
    outFile: 'screen_amf.mp4',
    fps: 60,
    encoder: 'h264_amf',
    outputIdx: 0,
  });
  assert.equal(amfArgs[amfArgs.indexOf('-c:v') + 1], 'h264_amf');
  assert.equal(amfArgs[amfArgs.indexOf('-movflags') + 1], '+frag_keyframe+empty_moov+default_base_moof');
  assert.equal(amfArgs[amfArgs.indexOf('-frag_duration') + 1], '500000');
  assert.equal(amfArgs[amfArgs.length - 1], 'screen_amf.mp4');

  const qsvArgs = buildFfmpegArgs({
    outFile: 'screen_qsv.mp4',
    fps: 60,
    encoder: 'h264_qsv',
    fragmented: false,
  });
  assert.equal(qsvArgs[qsvArgs.indexOf('-c:v') + 1], 'h264_qsv');
  assert.equal(qsvArgs.includes('-frag_duration'), false);

  const camAmf = buildCameraFfmpegArgs({
    deviceName: 'USB Cam',
    outFile: 'cam_amf.mp4',
    encoder: 'h264_amf',
  });
  assert.equal(camAmf[camAmf.indexOf('-c:v') + 1], 'h264_amf');
  assert.equal(camAmf[camAmf.indexOf('-frag_duration') + 1], '500000');
});

test('T19.1: buildExportFfmpegArgs maps AMF and QSV across H.264 and HEVC', () => {
  const amfH264 = buildExportFfmpegArgs({
    width: 1920,
    height: 1080,
    fps: 60,
    encoder: 'h264_amf',
    videoCodec: 'h264',
    quality: 'high',
    outFile: 'out_amf.mp4',
  });
  assert.equal(amfH264[amfH264.indexOf('-c:v') + 1], 'h264_amf');

  const amfHevc = buildExportFfmpegArgs({
    width: 3840,
    height: 2160,
    fps: 60,
    encoder: 'h264_amf',
    videoCodec: 'hevc',
    quality: 'maximum',
    outFile: 'out_amf_hevc.mp4',
  });
  assert.equal(amfHevc[amfHevc.indexOf('-c:v') + 1], 'hevc_amf');
  assert.equal(amfHevc[amfHevc.indexOf('-tag:v') + 1], 'hvc1');

  const qsvHevc = buildExportFfmpegArgs({
    width: 2560,
    height: 1440,
    fps: 60,
    encoder: 'h264_qsv',
    videoCodec: 'hevc',
    quality: 'compact',
    outFile: 'out_qsv_hevc.mp4',
  });
  assert.equal(qsvHevc[qsvHevc.indexOf('-c:v') + 1], 'hevc_qsv');
  assert.equal(qsvHevc[qsvHevc.indexOf('-global_quality') + 1], '28');
});

