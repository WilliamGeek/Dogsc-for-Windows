import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PointerTimelineAlignment } from '../../src/core/PointerTimelineAlignment.ts';
import type { PointerEventRecord } from '../../src/core/ZoomAnimation.ts';

const makeEvent = (time: number, x = 0.5, y = 0.5, kind: 'move' | 'leftClick' = 'move'): PointerEventRecord =>
  ({ time, location: { x, y }, kind, modifiers: [], cursorAssetID: null }) as PointerEventRecord;

test('shift == 0 returns normalized events unchanged', () => {
  const events = [makeEvent(0.5), makeEvent(1.0)];
  const aligned = PointerTimelineAlignment.align(events, 2.0, 2.0);
  assert.equal(aligned.length, 2);
  assert.equal(aligned[0].time, 0.5);
  assert.equal(aligned[1].time, 1.0);
});

test('shift > 0 offsets all events into the future', () => {
  const events = [makeEvent(0.5), makeEvent(1.0)];
  // shift = startOffset (2.0) - sourceStartTime (1.0) = 1.0
  const aligned = PointerTimelineAlignment.align(events, 2.0, 1.0);
  assert.equal(aligned.length, 2);
  assert.equal(aligned[0].time, 1.5);
  assert.equal(aligned[1].time, 2.0);
});

test('shift < 0 inserts non-clicking seed at t=0 from last pre-roll event per Swift L27-35', () => {
  // Event 1 at 0.2 (with shift -0.5 -> -0.3 < 0, becomes lastPreRoll at location 0.1, 0.2)
  // Event 2 at 0.4 (with shift -0.5 -> -0.1 < 0, becomes newer lastPreRoll at location 0.3, 0.4)
  // Event 3 at 0.8 (with shift -0.5 -> 0.3 > 0, first visible event)
  const events = [
    makeEvent(0.2, 0.1, 0.2, 'leftClick'),
    makeEvent(0.4, 0.3, 0.4, 'leftClick'),
    makeEvent(0.8, 0.7, 0.8, 'leftClick'),
  ];
  const aligned = PointerTimelineAlignment.align(events, 0.0, 0.5);

  assert.equal(aligned.length, 2);
  // First is seeded at t=0 with kind 'move' and location of the last pre-roll event
  assert.equal(aligned[0].time, 0);
  assert.equal(aligned[0].kind, 'move');
  assert.deepEqual(aligned[0].location, { x: 0.3, y: 0.4 });

  // Second is the shifted event at 0.8 - 0.5 = 0.3
  assert.ok(Math.abs(aligned[1].time - 0.3) < 1e-9);
  assert.equal(aligned[1].kind, 'leftClick');
  assert.deepEqual(aligned[1].location, { x: 0.7, y: 0.8 });
});

test('all events in pre-roll seeds single event at t=0', () => {
  const events = [
    makeEvent(0.1, 0.2, 0.3),
    makeEvent(0.2, 0.4, 0.5),
  ];
  // shift = -1.0, both events end up < 0
  const aligned = PointerTimelineAlignment.align(events, 0.0, 1.0);
  assert.equal(aligned.length, 1);
  assert.equal(aligned[0].time, 0);
  assert.equal(aligned[0].kind, 'move');
  assert.deepEqual(aligned[0].location, { x: 0.4, y: 0.5 });
});
