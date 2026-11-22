// Test for: F:\dogsc-win\src\core\ProjectTimelineEditingTransforms.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeOutputDeletion,
  rippleOverlayTiming,
  rippleZoom,
  rippleScreenMotion,
  rippleTimeline,
  validateSourceSequence,
  validateZoomClips,
  validateScreenMotionClips,
  validateCameraMotionClips,
  validateMosaicClips,
  validateStickerClips,
  ProjectTimelineEditingError,
  sortZoom,
  sortScreenMotion,
  sortCameraMotion,
  PROJECT_TIMELINE_EDITING_EPSILON,
} from '../../src/core/ProjectTimelineEditingTransforms.ts';
import {
  makeRecordingSegment,
  makeSourceSequenceEdited,
  makeSourceSequenceFullRecording,
  makeProjectTimeline,
  makeTransitionTiming,
} from '../../src/core/ProjectTimeline.ts';
import { makeOverlayTiming, makeMosaicClip, makeStickerClip } from '../../src/core/OverlayTimeline.ts';
import { makeZoomAnimationClip } from '../../src/core/ZoomAnimation.ts';
import { makeScreenMotionClip } from '../../src/core/ScreenMotion.ts';
import { makeCameraMotionClip } from '../../src/core/CameraMotion.ts';

test('T7.7: OutputDeletion duration, mapping and overlap calculation', () => {
  const deletion = makeOutputDeletion(2.0, 5.0); // duration = 3.0
  assert.equal(deletion.duration, 3.0);

  // Before deletion
  assert.equal(deletion.map(1.0), 1.0);
  assert.equal(deletion.map(2.0), 2.0);

  // Inside deletion (clamps to start per Swift L1162)
  assert.equal(deletion.map(3.5), 2.0);

  // After deletion (shifts by duration)
  assert.equal(deletion.map(5.0), 2.0);
  assert.equal(deletion.map(6.0), 3.0);

  // Overlap
  assert.equal(deletion.overlapDuration(1.0, 4.0), 2.0); // [2, 4]
  assert.equal(deletion.overlapDuration(0.0, 1.0), 0.0);
  assert.equal(deletion.overlapDuration(2.0, 5.0), 3.0);
});

test('T7.7: rippleOverlayTiming preserves upstream, shifts downstream, drops interior', () => {
  const deletion = makeOutputDeletion(2.0, 4.0);

  // Upstream
  const up = makeOverlayTiming({ startTime: 0.5, duration: 1.0 }); // 0.5..1.5
  const rippledUp = rippleOverlayTiming(up, deletion, false);
  assert.notEqual(rippledUp, null);
  assert.equal(rippledUp!.startTime, 0.5);
  assert.equal(rippledUp!.duration, 1.0);

  // Downstream
  const down = makeOverlayTiming({ startTime: 5.0, duration: 2.0 }); // 5.0..7.0
  const rippledDown = rippleOverlayTiming(down, deletion, false);
  assert.notEqual(rippledDown, null);
  assert.equal(rippledDown!.startTime, 3.0);
  assert.equal(rippledDown!.duration, 2.0);

  // Interior (2.2..3.8) -> completely deleted
  const interior = makeOverlayTiming({ startTime: 2.2, duration: 1.6 });
  assert.equal(rippleOverlayTiming(interior, deletion, false), null);

  // Spanning (1.0..5.0) -> start=1.0, end=3.0 -> duration = 2.0
  const spanning = makeOverlayTiming({ startTime: 1.0, duration: 4.0 });
  const rippledSpanning = rippleOverlayTiming(spanning, deletion, false);
  assert.notEqual(rippledSpanning, null);
  assert.equal(rippledSpanning!.startTime, 1.0);
  assert.equal(rippledSpanning!.duration, 2.0);

  // deletesOutputTail
  const tailClip = makeOverlayTiming({ startTime: 1.5, duration: 2.0 }); // 1.5..3.5
  const tailRippled = rippleOverlayTiming(tailClip, deletion, true);
  assert.notEqual(tailRippled, null);
  assert.equal(tailRippled!.startTime, 1.5);
  assert.equal(tailRippled!.duration, 0.5); // cut at deletion.start (2.0)
});

