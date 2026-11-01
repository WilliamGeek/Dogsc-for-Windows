import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CameraContentFill,
  CAMERA_CONTENT_FILL_EDGE_OVERSCAN_SCALE,
} from '../../src/core/CameraContentFill.ts';
import {
  CameraMotionTrack,
  makeCameraMotionState,
  makeCameraMotionClip,
  CameraLayoutModeFullscreen,
} from '../../src/core/CameraMotion.ts';
import { makeCompositionRect, makeCompositionPoint } from '../../src/core/CompositionScene.ts';
import { ZoomBezierCurveCubic } from '../../src/core/ZoomAnimation.ts';
import type { TransitionTiming } from '../../src/core/FocusEffect.ts';

test('T5.4: CameraContentFill.layout aspect fill and mirroring per Swift L6-67', () => {
  const target = makeCompositionRect(100, 100, 400, 300);
  // source 1920x1080 -> target 400x300
  // target.w/source.w = 400/1920 = 0.20833
  // target.h/source.h = 300/1080 = 0.27778
  // fill chooses max (0.27778) * 1.01 = 0.280555...
  const layout = CameraContentFill.layout(1920, 1080, target, { x: 0.5, y: 0.5 }, 1.0);
  assert.ok(layout != null);
  const expectedScale = (300 / 1080) * CAMERA_CONTENT_FILL_EDGE_OVERSCAN_SCALE;
  assert.ok(Math.abs(layout.scale - expectedScale) < 1e-6);

  // Mirroring
  const p = makeCompositionPoint(100, 200);
  const normalPt = CameraContentFill.destinationPoint(layout, p, false);
  const mirroredPt = CameraContentFill.destinationPoint(layout, p, true);
  // Y stays same
  assert.equal(normalPt.y, mirroredPt.y);
  // X mirrors around source center
  assert.notEqual(normalPt.x, mirroredPt.x);
});

test('T5.4: CameraMotionTrack.resolve shapes and fullscreen progress', () => {
  const squareState = makeCameraMotionState({
    layout: { kind: 'shape', shape: 'square' },
    roundness: 0.4,
  });
  const resolvedSquare = CameraMotionTrack.resolve(squareState, 1.0, 16 / 9);
  assert.equal(resolvedSquare.aspectRatio, 1.0);
  assert.equal(resolvedSquare.cornerFraction, 0.5 * 0.4);
  assert.equal(resolvedSquare.fullscreenProgress, 0);

  const circleState = makeCameraMotionState({
    layout: { kind: 'shape', shape: 'circle' },
  });
  const resolvedCircle = CameraMotionTrack.resolve(circleState, 1.0, 16 / 9);
  assert.equal(resolvedCircle.aspectRatio, 1.0);
  assert.equal(resolvedCircle.cornerFraction, 0.5);

  const fullState = makeCameraMotionState({
    layout: CameraLayoutModeFullscreen,
  });
  const resolvedFull = CameraMotionTrack.resolve(fullState, 1.0, 16 / 9);
  assert.equal(resolvedFull.aspectRatio, 16 / 9);
  assert.equal(resolvedFull.cornerFraction, 0);
  assert.equal(resolvedFull.fullscreenProgress, 1.0);
});

test('T5.4: CameraMotionTrack sampling with lead-in and hidden target fade', () => {
  const base = makeCameraMotionState({
    position: { x: 0.8, y: 0.8 },
    size: 0.3,
    opacity: 1.0,
  });

  const timing: TransitionTiming = {
    startTime: 1.0,
    duration: 2.0,
    leadInDuration: 0.5,
    leadInProgressOffset: 0,
    easing: '线性',
    customCurve: ZoomBezierCurveCubic,
    returnDuration: 0,
    returnProgressOffset: 0,
  };

  const hiddenTarget = makeCameraMotionState({
    position: { x: 0.2, y: 0.2 },
    size: 0.5,
    opacity: 0.0, // hidden!
  });

  const track = new CameraMotionTrack([makeCameraMotionClip({ timing, target: hiddenTarget })]);

  // Before clip (t=0.5): full opacity at base position
  const before = track.sample(0.5, base);
  assert.equal(before.opacity, 1.0);
  assert.equal(before.position.x, 0.8);

  // Midway through leadIn (t=1.25): opacity fades to 0.5, but position stays at base (no movement jump!)
  const mid = track.sample(1.25, base);
  assert.ok(Math.abs(mid.opacity - 0.5) < 1e-4);
  // Hidden target must fade in-place per Swift L343-348
  assert.equal(mid.position.x, 0.8);
  assert.equal(mid.position.y, 0.8);
});
