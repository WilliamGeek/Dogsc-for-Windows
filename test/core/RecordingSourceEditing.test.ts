// Test for: F:\dogsc-win\src\core\RecordingSourceEditing.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  usageCount,
  insertingFullRecording,
  removing,
  droppingMissingSources,
  projectStabilizeRecordingColors,
} from '../../src/core/RecordingSourceEditing.ts';
import {
  RecordingSourcePrimaryID,
  makeRecordingSource,
} from '../../src/core/RecordingSource.ts';
import {
  makeRecorderProject,
  makeProjectMediaManifest,
  makeProjectMediaReference,
} from '../../src/core/ProjectMediaModel.ts';
import {
  makeProjectTimeline,
  makeRecordingSegment,
  makeSourceSequenceEdited,
  makeSourceSequenceFullRecording,
  makeInsertedMedia,
  makePrimarySegmentAudioOverrides,
} from '../../src/core/ProjectTimeline.ts';
import { makeAnimationClip, makeOverlayTiming } from '../../src/core/OverlayTimeline.ts';
import { makeAudioClip } from '../../src/core/PostProductionModel.ts';
import { makeRecordingMarker } from '../../src/core/RecordingMarker.ts';
import { ProjectTimelineEditingError } from '../../src/core/ProjectTimelineEditing.ts';

const SRC_A = '11111111-1111-4111-8111-111111111111';
const SRC_B = '22222222-2222-4222-8222-222222222222';

function makeManifest(label: string) {
  return makeProjectMediaManifest({
    screen: makeProjectMediaReference({ relativePath: `media/${label}-screen.mp4` }),
  });
}

test('T13.3: usageCount counts primary vs additional segments and ignores inserted media', () => {
  assert.equal(usageCount(RecordingSourcePrimaryID, makeSourceSequenceFullRecording()), 1);
  assert.equal(usageCount(SRC_A, makeSourceSequenceFullRecording()), 0);

  const edited = makeSourceSequenceEdited([
    makeRecordingSegment({ id: 'seg-p', sourceStart: 0, sourceDuration: 4 }),
    makeRecordingSegment({ id: 'seg-a1', sourceStart: 0, sourceDuration: 3, sourceID: SRC_A }),
    makeRecordingSegment({ id: 'seg-a2', sourceStart: 3, sourceDuration: 2, sourceID: SRC_A }),
    makeRecordingSegment({
      id: 'seg-media',
      sourceStart: 0,
      sourceDuration: 2,
      media: makeInsertedMedia({ path: 'broll.mp4', fileDuration: 5, name: 'broll' }),
    }),
  ]);
  assert.equal(usageCount(RecordingSourcePrimaryID, edited), 1);
  assert.equal(usageCount(SRC_A, edited), 2);
  assert.equal(usageCount(SRC_B, edited), 0);
});

