// Test for: F:\dogsc-win\src\core\TimelineMediaPlan.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TimelineMediaSlice,
  TimelineMediaPlan,
  AuxiliaryMediaClockAlignment,
  ProjectTimelineMediaPlan,
} from '../../src/core/TimelineMediaPlan.ts';
import { TimelineMap } from '../../src/core/TimelineMap.ts';
import {
  makeRecordingSegment,
  makeSourceSequenceEdited,
  makeSourceSequenceFullRecording,
} from '../../src/core/ProjectTimeline.ts';
import { makeMediaTimeRange } from '../../src/core/MediaTimeRange.ts';
import {
  makeMediaTimelinePlacement,
  makeProjectMediaReference,
  makeMediaSyncAnchor,
} from '../../src/core/MediaTimeline.ts';
import { makePointerEventRecord, makeNormalizedPoint } from '../../src/core/ZoomAnimation.ts';

test('T7.2: TimelineMediaSlice properties and boundary queries', () => {
  const slice = new TimelineMediaSlice({
    segmentID: 's1',
    outputStart: 1.0,
    sourceStart: 5.0,
    duration: 3.0,
    sourceTimeScale: 2.0,
  });

  assert.equal(slice.outputEnd, 4.0);
  assert.equal(slice.sourceEnd, 11.0); // 5 + 3 * 2

  // At start boundary
  assert.equal(slice.sourceTime(1.0), 5.0);
  // Inside
  assert.equal(slice.sourceTime(2.0), 7.0); // 5 + 1.0 * 2
  // At end boundary -> null (exclusive)
  assert.equal(slice.sourceTime(4.0), null);
  // Outside
  assert.equal(slice.sourceTime(0.5), null);
  assert.equal(slice.sourceTime(4.5), null);
});

test('T7.2: TimelineMediaPlan from primary TimelineMap', () => {
  const seg1 = makeRecordingSegment({ id: 's1', sourceStart: 0, sourceDuration: 4 });
  const seg2 = makeRecordingSegment({ id: 's2', sourceStart: 5, sourceDuration: 3 });
  const map = new TimelineMap(makeSourceSequenceEdited([seg1, seg2]), 10);

  const plan = new TimelineMediaPlan({ primary: map });
  assert.equal(plan.outputDuration, 7.0);
  assert.equal(plan.playableDuration, 7.0);
  assert.equal(plan.slices.length, 2);

  // Slices check
  assert.equal(plan.slices[0].outputStart, 0);
  assert.equal(plan.slices[0].duration, 4);
  assert.equal(plan.slices[1].outputStart, 4);
  assert.equal(plan.slices[1].duration, 3);

  // slice lookup
  assert.equal(plan.slice(2.0)?.id, 's1');
  assert.equal(plan.slice(5.0)?.id, 's2');
  assert.equal(plan.slice(8.0), null);

  // sourceTime
  assert.equal(plan.sourceTime(2.0), 2.0);
  assert.equal(plan.sourceTime(5.0), 6.0); // 5.0 + (5.0 - 4.0)

  // contains
  assert.ok(plan.contains(0));
  assert.ok(plan.contains(3.99));
  assert.ok(plan.contains(4.0));
  assert.ok(!plan.contains(7.0));
});

