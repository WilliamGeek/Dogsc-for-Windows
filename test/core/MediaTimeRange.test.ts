import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMediaTimeRange, mediaTimeRangeEnd, mediaTimeRangeBucketIndex } from '../../src/core/MediaTimeRange.ts';

test('failable init returns null like Swift nil', () => {
  assert.equal(makeMediaTimeRange(0, 0), null);
  assert.equal(makeMediaTimeRange(0, -1), null);
  assert.equal(makeMediaTimeRange(Number.NaN, 1), null);
  assert.equal(makeMediaTimeRange(Number.MAX_VALUE, Number.MAX_VALUE), null); // end overflows to inf
});

test('bucketIndex is end-exclusive', () => {
  const r = makeMediaTimeRange(10, 4)!;
  assert.equal(mediaTimeRangeEnd(r), 14);
  assert.equal(mediaTimeRangeBucketIndex(r, 10, 4), 0);
  assert.equal(mediaTimeRangeBucketIndex(r, 13.99, 4), 3);
  assert.equal(mediaTimeRangeBucketIndex(r, 14, 4), null);
  assert.equal(mediaTimeRangeBucketIndex(r, 9.99, 4), null);
  assert.equal(mediaTimeRangeBucketIndex(r, 11, 0), null);
});

