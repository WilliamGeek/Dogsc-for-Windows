import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeFocusEffect,
  focusEffectNormalizedAngle,
  focusEffectClearHalfWidth,
  focusEffectFeatherWidth,
  focusEffectIsValid,
  FocusEffectEvaluator,
} from '../../src/core/FocusEffect.ts';
import { makeZoomAnimationClip } from '../../src/core/ZoomAnimation.ts';
import { makeMotionStyle, NormalizedCropFull } from '../../src/core/ProjectModel.ts';
import { ZoomTransitionResolution } from '../../src/core/ZoomTransitionResolution.ts';

test('T3.3: FocusEffect defaults, linear preset, angle normalization and validation', () => {
  // Default radial effect
  const def = makeFocusEffect(false);
  assert.equal(def.shape, null);
  assert.equal(def.target, 'animation');
  assert.equal(def.size, 0.45);
  assert.equal(def.blur, 0.35);
  assert.equal(def.softness, 0.5);
  assert.equal(def.dimming, 0.18);
  assert.ok(focusEffectIsValid(def));

  // Linear preset
  const linear = makeFocusEffect(true);
  assert.equal(linear.shape, 'linear');
  assert.equal(linear.angleDegrees, 0);
  assert.equal(linear.target, 'fixed');
  assert.equal(linear.size, 0.32);
  assert.equal(linear.dimming, 0);
  assert.ok(focusEffectIsValid(linear));

  // Normalized angle wrapping per Swift L31-34
  assert.equal(focusEffectNormalizedAngle(0), 0);
  assert.equal(focusEffectNormalizedAngle(360), 0);
  assert.equal(focusEffectNormalizedAngle(450), 90);
  assert.equal(focusEffectNormalizedAngle(-90), 270);
  assert.equal(focusEffectNormalizedAngle(-450), 270);

  // Width calculations per Swift L36-37
  // clearHalfWidth = 1080 * 0.45 / 2 = 243
  assert.equal(focusEffectClearHalfWidth(def, 1080), 243);
  // featherWidth = max(1080 * 0.5 * 0.4, 1) = max(216, 1) = 216
  assert.equal(focusEffectFeatherWidth(def, 1080), 216);

  // Validation tests
  assert.ok(focusEffectIsValid(def));
  // size out of range (0.1...1)
  assert.ok(!focusEffectIsValid({ ...def, size: 0.05 }));
  assert.ok(!focusEffectIsValid({ ...def, size: 1.5 }));
  // blur out of range (0...1)
  assert.ok(!focusEffectIsValid({ ...def, blur: -0.1 }));
  // invalid center
  assert.ok(!focusEffectIsValid({ ...def, center: { x: 1.5, y: 0.5 } }));
  // angle out of range (0...360)
  assert.ok(!focusEffectIsValid({ ...def, angleDegrees: 400 }));
});

test('T3.3: FocusEffectEvaluator.scene evaluation with ZoomAnimationClip', () => {
  const effect = makeFocusEffect(false, {
    target: 'animation',
    blur: 0.4,
    dimming: 0.2,
  });

  const clip = makeZoomAnimationClip({
    id: 'zoom-1',
    startTime: 1.0,
    endTime: 3.0,
    enterDuration: 0.5,
    exitDuration: 0.5,
    focus: { x: 0.3, y: 0.4 },
    focusEffect: effect,
  });

  const motion = makeMotionStyle();

  // Before startTime (t=0.5): should return null
  const before = FocusEffectEvaluator.scene(
    clip,
    null,
    { x: 0.3, y: 0.4 },
    NormalizedCropFull,
    null,
    0.5,
    motion,
  );
  assert.equal(before, null);

  // During hold (t=2.0): progress should be 1.0 exactly
  const hold = FocusEffectEvaluator.scene(
    clip,
    null,
    { x: 0.3, y: 0.4 },
    NormalizedCropFull,
    null,
    2.0,
    motion,
  );
  assert.ok(hold != null);
  assert.equal(hold.progress, 1.0);
  assert.equal(hold.center.x, 0.3);
  assert.equal(hold.center.y, 0.4);

  // Pointer target test
  const pointerEffect = makeFocusEffect(false, {
    target: 'pointer',
    blur: 0.3,
  });
  const pointerClip = makeZoomAnimationClip({
    ...clip,
    focusEffect: pointerEffect,
  });
  const pointerScene = FocusEffectEvaluator.scene(
    pointerClip,
    null,
    { x: 0.3, y: 0.4 },
    NormalizedCropFull,
    { x: 0.7, y: 0.8 },
    2.0,
    motion,
  );
  assert.ok(pointerScene != null);
  assert.equal(pointerScene.center.x, 0.7);
  assert.equal(pointerScene.center.y, 0.8);
});

test('T3.3: ZoomTransitionResolution.resolve trims tail and chains adjacent clips', () => {
  const clip1 = makeZoomAnimationClip({
    id: 'c1',
    startTime: 1.0,
    endTime: 2.0,
    enterDuration: 0.5,
    exitDuration: 0.5,
  });
  const clip2 = makeZoomAnimationClip({
    id: 'c2',
    startTime: 2.0, // Touching clip1
    endTime: 4.0,
    enterDuration: 0.5,
    exitDuration: 0.5,
  });

  // Touching clips: clip1 exitDuration becomes 0 (no return dip between touching clips)
  const resolved = ZoomTransitionResolution.resolve([clip1, clip2], 10.0);
  assert.equal(resolved.length, 2);
  assert.equal(resolved[0].exitDuration, 0);

  // Tail trim: clip2 requested to end at 4.0, but outputDuration is 3.5
  const trimmed = ZoomTransitionResolution.resolve([clip1, clip2], 3.5);
  assert.equal(trimmed.length, 2);
  assert.ok(trimmed[1].endTime <= 3.5);

  // Invalid duration returns empty
  assert.deepEqual(ZoomTransitionResolution.resolve([clip1], 0), []);
  assert.deepEqual(ZoomTransitionResolution.resolve([clip1], -5), []);
});
