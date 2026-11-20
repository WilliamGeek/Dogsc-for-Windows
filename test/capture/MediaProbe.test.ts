// Test for: F:\dogsc-win\src\capture\MediaProbe.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFfprobeJson } from '../../src/capture/MediaProbe.ts';

function sample(overrides: {
  stream?: Record<string, unknown>;
  format?: Record<string, unknown>;
} = {}): string {
  return JSON.stringify({
    streams: [
      {
        codec_type: 'video',
        codec_name: 'h264',
        width: 1920,
        height: 1080,
        nb_frames: '588',
        r_frame_rate: '60/1',
        avg_frame_rate: '60/1',
        start_time: '0.000000',
        duration: '9.800000',
        ...overrides.stream,
      },
    ],
    format: {
      duration: '9.800000',
      size: '3534978',
      ...overrides.format,
    },
  });
}

test('T12.1: parses real ffprobe JSON with exact duration and frame count', () => {
  const info = parseFfprobeJson(sample());

  assert.equal(info.durationSeconds, 9.8);
  assert.equal(info.frameCount, 588);
  assert.equal(info.width, 1920);
  assert.equal(info.height, 1080);
  assert.equal(info.fps, 60);
  assert.equal(info.codecName, 'h264');
  assert.equal(info.startTimeSeconds, 0);
  assert.equal(info.sizeBytes, 3_534_978);
});

test('T12.1: falls back to format duration and derives frame count when nb_frames is missing', () => {
  const info = parseFfprobeJson(
    sample({
      stream: { nb_frames: 'N/A', duration: undefined, r_frame_rate: '30/1' },
      format: { duration: '2.000000' },
    })
  );

  assert.equal(info.durationSeconds, 2);
  assert.equal(info.frameCount, 60);
  assert.equal(info.fps, 30);
});

test('T12.1: accepts fractional frame rates and negative start time diagnostics', () => {
  const info = parseFfprobeJson(
    sample({
      stream: {
        nb_frames: '300',
        r_frame_rate: '30000/1001',
        avg_frame_rate: '30000/1001',
        start_time: '-0.021000',
        duration: '10.010000',
      },
      format: { duration: '10.010000' },
    })
  );

  assert.ok(Math.abs(info.fps - 29.97002997002997) < 1e-9);
  assert.equal(info.frameCount, 300);
  assert.equal(info.startTimeSeconds, -0.021);
});

test('T12.1: uses avg_frame_rate when r_frame_rate is unusable', () => {
  const info = parseFfprobeJson(
    sample({
      stream: { nb_frames: '120', r_frame_rate: '0/0', avg_frame_rate: '60/1' },
    })
  );

  assert.equal(info.fps, 60);
  assert.equal(info.frameCount, 120);
});

test('T12.1: rejects zero duration instead of silently accepting wall-clock fallback', () => {
  assert.throws(
    () => parseFfprobeJson(sample({ stream: { duration: '0' }, format: { duration: '0' } })),
    /duration/
  );
});

test('T12.1: rejects missing video stream', () => {
  assert.throws(
    () => parseFfprobeJson(JSON.stringify({ streams: [], format: { duration: '9.8' } })),
    /视频流/
  );
});

test('T12.1: rejects invalid JSON', () => {
  assert.throws(() => parseFfprobeJson('{not-json'), /JSON/);
});

test('T12.1: rejects non-positive dimensions', () => {
  assert.throws(
    () => parseFfprobeJson(sample({ stream: { width: 0, height: 1080 } })),
    /width\/height/
  );
});
