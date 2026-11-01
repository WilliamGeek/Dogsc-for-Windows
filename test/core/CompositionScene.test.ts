import test from 'node:test';
import assert from 'node:assert/strict';

import {
  makeCompositionRect,
  compositionRectMidX,
  compositionRectMidY,
  makeCompositionPoint,
  ScreenDecorationInsets,
  makeScreenDecorationInsets,
  ScreenFrameGeometry,
  CompositionSceneEvaluator,
  MotionTrackCacheStore,
  screenSceneEvaluationProjectedQuad,
  type CompositionProjectLike,
} from '../../src/core/CompositionScene.ts';
import {
  makeCanvasStyle,
  makeCameraStyle,
  makeMotionStyle,
  makeNormalizedCrop,
} from '../../src/core/ProjectModel.ts';
import { makeScreenMotionClip, makeScreenMotionState } from '../../src/core/ScreenMotion.ts';
import { makeCameraMotionClip } from '../../src/core/CameraMotion.ts';

test('T5.5: CompositionRect and CompositionPoint basics', () => {
  const r = makeCompositionRect(10, 20, 100, 200);
  assert.equal(r.x, 10);
  assert.equal(r.y, 20);
  assert.equal(r.width, 100);
  assert.equal(r.height, 200);
  assert.equal(compositionRectMidX(r), 60);
  assert.equal(compositionRectMidY(r), 120);

  const p = makeCompositionPoint(5, 15);
  assert.equal(p.x, 5);
  assert.equal(p.y, 15);
});

test('T5.5: ScreenDecorationInsets clamping and ScreenFrameGeometry', () => {
  const insets = makeScreenDecorationInsets(-10, 5, -2, 8);
  assert.equal(insets.top, 0);
  assert.equal(insets.right, 5);
  assert.equal(insets.bottom, 0);
  assert.equal(insets.left, 8);
  assert.deepEqual(ScreenDecorationInsets.zero, { top: 0, right: 0, bottom: 0, left: 0 });

  // ScreenFrameGeometry
  // style: none -> zero
  const noneInsets = ScreenFrameGeometry.decorationInsetsAtScaleOne(
    'none',
    1.0,
    1.0,
    1920,
    1080,
    1.0
  );
  assert.deepEqual(noneInsets, ScreenDecorationInsets.zero);

  // style: windowLight -> top header
  const windowInsets = ScreenFrameGeometry.decorationInsetsAtScaleOne(
    'windowLight',
    1.0,
    1.0,
    1920,
    1080,
    1.0
  );
  // idealHeight = 46 * 1.0 * 1.0 = 46. FittedHeight = 1080, 0.25 * 1080 = 270.
  assert.equal(windowInsets.top, 46);
  assert.equal(windowInsets.left, 0);
  assert.equal(windowInsets.right, 0);
  assert.equal(windowInsets.bottom, 0);

  // style: devicePhone -> bezel on all 4 sides
  const phoneInsets = ScreenFrameGeometry.decorationInsetsAtScaleOne(
    'devicePhone',
    1.0,
    1.0,
    1000,
    1000,
    1.0
  );
  // shortEdge = 1000, bezel = 1000 * 0.026 * 1.0 = 26
  assert.equal(phoneInsets.top, 26);
  assert.equal(phoneInsets.bottom, 26);
  assert.equal(phoneInsets.left, 26);
  assert.equal(phoneInsets.right, 26);

  // style: deviceTablet -> bezel on all 4 sides
  const tabletInsets = ScreenFrameGeometry.decorationInsetsAtScaleOne(
    'deviceTablet',
    1.0,
    1.0,
    1000,
    1000,
    1.0
  );
  // shortEdge = 1000, bezel = 1000 * 0.035 * 1.0 = 35
  assert.equal(tabletInsets.top, 35);
  assert.equal(tabletInsets.bottom, 35);
  assert.equal(tabletInsets.left, 35);
  assert.equal(tabletInsets.right, 35);
});

test('T5.5: CompositionSceneEvaluator canonicalStyleScale and aspectFit', () => {
  assert.equal(CompositionSceneEvaluator.canonicalStyleScale(1920, 1080), 1.0);
  assert.equal(CompositionSceneEvaluator.canonicalStyleScale(3840, 2160), 2.0);
  assert.equal(CompositionSceneEvaluator.canonicalStyleScale(1080, 1920), 1.0);

  const fit1 = CompositionSceneEvaluator.aspectFit(16 / 9, 1920, 1080);
  assert.ok(Math.abs(fit1.width - 1920) < 1e-6);
  assert.ok(Math.abs(fit1.height - 1080) < 1e-6);

  const fitSquare = CompositionSceneEvaluator.aspectFit(1.0, 1920, 1080);
  assert.ok(Math.abs(fitSquare.width - 1080) < 1e-6);
  assert.ok(Math.abs(fitSquare.height - 1080) < 1e-6);
});

