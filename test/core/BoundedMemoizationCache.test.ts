import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoundedMemoizationCache } from '../../src/core/BoundedMemoizationCache.ts';

test('capacity is clamped to at least 1 per Swift L15', () => {
  const cache = new BoundedMemoizationCache<string, number>(0);
  cache.value('a', () => 1);
  cache.value('b', () => 2);
  assert.equal(cache.count, 1);
  // 'a' should have been evicted when 'b' arrived
  let builtA = false;
  const valA = cache.value('a', () => {
    builtA = true;
    return 10;
  });
  assert.equal(builtA, true);
  assert.equal(valA, 10);
});

test('LRU eviction order preserves recency', () => {
  const cache = new BoundedMemoizationCache<string, string>(2);
  cache.value('k1', () => 'v1');
  cache.value('k2', () => 'v2');
  assert.equal(cache.count, 2);

  // Access k1 to make k2 the least recently used
  let builtK1 = false;
  assert.equal(cache.value('k1', () => { builtK1 = true; return 'fresh'; }), 'v1');
  assert.equal(builtK1, false);

  // Insert k3 -> should evict k2, keeping k1 and k3
  cache.value('k3', () => 'v3');
  assert.equal(cache.count, 2);

  // Verify k1 is still cached
  assert.equal(cache.value('k1', () => 'rebuilt'), 'v1');

  // Verify k2 was evicted (calling build again)
  let builtK2 = false;
  assert.equal(cache.value('k2', () => { builtK2 = true; return 'v2-new'; }), 'v2-new');
  assert.equal(builtK2, true);
});

test('valueIfBuilt returning null (cancelled) does not write to cache', () => {
  const cache = new BoundedMemoizationCache<string, string>(3);
  let buildAttempts = 0;

  // 1. Cancelled build returns null
  const res1 = cache.valueIfBuilt('task-1', () => {
    buildAttempts++;
    return null; // Task cancelled
  });
  assert.equal(res1, null);
  assert.equal(cache.count, 0);
  assert.equal(buildAttempts, 1);

  // 2. Subsequent call should invoke build again
  const res2 = cache.valueIfBuilt('task-1', () => {
    buildAttempts++;
    return 'completed-result';
  });
  assert.equal(res2, 'completed-result');
  assert.equal(cache.count, 1);
  assert.equal(buildAttempts, 2);

  // 3. Third call hits cache without calling build
  const res3 = cache.valueIfBuilt('task-1', () => {
    buildAttempts++;
    return 'should-not-run';
  });
  assert.equal(res3, 'completed-result');
  assert.equal(buildAttempts, 2); // Still 2, build not called
});

test('structural object keys are matched correctly regardless of property order', () => {
  interface SpringKey {
    mass: number;
    stiffness: number;
    damping: number;
  }
  const cache = new BoundedMemoizationCache<SpringKey, string>(2);
  let builds = 0;

  const k1: SpringKey = { mass: 2.8, stiffness: 450, damping: 66 };
  cache.value(k1, () => {
    builds++;
    return 'spring-samples-1';
  });
  assert.equal(builds, 1);

  // Distinct object reference with different property key order
  const k2 = { damping: 66, mass: 2.8, stiffness: 450 } as SpringKey;
  const res = cache.value(k2, () => {
    builds++;
    return 'unexpected-build';
  });
  assert.equal(res, 'spring-samples-1');
  assert.equal(builds, 1); // Hit cache!
});
