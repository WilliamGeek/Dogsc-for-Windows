import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ElementMotionEvaluator, ElementMotionCurveAllCases } from '../../src/core/ElementMotion.ts';

test('every curve hits exact endpoints and clamps', () => {
  for (const curve of ElementMotionCurveAllCases) {
    assert.equal(ElementMotionEvaluator.progress(0, curve), 0);
    assert.equal(ElementMotionEvaluator.progress(1, curve), 1);
    assert.equal(ElementMotionEvaluator.progress(-3, curve), 0);
    assert.equal(ElementMotionEvaluator.progress(9, curve), 1);
    assert.equal(ElementMotionEvaluator.progress(Number.NaN, curve), 0);
  }
});

test('hand-computed midpoints', () => {
  assert.equal(ElementMotionEvaluator.progress(0.5, 'smooth'), 0.5);
  assert.equal(ElementMotionEvaluator.progress(0.5, 'swift'), 1 - 0.0625);
  assert.equal(ElementMotionEvaluator.progress(0.5, 'gentle'), 1 - 0.125);
});

