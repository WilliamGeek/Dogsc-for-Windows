// Test for: F:\dogsc-win\src\core\RecordingProjectImport.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adding,
  inserting,
  makeRecordingProjectImportOptions,
} from '../../src/core/RecordingProjectImport.ts';
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
  makeCanvasStyle,
  makeAudioStyle,
} from '../../src/core/ProjectModel.ts';
import {
  makeProjectTimeline,
  makeRecordingSegment,
  makeSourceSequenceEdited,
  makeInsertedMedia,
  makeTransitionTiming,
  makePrimarySegmentAudioOverrides,
} from '../../src/core/ProjectTimeline.ts';
import {
  makeAnimationClip,
  makeMosaicClip,
  makeNormalizedOverlayRect,
  makeOverlayTiming,
  makeStickerClip,
} from '../../src/core/OverlayTimeline.ts';
import {
  makeAudioClip,
  makeMediaAsset,
  makeSubtitleCue,
  makeVideoClip,
} from '../../src/core/PostProductionModel.ts';
import { makeZoomAnimationClip } from '../../src/core/ZoomAnimation.ts';
import { makeScreenMotionClip, makeScreenMotionState } from '../../src/core/ScreenMotion.ts';
import { makeCameraMotionClip, makeCameraMotionState } from '../../src/core/CameraMotion.ts';
import { makeRecordingMarker } from '../../src/core/RecordingMarker.ts';
import { ProjectTimelineEditingError } from '../../src/core/ProjectTimelineEditing.ts';

const IMP_EXTRA_OLD = '11111111-1111-4111-8111-111111111111';
const MAP_PRIMARY_NEW = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MAP_EXTRA_NEW = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function makeManifest(label: string) {
  return makeProjectMediaManifest({
    screen: makeProjectMediaReference({ relativePath: `media/${label}-screen.mp4` }),
  });
}

test('T13.4: adding merges imported sources, assets & markers without altering main track and rejects collisions', () => {
  const current = makeRecorderProject({
    media: makeManifest('cur-primary'),
    timeline: makeProjectTimeline({
      sourceSequence: makeSourceSequenceEdited([
        makeRecordingSegment({ id: 'cur-seg-1', sourceStart: 0, sourceDuration: 8 }),
      ]),
    }),
  });

  const imported = makeRecorderProject({
    canvas: makeCanvasStyle({
      cornerRadius: 42,
      screenFrame: 'browserDark',
    }),
    media: makeManifest('imp-primary'),
    additionalSources: [
      makeRecordingSource({
        id: IMP_EXTRA_OLD,
        name: 'Imp Extra',
        media: makeManifest('imp-extra'),
      }),
    ],
    recordingMarkers: [
      makeRecordingMarker({ sourceTime: 1.5, number: 1 }),
      makeRecordingMarker({ sourceTime: 2.5, number: 2, sourceID: IMP_EXTRA_OLD }),
    ],
    timeline: makeProjectTimeline({
      sourceSequence: makeSourceSequenceEdited([
        makeRecordingSegment({ id: 'imp-seg-1', sourceStart: 0, sourceDuration: 4 }),
      ]),
      mediaAssets: [makeMediaAsset({ id: 'asset-old', path: 'clips/broll.mp4', kind: 'video' })],
    }),
  });

  const sourceIDs = {
    [RecordingSourcePrimaryID]: MAP_PRIMARY_NEW,
    [IMP_EXTRA_OLD]: MAP_EXTRA_NEW,
  };
  const added = adding(
    imported,
    current,
    { [RecordingSourcePrimaryID]: 8 },
    { [RecordingSourcePrimaryID]: 4, [IMP_EXTRA_OLD]: 5 },
    sourceIDs
  );

  // Main track remains untouched
  assert.equal(added.timeline.sourceSequence.kind, 'edited');
  if (added.timeline.sourceSequence.kind === 'edited') {
    assert.deepEqual(
      added.timeline.sourceSequence.segments.map(s => s.id),
      ['cur-seg-1']
    );
  }

  // Imported sources appended with sequential color indexes & frozen canvas appearance
  assert.equal(added.additionalSources.length, 2);
  assert.equal(added.additionalSources[0].id, MAP_PRIMARY_NEW);
  assert.equal(added.additionalSources[0].colorIndex, 0);
  assert.equal(added.additionalSources[0].screenAppearance?.cornerRadius, 42);
  assert.equal(added.additionalSources[0].screenAppearance?.screenFrame, 'browserDark');
  assert.equal(added.additionalSources[1].id, MAP_EXTRA_NEW);
  assert.equal(added.additionalSources[1].colorIndex, 1);

  // Media assets get new IDs & markers remap sourceIDs
  assert.equal(added.timeline.mediaAssets.length, 1);
  assert.notEqual(added.timeline.mediaAssets[0].id, 'asset-old');
  assert.equal(added.recordingMarkers.length, 2);
  assert.equal(added.recordingMarkers[0].sourceID, MAP_PRIMARY_NEW);
  assert.equal(added.recordingMarkers[1].sourceID, MAP_EXTRA_NEW);

  // Rejects mapping onto primary ID
  assert.throws(
    () =>
      adding(
        imported,
        current,
        { [RecordingSourcePrimaryID]: 8 },
        { [RecordingSourcePrimaryID]: 4, [IMP_EXTRA_OLD]: 5 },
        { [RecordingSourcePrimaryID]: RecordingSourcePrimaryID, [IMP_EXTRA_OLD]: MAP_EXTRA_NEW }
      ),
    (e: unknown) => e instanceof ProjectTimelineEditingError && e.kind === 'invalidSourceSequence'
  );

  // Rejects duplicate target ID colliding across sources
  assert.throws(
    () =>
      adding(
        imported,
        current,
        { [RecordingSourcePrimaryID]: 8 },
        { [RecordingSourcePrimaryID]: 4, [IMP_EXTRA_OLD]: 5 },
        { [RecordingSourcePrimaryID]: MAP_PRIMARY_NEW, [IMP_EXTRA_OLD]: MAP_PRIMARY_NEW }
      ),
    (e: unknown) => e instanceof ProjectTimelineEditingError && e.kind === 'invalidSourceSequence'
  );
});

