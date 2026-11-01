import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MediaTimelinePlacement,
  MediaSyncAnchorCurve,
  makeProjectMediaReference,
  makeMediaSyncAnchor,
} from '../../src/core/MediaTimeline.ts';

test('T7.1: MediaTimelinePlacement mapping and boundaries', () => {
  const ref = makeProjectMediaReference({
    relativePath: 'video.mp4',
    startOffset: 1.0,
    sourceStartTime: 2.0,
    sourceTimeScale: 1.0,
  });

  const placement = new MediaTimelinePlacement(
    ref,
    10.0, // sourceAvailableDuration
    12.0  // timelineDuration
  );

  assert.equal(placement.timelineStart, 1.0);
  assert.equal(placement.sourceStart, 2.0);
  assert.equal(placement.playableDuration, 8.0);
  assert.equal(placement.sourceEnd, 10.0);
  assert.equal(placement.timelineEnd, 9.0);

  // In-range mapping
  assert.equal(placement.sourceTime(1.0), 2.0);
  assert.equal(placement.sourceTime(3.5), 4.5);
  assert.equal(placement.timelineTime(2.0), 1.0);
  assert.equal(placement.timelineTime(4.5), 3.5);

  // Out of range returns null
  assert.equal(placement.sourceTime(0.9), null);
  assert.equal(placement.sourceTime(9.0), null); // end-exclusive
  assert.equal(placement.timelineTime(1.9), null);
  assert.equal(placement.timelineTime(10.0), null);

  assert.equal(placement.contains(5.0), true);
  assert.equal(placement.contains(0.5), false);
});

test('T7.1: MediaTimelinePlacement with speed scale', () => {
  const ref = makeProjectMediaReference({
    relativePath: 'fast.mp4',
    startOffset: 0,
    sourceStartTime: 0,
    sourceTimeScale: 2.0, // 2x playback
  });

  const placement = new MediaTimelinePlacement(ref, 10.0, 10.0);
  assert.equal(placement.playableDuration, 5.0); // 10s of source takes 5s of timeline
  assert.equal(placement.sourceTime(2.0), 4.0); // 2s timeline = 4s source
  assert.equal(placement.timelineTime(4.0), 2.0);
});

test('T7.1: MediaSyncAnchorCurve piecewise linear interpolation and extrapolation', () => {
  const curve = new MediaSyncAnchorCurve([
    makeMediaSyncAnchor({ sourceTime: 1.0, offset: 0.1 }),
    makeMediaSyncAnchor({ sourceTime: 3.0, offset: 0.3 }),
  ]);

  // Before first point: grows from 0 at t=0
  assert.ok(Math.abs(curve.offset(0.0) - 0.0) < 1e-6);
  assert.ok(Math.abs(curve.offset(0.5) - 0.05) < 1e-6);
  assert.ok(Math.abs(curve.offset(1.0) - 0.1) < 1e-6);

  // Midpoint between anchors
  assert.ok(Math.abs(curve.offset(2.0) - 0.2) < 1e-6);
  assert.ok(Math.abs(curve.offset(3.0) - 0.3) < 1e-6);

  // After last anchor: holds last offset
  assert.ok(Math.abs(curve.offset(5.0) - 0.3) < 1e-6);
});
