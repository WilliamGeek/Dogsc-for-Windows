// Test for: F:\dogsc-win\src\core\EditorTimeline.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeTimelineZoomSegment,
  makeZoomTrackHitZoneMove,
  makeZoomTrackHitZoneResize,
  clampedTime,
  xPosition,
  zoomSegments,
  splitZoomAnimation,
  zoomSequenceIsValid,
  effectiveExitDuration,
  exitNormalizations,
  movingZoomAnimation,
  resizingZoomAnimation,
  zoomHitZone,
  motionHitZone,
  fitZoomAnimation,
  fitMotionTiming,
  zoomSegmentsFromKeyframes,
} from '../../src/core/EditorTimeline.ts';
import { makeZoomAnimationClip, makeZoomKeyframe } from '../../src/core/ZoomAnimation.ts';
import { makeTransitionTiming } from '../../src/core/ProjectTimeline.ts';

test('T7.8: clampedTime and xPosition mapping', () => {
  assert.equal(clampedTime(500, 1000, 10.0), 5.0);
  assert.equal(clampedTime(-100, 1000, 10.0), 0.0);
  assert.equal(clampedTime(1200, 1000, 10.0), 10.0);
  assert.equal(clampedTime(100, 0, 10.0), 0.0);

  assert.equal(xPosition(5.0, 1000, 10.0), 500);
  assert.equal(xPosition(0.0, 1000, 10.0), 0);
  assert.equal(xPosition(12.0, 1000, 10.0), 1000);
});

test('T7.8: zoomSegments maps clips and sorts by startTime', () => {
  const c1 = makeZoomAnimationClip({ id: 'z1', startTime: 5.0, endTime: 8.0, scale: 2.0 });
  const c2 = makeZoomAnimationClip({ id: 'z2', startTime: 1.0, endTime: 3.0, scale: 1.5 });
  const segments = zoomSegments([c1, c2], 10.0);

  assert.equal(segments.length, 2);
  assert.equal(segments[0].id, 'z2');
  assert.equal(segments[0].startTime, 1.0);
  assert.equal(segments[0].endTime, 3.0);
  assert.equal(segments[0].scale, 1.5);
  assert.equal(segments[1].id, 'z1');
});

test('T7.8: splitZoomAnimation splits into touching left and right parts', () => {
  const clip = makeZoomAnimationClip({
    id: 'original',
    startTime: 2.0,
    endTime: 6.0,
    enterDuration: 0.7,
    exitDuration: 0.7,
  });

  const split = splitZoomAnimation(clip, 4.0, 0.16);
  assert.notEqual(split, null);
  const [left, right] = split!;

  // Left ends at split point with 0 exit
  assert.equal(left.id, 'original');
  assert.equal(left.startTime, 2.0);
  assert.equal(left.endTime, 4.0);
  assert.equal(left.exitDuration, 0);

  // Right starts at split point with fresh id
  assert.notEqual(right.id, 'original');
  assert.equal(right.startTime, 4.0);
  assert.equal(right.endTime, 6.0);
  assert.equal(right.enterDuration, 0.7);

  // Splitting too close to boundary returns null (< minimumDuration)
  assert.equal(splitZoomAnimation(clip, 2.05, 0.16), null);
});

test('T7.8: zoomSequenceIsValid adheres to adjacency and exit windows', () => {
  const c1 = makeZoomAnimationClip({ id: 'c1', startTime: 0, endTime: 2, exitDuration: 0.5 });
  // Touching within tolerance -> valid
  const c2 = makeZoomAnimationClip({ id: 'c2', startTime: 2.0, endTime: 4 });
  assert.equal(zoomSequenceIsValid(c1, c2), true);

  // Starts in middle of return window (2.2 < 2.5) -> invalid
  const c3 = makeZoomAnimationClip({ id: 'c3', startTime: 2.2, endTime: 4 });
  assert.equal(zoomSequenceIsValid(c1, c3), false);

  // Starts at or after return window (2.5) -> valid
  const c4 = makeZoomAnimationClip({ id: 'c4', startTime: 2.5, endTime: 4 });
  assert.equal(zoomSequenceIsValid(c1, c4), true);
});

