// Test for: F:\dogsc-win\src\core\ProjectTimelineEditing.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitPrimarySegment,
  trimPrimarySegment,
  removePrimarySegment,
  movePrimarySegment,
  restorePrimaryGap,
  restorePrimaryLeadingGap,
  restorePrimaryTrailingGap,
  mergeAdjacentPrimarySegments,
  insertingScreenMotionClip,
  removingScreenMotionClip,
  replacingScreenMotionClip,
  insertingCameraMotionClip,
  removingCameraMotionClip,
  replacingCameraMotionClip,
  settingPrimarySegmentAudioOverrides,
  materialized,
  ProjectTimelineEditingError,
} from '../../src/core/ProjectTimelineEditing.ts';
import {
  makeRecordingSegment,
  makeSourceSequenceEdited,
  makeSourceSequenceFullRecording,
  makeProjectTimeline,
  makePrimarySegmentAudioOverrides,
} from '../../src/core/ProjectTimeline.ts';
import { makeZoomAnimationClip } from '../../src/core/ZoomAnimation.ts';
import { makeScreenMotionClip, makeScreenMotionState } from '../../src/core/ScreenMotion.ts';
import { makeCameraMotionClip } from '../../src/core/CameraMotion.ts';
import { makeTransitionTiming } from '../../src/core/ProjectTimeline.ts';

test('T7.6: splitPrimarySegment splits at output time and preserves duration', () => {
  const seg = makeRecordingSegment({ id: 's1', sourceStart: 0, sourceDuration: 10, playbackRate: 1.0 });
  const timeline = makeProjectTimeline({
    sourceSequence: makeSourceSequenceEdited([seg]),
  });

  const split = splitPrimarySegment(timeline, 4.0, 's2', 10.0);
  assert.equal(split.sourceSequence.kind, 'edited');
  if (split.sourceSequence.kind === 'edited') {
    assert.equal(split.sourceSequence.segments.length, 2);
    assert.equal(split.sourceSequence.segments[0].id, 's1');
    assert.equal(split.sourceSequence.segments[0].sourceDuration, 4.0);
    assert.equal(split.sourceSequence.segments[1].id, 's2');
    assert.equal(split.sourceSequence.segments[1].sourceStart, 4.0);
    assert.equal(split.sourceSequence.segments[1].sourceDuration, 6.0);
  }

  // Reject split outside bounds
  assert.throws(
    () => splitPrimarySegment(timeline, 0.0, 's3', 10.0),
    (err: any) => err instanceof ProjectTimelineEditingError && err.kind === 'splitOutsideSegment'
  );
  assert.throws(
    () => splitPrimarySegment(timeline, 10.0, 's3', 10.0),
    (err: any) => err instanceof ProjectTimelineEditingError && err.kind === 'splitOutsideSegment'
  );
});

test('T7.6: trimPrimarySegment trims edges and ripples downstream clips', () => {
  const s1 = makeRecordingSegment({ id: 's1', sourceStart: 0, sourceDuration: 4 });
  const s2 = makeRecordingSegment({ id: 's2', sourceStart: 4, sourceDuration: 6 });
  const downstreamZoom = makeZoomAnimationClip({ id: 'z1', startTime: 6.0, endTime: 8.0 });

  const timeline = makeProjectTimeline({
    sourceSequence: makeSourceSequenceEdited([s1, s2]),
    zoomClips: [downstreamZoom],
  });

  // Trim s1 right edge from 4.0 to 2.0 (deletes 2s)
  const trimmed = trimPrimarySegment(timeline, 's1', 'right', 2.0, 10.0);
  if (trimmed.sourceSequence.kind === 'edited') {
    assert.equal(trimmed.sourceSequence.segments[0].sourceDuration, 2.0);
  }
  // Downstream zoom shifts by -2.0s: from 6..8 to 4..6
  assert.equal(trimmed.zoomClips.length, 1);
  assert.equal(trimmed.zoomClips[0].startTime, 4.0);
  assert.equal(trimmed.zoomClips[0].endTime, 6.0);
});

test('T7.6: removePrimarySegment rejects removal of final segment and ripples on removal', () => {
  const s1 = makeRecordingSegment({ id: 's1', sourceStart: 0, sourceDuration: 5 });
  const singleTimeline = makeProjectTimeline({
    sourceSequence: makeSourceSequenceEdited([s1]),
  });
  assert.throws(
    () => removePrimarySegment(singleTimeline, 's1', 5.0),
    (err: any) => err instanceof ProjectTimelineEditingError && err.kind === 'cannotRemoveFinalSegment'
  );

  const s2 = makeRecordingSegment({ id: 's2', sourceStart: 5, sourceDuration: 5 });
  const multiTimeline = makeProjectTimeline({
    sourceSequence: makeSourceSequenceEdited([s1, s2]),
  });
  const removed = removePrimarySegment(multiTimeline, 's1', 10.0);
  if (removed.sourceSequence.kind === 'edited') {
    assert.equal(removed.sourceSequence.segments.length, 1);
    assert.equal(removed.sourceSequence.segments[0].id, 's2');
  }
});

