// Test for: F:\dogsc-win\src\core\ProjectPointerTrack.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectPointerTrack } from '../../src/core/ProjectPointerTrack.ts';
import { TimelineMap } from '../../src/core/TimelineMap.ts';
import {
  makeRecordingSegment,
  makeSourceSequenceEdited,
  makeSourceSequenceFullRecording,
} from '../../src/core/ProjectTimeline.ts';
import {
  makePointerEventRecord,
  makeNormalizedPoint,
  makeZoomAnimationClip,
} from '../../src/core/ZoomAnimation.ts';
import { makeCursorStyle, makeMotionStyle } from '../../src/core/ProjectModel.ts';

test('T7.3: ProjectPointerTrack initialization and segments mapping', () => {
  const seg1 = makeRecordingSegment({ id: 's1', sourceStart: 0, sourceDuration: 3 });
  const seg2 = makeRecordingSegment({ id: 's2', sourceStart: 5, sourceDuration: 3 }); // discontinuity!
  const map = new TimelineMap(makeSourceSequenceEdited([seg1, seg2]), 10);

  const events = [
    makePointerEventRecord({ time: 0.5, location: makeNormalizedPoint(0.2, 0.2), kind: 'move' }),
    makePointerEventRecord({ time: 1.0, location: makeNormalizedPoint(0.3, 0.3), kind: 'leftClick' }),
    makePointerEventRecord({ time: 5.5, location: makeNormalizedPoint(0.6, 0.6), kind: 'rightClick' }),
  ];

  const track = new ProjectPointerTrack(map, events);
  assert.equal(track.segments.length, 2);

  // First segment has no discontinuity at 0
  assert.equal(track.segments[0].startsAfterSourceDiscontinuity, false);
  assert.equal(track.segments[0].firstClickTime, 1.0);

  // Second segment has discontinuity (5 != 3)
  assert.equal(track.segments[1].startsAfterSourceDiscontinuity, true);
  // outputStart of seg2 is 3.0. Event at source 5.5 -> output: 3.0 + (5.5 - 5.0) = 3.5
  assert.equal(track.segments[1].firstClickTime, 3.5);
});

test('T7.3: ProjectPointerTrack evaluation and idle hiding', () => {
  const map = new TimelineMap(makeSourceSequenceFullRecording(), 10);
  const events = [
    makePointerEventRecord({ time: 0.0, location: makeNormalizedPoint(0.2, 0.2), kind: 'move' }),
    makePointerEventRecord({ time: 1.0, location: makeNormalizedPoint(0.5, 0.5), kind: 'move' }),
  ];

  const track = new ProjectPointerTrack(map, events);

  // Before idle delay (idleDelay default is 1.5s or similar)
  const activeEval = track.evaluation(1.5, makeMotionStyle(), makeCursorStyle({ hideWhenIdle: true, idleDelay: 1.0 }));
  assert.ok(activeEval.cursor);

  // After idle delay (t=3.0, last activity at 1.0 -> 2.0s elapsed > 1.0)
  const idleEval = track.evaluation(3.0, makeMotionStyle(), makeCursorStyle({ hideWhenIdle: true, idleDelay: 1.0 }));
  assert.equal(idleEval.cursor, null);
  // Position is still retained even when cursor is hidden
  assert.ok(idleEval.position);
});

test('T7.3: ProjectPointerTrack automaticCameraFocus follows pointer and clamps to inset', () => {
  const map = new TimelineMap(makeSourceSequenceFullRecording(), 10);
  const events = [
    makePointerEventRecord({ time: 0.0, location: makeNormalizedPoint(0.5, 0.5), kind: 'move' }),
    makePointerEventRecord({ time: 1.0, location: makeNormalizedPoint(0.95, 0.95), kind: 'move' }),
  ];
  const track = new ProjectPointerTrack(map, events);

  const clip = makeZoomAnimationClip({
    origin: 'automatic',
    startTime: 0.0,
    endTime: 2.0,
    scale: 2.0,
    focus: makeNormalizedPoint(0.5, 0.5),
    enterDuration: 0.3,
  });

  const focus = track.automaticCameraFocus(1.5, clip);
  // Focus should follow pointer towards (0.95, 0.95) and remain bounded in [0, 1]
  assert.ok(focus.x > 0.5);
  assert.ok(focus.y > 0.5);
  assert.ok(focus.x <= 1.0);
  assert.ok(focus.y <= 1.0);
});

test('T13.5b-2a: multi-source ProjectPointerTrack marks source switch discontinuity and blocks cross-source cutBridge', () => {
  const altSourceID = 'aaaaaaaa-1111-4111-8111-111111111111';
  const map = new TimelineMap(
    makeSourceSequenceEdited([
      makeRecordingSegment({ id: 's-prim', sourceStart: 0, sourceDuration: 2 }),
      makeRecordingSegment({ id: 's-alt', sourceStart: 0, sourceDuration: 2, sourceID: altSourceID }),
    ]),
    { '00000000-0000-0000-0000-000000000001': 5, [altSourceID]: 5 }
  );

  const track = new ProjectPointerTrack({
    timelineMap: map,
    eventsBySource: {
      '00000000-0000-0000-0000-000000000001': [
        makePointerEventRecord({ time: 0.5, location: makeNormalizedPoint(0.1, 0.1), kind: 'move' }),
        makePointerEventRecord({ time: 1.9, location: makeNormalizedPoint(0.1, 0.1), kind: 'move' }),
      ],
      [altSourceID]: [
        makePointerEventRecord({ time: 0.0, location: makeNormalizedPoint(0.9, 0.9), kind: 'move' }),
        makePointerEventRecord({ time: 1.0, location: makeNormalizedPoint(0.9, 0.9), kind: 'move' }),
      ],
    },
  });

  assert.equal(track.segments.length, 2);
  assert.equal(track.segments[1].sourceID, altSourceID);
  assert.equal(track.segments[1].startsAfterSourceDiscontinuity, true);

  // Across source boundary at t=2.05, cutBridge must NOT blend from primary (0.1,0.1); stays on alt source (0.9,0.9)
  const atBoundary = track.evaluation(2.05);
  assert.ok(atBoundary.position != null);
  assert.ok(atBoundary.position.x > 0.85, `Expected unbridged alt position near 0.9, got ${atBoundary.position.x}`);
});
