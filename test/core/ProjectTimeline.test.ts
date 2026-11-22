import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RecordingSegment,
  makeRecordingSegment,
  recordingSegmentSourceEnd,
  recordingSegmentOutputDuration,
  SourceSequence,
  TransitionTiming,
  makeTransitionTiming,
  transitionTimingEndTime,
  transitionTimingLeadInEndTime,
  transitionTimingEffectEndTime,
  transitionTimingRequestedLeadInDuration,
  transitionTimingRequestedReturnDuration,
  transitionTimingPreserveTransitionIntent,
  PrimarySegmentAudioOverrides,
  makePrimarySegmentAudioOverrides,
  primarySegmentAudioOverridesIsEmpty,
  makeProjectTimeline,
} from '../../src/core/ProjectTimeline.ts';

test('T7.1: RecordingSegment calculations and playback rate', () => {
  const seg = makeRecordingSegment({
    sourceStart: 2.0,
    sourceDuration: 8.0,
    playbackRate: 2.0,
  });

  assert.equal(seg.sourceStart, 2.0);
  assert.equal(seg.sourceDuration, 8.0);
  assert.equal(seg.playbackRate, 2.0);
  assert.equal(recordingSegmentSourceEnd(seg), 10.0);
  assert.equal(recordingSegmentOutputDuration(seg), 4.0);

  // Invalid playback rate defaults to 1.0
  const segInvalid = makeRecordingSegment({
    sourceStart: 0,
    sourceDuration: 5,
    playbackRate: -2,
  });
  assert.equal(segInvalid.playbackRate, 1.0);
});

test('T7.1: SourceSequence presets', () => {
  assert.deepEqual(SourceSequence.fullRecording, { kind: 'fullRecording' });

  const edited = SourceSequence.edited([
    makeRecordingSegment({ sourceStart: 0, sourceDuration: 5 }),
  ]);
  assert.equal(edited.kind, 'edited');
  if (edited.kind === 'edited') {
    assert.equal(edited.segments.length, 1);
  }
});

test('T7.1: TransitionTiming timing properties and clamping', () => {
  const timing = makeTransitionTiming({
    startTime: 1.0,
    duration: 2.0,
    leadInDuration: 0.5,
    returnDuration: 0.8,
  });

  assert.equal(transitionTimingEndTime(timing), 3.0);
  assert.equal(transitionTimingLeadInEndTime(timing), 1.5);
  assert.equal(transitionTimingEffectEndTime(timing), 3.8);

  // Clamping of leadIn and return duration (max 5)
  const clamped = makeTransitionTiming({
    startTime: 0,
    duration: 10,
    leadInDuration: 99,
    returnDuration: -5,
  });
  assert.equal(clamped.leadInDuration, 5.0);
  assert.equal(clamped.returnDuration, 0.0);

  // Preserve transition intent
  const preserved = transitionTimingPreserveTransitionIntent(timing, 0.7);
  assert.equal(preserved.preferredLeadInDuration, 0.5);
  assert.equal(preserved.preferredReturnDuration, 0.8);
});

test('T7.1: PrimarySegmentAudioOverrides and ProjectTimeline construction', () => {
  const empty = makePrimarySegmentAudioOverrides();
  assert.equal(primarySegmentAudioOverridesIsEmpty(empty), true);

  const overridden = makePrimarySegmentAudioOverrides({
    systemVolume: 1.5, // clamps to 1
    microphoneVolume: -0.2, // clamps to 0
    isSystemMuted: true,
  });
  assert.equal(overridden.systemVolume, 1.0);
  assert.equal(overridden.microphoneVolume, 0.0);
  assert.equal(overridden.isSystemMuted, true);
  assert.equal(primarySegmentAudioOverridesIsEmpty(overridden), false);

  const timeline = makeProjectTimeline();
  assert.deepEqual(timeline.sourceSequence, SourceSequence.fullRecording);
  assert.equal(timeline.zoomClips.length, 0);
  assert.equal(timeline.screenMotionClips.length, 0);
  assert.equal(timeline.cameraMotionClips.length, 0);
  assert.equal(timeline.mosaicClips.length, 0);
  assert.equal(timeline.stickerClips.length, 0);
  assert.equal(timeline.animationClips.length, 0);
  assert.equal(timeline.audioClips.length, 0);
  assert.equal(timeline.videoClips.length, 0);
  assert.equal(timeline.subtitleCues.length, 0);
  assert.equal(timeline.mediaAssets.length, 0);
});

