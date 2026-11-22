import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeAnimationsFromClicks,
  makeAnimationsFromPointerEvents,
  makeAnimationsInTimelineMap,
  clippedAnimations,
  clippedKeyframes,
  makeKeyframesFromClicks,
  AutoZoomPlanner,
} from '../../src/core/AutoZoomPlanner.ts';
import { TimelineMap } from '../../src/core/TimelineMap.ts';
import { makeRecordingSegment, makeSourceSequenceEdited } from '../../src/core/ProjectTimeline.ts';
import {
  makePointerClick,
  makePointerEventRecord,
  makeZoomAnimationClip,
  makeZoomKeyframe,
  zoomAnimationClipEffectEndTime,
} from '../../src/core/ZoomAnimation.ts';

test('T4.1: Empty input returns empty array', () => {
  assert.deepEqual(makeAnimationsFromClicks([]), []);
  assert.deepEqual(makeAnimationsFromPointerEvents([]), []);
  assert.deepEqual(AutoZoomPlanner.makeAnimationsFromClicks([]), []);
  assert.deepEqual(AutoZoomPlanner.makeAnimationsFromPointerEvents([]), []);
  const kfs = makeKeyframesFromClicks([]);
  assert.equal(kfs.length, 1);
  assert.equal(kfs[0].time, 0);
  assert.equal(kfs[0].scale, 1);
  assert.equal(kfs[0].focus.x, 0.5);
  assert.equal(kfs[0].focus.y, 0.5);
});

test('T4.1: Two clicks at t=1.0/1.5 nearby -> 1 clip with startTime = 0.874', () => {
  // Required test:
  // clicks at t=1.0, (0.5, 0.5) and t=1.5, (0.52, 0.5)
  // enterDuration = 0.7, pre-roll ratio = 0.18
  // startTime = 1.0 - 0.7 * 0.18 = 0.874 (Swift L450)
  const clicks = [
    makePointerClick(1.0, { x: 0.5, y: 0.5 }),
    makePointerClick(1.5, { x: 0.52, y: 0.5 }),
  ];

  const clips = makeAnimationsFromClicks(clicks, {
    zoomScale: 1.6,
    enterDuration: 0.7,
  });

  assert.equal(clips.length, 1);
  const clip = clips[0];
  assert.ok(Math.abs(clip.startTime - 0.874) < 1e-9);
  // Spatial group focus: x = (0.5 + 0.52)/2 = 0.51, y = 0.5
  assert.ok(Math.abs(clip.focus.x - 0.51) < 1e-9);
  assert.ok(Math.abs(clip.focus.y - 0.5) < 1e-9);
  assert.equal(clip.origin, 'automatic');
});

test('T4.1: Two clicks 3s apart -> 2 clips, second startTime >= first effectEndTime', () => {
  // Required test:
  // click 1 at t=1.0, click 2 at t=4.0
  const clicks = [
    makePointerClick(1.0, { x: 0.5, y: 0.5 }),
    makePointerClick(4.0, { x: 0.5, y: 0.5 }),
  ];

  const clips = makeAnimationsFromClicks(clicks);
  assert.equal(clips.length, 2);

  const firstEffectEnd = zoomAnimationClipEffectEndTime(clips[0]);
  assert.ok(
    clips[1].startTime >= firstEffectEnd,
    `second.startTime (${clips[1].startTime}) should be >= first.effectEndTime (${firstEffectEnd})`,
  );
});

test('T4.1: Click at corner (0.01, 0.99) constrains focus to (0.12, 0.88)', () => {
  // Required test:
  // safeInset = 0.12 (Swift L415)
  const clicks = [makePointerClick(1.0, { x: 0.01, y: 0.99 })];

  const clips = makeAnimationsFromClicks(clicks, { safeInset: 0.12 });
  assert.equal(clips.length, 1);
  assert.ok(Math.abs(clips[0].focus.x - 0.12) < 1e-9);
  assert.ok(Math.abs(clips[0].focus.y - 0.88) < 1e-9);
});