test('T13.4: inserting splices imported programme, freezes audio, bounds/remaps tracks, and splits active host effects', () => {
  const hostMotionGroup = '99999999-9999-4999-8999-999999999999';
  const current = makeRecorderProject({
    media: makeManifest('host'),
    timeline: makeProjectTimeline({
      sourceSequence: makeSourceSequenceEdited([
        makeRecordingSegment({ id: 'host-seg', sourceStart: 0, sourceDuration: 10 }),
      ]),
      animationClips: [
        makeAnimationClip({
          id: 'host-anim',
          timing: makeOverlayTiming(2, 6), // spans insertion at t=5
          sourcePath: 'motions/host.dmhtml',
          timeOffset: 1,
        }),
      ],
      screenMotionClips: [
        makeScreenMotionClip({
          id: 'host-sm',
          timing: makeTransitionTiming({ startTime: 3, duration: 4 }),
          target: makeScreenMotionState(),
          groupID: hostMotionGroup,
        }),
      ],
    }),
  });

  const impGroup = '77777777-7777-4777-8777-777777777777';
  const imported = makeRecorderProject({
    audio: makeAudioStyle({ systemVolume: 0.35, microphoneVolume: 0.85, isSystemMuted: true }),
    media: makeManifest('imp'),
    recordingMarkers: [makeRecordingMarker({ sourceTime: 1, number: 9 })],
    timeline: makeProjectTimeline({
      sourceSequence: makeSourceSequenceEdited([
        makeRecordingSegment({
          id: 'imp-s1',
          sourceStart: 0,
          sourceDuration: 4, // rate 2.0 -> 2s output
          playbackRate: 2.0,
        }),
        makeRecordingSegment({
          id: 'imp-media',
          sourceStart: 0,
          sourceDuration: 2, // 2s output, total imported output = 4s
          media: makeInsertedMedia({
            path: 'clips/title.mp4',
            fileDuration: 2,
            name: 'Title',
            screenAppearance: null,
          }),
        }),
      ]),
      primarySegmentAudioOverrides: {
        'imp-media': makePrimarySegmentAudioOverrides({ systemVolume: 0.9 }),
      },
      zoomClips: [
        makeZoomAnimationClip({ id: 'imp-z1', startTime: 0.5, endTime: 6.0 }), // clamped to 4.0
      ],
      screenMotionClips: [
        makeScreenMotionClip({
          id: 'imp-sm',
          timing: makeTransitionTiming({ startTime: 0.5, duration: 2.0 }),
          target: makeScreenMotionState(),
          groupID: impGroup,
        }),
      ],
      cameraMotionClips: [
        makeCameraMotionClip({
          id: 'imp-cm',
          timing: makeTransitionTiming({ startTime: 0.5, duration: 2.0 }),
          target: makeCameraMotionState(),
          groupID: impGroup,
        }),
      ],
      mosaicClips: [
        makeMosaicClip({
          id: 'imp-mos',
          timing: makeOverlayTiming(1.0, 2.0),
          normalizedRect: makeNormalizedOverlayRect(0.1, 0.1, 0.2, 0.2),
        }),
      ],
      stickerClips: [
        makeStickerClip({
          id: 'imp-st',
          timing: makeOverlayTiming(0.5, 1.5),
          relativePath: 'stickers/dot.png',
        }),
      ],
      animationClips: [
        makeAnimationClip({
          id: 'imp-an',
          timing: makeOverlayTiming(0.5, 1.0),
          sourcePath: 'motions/in.dmhtml',
        }),
      ],
      videoClips: [
        makeVideoClip({
          id: 'imp-vid',
          timing: makeOverlayTiming(1.0, 1.0),
          sourcePath: 'clips/pip.mp4',
        }),
      ],
      audioClips: [
        makeAudioClip({
          id: 'imp-aud',
          timing: makeOverlayTiming(0.0, 10.0), // clamped to 4.0
          sourcePath: 'audio/imp.mp3',
        }),
      ],
      subtitleCues: [
        makeSubtitleCue({
          id: 'imp-sub',
          timing: makeOverlayTiming(0.5, 1.0),
          text: 'imported sub',
        }),
      ],
      mediaAssets: [makeMediaAsset({ id: 'imp-asset', path: 'clips/pip.mp4', kind: 'video' })],
    }),
  });

  const inserted = inserting(
    imported,
    current,
    5.0,
    { [RecordingSourcePrimaryID]: 10 },
    { [RecordingSourcePrimaryID]: 4 },
    makeRecordingProjectImportOptions(),
    { [RecordingSourcePrimaryID]: MAP_PRIMARY_NEW }
  );

  assert.equal(inserted.timeline.sourceSequence.kind, 'edited');
  if (inserted.timeline.sourceSequence.kind === 'edited') {
    const segs = inserted.timeline.sourceSequence.segments;
    // host-left(5s), imp-s1(2s @ 2x), imp-media(2s), host-right(5s)
    assert.equal(segs.length, 4);
    assert.equal(segs[0].sourceDuration, 5);
    assert.equal(segs[1].sourceID, MAP_PRIMARY_NEW);
    assert.equal(segs[1].playbackRate, 2.0);
    assert.equal(segs[1].sourceDuration, 4.0);
    assert.equal(segs[2].media?.path, 'clips/title.mp4');
    assert.ok(segs[2].media?.screenAppearance != null);
    assert.equal(segs[3].sourceStart, 5);
    assert.equal(segs[3].sourceDuration, 5);

    // Imported audio defaults frozen onto imp-s1; explicit override preserved on imp-media
    const ov1 = inserted.timeline.primarySegmentAudioOverrides[segs[1].id];
    assert.equal(ov1?.systemVolume, 0.35);
    assert.equal(ov1?.isSystemMuted, true);
    const ov2 = inserted.timeline.primarySegmentAudioOverrides[segs[2].id];
    assert.equal(ov2?.systemVolume, 0.9);
  }

  // Host spanning animation split at 5 into [2..5] and [9..12]; plus imported anim shifted to 5.5
  assert.equal(inserted.timeline.animationClips.length, 3);
  const hostRightAnim = inserted.timeline.animationClips.find(c => c.timeOffset === 4);
  assert.ok(hostRightAnim);
  assert.equal(hostRightAnim.timing.startTime, 9);

  // Imported zoom was bounded to 4.0s then shifted by +5 -> [5.5, 9.0]
  assert.equal(inserted.timeline.zoomClips.length, 1);
  assert.equal(inserted.timeline.zoomClips[0].startTime, 5.5);
  assert.equal(inserted.timeline.zoomClips[0].endTime, 9.0);
  assert.notEqual(inserted.timeline.zoomClips[0].id, 'imp-z1');

  // Imported screenMotion and cameraMotion share a fresh non-colliding groupID
  const impSm = inserted.timeline.screenMotionClips.find(c => c.timing.startTime === 5.5);
  const impCm = inserted.timeline.cameraMotionClips.find(c => c.timing.startTime === 5.5);
  assert.ok(impSm?.groupID && impCm?.groupID);
  assert.equal(impSm.groupID, impCm.groupID);
  assert.notEqual(impSm.groupID, impGroup);

  // Imported audio bounded to 4.0s and shifted to t=5
  assert.equal(inserted.timeline.audioClips.length, 1);
  assert.equal(inserted.timeline.audioClips[0].timing.startTime, 5.0);
  assert.equal(inserted.timeline.audioClips[0].timing.duration, 4.0);
  assert.equal(inserted.recordingMarkers.length, 1);
  assert.equal(inserted.recordingMarkers[0].sourceID, MAP_PRIMARY_NEW);

  // Respects options filtering all tracks out
  const stripped = inserting(
    imported,
    current,
    5.0,
    { [RecordingSourcePrimaryID]: 10 },
    { [RecordingSourcePrimaryID]: 4 },
    makeRecordingProjectImportOptions({
      includesMotion: false,
      includesSubtitles: false,
      includesOverlays: false,
      includesAudio: false,
    }),
    { [RecordingSourcePrimaryID]: MAP_PRIMARY_NEW }
  );
  assert.equal(stripped.timeline.zoomClips.length, 0);
  assert.equal(stripped.timeline.mosaicClips.length, 0);
  assert.equal(stripped.timeline.stickerClips.length, 0);
  assert.equal(stripped.timeline.videoClips.length, 0);
  assert.equal(stripped.timeline.audioClips.length, 0);
  assert.equal(stripped.timeline.subtitleCues.length, 0);
  // Only the split host animation clips remain (2 pieces, no imported anim)
  assert.equal(stripped.timeline.animationClips.length, 2);
});
