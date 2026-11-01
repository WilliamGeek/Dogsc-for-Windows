// Test for: F:\dogsc-win\src\core\AudioCaptureDiagnostics.ts
//           F:\dogsc-win\src\core\CameraCaptureDiagnostics.ts
//           F:\dogsc-win\src\core\RecordingPerformanceDiagnostics.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAudioCaptureDiagnostics } from '../../src/core/AudioCaptureDiagnostics.ts';
import { makeCameraCaptureDiagnostics } from '../../src/core/CameraCaptureDiagnostics.ts';
import {
  makeRecordingPerformanceSample,
  summarizeRecordingPerformance,
} from '../../src/core/RecordingPerformanceDiagnostics.ts';

test('T8.1: AudioCaptureDiagnostics drops, fps and clamping', () => {
  const diag = makeAudioCaptureDiagnostics({
    receivedSampleBuffers: 100,
    appendedSampleBuffers: 95,
    ingressDrops: 2,
    writerBackpressureDrops: 1,
    invalidTimestampDrops: 1,
    nonMonotonicTimestampDrops: 1,
    elapsed: 5.0,
  });

  assert.equal(diag.totalDroppedSampleBuffers, 5);
  assert.equal(diag.appendedSampleBuffersPerSecond, 19.0); // 95 / 5.0

  // Clamping negative values
  const clamped = makeAudioCaptureDiagnostics({
    receivedSampleBuffers: -10,
    appendedSampleBuffers: -5,
    elapsed: -1,
  });
  assert.equal(clamped.receivedSampleBuffers, 0);
  assert.equal(clamped.appendedSampleBuffers, 0);
  assert.equal(clamped.elapsed, 0);
  assert.equal(clamped.appendedSampleBuffersPerSecond, 0);
});

test('T8.1: CameraCaptureDiagnostics drop category totals and frame rate calculations', () => {
  const diag = makeCameraCaptureDiagnostics({
    receivedFrames: 61,
    appendedFrames: 51,
    systemLateDrops: 3,
    systemOutOfBufferDrops: 2,
    systemDiscontinuityDrops: 1,
    systemUnknownDrops: 0,
    encoderBackpressureDrops: 2,
    nonMonotonicTimestampDrops: 1,
    invalidSampleDrops: 1,
    normalizedFrames: 51,
    formatChanges: 0,
    elapsed: 2.0,
    maximumFrameInterval: 0.04,
  });

  assert.equal(diag.systemDroppedFrames, 6); // 3 + 2 + 1 + 0
  assert.equal(diag.applicationDroppedFrames, 4); // 2 + 1 + 1
  assert.equal(diag.receivedFramesPerSecond, 30.0); // (61 - 1) / 2.0
  assert.equal(diag.appendedFramesPerSecond, 25.0); // (51 - 1) / 2.0
});

test('T8.1: RecordingPerformanceDiagnostics sample clamping, peak aggregation and thermal severity', () => {
  const s1 = makeRecordingPerformanceSample({
    elapsed: 1.0,
    processCPUPercent: 45.0,
    systemCPUPercent: 60.0,
    processResidentBytes: 100_000_000,
    availableDiskBytes: 50_000_000_000,
    thermalState: 'nominal',
  });

  const s2 = makeRecordingPerformanceSample({
    elapsed: 2.0,
    processCPUPercent: 75.0,
    systemCPUPercent: 120.0, // clamped to 100 per Swift L33-36
    processResidentBytes: 150_000_000,
    availableDiskBytes: 40_000_000_000,
    thermalState: 'serious', // severity 2 > 0
  });

  const s3 = makeRecordingPerformanceSample({
    elapsed: 3.0,
    processCPUPercent: 50.0,
    systemCPUPercent: 70.0,
    processResidentBytes: 120_000_000,
    availableDiskBytes: 45_000_000_000,
    thermalState: 'fair', // severity 1 < 2
  });

  assert.equal(s2.systemCPUPercent, 100.0);

  const summary = summarizeRecordingPerformance([s1, s2, s3]);
  assert.equal(summary.sampleCount, 3);
  assert.equal(summary.peakProcessCPUPercent, 75.0);
  assert.equal(summary.peakSystemCPUPercent, 100.0);
  assert.equal(summary.peakProcessResidentBytes, 150_000_000);
  assert.equal(summary.minimumAvailableDiskBytes, 40_000_000_000);
  assert.equal(summary.worstThermalState, 'serious');
});