test('T7.8: movingZoomAnimation and resizingZoomAnimation enforce limits', () => {
  const c1 = makeZoomAnimationClip({ id: 'c1', startTime: 2.0, endTime: 4.0, exitDuration: 0.7 }); // duration = 2.0
  const c2 = makeZoomAnimationClip({ id: 'c2', startTime: 6.0, endTime: 8.0 });

  // Move c1 towards start (boundary 0)
  const movedLeft = movingZoomAnimation(c1, 0.5, [c1, c2], 10.0);
  assert.equal(movedLeft.startTime, 0.5);
  assert.equal(movedLeft.endTime, 2.5);

  // Resize c1 right edge: proposedEnd = 5.0 (can clear or touch c2)
  const resized = resizingZoomAnimation({
    animation: c1,
    proposedEnd: 5.0,
    among: [c1, c2],
    duration: 10.0,
  });
  assert.equal(resized.startTime, 2.0);
  assert.ok(resized.endTime <= 6.0);
});

test('T7.8: zoomHitZone identifies move and resize handles', () => {
  const seg = makeTimelineZoomSegment({
    id: 'seg1',
    startTime: 2.0,
    endTime: 6.0,
    scale: 2.0,
    origin: 'manual',
  });
  // Timeline: width 1000, duration 10.0 -> 100px / s
  // seg1: x = 200 to 600, width = 400
  // Track height 56, bar height 42 -> bar y: 7 to 49

  // Miss outside y
  assert.equal(
    zoomHitZone({
      x: 300,
      y: 0,
      segments: [seg],
      width: 1000,
      duration: 10.0,
    }).kind,
    'empty'
  );

  // Move hit inside bar (unselected)
  const hitMove = zoomHitZone({
    x: 300,
    y: 25,
    segments: [seg],
    width: 1000,
    duration: 10.0,
  });
  assert.equal(hitMove.kind, 'move');
  if (hitMove.kind === 'move') assert.equal(hitMove.id, 'seg1');

  // Selected: hit near leading edge (x = 202, handleHalfWidth = 9)
  const hitResizeLeading = zoomHitZone({
    x: 202,
    y: 25,
    segments: [seg],
    width: 1000,
    duration: 10.0,
    selectedID: 'seg1',
  });
  assert.equal(hitResizeLeading.kind, 'resize');
  if (hitResizeLeading.kind === 'resize') {
    assert.equal(hitResizeLeading.leading, true);
  }

  // Selected: hit near trailing edge (x = 598)
  const hitResizeTrailing = zoomHitZone({
    x: 598,
    y: 25,
    segments: [seg],
    width: 1000,
    duration: 10.0,
    selectedID: 'seg1',
  });
  assert.equal(hitResizeTrailing.kind, 'resize');
  if (hitResizeTrailing.kind === 'resize') {
    assert.equal(hitResizeTrailing.leading, false);
  }
});

test('T7.8: fitZoomAnimation and fitMotionTiming fit into gaps', () => {
  const c1 = makeZoomAnimationClip({ id: 'z1', startTime: 0, endTime: 3 });
  const c2 = makeZoomAnimationClip({ id: 'z2', startTime: 7, endTime: 10 });

  // Drag in the gap 4..6
  const fitted = fitZoomAnimation({
    start: 4.0,
    end: 6.0,
    among: [c1, c2],
    duration: 10.0,
  });
  assert.notEqual(fitted, null);
  assert.ok(fitted!.startTime >= 3.0);
  assert.ok(fitted!.endTime <= 7.0);

  // fitMotionTiming
  const t1 = makeTransitionTiming({ startTime: 0, duration: 2 });
  const fittedMotion = fitMotionTiming({
    start: 3.0,
    end: 5.0,
    among: [t1],
    duration: 10.0,
    returnDuration: 0.7,
  });
  assert.notEqual(fittedMotion, null);
  assert.equal(fittedMotion!.startTime, 3.0);
});

test('T7.8: zoomSegmentsFromKeyframes clusters legacy keyframes into segments', () => {
  const kfs = [
    makeZoomKeyframe({ id: 'k1', time: 0.0, scale: 1.0 }),
    makeZoomKeyframe({ id: 'k2', time: 1.0, scale: 2.0 }),
    makeZoomKeyframe({ id: 'k3', time: 2.0, scale: 2.5 }),
    makeZoomKeyframe({ id: 'k4', time: 3.0, scale: 1.0 }),
  ];

  const segments = zoomSegmentsFromKeyframes(kfs, 5.0, 1.0);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].startTime, 0.0);
  assert.equal(segments[0].endTime, 3.0);
  assert.equal(segments[0].scale, 2.5); // representative frame is maximum scale
});
