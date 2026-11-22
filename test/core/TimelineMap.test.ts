// Test for: F:\dogsc-win\src\core\TimelineMap.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TimelineMap,
  TimelineMapError,
  ResolvedRecordingSegment,
} from '../../src/core/TimelineMap.ts';
import {
  makeRecordingSegment,
  makeSourceSequenceFullRecording,
  makeSourceSequenceEdited,
} from '../../src/core/ProjectTimeline.ts';
import { makePointerEventRecord, makeNormalizedPoint } from '../../src/core/ZoomAnimation.ts';

test('T7.2: TimelineMap fullRecording basic properties and mapping', () => {
  const map = new TimelineMap(makeSourceSequenceFullRecording(), 10.0);
  assert.equal(map.outputDuration, 10.0);
  assert.equal(map.segments.length, 1);

  const seg = map.segment(2.5);
  assert.ok(seg);
  assert.equal(seg.id, TimelineMap.fullRecordingSegmentID);
  assert.equal(seg.sourceStart, 0);
  assert.equal(seg.sourceDuration, 10.0);
  assert.equal(seg.playbackRate, 1);
  assert.equal(seg.outputStart, 0);
  assert.equal(seg.outputEnd, 10.0);

  // Time mappings
  assert.equal(map.sourceTime(2.5), 2.5);
  assert.equal(map.outputTime(2.5), 2.5);

  // Out of bounds
  assert.equal(map.segment(-1), null);
  assert.equal(map.segment(10.0), null);
  assert.equal(map.sourceTime(10.0), null);
  assert.equal(map.outputTime(11.0), null);

  // Ranges
  const outRange = map.outputRange(TimelineMap.fullRecordingSegmentID);
  assert.ok(outRange);
  assert.equal(outRange.start, 0);
  assert.equal(outRange.duration, 10.0);

  const mat = map.materializedSourceSequence();
  assert.equal(mat.kind, 'edited');
  if (mat.kind === 'edited') {
    assert.equal(mat.segments.length, 1);
    assert.equal(mat.segments[0].id, TimelineMap.fullRecordingSegmentID);
  }
});

test('T7.2: TimelineMap edited segments with variable speed and cuts', () => {
  const seg1 = makeRecordingSegment({
    id: 'seg-1',
    sourceStart: 1.0,
    sourceDuration: 4.0, // output = 4.0
    playbackRate: 1.0,
  });
  const seg2 = makeRecordingSegment({
    id: 'seg-2',
    sourceStart: 6.0,
    sourceDuration: 2.0, // output = 1.0 at 2x
    playbackRate: 2.0,
  });

  const map = new TimelineMap(makeSourceSequenceEdited([seg1, seg2]), 10.0);
  assert.equal(map.outputDuration, 5.0); // 4.0 + 1.0

  // Segment 1 lookup
  const found1 = map.segment(2.0);
  assert.ok(found1);
  assert.equal(found1.id, 'seg-1');
  assert.equal(found1.outputStart, 0);
  assert.equal(found1.outputEnd, 4.0);
  assert.equal(map.sourceTime(2.0), 3.0); // 1.0 + 2.0

  // Segment 2 lookup
  const found2 = map.segment(4.5);
  assert.ok(found2);
  assert.equal(found2.id, 'seg-2');
  assert.equal(found2.outputStart, 4.0);
  assert.equal(found2.outputEnd, 5.0);
  // At output 4.5: elapsed in seg2 = 0.5. At 2x speed -> source offset = 0.5 * 2 = 1.0. source = 6.0 + 1.0 = 7.0
  assert.equal(map.sourceTime(4.5), 7.0);

  // Reverse mapping outputTime(forSourceTime)
  assert.equal(map.outputTime(3.0), 2.0);
  assert.equal(map.outputTime(7.0), 4.5);
  // Source time in cut interval (e.g. 5.5) -> null
  assert.equal(map.outputTime(5.5), null);
});

