import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeScreenMotionState,
  makeScreenMotionClip,
  makeScreenAnchorViewport,
  ScreenMotionTrack,
} from '../../src/core/ScreenMotion.ts';
import {
  ScreenMotionCreationStyle,
  makeScreenMotionCreationStyleFromClip,
  screenMotionCreationStyleIsValid,
  screenMotionCreationStyleCreateClip,
} from '../../src/core/ScreenMotionCreationStyle.ts';
import { ZoomBezierCurveCubic } from '../../src/core/ZoomAnimation.ts';
import type { TransitionTiming } from '../../src/core/FocusEffect.ts';

test('T5.3: ScreenMotionState defaults and ScreenMotionTrack interpolation', () => {
  const base = makeScreenMotionState({
    position: { x: 0.5, y: 0.5 },
    scale: 1.0,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
  });

  const timing: TransitionTiming = {
    startTime: 1.0,
    duration: 2.0, // ends at t=3.0
    leadInDuration: 0.5,
    leadInProgressOffset: 0,
    easing: '线性',
    customCurve: ZoomBezierCurveCubic,
    returnDuration: 0.5, // returns to base until t=3.5
    returnProgressOffset: 0,
  };

  const target = makeScreenMotionState({
    position: { x: 0.8, y: 0.2 },
    scale: 2.0,
    rotationX: 10,
    rotationY: -20,
    rotationZ: 15,
  });

  const clip = makeScreenMotionClip({ timing, target });
  const track = new ScreenMotionTrack([clip]);

  // Before clip (t=0.5): returns base
  const before = track.sample(0.5, base);
  assert.equal(before.scale, 1.0);
  assert.equal(before.position.x, 0.5);

  // Halfway through lead-in (t=1.25, progress = 0.5 with linear easing)
  const midway = track.sample(1.25, base);
  assert.ok(Math.abs(midway.scale - 1.5) < 1e-4);
  assert.ok(Math.abs(midway.position.x - 0.65) < 1e-4);
  assert.ok(Math.abs(midway.rotationX - 5.0) < 1e-4);
  assert.ok(Math.abs(midway.rotationY - (-10.0)) < 1e-4);

  // During hold (t=2.0): holds target
  const hold = track.sample(2.0, base);
  assert.equal(hold.scale, 2.0);
  assert.equal(hold.position.x, 0.8);
  assert.equal(hold.rotationX, 10);

  // During return (t=3.25, halfway through returnDuration=0.5): returning to base
  const returning = track.sample(3.25, base);
  assert.ok(Math.abs(returning.scale - 1.5) < 1e-4);

  // After return (t=4.0): back at base
  const after = track.sample(4.0, base);
  assert.equal(after.scale, 1.0);
});

test('T5.3: ScreenMotionTrack layout with ScreenAnchorViewport non-singular pixel offsets', () => {
  const viewport = makeScreenAnchorViewport({
    canvasWidth: 1920,
    canvasHeight: 1080,
    fittedWidth: 1600,
    fittedHeight: 900,
    borderWidthAtScaleOne: 4,
    decorationTopAtScaleOne: 30,
  });

  const base = makeScreenMotionState();
  const target = makeScreenMotionState({ scale: 2.0, position: { x: 0.7, y: 0.3 } });
  const timing: TransitionTiming = {
    startTime: 0,
    duration: 1.0,
    leadInDuration: 1.0,
    leadInProgressOffset: 0,
    easing: '线性',
    customCurve: ZoomBezierCurveCubic,
    returnDuration: 0,
    returnProgressOffset: 0,
  };
  const track = new ScreenMotionTrack([makeScreenMotionClip({ timing, target })]);

  const sample = track.sampleLayout(0.5, base, undefined, viewport);
  assert.ok(sample.manualOffset != null);
  assert.ok(Number.isFinite(sample.manualOffset.x));
  assert.ok(Number.isFinite(sample.manualOffset.y));
});

test('T5.3: ScreenMotionCreationStyle round trip and validation', () => {
  const clip = makeScreenMotionClip({
    timing: {
      startTime: 1.0,
      duration: 2.0,
      leadInDuration: 0.6,
      leadInProgressOffset: 0,
      easing: '三次方缓动',
      customCurve: ZoomBezierCurveCubic,
      returnDuration: 0.8,
      returnProgressOffset: 0,
    },
    target: makeScreenMotionState({ scale: 1.8 }),
  });

  const style = makeScreenMotionCreationStyleFromClip(clip);
  assert.ok(screenMotionCreationStyleIsValid(style));
  assert.equal(style.leadInDuration, 0.6);
  assert.equal(style.returnDuration, 0.8);

  const newTiming: TransitionTiming = {
    startTime: 5.0,
    duration: 3.0,
    leadInDuration: 0.2,
    leadInProgressOffset: 0,
    easing: '线性',
    customCurve: ZoomBezierCurveCubic,
    returnDuration: 0.2,
    returnProgressOffset: 0,
  };
  const recreated = screenMotionCreationStyleCreateClip(style, newTiming);
  assert.equal(recreated.timing.leadInDuration, 0.6);
  assert.equal(recreated.timing.returnDuration, 0.2); // clamped to newTiming.returnDuration
});
