// Test for: End-to-End Pipeline Verification (T9.1)
// Pipeline: Pointer events (3 clicks) -> AutoZoomPlanner -> RecorderProject -> FrameSceneEvaluator
// Invariant: Zero NaN / non-finite values at all sample times (t = 0, click times, end of timeline).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CompositionSize,
  makeCompositionSize,
  FrameSceneEvaluator,
  FrameColorContractSDRDesktop,
  type FrameScene,
} from '../../src/core/FrameScene.ts';
import {
  AutoZoomPlanner,
  makeAnimationsFromPointerEvents,
} from '../../src/core/AutoZoomPlanner.ts';
import {
  makePointerEventRecord,
  makeNormalizedPoint,
  ZoomAnimationTrack,
  type PointerEventRecord,
} from '../../src/core/ZoomAnimation.ts';
import { TimelineMap } from '../../src/core/TimelineMap.ts';
import {
  makeSourceSequenceFullRecording,
  makeProjectTimeline,
} from '../../src/core/ProjectTimeline.ts';
import { ProjectPointerTrack } from '../../src/core/ProjectPointerTrack.ts';
import {
  makeRecorderProject,
  type RecorderProject,
} from '../../src/core/ProjectMediaModel.ts';
import {
  makeCanvasStyle,
  makeCursorStyle,
  makeMotionStyle,
  makeCameraStyle,
  makeOpeningSequence,
  makeNormalizedCrop,
} from '../../src/core/ProjectModel.ts';
import {
  makeCursorAssetMetrics,
  type CursorAssetMetrics,
} from '../../src/core/CursorRenderGeometry.ts';
import { HexColorWhite } from '../../src/core/HexColor.ts';
import { ProjectValidator } from '../../src/core/ProjectValidator.ts';

/**
 * Recursively inspects every property of an object or array to ensure
 * no NaN or non-finite numbers exist anywhere in the structure.
 */
function assertNoNaN(obj: unknown, path: string = 'root'): void {
  if (typeof obj === 'number') {
    assert.ok(
      !Number.isNaN(obj),
      `NaN detected at ${path}`
    );
    assert.ok(
      Number.isFinite(obj),
      `Non-finite number (${obj}) detected at ${path}`
    );
  } else if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      assertNoNaN(obj[i], `${path}[${i}]`);
    }
  } else if (obj !== null && typeof obj === 'object') {
    for (const [key, val] of Object.entries(obj)) {
      assertNoNaN(val, `${path}.${key}`);
    }
  }
}