test('v0.2.0: InsertedMedia, RecordingSegment multi-source and visual layer organization', async () => {
  const {
    makeInsertedMedia,
    insertedMediaHasEmbeddedAudio,
    projectTimelineNextVisualLayer,
    projectTimelineVisualLayer,
    projectTimelineOrganizeTracks,
    projectTimelineProgramAudioClips,
    projectTimelineAssociatedEffectAudioClips,
  } = await import('../../src/core/ProjectTimeline.ts');
  const { makeOverlayTiming, makeStickerClip, makeAnimationClip } = await import(
    '../../src/core/OverlayTimeline.ts'
  );
  const { makeAudioClip, makeVideoClip } = await import('../../src/core/PostProductionModel.ts');

  const silentMotion = makeInsertedMedia({
    path: 'standin.mp4',
    fileDuration: 3,
    name: 'Title',
    motionPath: 'title.dmhtml',
  });
  assert.equal(insertedMediaHasEmbeddedAudio(silentMotion), false);
  const voicedMotion = makeInsertedMedia({
    path: 'standin.mp4',
    fileDuration: 3,
    name: 'Title',
    motionPath: 'title.dmhtml',
    soundPath: 'boom.wav',
  });
  assert.equal(insertedMediaHasEmbeddedAudio(voicedMotion), true);

  const s1 = makeStickerClip({
    id: 'ST-1',
    timing: makeOverlayTiming(0, 4),
    relativePath: 'a.png',
    layerIndex: 5,
  });
  const a1 = makeAnimationClip({
    id: 'AN-1',
    timing: makeOverlayTiming(2, 3),
    sourcePath: 'b.dmhtml',
    layerIndex: 2,
    soundtrack: { path: 'sfx.wav', volume: 0.7, fadeIn: 0, fadeOut: 0 },
  });
  const v1 = makeVideoClip({
    id: 'VD-1',
    timing: makeOverlayTiming(6, 2),
    sourcePath: 'broll.mp4',
    layerIndex: 9,
  });
  const bgm = makeAudioClip({
    id: 'AU-1',
    timing: makeOverlayTiming(0, 20),
    sourcePath: 'bgm.mp3',
    kind: 'music',
  });
  const fx = makeAudioClip({
    id: 'AU-2',
    timing: makeOverlayTiming(1, 2),
    sourcePath: 'pop.wav',
    kind: 'effect',
  });

  const tl = makeProjectTimeline({
    stickerClips: [s1],
    animationClips: [a1],
    videoClips: [v1],
    audioClips: [bgm, fx],
  });

  assert.equal(projectTimelineNextVisualLayer(tl), 10);
  // Overlaps s1 (layer 5) and a1 (layer 2) -> places above max overlapping layer (5 + 1 = 6)
  assert.equal(projectTimelineVisualLayer(tl, makeOverlayTiming(1, 2)), 6);
  // Non-overlapping span [9, 10] reuses lowest layer (2)
  assert.equal(projectTimelineVisualLayer(tl, makeOverlayTiming(9, 1)), 2);

  const organized = projectTimelineOrganizeTracks(tl);
  // Original tl must remain unmutated
  assert.equal(tl.videoClips[0].layerIndex, 9);
  assert.equal(organized.animationClips[0].layerIndex, 0);
  assert.equal(organized.stickerClips[0].layerIndex, 1);
  assert.equal(organized.videoClips[0].layerIndex, 0);
  // Audio: music on lane 0, effect on lane 1 (after music)
  assert.equal(organized.audioClips[0].lane, 0);
  assert.equal(organized.audioClips[1].lane, 1);

  assert.equal(projectTimelineProgramAudioClips(tl).length, 4);
  assert.equal(projectTimelineAssociatedEffectAudioClips(tl, 1, 3).length, 1);
});
