import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PointerEventTimelineOrdering } from '../../src/core/PointerEventTimelineOrdering.ts';
import type { PointerEventRecord } from '../../src/core/ZoomAnimation.ts';

const ev = (time: number): PointerEventRecord =>
  ({ time, location: { x: 0, y: 0 }, kind: 'move', modifiers: [], cursorAssetID: null }) as PointerEventRecord;

test('ordered input is returned as-is (same reference)', () => {
  const events = [ev(0), ev(1), ev(1), ev(2)];
  assert.equal(PointerEventTimelineOrdering.isNormalized(events), true);
  assert.equal(PointerEventTimelineOrdering.normalized(events), events);
});

test('unordered / non-finite input is filtered and stably sorted, input untouched', () => {
  const events = [ev(2), ev(Number.NaN), ev(0), ev(1)];
  const out = PointerEventTimelineOrdering.normalized(events);
  assert.deepEqual(out.map((e) => e.time), [0, 1, 2]);
  assert.equal(events.length, 4);
  assert.equal(events[0].time, 2);
});