test('T4.1: Single click at t=0 + move events up to t=1.0 extends endTime to 1.55', () => {
  // Required test:
  // leftClick at t=0, location (0.5, 0.5)
  // move events at t=0.1, 0.2, ..., 1.0 (gap = 0.1 <= 1.4)
  // settleHold = 0.55, holdDuration = 0.9
  // endTime = max(0 + 0.9, 1.0 + 0.55) = 1.55 (Swift L245-305)
  const events = [
    makePointerEventRecord(0.0, { x: 0.5, y: 0.5 }, 'leftClick'),
  ];
  for (let step = 1; step <= 10; step++) {
    const time = step / 10;
    events.push(makePointerEventRecord(time, { x: 0.5, y: 0.5 }, 'move'));
  }

  const clips = makeAnimationsFromPointerEvents(events);
  assert.equal(clips.length, 1);
  assert.ok(
    Math.abs(clips[0].endTime - 1.55) < 1e-9,
    `Expected endTime 1.55, got ${clips[0].endTime}`,
  );
});

test('T4.1: clippedAnimations and clippedKeyframes', () => {
  const clip = makeZoomAnimationClip({
    startTime: 1.0,
    endTime: 4.0,
    exitDuration: 0.7,
  });

  const clipped = clippedAnimations([clip], 3.0);
  assert.equal(clipped.length, 1);
  assert.equal(clipped[0].endTime, 3.0);
  assert.equal(clipped[0].exitDuration, 0.0);

  // Keyframe clipping
  const kfs = [
    makeZoomKeyframe({ time: 0.0, scale: 1.0, focus: { x: 0.5, y: 0.5 } }),
    makeZoomKeyframe({ time: 2.0, scale: 2.0, focus: { x: 0.3, y: 0.3 } }),
    makeZoomKeyframe({ time: 4.0, scale: 1.0, focus: { x: 0.5, y: 0.5 } }),
  ];

  const clippedKfs = clippedKeyframes(kfs, 2.0);
  assert.equal(clippedKfs.length, 2);
  assert.equal(clippedKfs[clippedKfs.length - 1].time, 2.0);
});

test('T13.5b-2a: makeAnimationsInTimelineMap isolates segments per source and drops physical stop click', () => {
  const altSourceID = 'bbbbbbbb-2222-4222-8222-222222222222';
  const map = new TimelineMap(
    makeSourceSequenceEdited([
      makeRecordingSegment({ id: 's1', sourceStart: 0, sourceDuration: 5 }),
      makeRecordingSegment({ id: 's2', sourceStart: 0, sourceDuration: 5, sourceID: altSourceID }),
    ]),
    { '00000000-0000-0000-0000-000000000001': 5, [altSourceID]: 5 }
  );

  const clips = makeAnimationsInTimelineMap(map, {
    '00000000-0000-0000-0000-000000000001': [
      makePointerEventRecord(1.0, { x: 0.2, y: 0.2 }, 'leftClick'),
      makePointerEventRecord(4.5, { x: 0.9, y: 0.9 }, 'leftClick'), // trailing stop click -> dropped!
    ],
    [altSourceID]: [
      makePointerEventRecord(1.5, { x: 0.7, y: 0.7 }, 'leftClick'),
      makePointerEventRecord(4.8, { x: 0.1, y: 0.1 }, 'leftClick'), // trailing stop click -> dropped!
    ],
  });

  assert.equal(clips.length, 2);
  assert.ok(clips[0].endTime <= 5.0 + 1e-9);
  assert.ok(Math.abs(clips[0].focus.x - 0.2) < 1e-6);
  assert.ok(clips[1].startTime >= 5.0 - 1e-9);
  assert.ok(Math.abs(clips[1].focus.x - 0.7) < 1e-6);
});