test('T7.2: TimelineMap validation and error cases', () => {
  // Invalid source duration
  assert.throws(
    () => new TimelineMap(makeSourceSequenceFullRecording(), 0),
    (err: any) => err instanceof TimelineMapError && err.kind === 'invalidFullSourceDuration'
  );
  assert.throws(
    () => new TimelineMap(makeSourceSequenceFullRecording(), -5),
    (err: any) => err instanceof TimelineMapError && err.kind === 'invalidFullSourceDuration'
  );

  // Empty edited
  assert.throws(
    () => new TimelineMap(makeSourceSequenceEdited([]), 10),
    (err: any) => err instanceof TimelineMapError && err.kind === 'emptyEditedSequence'
  );

  // Duplicate segment ID
  const dup1 = makeRecordingSegment({ id: 'dup', sourceStart: 0, sourceDuration: 2 });
  const dup2 = makeRecordingSegment({ id: 'dup', sourceStart: 3, sourceDuration: 2 });
  assert.throws(
    () => new TimelineMap(makeSourceSequenceEdited([dup1, dup2]), 10),
    (err: any) => err instanceof TimelineMapError && err.kind === 'duplicateSegmentID'
  );

  // Segment outside source
  const outSeg = makeRecordingSegment({ id: 's1', sourceStart: 8, sourceDuration: 5 });
  assert.throws(
    () => new TimelineMap(makeSourceSequenceEdited([outSeg]), 10),
    (err: any) => err instanceof TimelineMapError && err.kind === 'segmentOutsideSource'
  );

  // Repeated / overlapping source intervals are valid in v0.2.0 and disambiguated by segmentID
  const overlap1 = makeRecordingSegment({ id: 's1', sourceStart: 1, sourceDuration: 4 }); // output 0..4
  const overlap2 = makeRecordingSegment({ id: 's2', sourceStart: 3, sourceDuration: 4 }); // output 4..8
  const repeatedMap = new TimelineMap(makeSourceSequenceEdited([overlap1, overlap2]), 10);
  assert.equal(repeatedMap.outputDuration, 8);
  const positions = repeatedMap.outputPositions(3.5, '00000000-0000-0000-0000-000000000001');
  assert.equal(positions.length, 2);
  assert.equal(positions[0].segmentID, 's1');
  assert.equal(positions[0].time, 2.5);
  assert.equal(positions[1].segmentID, 's2');
  assert.equal(positions[1].time, 4.5);
});

test('T7.2: TimelineMap mapPointerEventSegments seeds move and scales time', () => {
  const seg1 = makeRecordingSegment({
    id: 's1',
    sourceStart: 2.0,
    sourceDuration: 2.0, // 2..4, output 0..2
    playbackRate: 1.0,
  });
  const seg2 = makeRecordingSegment({
    id: 's2',
    sourceStart: 5.0,
    sourceDuration: 2.0, // 5..7, output 2..3 at 2x
    playbackRate: 2.0,
  });
  const map = new TimelineMap(makeSourceSequenceEdited([seg1, seg2]), 10.0);

  const events = [
    makePointerEventRecord({ time: 1.5, location: makeNormalizedPoint(0.1, 0.1), kind: 'move' }),
    makePointerEventRecord({ time: 2.5, location: makeNormalizedPoint(0.2, 0.2), kind: 'leftClick' }),
    makePointerEventRecord({ time: 4.8, location: makeNormalizedPoint(0.5, 0.5), kind: 'move' }),
    makePointerEventRecord({ time: 6.0, location: makeNormalizedPoint(0.8, 0.8), kind: 'rightClick' }),
  ];

  const mapped = map.mapPointerEventSegments(events);
  assert.equal(mapped.length, 2);

  // seg 1:
  // Starts at 2.0. Event at 1.5 is prior seed. Event at 2.5 is inside range.
  const m1 = mapped[0];
  assert.equal(m1.id, 's1');
  assert.equal(m1.events.length, 2);
  // Seed move at output 0 (location from event at 1.5)
  assert.equal(m1.events[0].time, 0);
  assert.equal(m1.events[0].location.x, 0.1);
  assert.equal(m1.events[0].kind, 'move');
  // Second event: at source 2.5 -> output: 0 + (2.5 - 2.0) = 0.5
  assert.equal(m1.events[1].time, 0.5);
  assert.equal(m1.events[1].kind, 'leftClick');

  // seg 2:
  // Starts at 5.0 (outputStart 2.0).
  // Prior event at 4.8 seeds move at output 2.0 (location from 4.8).
  // Event at 6.0 inside range: elapsed source = 1.0 -> output offset = 1.0 / 2.0 = 0.5. output = 2.5.
  const m2 = mapped[1];
  assert.equal(m2.id, 's2');
  assert.equal(m2.events.length, 2);
  assert.equal(m2.events[0].time, 2.0);
  assert.equal(m2.events[0].location.x, 0.5);
  assert.equal(m2.events[0].kind, 'move');
  assert.equal(m2.events[1].time, 2.5);
  assert.equal(m2.events[1].kind, 'rightClick');
});
