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
});