test('T9.1: End-to-end recording pipeline (3 clicks -> AutoZoomPlanner -> Project -> FrameSceneEvaluator) produces no NaNs at key sample points', () => {
  // Step 1: Construct realistic pointer event sequence spanning 10 seconds with 3 distinct clicks.
  // Click 1 at t=1.0, (0.25, 0.35)
  // Click 2 at t=4.0, (0.75, 0.65)
  // Click 3 at t=7.0, (0.50, 0.50)
  const events: PointerEventRecord[] = [
    // Pre-roll / initial move
    makePointerEventRecord({ time: 0.0, location: makeNormalizedPoint(0.20, 0.30), kind: 'move' }),
    makePointerEventRecord({ time: 0.4, location: makeNormalizedPoint(0.22, 0.32), kind: 'move' }),
    makePointerEventRecord({ time: 0.8, location: makeNormalizedPoint(0.24, 0.34), kind: 'move' }),
    // Click 1
    makePointerEventRecord({ time: 1.0, location: makeNormalizedPoint(0.25, 0.35), kind: 'leftClick' }),
    makePointerEventRecord({ time: 1.2, location: makeNormalizedPoint(0.26, 0.36), kind: 'move' }),
    makePointerEventRecord({ time: 1.6, location: makeNormalizedPoint(0.30, 0.40), kind: 'move' }),

    // Transit to click 2
    makePointerEventRecord({ time: 3.2, location: makeNormalizedPoint(0.60, 0.55), kind: 'move' }),
    makePointerEventRecord({ time: 3.7, location: makeNormalizedPoint(0.70, 0.62), kind: 'move' }),
    // Click 2
    makePointerEventRecord({ time: 4.0, location: makeNormalizedPoint(0.75, 0.65), kind: 'leftClick' }),
    makePointerEventRecord({ time: 4.3, location: makeNormalizedPoint(0.73, 0.63), kind: 'move' }),
    makePointerEventRecord({ time: 4.8, location: makeNormalizedPoint(0.68, 0.58), kind: 'move' }),

    // Transit to click 3
    makePointerEventRecord({ time: 6.2, location: makeNormalizedPoint(0.55, 0.52), kind: 'move' }),
    makePointerEventRecord({ time: 6.8, location: makeNormalizedPoint(0.51, 0.51), kind: 'move' }),
    // Click 3
    makePointerEventRecord({ time: 7.0, location: makeNormalizedPoint(0.50, 0.50), kind: 'leftClick' }),
    makePointerEventRecord({ time: 7.4, location: makeNormalizedPoint(0.51, 0.50), kind: 'move' }),

    // End of recording
    makePointerEventRecord({ time: 9.0, location: makeNormalizedPoint(0.52, 0.48), kind: 'move' }),
    makePointerEventRecord({ time: 10.0, location: makeNormalizedPoint(0.52, 0.48), kind: 'move' }),
  ];

  // Step 2: AutoZoomPlanner generates zoom clips from pointer clicks.
  const zoomClips = AutoZoomPlanner.makeAnimationsFromPointerEvents(events, {
    zoomScale: 1.8,
    transitionDuration: 0.7,
  });

  // Verify that 3 distinct zoom clips are generated for the 3 widely-spaced clicks
  assert.equal(zoomClips.length, 3);
  assert.equal(zoomClips[0].origin, 'automatic');
  assert.equal(zoomClips[1].origin, 'automatic');
  assert.equal(zoomClips[2].origin, 'automatic');

  // Verify pre-roll start timing (startTime = clickTime - 0.7 * 0.18 = clickTime - 0.126)
  assert.ok(Math.abs(zoomClips[0].startTime - 0.874) < 1e-6);
  assert.ok(Math.abs(zoomClips[1].startTime - 3.874) < 1e-6);
  assert.ok(Math.abs(zoomClips[2].startTime - 6.874) < 1e-6);

  // Step 3: Construct project timeline and pointer track
  const duration = 10.0;
  const timelineMap = new TimelineMap(makeSourceSequenceFullRecording(), duration);
  const pointerTrack = new ProjectPointerTrack(timelineMap, events);
  const timeline = makeProjectTimeline({ zoomClips });

  const defaultCursorMetrics = makeCursorAssetMetrics({
    hotspot: { x: 0, y: 0 },
    intrinsicSize: { width: 32, height: 32 },
    clickColor: HexColorWhite,
  });

  // Step 4: Construct complete RecorderProject
  const canvasSize = makeCompositionSize(1920, 1080);
  const project: RecorderProject = makeRecorderProject({
    title: 'Pipeline Integration Test Recording',
    canvas: makeCanvasStyle({
      crop: makeNormalizedCrop(0, 0, 1, 1),
      aspectRatio: '16:9',
      padding: 0.04,
      cornerRadius: 16,
      shadowStrength: 0.35,
      borderWidth: 1.5,
    }),
    camera: makeCameraStyle({
      position: { x: 0.88, y: 0.85 },
      size: 0.22,
      roundness: 0.5,
      scaleDuringZoom: 1.0,
      borderWidth: 2.0,
      shadowStrength: 0.4,
      isHidden: false,
    }),
    cursorStyle: makeCursorStyle({
      assetID: 'appleBlack',
      size: 1.25,
      clickEffectStyle: 'ripple',
      clickOpacity: 0.8,
      clickScale: 1.2,
      hideWhenIdle: true,
      idleDelay: 1.5,
    }),
    motion: makeMotionStyle({
      screenSpringMass: 2.4,
      screenSpringStiffness: 210,
      screenSpringDamping: 42,
      cursorSpringMass: 2.8,
      cursorSpringStiffness: 450,
      cursorSpringDamping: 66,
      defaultZoomScale: 1.8,
    }),
    openingSequence: makeOpeningSequence({
      isEnabled: true,
      duration: 1.0,
      includedElements: ['屏幕', '摄像头'],
    }),
    zoomAnimations: zoomClips,
    timeline,
  });

  // Ensure whole project passes strict validator
  assert.doesNotThrow(() => ProjectValidator.validate(project));

  // Step 5: Evaluate scene at sample points:
  // t=0.0 (initial opening state)
  // t=0.874 (zoom 1 transition starts)
  // t=1.0 (click 1 moment)
  // t=2.5 (relaxed state after zoom 1)
  // t=4.0 (click 2 moment)
  // t=5.5 (relaxed state after zoom 2)
  // t=7.0 (click 3 moment)
  // t=10.0 (end of timeline)
  const sampleTimes = [0.0, 0.874, 1.0, 2.5, 4.0, 5.5, 7.0, 10.0];

  for (const t of sampleTimes) {
    const scene: FrameScene = FrameSceneEvaluator.scene(
      project,
      t,
      duration,
      canvasSize,
      16 / 9,
      null, // cameraSourceSize
      pointerTrack,
      null, // pointerEvaluation
      defaultCursorMetrics
    );

    // Assert zero NaN or non-finite values in entire recursive structure
    assertNoNaN(scene, `scene(t=${t})`);

    // Invariant assertions
    assert.equal(scene.time, t);
    assert.equal(scene.canvasSize.width, 1920);
    assert.equal(scene.canvasSize.height, 1080);
    assert.ok(scene.screen.fittedRect.width > 0, `Screen width > 0 at t=${t}`);
    assert.ok(scene.screen.fittedRect.height > 0, `Screen height > 0 at t=${t}`);
    assert.ok(scene.screen.finalRect.width > 0, `Final screen rect width > 0 at t=${t}`);
    assert.ok(scene.screen.finalRect.height > 0, `Final screen rect height > 0 at t=${t}`);
    assert.ok(scene.layerOrder.length >= 2, `Layer order has layers at t=${t}`);
    assert.ok(scene.layerOrder.includes('screen'), `Layer order includes screen at t=${t}`);
    assert.ok(scene.layerOrder.includes('background'), `Layer order includes background at t=${t}`);

    // Quad coordinates must all be valid and finite
    const quad = scene.screen.projectedQuad;
    assert.ok(Number.isFinite(quad.topLeft.x));
    assert.ok(Number.isFinite(quad.topLeft.y));
    assert.ok(Number.isFinite(quad.bottomRight.x));
    assert.ok(Number.isFinite(quad.bottomRight.y));

    // When cursor is active at click moments, cursor scene should be populated
    if (t === 1.0 || t === 4.0 || t === 7.0) {
      assert.ok(scene.cursor !== null, `Cursor should be rendered at click moment t=${t}`);
      assert.ok(scene.cursor!.layout.size.width > 0);
      assert.ok(scene.cursor!.layout.size.height > 0);
    }
  }
});

