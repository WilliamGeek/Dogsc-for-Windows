import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRecordingMarker } from '../../src/core/RecordingMarker.ts';

test('makeRecordingMarker clamps sourceTime and number per Swift L12-13', () => {
  // Swift L12: self.sourceTime = sourceTime.isFinite ? max(sourceTime, 0) : 0
  assert.equal(makeRecordingMarker(-5, 2).sourceTime, 0);
  assert.equal(makeRecordingMarker(Number.NaN, 2).sourceTime, 0);
  assert.equal(makeRecordingMarker(Number.POSITIVE_INFINITY, 2).sourceTime, 0);
  assert.equal(makeRecordingMarker(12.34, 2).sourceTime, 12.34);

  // Swift L13: self.number = max(number, 1)
  assert.equal(makeRecordingMarker(0, 0).number, 1);
  assert.equal(makeRecordingMarker(0, -99).number, 1);
  assert.equal(makeRecordingMarker(0, 42).number, 42);
});

test('makeRecordingMarker handles UUID correctly', () => {
  const m1 = makeRecordingMarker(1.0, 1);
  assert.ok(typeof m1.id === 'string' && m1.id.length > 0);

  const customId = 'CUSTOM-MARKER-UUID';
  const m2 = makeRecordingMarker(2.0, 2, customId);
  assert.equal(m2.id, customId);
});