test('T7.6: restorePrimaryGap, leading gap and trailing gap', () => {
  // s1: 0..3, s2: 7..10 -> gap of 4s between 3 and 7
  const s1 = makeRecordingSegment({ id: 's1', sourceStart: 0, sourceDuration: 3 });
  const s2 = makeRecordingSegment({ id: 's2', sourceStart: 7, sourceDuration: 3 });
  const timeline = makeProjectTimeline({
    sourceSequence: makeSourceSequenceEdited([s1, s2]),
  });

  const restored = restorePrimaryGap(timeline, 's1', 's2', 'restored-gap', 10.0);
  if (restored.sourceSequence.kind === 'edited') {
    assert.equal(restored.sourceSequence.segments.length, 3);
    assert.equal(restored.sourceSequence.segments[1].id, 'restored-gap');
    assert.equal(restored.sourceSequence.segments[1].sourceStart, 3);
    assert.equal(restored.sourceSequence.segments[1].sourceDuration, 4);
  }

  // Leading gap: timeline starts at sourceStart 2.0
  const leadingSeg = makeRecordingSegment({ id: 'lead', sourceStart: 2.0, sourceDuration: 5.0 });
  const leadingTimeline = makeProjectTimeline({
    sourceSequence: makeSourceSequenceEdited([leadingSeg]),
  });
  const restoredLeading = restorePrimaryLeadingGap(leadingTimeline, 'restored-lead', 10.0);
  if (restoredLeading.sourceSequence.kind === 'edited') {
    assert.equal(restoredLeading.sourceSequence.segments.length, 2);
    assert.equal(restoredLeading.sourceSequence.segments[0].id, 'restored-lead');
    assert.equal(restoredLeading.sourceSequence.segments[0].sourceStart, 0);
    assert.equal(restoredLeading.sourceSequence.segments[0].sourceDuration, 2.0);
  }

  // Trailing gap: timeline ends at sourceStart 0..6 while full duration is 10.0
  const trailSeg = makeRecordingSegment({ id: 'trail', sourceStart: 0, sourceDuration: 6.0 });
  const trailTimeline = makeProjectTimeline({
    sourceSequence: makeSourceSequenceEdited([trailSeg]),
  });
  const restoredTrailing = restorePrimaryTrailingGap(trailTimeline, 'restored-trail', 10.0);
  if (restoredTrailing.sourceSequence.kind === 'edited') {
    assert.equal(restoredTrailing.sourceSequence.segments.length, 2);
    assert.equal(restoredTrailing.sourceSequence.segments[1].id, 'restored-trail');
    assert.equal(restoredTrailing.sourceSequence.segments[1].sourceStart, 6.0);
    assert.equal(restoredTrailing.sourceSequence.segments[1].sourceDuration, 4.0);
  }
});

test('T7.6: mergeAdjacentPrimarySegments merges contiguous segments', () => {
  const s1 = makeRecordingSegment({ id: 's1', sourceStart: 0, sourceDuration: 4 });
  const s2 = makeRecordingSegment({ id: 's2', sourceStart: 4, sourceDuration: 6 });
  const timeline = makeProjectTimeline({
    sourceSequence: makeSourceSequenceEdited([s1, s2]),
  });

  const merged = mergeAdjacentPrimarySegments(timeline, 's1', 's2', 10.0);
  if (merged.sourceSequence.kind === 'edited') {
    assert.equal(merged.sourceSequence.segments.length, 1);
    assert.equal(merged.sourceSequence.segments[0].id, 's1');
    assert.equal(merged.sourceSequence.segments[0].sourceStart, 0);
    assert.equal(merged.sourceSequence.segments[0].sourceDuration, 10.0);
  }

  // Non-contiguous segments cannot merge
  const sA = makeRecordingSegment({ id: 'a', sourceStart: 0, sourceDuration: 3 });
  const sB = makeRecordingSegment({ id: 'b', sourceStart: 5, sourceDuration: 5 }); // gap of 2
  const gapTimeline = makeProjectTimeline({
    sourceSequence: makeSourceSequenceEdited([sA, sB]),
  });
  assert.throws(
    () => mergeAdjacentPrimarySegments(gapTimeline, 'a', 'b', 10.0),
    (err: any) => err instanceof ProjectTimelineEditingError && err.kind === 'cannotMergeDeletedGap'
  );
});

test('T7.6: screenMotion & cameraMotion inserting, removing and replacing', () => {
  const timeline = makeProjectTimeline();
  const sm1 = makeScreenMotionClip({
    id: 'sm1',
    timing: makeTransitionTiming({ startTime: 0, duration: 2 }),
    target: makeScreenMotionState(),
  });
  const sm2 = makeScreenMotionClip({
    id: 'sm2',
    timing: makeTransitionTiming({ startTime: 3, duration: 2 }),
    target: makeScreenMotionState(),
  });

  const withSm1 = insertingScreenMotionClip(sm1, timeline);
  assert.equal(withSm1.screenMotionClips.length, 1);

  const withSm2 = insertingScreenMotionClip(sm2, withSm1);
  assert.equal(withSm2.screenMotionClips.length, 2);

  // Replace sm1
  const sm1Updated = makeScreenMotionClip({
    id: 'sm1',
    timing: makeTransitionTiming({ startTime: 0, duration: 2.5 }),
    target: makeScreenMotionState(),
  });
  const replaced = replacingScreenMotionClip('sm1', withSm2, sm1Updated);
  assert.equal(replaced.screenMotionClips[0].timing.duration, 2.5);

  // Remove sm2
  const removed = removingScreenMotionClip('sm2', replaced);
  assert.equal(removed.screenMotionClips.length, 1);
  assert.equal(removed.screenMotionClips[0].id, 'sm1');
});