test('T5.5: evaluateCamera geometry and fullscreen progress', () => {
  const cameraStyle = makeCameraStyle({
    shape: 'circle',
    size: 0.3,
    borderWidth: 4,
    scaleDuringZoom: 1.5,
  });

  // Basic aspect ratio call
  const evalNormal = CompositionSceneEvaluator.evaluateCamera(
    cameraStyle,
    1.0, // square aspect
    1.0, // screen zoom scale
    1920,
    1080,
    1.0
  );
  assert.ok(Number.isFinite(evalNormal.rect.width));
  assert.ok(Number.isFinite(evalNormal.rect.height));
  assert.equal(evalNormal.zoomScale, 1.0);
  assert.equal(evalNormal.fullscreenProgress, 0);
  assert.ok(evalNormal.borderWidth > 0);

  // Fullscreen camera sample
  const evalFullscreen = CompositionSceneEvaluator.evaluateCamera(
    cameraStyle,
    {
      rect: makeCompositionRect(0, 0, 100, 100),
      position: { x: 0.5, y: 0.5 },
      size: 0.5,
      aspectRatio: 1.0,
      cornerFraction: 0.5,
      opacity: 1.0,
      fullscreenProgress: 1.0,
    },
    1.0,
    1920,
    1080,
    1.0
  );
  assert.equal(evalFullscreen.fullscreenProgress, 1.0);
  assert.equal(evalFullscreen.rect.width, 1920);
  assert.equal(evalFullscreen.rect.height, 1080);
  assert.equal(evalFullscreen.borderWidth, 0); // border completely fades in fullscreen
});

test('T5.5: CompositionSceneEvaluator.evaluate end-to-end', () => {
  const project: CompositionProjectLike = {
    canvas: makeCanvasStyle({
      crop: makeNormalizedCrop(0, 0, 1, 1),
      padding: 0,
      contentPosition: { x: 0.5, y: 0.5 },
      contentScale: 1.0,
      borderWidth: 0,
      screenFrame: 'none',
      cornerRadius: 0,
    }),
    camera: makeCameraStyle(),
    motion: makeMotionStyle(),
    timeline: {
      screenMotionClips: [],
      cameraMotionClips: [],
    },
    zoomAnimations: [],
  };

  const scene = CompositionSceneEvaluator.evaluate(
    project,
    0.0,
    1920,
    1080,
    16 / 9,
    1.0, // cameraAspectRatio
    1.0
  );

  assert.ok(scene.screen);
  assert.ok(scene.camera);
  assert.equal(scene.screen.fittedRect.width, 1920);
  assert.equal(scene.screen.fittedRect.height, 1080);
  assert.equal(scene.screen.baseRect.width, 1920);
  assert.equal(scene.screen.finalRect.width, 1920);

  // Projected quad computed property
  const quad = scene.screen.projectedQuad;
  assert.ok(quad);
  assert.ok(Number.isFinite(quad.topLeft.x));
  assert.ok(Number.isFinite(quad.topRight.x));
  assert.ok(Number.isFinite(quad.bottomLeft.x));
  assert.ok(Number.isFinite(quad.bottomRight.x));

  // screenSceneEvaluationProjectedQuad helper
  const quad2 = screenSceneEvaluationProjectedQuad(scene.screen);
  assert.deepEqual(quad, quad2);
});

test('T5.5: MotionTrackCacheStore caching and eviction', () => {
  const cache = new MotionTrackCacheStore();
  const clipA = makeScreenMotionClip({
    id: 'a',
    timing: { startTime: 0, duration: 1 },
    target: makeScreenMotionState(),
  });
  const clipB = makeScreenMotionClip({
    id: 'b',
    timing: { startTime: 1, duration: 1 },
    target: makeScreenMotionState(),
  });

  const track1 = cache.screenTrack([clipA]);
  const track2 = cache.screenTrack([clipA]);
  assert.equal(track1, track2); // Identical instance from cache

  const track3 = cache.screenTrack([clipB]);
  assert.notEqual(track1, track3);

  // Eviction test (>4 items)
  for (let i = 0; i < 5; i++) {
    cache.screenTrack([
      makeScreenMotionClip({
        id: `item-${i}`,
        timing: { startTime: i * 2, duration: 1 },
        target: makeScreenMotionState(),
      }),
    ]);
  }
  // Original track1 should be evicted now
  const track1Recreated = cache.screenTrack([clipA]);
  assert.notEqual(track1, track1Recreated);
});