test('T13.3: insertingFullRecording inserts full or marked sub-range and splits spanning effects', () => {
  const project = makeRecorderProject({
    media: makeManifest('primary'),
    additionalSources: [makeRecordingSource({ id: SRC_A, name: 'Clip A', media: makeManifest('a') })],
    timeline: makeProjectTimeline({
      sourceSequence: makeSourceSequenceEdited([
        makeRecordingSegment({ id: 'p1', sourceStart: 0, sourceDuration: 10 }),
      ]),
      animationClips: [
        makeAnimationClip({
          id: 'anim-1',
          timing: makeOverlayTiming(2, 6),
          sourcePath: 'motions/card.dmhtml',
          timeOffset: 1,
        }),
      ],
      audioClips: [
        makeAudioClip({
          id: 'aud-1',
          timing: makeOverlayTiming(1, 8),
          sourcePath: 'audio/bgm.mp3',
          sourceStart: 0.5,
          fadeIn: 0.3,
          fadeOut: 0.5,
        }),
      ],
    }),
  });

  const durations = { [RecordingSourcePrimaryID]: 10, [SRC_A]: 8 };

  // Insert marked sub-range [1.5, 4.5] (duration 3s) of SRC_A at t=5
  const updated = insertingFullRecording(SRC_A, project, 5, durations, {
    lowerBound: 1.5,
    upperBound: 4.5,
  });

  assert.equal(updated.timeline.sourceSequence.kind, 'edited');
  if (updated.timeline.sourceSequence.kind === 'edited') {
    assert.equal(updated.timeline.sourceSequence.segments.length, 3);
    const middle = updated.timeline.sourceSequence.segments[1];
    assert.equal(middle.sourceID, SRC_A);
    assert.equal(middle.sourceStart, 1.5);
    assert.equal(middle.sourceDuration, 3.0);
    assert.equal(middle.media, null);
  }
  // Spanning animation and audio split at t=5 and right part shifted by +3s
  assert.equal(updated.timeline.animationClips.length, 2);
  assert.equal(updated.timeline.animationClips[0].timing.duration, 3);
  assert.equal(updated.timeline.animationClips[1].timing.startTime, 8);
  assert.equal(updated.timeline.animationClips[1].timeOffset, 4);

  assert.equal(updated.timeline.audioClips.length, 2);
  assert.equal(updated.timeline.audioClips[0].fadeOut, 0);
  assert.equal(updated.timeline.audioClips[1].timing.startTime, 8);
  assert.equal(updated.timeline.audioClips[1].fadeIn, 0);

  // Full span insert of primary source at t=0
  const withFullPrimary = insertingFullRecording(RecordingSourcePrimaryID, project, 0, durations);
  if (withFullPrimary.timeline.sourceSequence.kind === 'edited') {
    assert.equal(withFullPrimary.timeline.sourceSequence.segments.length, 2);
    assert.equal(withFullPrimary.timeline.sourceSequence.segments[0].sourceID, null);
    assert.equal(withFullPrimary.timeline.sourceSequence.segments[0].sourceDuration, 10);
  }
});

test('T13.3: removing deletes additional source, stabilizes colors, removes markers, and blocks final segment', () => {
  const project = makeRecorderProject({
    media: makeManifest('primary'),
    additionalSources: [
      makeRecordingSource({ id: SRC_A, name: 'A', media: makeManifest('a') }),
      makeRecordingSource({ id: SRC_B, name: 'B', media: makeManifest('b') }),
    ],
    recordingMarkers: [
      makeRecordingMarker({ sourceTime: 1, number: 1, sourceID: null }),
      makeRecordingMarker({ sourceTime: 2, number: 2, sourceID: SRC_A }),
    ],
    timeline: makeProjectTimeline({
      sourceSequence: makeSourceSequenceEdited([
        makeRecordingSegment({ id: 'seg-p', sourceStart: 0, sourceDuration: 6 }),
        makeRecordingSegment({ id: 'seg-a', sourceStart: 0, sourceDuration: 4, sourceID: SRC_A }),
      ]),
    }),
  });
  const durations = { [RecordingSourcePrimaryID]: 6, [SRC_A]: 4, [SRC_B]: 5 };

  const afterRemove = removing(SRC_A, project, durations);
  assert.equal(afterRemove.additionalSources.length, 1);
  assert.equal(afterRemove.additionalSources[0].id, SRC_B);
  assert.equal(afterRemove.additionalSources[0].colorIndex, 1);
  assert.equal(afterRemove.recordingMarkers.length, 1);
  assert.equal(afterRemove.recordingMarkers[0].sourceID, null);
  assert.equal(afterRemove.timeline.sourceSequence.kind, 'edited');
  if (afterRemove.timeline.sourceSequence.kind === 'edited') {
    assert.equal(afterRemove.timeline.sourceSequence.segments.length, 1);
    assert.equal(afterRemove.timeline.sourceSequence.segments[0].id, 'seg-p');
  }

  // Removing primary or missing source rejects
  assert.throws(
    () => removing(RecordingSourcePrimaryID, project, durations),
    (e: unknown) => e instanceof ProjectTimelineEditingError && e.kind === 'invalidSourceSequence'
  );

  // Removing sole source owning every segment throws cannotRemoveFinalSegment
  const onlySrcA = makeRecorderProject({
    media: makeManifest('primary'),
    additionalSources: [makeRecordingSource({ id: SRC_A, name: 'A', media: makeManifest('a') })],
    timeline: makeProjectTimeline({
      sourceSequence: makeSourceSequenceEdited([
        makeRecordingSegment({ id: 'seg-a', sourceStart: 0, sourceDuration: 4, sourceID: SRC_A }),
      ]),
    }),
  });
  assert.throws(
    () => removing(SRC_A, onlySrcA, { [RecordingSourcePrimaryID]: 6, [SRC_A]: 4 }),
    (e: unknown) => e instanceof ProjectTimelineEditingError && e.kind === 'cannotRemoveFinalSegment'
  );
});

