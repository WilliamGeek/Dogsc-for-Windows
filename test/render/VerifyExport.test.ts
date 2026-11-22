// Test for: F:\dogsc-win\scripts\verify-export.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateExportVerification,
  evaluatePointerToFlashSync,
  evaluateSyncFrames,
  type ExportVerificationInput,
} from '../../scripts/verify-export.ts';

function validInput(): ExportVerificationInput {
  return {
    metaDurationSeconds: 9.8,
    metaFps: 60,
    screen: { durationSeconds: 9.8, frameCount: 588, width: 1920, height: 1080 },
    exported: { durationSeconds: 9.8, frameCount: 588, width: 1920, height: 1080 },
    captureFrameRate: 60,
    recordsSystemAudio: false,
    hasAudio: false,
    pointerClickTimesSeconds: [2.0, 4.0],
    frameSamples: [],
  };
}

test('T12.7: VerifyExport passes a clean 1x export', () => {
  const report = evaluateExportVerification(validInput());
  assert.equal(report.ok, true);
  assert.deepEqual(report.errors, []);
});

test('T12.7: VerifyExport rejects 155 tail duplicate frames', () => {
  const input = validInput();
  input.exported = { ...input.exported, frameCount: 743, durationSeconds: 12.383 };
  const report = evaluateExportVerification(input);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.includes('帧数不一致')));
});

test('T12.7: VerifyExport rejects a 2.5s wall-clock duration mismatch', () => {
  const input = validInput();
  input.metaDurationSeconds = 12.377;
  const report = evaluateExportVerification(input);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.includes('时长不一致')));
});

test('T12.7: VerifyExport rejects captureFrameRate that lies about meta.fps', () => {
  const input = validInput();
  input.metaFps = 30;
  input.captureFrameRate = 60;
  const report = evaluateExportVerification(input);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.includes('录制帧率谎言')));
});

test('T12.7: VerifyExport rejects all-black or truncated click frames', () => {
  const input = validInput();
  input.frameSamples = [
    { timeSeconds: 2, byteLength: 1920 * 1080 * 3, expectedBytes: 1920 * 1080 * 3, mean: 0, std: 0 },
  ];
  const report = evaluateExportVerification(input);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.includes('全黑或不可读')));
});

test('T12.7/T12.8: sync frames pass when export matches source within one frame', () => {
  const sync = evaluateSyncFrames([150, 151, 152, 290, 291], [151, 152, 153, 291, 292]);
  assert.equal(sync.ok, true);
  assert.equal(sync.maxDeltaFrames, 1);
});

test('T12.7/T12.8: sync frames reject a missing flash or a two-frame drift', () => {
  const missing = evaluateSyncFrames([150, 151, 152], []);
  assert.equal(missing.ok, false);

  const drift = evaluateSyncFrames([150, 151, 152], [153, 154, 155]);
  assert.equal(drift.ok, false);
  assert.equal(drift.maxDeltaFrames, 3);
});

test('T12.7/T12.8: sync frames reject a different number of flash runs', () => {
  const sync = evaluateSyncFrames([150, 151, 290, 291], [150, 151]);
  assert.equal(sync.ok, false);
});

test('T12.9: pointer-to-flash timing sync catches 24-frame (406ms) residual drift', () => {
  const drifted = evaluatePointerToFlashSync(
    [143, 144, 145, 286, 287, 288],
    [1.9757, 4.3615],
    60
  );
  assert.equal(drifted.ok, false);
  assert.equal(drifted.maxDeltaFrames, 24);
});

test('T12.9: pointer-to-flash timing sync passes when click times align within tolerance', () => {
  const aligned = evaluatePointerToFlashSync(
    [143, 144, 145, 286, 287, 288],
    [2.383, 4.767],
    60
  );
  assert.equal(aligned.ok, true);
  assert.equal(aligned.maxDeltaFrames, 0);
});
