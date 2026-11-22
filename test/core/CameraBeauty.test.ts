import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CameraBeautySettings,
  cameraBeautyIsEnabled,
  cameraBeautySettingsEquals,
  cameraBeautySettingsFromJSON,
  makeCameraBeautySettings,
} from '../../src/core/CameraBeauty.ts';

test('CameraBeautySettings defaults and isEnabled per Swift L3-11', () => {
  const d = makeCameraBeautySettings();
  assert.equal(d.smoothing, 0);
  assert.equal(d.whitening, 0);
  assert.equal(cameraBeautyIsEnabled(d), false);

  assert.equal(cameraBeautyIsEnabled(makeCameraBeautySettings({ smoothing: 0.0001 })), true);
  assert.equal(cameraBeautyIsEnabled(makeCameraBeautySettings({ whitening: 0.5 })), true);
  assert.equal(CameraBeautySettings.isEnabled(d), false);
});

test('CameraBeautySettings clamps out-of-range and NaN/Infinity inputs per Swift L20-22', () => {
  const clamped = makeCameraBeautySettings({ smoothing: -0.4, whitening: 2.7 });
  assert.equal(clamped.smoothing, 0);
  assert.equal(clamped.whitening, 1);

  const nonFinite = makeCameraBeautySettings({
    smoothing: Number.NaN,
    whitening: Number.POSITIVE_INFINITY,
  });
  assert.equal(nonFinite.smoothing, 0);
  assert.equal(nonFinite.whitening, 0);
  assert.equal(cameraBeautyIsEnabled(nonFinite), false);
});

test('CameraBeautySettings JSON decoding defaults missing fields and checks equality', () => {
  const partial = cameraBeautySettingsFromJSON({ smoothing: 0.35 });
  assert.ok(Math.abs(partial.smoothing - 0.35) < 1e-9);
  assert.equal(partial.whitening, 0);

  const empty = cameraBeautySettingsFromJSON(null);
  assert.deepEqual(empty, { smoothing: 0, whitening: 0 });
  assert.equal(
    cameraBeautySettingsEquals(
      makeCameraBeautySettings({ smoothing: 0.2, whitening: 0.4 }),
      makeCameraBeautySettings({ smoothing: 0.2, whitening: 0.4 }),
    ),
    true,
  );
});