test('T13.3: projectStabilizeRecordingColors fills missing colorIndex without mutating input', () => {
  const original = makeRecorderProject({
    additionalSources: [
      makeRecordingSource({ id: SRC_A, name: 'A', media: makeManifest('a'), colorIndex: 4 }),
      makeRecordingSource({ id: SRC_B, name: 'B', media: makeManifest('b'), colorIndex: null }),
    ],
  });
  const stabilized = projectStabilizeRecordingColors(original);
  assert.equal(stabilized.additionalSources[0].colorIndex, 4);
  assert.equal(stabilized.additionalSources[1].colorIndex, 1);
  assert.equal(original.additionalSources[1].colorIndex, null);
});

test('T13.3: droppingMissingSources removes dangling segments/overrides/markers and falls back cleanly', () => {
  const danglingProject = makeRecorderProject({
    media: makeManifest('primary'),
    additionalSources: [],
    recordingMarkers: [
      makeRecordingMarker({ sourceTime: 1, number: 1 }),
      makeRecordingMarker({ sourceTime: 2, number: 2, sourceID: SRC_A }),
    ],
    timeline: makeProjectTimeline({
      sourceSequence: makeSourceSequenceEdited([
        makeRecordingSegment({ id: 'seg-p', sourceStart: 0, sourceDuration: 5 }),
        makeRecordingSegment({ id: 'seg-missing', sourceStart: 0, sourceDuration: 4, sourceID: SRC_A }),
        makeRecordingSegment({
          id: 'seg-media',
          sourceStart: 0,
          sourceDuration: 2,
          media: makeInsertedMedia({ path: 'card.mp4', fileDuration: 2, name: 'card' }),
        }),
      ]),
      primarySegmentAudioOverrides: {
        'seg-p': makePrimarySegmentAudioOverrides({ systemVolume: 0.8 }),
        'seg-missing': makePrimarySegmentAudioOverrides({ isMicrophoneMuted: true }),
      },
    }),
  });

  const rescue = droppingMissingSources(danglingProject);
  assert.equal(rescue.droppedSegments, 1);
  assert.equal(rescue.project.recordingMarkers.length, 1);
  assert.equal(rescue.project.timeline.primarySegmentAudioOverrides['seg-missing'], undefined);
  assert.equal(rescue.project.timeline.primarySegmentAudioOverrides['seg-p']?.systemVolume, 0.8);
  assert.equal(rescue.project.timeline.sourceSequence.kind, 'edited');
  if (rescue.project.timeline.sourceSequence.kind === 'edited') {
    assert.deepEqual(
      rescue.project.timeline.sourceSequence.segments.map(s => s.id),
      ['seg-p', 'seg-media']
    );
  }

  // Fallback to fullRecording when every segment was from missing source
  const allMissing = makeRecorderProject({
    media: makeManifest('primary'),
    additionalSources: [],
    timeline: makeProjectTimeline({
      sourceSequence: makeSourceSequenceEdited([
        makeRecordingSegment({ id: 'seg-missing', sourceStart: 0, sourceDuration: 4, sourceID: SRC_A }),
      ]),
      primarySegmentAudioOverrides: {
        'seg-missing': makePrimarySegmentAudioOverrides({ isSystemMuted: true }),
      },
    }),
  });
  const rescuedAll = droppingMissingSources(allMissing);
  assert.equal(rescuedAll.droppedSegments, 1);
  assert.equal(rescuedAll.project.timeline.sourceSequence.kind, 'fullRecording');
  assert.deepEqual(rescuedAll.project.timeline.primarySegmentAudioOverrides, {});
});