test('T7.2: TimelineMediaPlan with auxiliary placement without sync anchors', () => {
  // Screen recording has segment from 2 to 6 (duration 4)
  const seg = makeRecordingSegment({ id: 's1', sourceStart: 2, sourceDuration: 4 });
  const map = new TimelineMap(makeSourceSequenceEdited([seg]), 10);

  // Camera was started at source 0, startOffset 1, available 0..8
  const cameraRef = makeProjectMediaReference({
    relativePath: 'camera.mp4',
    startOffset: 1.0, // starts at timeline 1.0
    sourceStartTime: 0.0,
  });
  const placement = makeMediaTimelinePlacement({
    reference: cameraRef,
    sourceAvailableStart: 0,
    sourceAvailableDuration: 8,
    timelineDuration: 10,
  });

  const plan = new TimelineMediaPlan({
    timelineMap: map,
    auxiliary: placement,
  });

  assert.equal(plan.outputDuration, 4.0);
  assert.equal(plan.slices.length, 1);
  const s = plan.slices[0];
  // Retained start = max(seg.sourceStart 2.0, placement.timelineStart 1.0) = 2.0
  // Retained end = min(seg.sourceEnd 6.0, placement.timelineEnd 9.0) = 6.0
  // Starts and ends at primary boundary -> duration verbatim 4.0
  assert.equal(s.duration, 4.0);
  assert.equal(s.outputStart, 0);
  // Source time at timeline 2.0: camera started at 1.0 -> 1s into camera source -> sourceStart = 1.0
  assert.equal(s.sourceStart, 1.0);
});

test('T7.2: TimelineMediaPlan with sync anchors divides slice', () => {
  const seg = makeRecordingSegment({ id: 's1', sourceStart: 0, sourceDuration: 6 });
  const map = new TimelineMap(makeSourceSequenceEdited([seg]), 10);

  const anchor = makeMediaSyncAnchor({ sourceTime: 3.0, offset: 0.2 });
  const ref = makeProjectMediaReference({
    relativePath: 'cam.mp4',
    startOffset: 0,
    sourceStartTime: 0,
    syncAnchors: [anchor],
  });
  const placement = makeMediaTimelinePlacement({
    reference: ref,
    sourceAvailableStart: 0,
    sourceAvailableDuration: 10,
    timelineDuration: 10,
  });

  const plan = new TimelineMediaPlan({
    timelineMap: map,
    auxiliary: placement,
    syncAnchors: [anchor],
    sourceAvailableRange: makeMediaTimeRange(0, 10),
  });

  // Seg 0..6 is split by anchor at 3.0 into 2 slices (0..3 and 3..6)
  assert.equal(plan.slices.length, 2);
  assert.equal(plan.slices[0].outputStart, 0);
  assert.equal(plan.slices[0].duration, 3.0);
  assert.equal(plan.slices[1].outputStart, 3.0);
  assert.equal(plan.slices[1].duration, 3.0);
});

test('T7.2: AuxiliaryMediaClockAlignment inferred scale', () => {
  const ref = makeProjectMediaReference({
    relativePath: 'a.mp4',
    sourceStartTime: 0,
    startOffset: 0,
  });
  const range = makeMediaTimeRange(0, 10.05);
  assert.ok(range);

  // 10.05 / 10 = 1.005, within 0.9..1.1
  const scale = AuxiliaryMediaClockAlignment.inferredSourceTimeScale(ref, range, 10.0);
  assert.ok(scale != null);
  assert.ok(Math.abs(scale - 1.005) < 1e-6);

  // Out of 0.9..1.1 range -> null
  const rangeFar = makeMediaTimeRange(0, 15.0);
  assert.ok(rangeFar);
  assert.equal(AuxiliaryMediaClockAlignment.inferredSourceTimeScale(ref, rangeFar, 10.0), null);
});

test('T7.2: ProjectTimelineMediaPlan end-to-end plan generation', () => {
  const videoRange = makeMediaTimeRange(0, 10);
  assert.ok(videoRange);
  const audioRange = makeMediaTimeRange(0, 10);
  assert.ok(audioRange);

  const pointerEvents = [
    makePointerEventRecord({ time: 0.5, location: makeNormalizedPoint(0.5, 0.5), kind: 'move' }),
  ];

  const plan = new ProjectTimelineMediaPlan({
    sourceSequence: makeSourceSequenceFullRecording(),
    primaryVideoRange: videoRange,
    systemAudioRange: audioRange,
    sourcePointerEvents: pointerEvents,
  });

  assert.equal(plan.outputDuration, 10.0);
  assert.ok(plan.primary);
  assert.ok(plan.systemAudio);
  assert.equal(plan.camera, null);
  assert.equal(plan.microphone, null);
  assert.equal(plan.pointerAlignedEvents.length, 1);
});
