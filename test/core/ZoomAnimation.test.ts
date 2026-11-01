import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeNormalizedPoint,
  normalizedPointConstrained,
  ZoomBezierCurveLinear,
  ZoomBezierCurveQuadratic,
  ZoomBezierCurveCubic,
  ZoomBezierCurveQuintic,
  zoomBezierCurveValue,
  makeZoomAnimationClip,
  zoomAnimationClipDuration,
  zoomAnimationClipEffectEndTime,
} from '../../src/core/ZoomAnimation.ts';

test('NormalizedPoint.constrained(0.12) clamps (0,1) to (0.12, 0.88)', () => {
  const p = makeNormalizedPoint(0, 1);
  const constrained = normalizedPointConstrained(p, 0.12);
  assert.ok(Math.abs(constrained.x - 0.12) < 1e-9);
  assert.ok(Math.abs(constrained.y - 0.88) < 1e-9);

  // safeInset > 0.5 clamps to 0.5
  const center = normalizedPointConstrained(makeNormalizedPoint(0.1, 0.9), 0.7);
  assert.equal(center.x, 0.5);
  assert.equal(center.y, 0.5);
});

test('ZoomBezierCurve exact values and monotonicity across presets per Swift L128-200', () => {
  // linear at 0.3 should equal 0.3
  const linVal = zoomBezierCurveValue(ZoomBezierCurveLinear, 0.3);
  assert.ok(Math.abs(linVal - 0.3) < 1e-4);

  const presets = [
    ZoomBezierCurveLinear,
    ZoomBezierCurveQuadratic,
    ZoomBezierCurveCubic,
    ZoomBezierCurveQuintic,
  ];

  for (const curve of presets) {
    // Endpoints exact
    assert.equal(zoomBezierCurveValue(curve, 0), 0);
    assert.equal(zoomBezierCurveValue(curve, 1), 1);

    // Monotonicity check across 101 samples
    let prev = -1e-9;
    for (let step = 0; step <= 100; step++) {
      const t = step / 100;
      const val = zoomBezierCurveValue(curve, t);
      assert.ok(val >= prev, `Curve not monotonic at t=${t}: ${val} < ${prev}`);
      assert.ok(val >= 0 && val <= 1);
      prev = val;
    }
  }
});

test('ZoomAnimationClip constructor clamps per Swift L238-254', () => {
  const clip = makeZoomAnimationClip({
    startTime: 5.0,
    endTime: 3.0, // Invalid: endTime < startTime
    scale: 0.5, // Invalid: scale < 1
    enterDuration: 9.0, // Invalid: enterDuration > 5
    exitDuration: -2.0, // Invalid: exitDuration < 0
  });

  // endTime must equal startTime
  assert.equal(clip.startTime, 5.0);
  assert.equal(clip.endTime, 5.0);

  // scale must be at least 1
  assert.equal(clip.scale, 1.0);

  // durations clamped to [0, 5]
  assert.equal(clip.enterDuration, 5.0);
  assert.equal(clip.exitDuration, 0.0);

  // computed properties
  assert.equal(zoomAnimationClipDuration(clip), 0.0);
  assert.equal(zoomAnimationClipEffectEndTime(clip), 5.0);
});
