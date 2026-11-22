// Test for: F:\dogsc-win\src\core\ProjectTimelineRetime.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  settingPlaybackRate,
  ProjectTimelineEditingError,
  zoomSequenceIsValid,
  nonoverlappingZoomClips,
} from '../../src/core/ProjectTimelineRetime.ts';
import {
  makeRecordingSegment,
  makeSourceSequenceEdited,
  makeSourceSequenceFullRecording,
  makeProjectTimeline,
} from '../../src/core/ProjectTimeline.ts';
import { TimelineMap } from '../../src/core/TimelineMap.ts';
import { makeZoomAnimationClip, makeNormalizedPoint } from '../../src/core/ZoomAnimation.ts';
import {
  makeMosaicClip,
  makeAnimationClip,
  makeOverlayTiming,
  makeNormalizedOverlayRect,
} from '../../src/core/OverlayTimeline.ts';
import { makeAudioClip, makeSubtitleCue, makeVideoClip } from '../../src/core/PostProductionModel.ts';
import { makeSegmentSceneStyle } from '../../src/core/SegmentSceneStyle.ts';
import { RecordingSourcePrimaryID } from '../../src/core/RecordingSource.ts';

test('T7.5: settingPlaybackRate changes rate and shifts downstream clips', () => {
  const seg1 = makeRecordingSegment({ id: 's1', sourceStart: 0, sourceDuration: 4, playbackRate: 1.0 }); // 0..4
  const seg2 = makeRecordingSegment({ id: 's2', sourceStart: 4, sourceDuration: 6, playbackRate: 1.0 }); // 4..10
  const clipDownstream = makeZoomAnimationClip({
    id: 'z1',
    startTime: 5.0,
    endTime: 7.0, // duration = 2.0
    scale: 2.0,
  });

  const timeline = makeProjectTimeline({
    sourceSequence: makeSourceSequenceEdited([seg1, seg2]),
    zoomClips: [clipDownstream],
  });

  // Double speed of seg1 (rate 2.0 -> output duration decreases from 4.0 to 2.0, tailOffset = -2.0)
  const retimed = settingPlaybackRate(2.0, 's1', timeline, 10.0);
  assert.equal(retimed.sourceSequence.kind, 'edited');
  if (retimed.sourceSequence.kind === 'edited') {
    assert.equal(retimed.sourceSequence.segments[0].playbackRate, 2.0);
  }

  // Downstream clip shifted by -2.0s: new start = 5.0 - 2.0 = 3.0, duration preserved (3..5)
  assert.equal(retimed.zoomClips.length, 1);
  assert.equal(retimed.zoomClips[0].startTime, 3.0);
  assert.equal(retimed.zoomClips[0].endTime, 5.0);
  assert.equal(retimed.zoomClips[0].duration, 2.0);
});

test('T7.5: settingPlaybackRate rejects unknown segment ID', () => {
  const timeline = makeProjectTimeline({
    sourceSequence: makeSourceSequenceFullRecording(),
  });
  assert.throws(
    () => settingPlaybackRate(2.0, 'non-existent-uuid', timeline, 10.0),
    (err: any) => err instanceof ProjectTimelineEditingError && err.kind === 'segmentNotFound'
  );
});

test('T7.5: zoomSequenceIsValid and nonoverlappingZoomClips repair', () => {
  const c1 = makeZoomAnimationClip({ id: 'z1', startTime: 0, endTime: 2, exitDuration: 0.5 }); // ends 2.0, return ends 2.5
  const c2 = makeZoomAnimationClip({ id: 'z2', startTime: 2.2, endTime: 4 }); // starts at 2.2 in the middle of return window!

  // Not touching (gap 0.2 > tolerance) and does not clear return (2.2 < 2.5) -> invalid
  assert.equal(zoomSequenceIsValid(c1, c2), false);

  // nonoverlappingZoomClips pushes c2 to 2.5
  const repaired = nonoverlappingZoomClips([c1, c2]);
  assert.equal(repaired.length, 2);
  assert.equal(repaired[1].startTime, 2.5);
  assert.equal(repaired[1].endTime, 4.3); // 2.5 + duration 1.8
});

test('T13.5b-1: multi-source settingPlaybackRate preserves segment sceneStyle and retimes all overlay/post tracks', () => {
  const altSourceID = '44444444-4444-4444-8444-444444444444';
  const style = makeSegmentSceneStyle({ presetID: 'focus-style' });
  const seg1 = makeRecordingSegment({
    id: 's1',
    sourceStart: 0,
    sourceDuration: 4,
    playbackRate: 1.0,
    sourceID: altSourceID,
    sceneStyle: style,
  });
  const seg2 = makeRecordingSegment({
    id: 's2',
    sourceStart: 0,
    sourceDuration: 6,
    playbackRate: 1.0,
  });
  const mosaicInside = makeMosaicClip({
    id: 'm1',
    timing: makeOverlayTiming(1.0, 2.0), // inside seg1 (0..4) -> halved to (0.5, 1.0)
    normalizedRect: makeNormalizedOverlayRect(0.2, 0.2, 0.3, 0.3),
  });
  const animDownstream = makeAnimationClip({
    id: 'a1',
    timing: makeOverlayTiming(5.0, 2.0),
    sourcePath: 'motions/badge.dmhtml',
  });
  const audioDownstream = makeAudioClip({
    id: 'aud1',
    timing: makeOverlayTiming(4.5, 2.0),
    sourcePath: 'audio/bgm.mp3',
  });
  const videoDownstream = makeVideoClip({
    id: 'vid1',
    timing: makeOverlayTiming(6.0, 2.0),
    sourcePath: 'clips/overlay.mp4',
  });
  const subDownstream = makeSubtitleCue({
    id: 'sub1',
    timing: makeOverlayTiming(5.0, 1.5),
    text: 'caption',
  });

  const timeline = makeProjectTimeline({
    sourceSequence: makeSourceSequenceEdited([seg1, seg2]),
    mosaicClips: [mosaicInside],
    animationClips: [animDownstream],
    audioClips: [audioDownstream],
    videoClips: [videoDownstream],
    subtitleCues: [subDownstream],
  });

  const retimed = settingPlaybackRate(2.0, 's1', timeline, {
    [RecordingSourcePrimaryID]: 10,
    [altSourceID]: 8,
  });

  if (retimed.sourceSequence.kind === 'edited') {
    assert.equal(retimed.sourceSequence.segments[0].sourceID, altSourceID);
    assert.equal(retimed.sourceSequence.segments[0].sceneStyle?.presetID, 'focus-style');
    assert.equal(retimed.sourceSequence.segments[0].playbackRate, 2.0);
  }
  assert.equal(retimed.mosaicClips[0].timing.startTime, 0.5);
  assert.equal(retimed.mosaicClips[0].timing.duration, 2.0);
  assert.equal(retimed.animationClips[0].timing.startTime, 3.0);
  assert.equal(retimed.audioClips[0].timing.startTime, 2.5);
  assert.equal(retimed.videoClips[0].timing.startTime, 4.0);
  assert.equal(retimed.subtitleCues[0].timing.startTime, 3.0);
});