test('T9.1: FrameRenderPlan and refreshingCursor subframe evaluation pipeline produces no NaNs', () => {
  const events: PointerEventRecord[] = [
    makePointerEventRecord({ time: 0.0, location: makeNormalizedPoint(0.5, 0.5), kind: 'move' }),
    makePointerEventRecord({ time: 1.0, location: makeNormalizedPoint(0.5, 0.5), kind: 'leftClick' }),
    makePointerEventRecord({ time: 2.0, location: makeNormalizedPoint(0.5, 0.5), kind: 'move' }),
  ];

  const zoomClips = AutoZoomPlanner.makeAnimationsFromPointerEvents(events);
  const timelineMap = new TimelineMap(makeSourceSequenceFullRecording(), 5.0);
  const pointerTrack = new ProjectPointerTrack(timelineMap, events);
  const timeline = makeProjectTimeline({ zoomClips });

  const defaultCursorMetrics = makeCursorAssetMetrics({
    hotspot: { x: 0, y: 0 },
    intrinsicSize: { width: 32, height: 32 },
    clickColor: HexColorWhite,
  });

  const project = makeRecorderProject({
    timeline,
    zoomAnimations: zoomClips,
  });

  const canvasSize = makeCompositionSize(1920, 1080);
  const plan = FrameSceneEvaluator.renderPlan(
    project,
    1.0,
    5.0,
    60,
    canvasSize,
    16 / 9,
    null,
    pointerTrack,
    defaultCursorMetrics
  );

  assertNoNaN(plan, 'renderPlan');
  assert.equal(plan.presentationTime, 1.0);
  assert.equal(plan.outputDuration, 5.0);
  assert.equal(plan.frameRate, 60);

  // Refresh cursor at 1.016s (1/60s later)
  const refreshed = FrameSceneEvaluator.refreshingCursor(
    plan,
    1.016,
    project,
    pointerTrack,
    defaultCursorMetrics
  );

  assertNoNaN(refreshed, 'refreshedPlan');
  assert.equal(refreshed.presentationTime, 1.016);
  assert.deepEqual(refreshed.scene.screen, plan.scene.screen);
  assert.deepEqual(refreshed.scene.background, plan.scene.background);
});

test('T9.1: Out-of-bounds, empty clips and edge cases produce zero NaNs', () => {
  const project = makeRecorderProject();
  const canvasSize = makeCompositionSize(1920, 1080);

  // t < 0 and t > duration
  const times = [-5.0, 0.0, 100.0];
  for (const t of times) {
    const scene = FrameSceneEvaluator.scene(
      project,
      t,
      10.0,
      canvasSize,
      16 / 9
    );
    assertNoNaN(scene, `edgeScene(t=${t})`);
    assert.ok(scene.time >= 0, 'Negative time is clamped to >= 0');
  }
});
