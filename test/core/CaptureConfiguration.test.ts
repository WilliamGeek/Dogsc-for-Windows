// Test for: F:\dogsc-win\src\core\CaptureConfiguration.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OutputFrameRate,
  CameraCaptureResolution,
  CaptureSource,
  NormalizedRect,
  CaptureDimensions,
  CaptureCodec,
  CaptureResolutionLimit,
  makeCaptureConfiguration,
  FrameIntervalDiagnostics,
  FrameRateMeasurement,
} from '../../src/core/CaptureConfiguration.ts';

test('T7.4: CameraCaptureResolution labels and aspect ratio', () => {
  const r4k = new CameraCaptureResolution(3840, 2160);
  assert.equal(r4k.resolutionLabel, '4K');
  assert.equal(r4k.aspectRatioLabel, '16:9');
  assert.equal(r4k.id, '3840x2160');

  const r1080 = new CameraCaptureResolution(1920, 1080);
  assert.equal(r1080.resolutionLabel, '1080p');
  assert.equal(r1080.aspectRatioLabel, '16:9');
});

test('T7.4: NormalizedRect constrained clamps to 0..1 with minimum size', () => {
  const rect = NormalizedRect.constrained(
    NormalizedRect.make({ x: -0.5, y: 0.5, width: 2.0, height: 0.001 })
  );
  assert.equal(rect.x, 0);
  assert.equal(rect.y, 0.5);
  assert.equal(rect.width, 1.0);
  assert.equal(rect.height, 0.02); // minimum height
});

test('T7.4: CaptureDimensions H264 compatibility and scaling', () => {
  const dim = CaptureDimensions.h264Compatible(5120, 2880, 4096, 2304);
  assert.ok(dim.width <= 4096);
  assert.ok(dim.height <= 2304);
  assert.equal(dim.width % 2, 0); // even dimensions
  assert.equal(dim.height % 2, 0);
});

test('T7.4: CaptureResolutionLimit applying', () => {
  const original = CaptureDimensions.make(5120, 2880);
  const limited = CaptureResolutionLimit.applying('最高 4K', original);
  assert.ok(limited.width <= 3840);
  assert.ok(limited.height <= 2160);

  const native = CaptureResolutionLimit.applying('原始分辨率', original);
  assert.equal(native.width, 5120);
  assert.equal(native.height, 2880);
});

test('T7.4: FrameIntervalDiagnostics percentiles and consecutive runs', () => {
  const intervals = [0.016, 0.016, 0.040, 0.040, 0.040, 0.016, 0.060];
  const diag = new FrameIntervalDiagnostics(intervals);

  assert.equal(diag.sampleCount, 7);
  assert.equal(diag.over33Milliseconds, 4); // three 0.040 and one 0.060
  assert.equal(diag.over50Milliseconds, 1); // one 0.060
  assert.equal(diag.maximumConsecutiveOver33Milliseconds, 3); // run of three 0.040
  assert.equal(diag.maximum, 0.060);
});

test('T7.4: FrameRateMeasurement performance metrics', () => {
  const diag = new FrameIntervalDiagnostics([0.016, 0.017, 0.016]);
  const meas = new FrameRateMeasurement({
    target: OutputFrameRate.fps60,
    deliveredFrames: 61,
    elapsed: 1.0,
    intervalDiagnostics: diag,
  });

  assert.equal(meas.actualFramesPerSecond, 60.0);
  assert.equal(meas.deliveryRatio, 1.0);
  assert.equal(meas.isMostlyIdle, false);
});
