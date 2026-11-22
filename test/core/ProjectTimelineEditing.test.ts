// Test for: F:\dogsc-win\src\core\ProjectTimelineEditing.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitPrimarySegment,
  trimPrimarySegment,
  removePrimarySegment,
  movePrimarySegment,
  movePrimarySegments,
  restorePrimaryGap,
  restorePrimaryLeadingGap,
  restorePrimaryTrailingGap,
  mergeAdjacentPrimarySegments,
  insertMediaSegment,
  insertPrimarySegments,
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
  makeInsertedMedia,
} from '../../src/core/ProjectTimeline.ts';
import { makeZoomAnimationClip } from '../../src/core/ZoomAnimation.ts';
import { makeScreenMotionClip, makeScreenMotionState } from '../../src/core/ScreenMotion.ts';
import { makeCameraMotionClip } from '../../src/core/CameraMotion.ts';
import { makeTransitionTiming } from '../../src/core/ProjectTimeline.ts';
import { makeAnimationClip, makeOverlayTiming } from '../../src/core/OverlayTimeline.ts';
import { makeAudioClip, makeSubtitleCue, makeVideoClip } from '../../src/core/PostProductionModel.ts';
import { makeNormalizedCrop } from '../../src/core/ProjectModel.ts';
import { makeSegmentSceneStyle } from '../../src/core/SegmentSceneStyle.ts';
import { RecordingSourcePrimaryID } from '../../src/core/RecordingSource.ts';

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

test('T13.5b-1: insertMediaSegment splits segment and ripples all downstream tracks', () => {
  const seg = makeRecordingSegment({ id: 's1', sourceStart: 0, sourceDuration: 10 });
  const media = makeInsertedMedia({ path: 'assets/intro.mp4', fileDuration: 5, name: 'intro' });
  const downstreamAnim = makeAnimationClip({
    id: 'anim-1',
    timing: makeOverlayTiming(6, 2),
    sourcePath: 'motions/card.dmhtml',
  });
  const downstreamAudio = makeAudioClip({
    id: 'aud-1',
    timing: makeOverlayTiming(7, 2),
    sourcePath: 'audio/bgm.mp3',
  });
  const downstreamSub = makeSubtitleCue({
    id: 'sub-1',
    timing: makeOverlayTiming(6.5, 1.5),
    text: 'hello',
  });
  const timeline = makeProjectTimeline({
    sourceSequence: makeSourceSequenceEdited([seg]),
    animationClips: [downstreamAnim],
    audioClips: [downstreamAudio],
    subtitleCues: [downstreamSub],
  });

  const edited = insertMediaSegment(timeline, media, 4.0, 2.0, 'm1', 10.0, 1.0);
  assert.equal(edited.sourceSequence.kind, 'edited');
  if (edited.sourceSequence.kind === 'edited') {
    assert.equal(edited.sourceSequence.segments.length, 3);
    assert.equal(edited.sourceSequence.segments[0].sourceDuration, 4.0);
    assert.equal(edited.sourceSequence.segments[1].id, 'm1');
    assert.equal(edited.sourceSequence.segments[1].sourceStart, 1.0);
    assert.equal(edited.sourceSequence.segments[1].sourceDuration, 2.0);
    assert.equal(edited.sourceSequence.segments[1].media?.path, 'assets/intro.mp4');
    assert.equal(edited.sourceSequence.segments[2].sourceStart, 4.0);
    assert.equal(edited.sourceSequence.segments[2].sourceDuration, 6.0);
  }
  assert.equal(edited.animationClips[0].timing.startTime, 8.0);
  assert.equal(edited.audioClips[0].timing.startTime, 9.0);
  assert.equal(edited.subtitleCues[0].timing.startTime, 8.5);
});

test('T13.5b-1: insertPrimarySegments splits active effects across boundary and applies audio overrides', () => {
  const s1 = makeRecordingSegment({ id: 's1', sourceStart: 0, sourceDuration: 10 });
  const animSpanning = makeAnimationClip({
    id: 'anim-span',
    timing: makeOverlayTiming(2, 6), // covers insertion at t=5
    sourcePath: 'motions/callout.dmhtml',
    timeOffset: 1,
    playbackRate: 1,
  });
  const audioSpanning = makeAudioClip({
    id: 'aud-span',
    timing: makeOverlayTiming(1, 8),
    sourcePath: 'audio/track.mp3',
    sourceStart: 0.5,
    fadeIn: 0.4,
    fadeOut: 0.6,
  });
  const timeline = makeProjectTimeline({
    sourceSequence: makeSourceSequenceEdited([s1]),
    animationClips: [animSpanning],
    audioClips: [audioSpanning],
  });

  const extraSourceID = '22222222-2222-4222-8222-222222222222';
  const ins = makeRecordingSegment({
    id: 'ins-1',
    sourceStart: 0,
    sourceDuration: 3,
    sourceID: extraSourceID,
  });
  const ov = makePrimarySegmentAudioOverrides({ systemVolume: 0.25 });
  const inserted = insertPrimarySegments(
    timeline,
    [ins],
    5.0,
    { [RecordingSourcePrimaryID]: 10, [extraSourceID]: 6 },
    { audioOverrides: { 'ins-1': ov }, splitEffectsAtInsertion: true }
  );

  assert.equal(inserted.primarySegmentAudioOverrides['ins-1']?.systemVolume, 0.25);
  assert.equal(inserted.animationClips.length, 2);
  assert.equal(inserted.animationClips[0].timing.startTime, 2);
  assert.equal(inserted.animationClips[0].timing.duration, 3);
  assert.equal(inserted.animationClips[1].timing.startTime, 8); // 5 + inserted 3
  assert.equal(inserted.animationClips[1].timing.duration, 3);
  assert.equal(inserted.animationClips[1].timeOffset, 4); // 1 + 3 * rate(1)

  assert.equal(inserted.audioClips.length, 2);
  assert.equal(inserted.audioClips[0].timing.duration, 4);
  assert.equal(inserted.audioClips[0].fadeOut, 0);
  assert.equal(inserted.audioClips[1].timing.startTime, 8);
  assert.equal(inserted.audioClips[1].fadeIn, 0);
  assert.equal(inserted.audioClips[1].fadeOut, 0.6);
});

