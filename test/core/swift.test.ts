import { test } from 'node:test';
import assert from 'node:assert/strict';
import { max, min, clamp, toInt } from '../../src/core/swift.ts';

test('Swift max/min NaN semantics differ from Math.*', () => {
  assert.equal(max(0, Number.NaN), 0); // Swift: y >= x ? y : x  → NaN >= 0 false → x
  assert.ok(Number.isNaN(max(Number.NaN, 0)));
  assert.equal(min(1, Number.NaN), 1);
  assert.equal(max(1, 5, 3), 5);
  assert.equal(min(4, 2, 3), 2);
});

test('clamp and toInt', () => {
  assert.equal(clamp(2, 0, 1), 1);
  assert.equal(clamp(-1, 0, 1), 0);
  assert.equal(toInt(2.9), 2);
  assert.equal(toInt(-2.9), -2);
});

