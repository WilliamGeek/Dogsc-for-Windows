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