test('T7.7: rippleZoom shifts downstream clips and handles tail clipping', () => {
  const deletion = makeOutputDeletion(3.0, 6.0); // duration 3.0

  const downstream = makeZoomAnimationClip({
    id: 'z-down',
    startTime: 7.0,
    endTime: 9.0,
    scale: 2.0,
  });
  const shifted = rippleZoom(downstream, deletion, false);
  assert.notEqual(shifted, null);
  assert.equal(shifted!.startTime, 4.0);
  assert.equal(shifted!.endTime, 6.0);
  assert.equal(shifted!.scale, 2.0);

  // Fully deleted clip
  const deletedClip = makeZoomAnimationClip({
    id: 'z-del',
    startTime: 3.5,
    endTime: 5.5,
  });
  assert.equal(rippleZoom(deletedClip, deletion, false), null);
});

test('T7.7: validateSourceSequence detects empty, duplicates and overlapping source ranges', () => {
  // Empty edited sequence
  assert.throws(
    () => validateSourceSequence(makeSourceSequenceEdited([])),
    (err: any) => err instanceof ProjectTimelineEditingError && err.kind === 'invalidSourceSequence'
  );

  // Duplicate segment IDs
  const s1 = makeRecordingSegment({ id: 'same-id', sourceStart: 0, sourceDuration: 2 });
  const s2 = makeRecordingSegment({ id: 'same-id', sourceStart: 2, sourceDuration: 2 });
  assert.throws(
    () => validateSourceSequence(makeSourceSequenceEdited([s1, s2])),
    (err: any) => err instanceof ProjectTimelineEditingError && err.kind === 'duplicateSegmentID'
  );

  // Repeated source intervals (0..4 and 3..6) are valid in v0.2.0
  const s3 = makeRecordingSegment({ id: 's3', sourceStart: 0, sourceDuration: 4 });
  const s4 = makeRecordingSegment({ id: 's4', sourceStart: 3, sourceDuration: 3 });
  assert.doesNotThrow(() => validateSourceSequence(makeSourceSequenceEdited([s3, s4])));

  // Valid disjoint source intervals: 0..4 and 4..10
  const s5 = makeRecordingSegment({ id: 's5', sourceStart: 0, sourceDuration: 4 });
  const s6 = makeRecordingSegment({ id: 's6', sourceStart: 4, sourceDuration: 6 });
  assert.doesNotThrow(() => validateSourceSequence(makeSourceSequenceEdited([s5, s6])));
});

test('T7.7: validateZoomClips detects duplicate IDs and invalid clips', () => {
  const z1 = makeZoomAnimationClip({ id: 'z1', startTime: 0, endTime: 2 });
  const z2 = makeZoomAnimationClip({ id: 'z1', startTime: 3, endTime: 5 }); // duplicate ID
  assert.throws(
    () => validateZoomClips([z1, z2]),
    (err: any) => err instanceof ProjectTimelineEditingError && err.kind === 'duplicateClipID'
  );

  // Overlapping non-touching zoom clips (z3 ends at 2, exit is 0.7, z4 starts at 2.3)
  const z3 = makeZoomAnimationClip({ id: 'z3', startTime: 0, endTime: 2, exitDuration: 0.7 });
  const z4 = makeZoomAnimationClip({ id: 'z4', startTime: 2.3, endTime: 4 });
  assert.throws(
    () => validateZoomClips([z3, z4]),
    (err: any) => err instanceof ProjectTimelineEditingError && err.kind === 'overlappingClips'
  );
});

test('T7.7: sortZoom, sortScreenMotion, sortCameraMotion stable ordering', () => {
  const zA = makeZoomAnimationClip({ id: 'b', startTime: 1.0, endTime: 2.0 });
  const zB = makeZoomAnimationClip({ id: 'a', startTime: 1.0, endTime: 2.0 });
  const zC = makeZoomAnimationClip({ id: 'c', startTime: 0.5, endTime: 1.0 });

  const list = [zA, zB, zC];
  sortZoom(list);
  assert.equal(list[0].id, 'c');
  assert.equal(list[1].id, 'a');
  assert.equal(list[2].id, 'b');
});