test('T13.5b-1: movePrimarySegments moves block atomically and remaps overlay/post tracks', () => {
  const s1 = makeRecordingSegment({ id: 's1', sourceStart: 0, sourceDuration: 4 }); // 0..4
  const s2 = makeRecordingSegment({ id: 's2', sourceStart: 4, sourceDuration: 3 }); // 4..7
  const s3 = makeRecordingSegment({ id: 's3', sourceStart: 7, sourceDuration: 3 }); // 7..10
  const timeline = makeProjectTimeline({
    sourceSequence: makeSourceSequenceEdited([s1, s2, s3]),
    videoClips: [
      makeVideoClip({
        id: 'vid-s2',
        timing: makeOverlayTiming(4.5, 2.0),
        sourcePath: 'clips/broll.mp4',
      }),
    ],
    subtitleCues: [
      makeSubtitleCue({
        id: 'sub-s1',
        timing: makeOverlayTiming(1.0, 2.0),
        text: 'first',
      }),
    ],
  });

  // Move ['s2', 's3'] before 's1' -> ['s2', 's3', 's1']
  const moved = movePrimarySegments(timeline, ['s3', 's2'], 0, 10.0);
  assert.equal(moved.sourceSequence.kind, 'edited');
  if (moved.sourceSequence.kind === 'edited') {
    assert.deepEqual(
      moved.sourceSequence.segments.map(s => s.id),
      ['s2', 's3', 's1']
    );
  }
  // vid-s2 started in s2 (4 -> 0, delta -4): 4.5 -> 0.5
  assert.equal(moved.videoClips[0].timing.startTime, 0.5);
  // sub-s1 started in s1 (0 -> 6, delta +6): 1.0 -> 7.0
  assert.equal(moved.subtitleCues[0].timing.startTime, 7.0);
});

test('T13.5b-1: mergeAdjacentPrimarySegments checks sourceID and sceneStyle before merging', () => {
  const altSourceID = '33333333-3333-4333-8333-333333333333';
  const diffSourceTimeline = makeProjectTimeline({
    sourceSequence: makeSourceSequenceEdited([
      makeRecordingSegment({ id: 'a', sourceStart: 0, sourceDuration: 3 }),
      makeRecordingSegment({ id: 'b', sourceStart: 3, sourceDuration: 3, sourceID: altSourceID }),
    ]),
  });
  assert.throws(
    () =>
      mergeAdjacentPrimarySegments(diffSourceTimeline, 'a', 'b', {
        [RecordingSourcePrimaryID]: 10,
        [altSourceID]: 10,
      }),
    (err: unknown) =>
      err instanceof ProjectTimelineEditingError && err.kind === 'cannotMergeDifferentSources'
  );

  const styleA = makeSegmentSceneStyle({ presetID: 'preset-a' });
  const styleB = makeSegmentSceneStyle({ presetID: 'preset-b' });
  const diffStyleTimeline = makeProjectTimeline({
    sourceSequence: makeSourceSequenceEdited([
      makeRecordingSegment({ id: 'a', sourceStart: 0, sourceDuration: 3, sceneStyle: styleA }),
      makeRecordingSegment({ id: 'b', sourceStart: 3, sourceDuration: 3, sceneStyle: styleB }),
    ]),
  });
  assert.throws(
    () => mergeAdjacentPrimarySegments(diffStyleTimeline, 'a', 'b', 10),
    (err: unknown) =>
      err instanceof ProjectTimelineEditingError && err.kind === 'cannotMergeDifferentSceneStyles'
  );

  const crop = makeNormalizedCrop({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
  const sameStyleTimeline = makeProjectTimeline({
    sourceSequence: makeSourceSequenceEdited([
      makeRecordingSegment({
        id: 'a',
        sourceStart: 0,
        sourceDuration: 3,
        sceneStyle: makeSegmentSceneStyle({ presetID: 'preset-a' }),
        crop,
      }),
      makeRecordingSegment({
        id: 'b',
        sourceStart: 3,
        sourceDuration: 4,
        sceneStyle: makeSegmentSceneStyle({ presetID: 'preset-a' }),
        crop,
      }),
    ]),
  });
  const merged = mergeAdjacentPrimarySegments(sameStyleTimeline, 'a', 'b', 10);
  if (merged.sourceSequence.kind === 'edited') {
    assert.equal(merged.sourceSequence.segments.length, 1);
    assert.equal(merged.sourceSequence.segments[0].sourceDuration, 7);
    assert.equal(merged.sourceSequence.segments[0].sceneStyle?.presetID, 'preset-a');
    assert.deepEqual(merged.sourceSequence.segments[0].crop, crop);
  }
});
