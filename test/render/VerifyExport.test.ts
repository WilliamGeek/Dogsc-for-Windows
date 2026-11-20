// Test for: F:\dogsc-win\scripts\verify-export.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExportVerification, type ExportVerificationInput } from '../../scripts/verify-export.ts';

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
