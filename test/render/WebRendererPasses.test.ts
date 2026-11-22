// Tests for: F:\dogsc-win\web\passes\{glUtils,background,screen,cursor}.ts and F:\dogsc-win\web\renderer.ts

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LAYER_ORDER,
  resolveLayerRenderOrder,
  dispatchSceneLayers,
  buildAxisAlignedRectVertices,
  buildExpandedAxisAlignedShadowVertices,
} from '../../web/passes/glUtils.ts';
import {
  resolveBackgroundShaderParams as passResolveBg,
} from '../../web/passes/background.ts';
import {
  buildProjectedQuadVertices as passBuildProjectedQuadVertices,
  computeScreenShaderUniforms as passComputeScreenUniforms,
  buildShadowQuadVertices as passBuildShadowVertices,
  computeEffectiveScreenOpacity,
} from '../../web/passes/screen.ts';
import {
  buildCursorArrowTriangles as passBuildCursorTriangles,
  computeCursorClickEffectPass as passComputeClickEffectPass,
} from '../../web/passes/cursor.ts';
import {
  computeCameraShaderUniforms,
  sampleCameraUV,
  buildCameraQuadVertices,
  buildCameraShadowVertices,
} from '../../web/passes/camera.ts';
import {
  MAX_BLUR_MOSAICS,
  MAX_SPOTLIGHT_REGIONS,
  computeBlurMosaicUniforms,
  computeSpotlightPassUniforms,
  evaluateSpotlightOutsideMask,
} from '../../web/passes/spotlight.ts';
import {
  computeStickerRenderPlan,
  buildRotatedQuadVertices,
} from '../../web/passes/stickers.ts';
import {
  computeChromePassGeometry,
} from '../../web/passes/chrome.ts';
import {
  computeFocusPassUniforms,
  evaluateFocusOutsideFactor,
} from '../../web/passes/focus.ts';
import { buildProjectedQuadVertices } from '../../web/passes/screen.ts';
import * as rendererExports from '../../web/renderer.ts';
import {
  makeCompositionRect,
  makeCompositionPoint,
  CompositionSceneEvaluator,
} from '../../src/core/CompositionScene.ts';
import {
  FrameSceneEvaluator,
  makeCompositionSize,
  makeFrameScreenScene,
  makeFrameCameraScene,
  makeFrameMosaicScene,
  makeFrameStickerScene,
  makeFrameShadow,
} from '../../src/core/FrameScene.ts';
import { CameraContentFill } from '../../src/core/CameraContentFill.ts';
import { makeCameraBeautySettings } from '../../src/core/CameraBeauty.ts';
import {
  makeNormalizedCrop,
  makeCanvasStyle,
  makeCameraStyle,
  makeMotionStyle,
  makeCursorStyle,
  makeOpeningSequence,
  type OpeningSequencePreset,
  type ScreenFrameStyle,
} from '../../src/core/ProjectModel.ts';
import { makeHexColor } from '../../src/core/HexColor.ts';
import { ScreenProjection } from '../../src/core/ScreenProjection.ts';
import { makeFocusEffect, FocusEffectEvaluator } from '../../src/core/FocusEffect.ts';
import { makeProjectTimeline } from '../../src/core/ProjectTimeline.ts';
import { makeRecorderProject } from '../../src/core/ProjectMediaModel.ts';
import { makeZoomAnimationClip, makeNormalizedPoint } from '../../src/core/ZoomAnimation.ts';
import {
  makeFrameStickerBackdropScene,
  StickerTransitionTrack,
} from '../../src/core/StickerTransition.ts';
import {
  makeStickerClip,
  makeOverlayTiming,
} from '../../src/core/OverlayTimeline.ts';

test('T14.1: resolveLayerRenderOrder preserves deduplicated order and falls back when empty', () => {
  assert.deepEqual(
    resolveLayerRenderOrder({ layerOrder: ['background', 'camera', 'screen', 'camera', 'cursor'] }),
    ['background', 'camera', 'screen', 'cursor']
  );
  assert.deepEqual(resolveLayerRenderOrder({ layerOrder: [] }), [...DEFAULT_LAYER_ORDER]);
});

test('T14.1: dispatchSceneLayers executes registered handlers strictly in scene.layerOrder', () => {
  const calls: string[] = [];
  const executed = dispatchSceneLayers(
    { layerOrder: ['background', 'camera', 'screen', 'spotlight', 'cursor'] },
    {
      cursor: () => calls.push('cursor'),
      screen: () => calls.push('screen'),
      background: () => calls.push('background'),
    }
  );

  assert.deepEqual(calls, ['background', 'screen', 'cursor']);
  assert.deepEqual(executed, ['background', 'screen', 'cursor']);
});

test('T14.1: computeEffectiveScreenOpacity applies sticker screenSuppression', () => {
  const rect = makeCompositionRect(0, 0, 1920, 1080);
  const quad = ScreenProjection.project(rect, 0, 0, 0, 1);
  const screen = makeFrameScreenScene({
    sourceCrop: makeNormalizedCrop(),
    baseRect: rect,
    finalRect: rect,
    projectedQuad: quad,
    cornerRadius: 0,
    borderWidth: 0,
    borderColor: makeHexColor(0xffffff),
    borderOpacity: 0,
    shadow: null,
    opacity: 0.8,
  });

  assert.equal(computeEffectiveScreenOpacity(screen, null), 0.8);
  assert.ok(
    Math.abs(
      computeEffectiveScreenOpacity(
        screen,
        makeFrameStickerBackdropScene({ screenSuppression: 0.5 })
      ) - 0.4
    ) < 1e-9
  );
  assert.equal(
    computeEffectiveScreenOpacity(
      screen,
      makeFrameStickerBackdropScene({ screenSuppression: 1.0 })
    ),
    0
  );
});

test('T14.1: buildAxisAlignedRectVertices and buildExpandedAxisAlignedShadowVertices produce valid quads', () => {
  const rect = makeCompositionRect(480, 270, 960, 540);
  const verts = buildAxisAlignedRectVertices(rect, 1920, 1080);
  assert.equal(verts.length, 24);
  // Top-left vertex at (480, 270) -> ndc (-0.5, +0.5), uv (0, 0)
  assert.ok(Math.abs(verts[0] - -0.5) < 1e-6);
  assert.ok(Math.abs(verts[1] - 0.5) < 1e-6);
  assert.equal(verts[2], 0);
  assert.equal(verts[3], 0);
  // Bottom-right vertex at idx 2 -> ndc (0.5, -0.5), uv (1, 1)
  assert.ok(Math.abs(verts[8] - 0.5) < 1e-6);
  assert.ok(Math.abs(verts[9] - -0.5) < 1e-6);
  assert.equal(verts[10], 1);
  assert.equal(verts[11], 1);

  assert.equal(
    buildExpandedAxisAlignedShadowVertices(
      rect,
      makeFrameShadow({ opacity: 0, radius: 10, offset: makeCompositionPoint(0, 8) }),
      1920,
      1080
    ),
    null
  );

  const shadowVerts = buildExpandedAxisAlignedShadowVertices(
    rect,
    makeFrameShadow({ opacity: 0.35, radius: 16, offset: makeCompositionPoint(0, 10) }),
    1920,
    1080
  );
  assert.ok(shadowVerts !== null);
  assert.equal(shadowVerts.length, 24);
  assert.ok(shadowVerts[0] < verts[0]);
  assert.ok(shadowVerts[1] > verts[1]);
  assert.ok(shadowVerts[2] < 0);
  assert.ok(shadowVerts[3] < 0);
  assert.ok(shadowVerts[10] > 1);
  assert.ok(shadowVerts[11] > 1);
});

test('T14.1: web/renderer.ts preserves exact re-exports from modular passes', () => {
  assert.equal(rendererExports.resolveBackgroundShaderParams, passResolveBg);
  assert.equal(rendererExports.buildProjectedQuadVertices, passBuildProjectedQuadVertices);
  assert.equal(rendererExports.computeScreenShaderUniforms, passComputeScreenUniforms);
  assert.equal(rendererExports.buildShadowQuadVertices, passBuildShadowVertices);
  assert.equal(rendererExports.computeCursorClickEffectPass, passComputeClickEffectPass);
  assert.equal(rendererExports.buildCursorArrowTriangles, passBuildCursorTriangles);
  assert.equal(rendererExports.resolveLayerRenderOrder, resolveLayerRenderOrder);
  assert.equal(rendererExports.dispatchSceneLayers, dispatchSceneLayers);
  assert.equal(rendererExports.computeCameraShaderUniforms, computeCameraShaderUniforms);
  assert.equal(rendererExports.sampleCameraUV, sampleCameraUV);
  assert.equal(rendererExports.buildCameraQuadVertices, buildCameraQuadVertices);
  assert.equal(rendererExports.buildCameraShadowVertices, buildCameraShadowVertices);
  assert.equal(rendererExports.computeBlurMosaicUniforms, computeBlurMosaicUniforms);
  assert.equal(rendererExports.computeSpotlightPassUniforms, computeSpotlightPassUniforms);
  assert.equal(rendererExports.evaluateSpotlightOutsideMask, evaluateSpotlightOutsideMask);
  assert.equal(rendererExports.computeStickerRenderPlan, computeStickerRenderPlan);
  assert.equal(rendererExports.buildRotatedQuadVertices, buildRotatedQuadVertices);
  assert.equal(rendererExports.computeChromePassGeometry, computeChromePassGeometry);
  assert.equal(rendererExports.computeFocusPassUniforms, computeFocusPassUniforms);
  assert.equal(rendererExports.evaluateFocusOutsideFactor, evaluateFocusOutsideFactor);
});

test('T14.2: computeCameraShaderUniforms enforces circle mask clamping, AspectFill uvRect, beauty, and suppression', () => {
  const rect = makeCompositionRect(1400, 720, 240, 240);
  const fill = CameraContentFill.layout(1920, 1080, rect, { x: 0.5, y: 0.5 }, 1.0)!;
  assert.ok(fill !== null);

  const camera = makeFrameCameraScene({
    rect,
    contentFill: fill,
    cornerRadius: 999, // clamped to shortEdge / 2 = 120
    borderWidth: 6,
    borderColor: makeHexColor(0x38bdf8),
    shadow: makeFrameShadow({
      color: makeHexColor(0x000000),
      opacity: 0.4,
      radius: 18,
      offset: makeCompositionPoint(0, 10),
    }),
    opacity: 0.8,
    isMirrored: true,
    beauty: makeCameraBeautySettings({ smoothing: 0.65, whitening: 0.4 }),
  });

  const u = computeCameraShaderUniforms(camera, null);
  assert.ok(u !== null);
  assert.equal(u.cornerRadius, 120);
  assert.equal(u.borderWidth, 6);
  assert.equal(u.isMirrored, true);
  assert.ok(Math.abs(u.opacity - 0.8) < 1e-9);
  assert.ok(Math.abs(u.beautySmoothing - 0.65) < 1e-9);
  assert.ok(Math.abs(u.beautyWhitening - 0.4) < 1e-9);
  // Wide 16:9 camera source into 1:1 target crops horizontal width cleanly inside [0, 1]
  assert.ok(u.uvRect[0] > 0.1 && u.uvRect[2] < 0.7);
  assert.ok(u.uvRect[3] > 0.95);
  assert.ok(u.shadow !== null);
  assert.ok(Math.abs(u.shadow.color[3] - 0.32) < 1e-9);

  // Mirror flips horizontal sample symmetrically inside uvRect
  const leftSample = sampleCameraUV(0, 0.5, u.uvRect, true);
  const rightSample = sampleCameraUV(1, 0.5, u.uvRect, true);
  assert.ok(Math.abs(leftSample[0] - (u.uvRect[0] + u.uvRect[2])) < 1e-9);
  assert.ok(Math.abs(rightSample[0] - u.uvRect[0]) < 1e-9);
  assert.ok(leftSample[0] > rightSample[0]);

  // Half suppression halves opacity; full suppression or zero opacity suppresses render (returns null)
  const half = computeCameraShaderUniforms(
    camera,
    makeFrameStickerBackdropScene({ cameraSuppression: 0.5 })
  );
  assert.ok(half !== null && Math.abs(half.opacity - 0.4) < 1e-9);
  assert.equal(
    computeCameraShaderUniforms(
      camera,
      makeFrameStickerBackdropScene({ cameraSuppression: 1.0 })
    ),
    null
  );
  assert.equal(
    computeCameraShaderUniforms(
      makeFrameCameraScene({
        rect,
        contentFill: fill,
        cornerRadius: 20,
        borderWidth: 0,
        shadow: null,
        opacity: 0,
        isMirrored: false,
      }),
      null
    ),
    null
  );
});

test('T14.2: camera vertices expand shadow, handle zoom dodge scale, and integrate cleanly', () => {
  const style = makeCameraStyle({
    shape: 'circle',
    position: { x: 1, y: 1 },
    size: 0.3,
    scaleDuringZoom: 0.7,
    borderWidth: 4,
  });
  const idleEval = CompositionSceneEvaluator.evaluateCamera(style, 16 / 9, 1.0, 1920, 1080, 1.0);
  const zoomEval = CompositionSceneEvaluator.evaluateCamera(style, 16 / 9, 1.6, 1920, 1080, 1.0);
  assert.ok(zoomEval.rect.height < idleEval.rect.height);

  const zoomCam = makeFrameCameraScene({
    rect: zoomEval.rect,
    contentFill: CameraContentFill.layout(1280, 720, zoomEval.rect),
    cornerRadius: zoomEval.cornerRadius,
    borderWidth: zoomEval.borderWidth,
    shadow: makeFrameShadow({ opacity: 0.3, radius: 14, offset: makeCompositionPoint(0, 6) }),
    opacity: zoomEval.opacity,
    isMirrored: false,
  });

  const quadVerts = buildCameraQuadVertices(zoomCam, 1920, 1080);
  const shadowVerts = buildCameraShadowVertices(zoomCam, 1920, 1080);
  assert.equal(quadVerts.length, 24);
  assert.ok(shadowVerts !== null && shadowVerts.length === 24);
  assert.ok(shadowVerts[0] < quadVerts[0]);
  assert.ok(shadowVerts[1] > quadVerts[1]);
});

test('T14.3: computeBlurMosaicUniforms filters blur mosaics, ignores inactive items, and caps at MAX_BLUR_MOSAICS', () => {
  const rect = makeCompositionRect(0, 0, 1920, 1080);
  const quad = ScreenProjection.project(rect, 0, 0, 0, 1);

  const mosaics = [
    makeFrameMosaicScene({
      sourceRect: { x: 0.1, y: 0.2, width: 0.3, height: 0.2 },
      cornerRadius: 0.1,
      style: 'blur',
      intensity: 0.8,
      transitionProgress: 0.5,
    }),
    makeFrameMosaicScene({
      sourceRect: { x: 0.5, y: 0.5, width: 0.2, height: 0.2 },
      cornerRadius: 0.2,
      style: 'spotlight',
      intensity: 0.9,
      spotlightDimming: 0.4,
      transitionProgress: 1.0,
    }),
    makeFrameMosaicScene({
      sourceRect: { x: 0.2, y: 0.2, width: 0.1, height: 0.1 },
      cornerRadius: 0.1,
      style: 'blur',
      intensity: 0.6,
      transitionProgress: 0, // inactive
    }),
    makeFrameMosaicScene({
      sourceRect: { x: 0.3, y: 0.3, width: 0.1, height: 0.1 },
      cornerRadius: 0.1,
      style: 'blur',
      intensity: 0, // zero intensity
      transitionProgress: 1.0,
    }),
  ];
  for (let i = 0; i < 10; i++) {
    mosaics.push(
      makeFrameMosaicScene({
        sourceRect: { x: 0.05 * (i % 4), y: 0.1, width: 0.2, height: 0.2 },
        cornerRadius: 0.05,
        style: 'blur',
        intensity: 0.5,
        transitionProgress: 1.0,
      })
    );
  }

  const screen = makeFrameScreenScene({
    sourceCrop: makeNormalizedCrop(),
    baseRect: rect,
    finalRect: rect,
    projectedQuad: quad,
    cornerRadius: 0,
    borderWidth: 0,
    borderColor: makeHexColor(0xffffff),
    borderOpacity: 0,
    shadow: null,
    mosaics,
  });

  const batch = computeBlurMosaicUniforms(screen);
  assert.equal(batch.count, MAX_BLUR_MOSAICS);
  assert.equal(batch.rectsFlat.length, MAX_BLUR_MOSAICS * 4);
  assert.equal(batch.paramsFlat.length, MAX_BLUR_MOSAICS * 4);
  assert.ok(Math.abs(batch.rectsFlat[0] - 0.1) < 1e-6);
  assert.ok(Math.abs(batch.paramsFlat[0] - 0.1) < 1e-6);
  assert.ok(Math.abs(batch.paramsFlat[1] - 0.8) < 1e-6);
  assert.ok(Math.abs(batch.paramsFlat[2] - 0.5) < 1e-6);
  assert.ok(Math.abs(batch.paramsFlat[3] - 0.4) < 1e-6);
});

test('T14.3: computeSpotlightPassUniforms and evaluateSpotlightOutsideMask merge multiple cutouts cleanly', () => {
  const rect = makeCompositionRect(160, 90, 1600, 900);
  const quad = ScreenProjection.project(rect, 0, 0, 0, 1);

  const blurOnlyScreen = makeFrameScreenScene({
    sourceCrop: makeNormalizedCrop(),
    baseRect: rect,
    finalRect: rect,
    projectedQuad: quad,
    cornerRadius: 24,
    borderWidth: 0,
    borderColor: makeHexColor(0xffffff),
    borderOpacity: 0,
    shadow: null,
    mosaics: [
      makeFrameMosaicScene({
        sourceRect: { x: 0.2, y: 0.2, width: 0.2, height: 0.2 },
        cornerRadius: 0.1,
        style: 'blur',
        intensity: 0.7,
        transitionProgress: 1,
      }),
    ],
  });
  assert.equal(computeSpotlightPassUniforms(blurOnlyScreen, null), null);

  const spotlightScreen = makeFrameScreenScene({
    sourceCrop: makeNormalizedCrop(),
    baseRect: rect,
    finalRect: rect,
    projectedQuad: quad,
    cornerRadius: 24,
    borderWidth: 0,
    borderColor: makeHexColor(0xffffff),
    borderOpacity: 0,
    shadow: null,
    mosaics: [
      makeFrameMosaicScene({
        sourceRect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        cornerRadius: 0.1,
        style: 'spotlight',
        intensity: 0.5,
        spotlightDimming: 0.3,
        transitionProgress: 0.5, // effective dimming = 0.15
      }),
      makeFrameMosaicScene({
        sourceRect: { x: 0.65, y: 0.6, width: 0.25, height: 0.25 },
        cornerRadius: 0.5, // circle/pill
        style: 'spotlight',
        intensity: 0.5,
        spotlightDimming: 0.5,
        transitionProgress: 1.0, // effective dimming = 0.5 -> wins max
      }),
    ],
  });

  // Sticker suppression hides spotlight completely
  assert.equal(
    computeSpotlightPassUniforms(
      spotlightScreen,
      makeFrameStickerBackdropScene({ screenSuppression: 1.0 })
    ),
    null
  );

  const u = computeSpotlightPassUniforms(spotlightScreen, null);
  assert.ok(u !== null);
  assert.equal(u.count, 2);
  assert.ok(u.count <= MAX_SPOTLIGHT_REGIONS);
  assert.ok(Math.abs(u.dimmingAlpha - 0.5) < 1e-6);

  // Union of two non-overlapping spotlights keeps both centers bright (outsideMask == 0)
  // while pixels outside both regions are dimmed (outsideMask == 1).
  assert.equal(evaluateSpotlightOutsideMask(0.2, 0.2, u.screenSize, u.regions), 0);
  assert.equal(evaluateSpotlightOutsideMask(0.775, 0.725, u.screenSize, u.regions), 0);
  assert.equal(evaluateSpotlightOutsideMask(0.5, 0.5, u.screenSize, u.regions), 1);
  assert.equal(evaluateSpotlightOutsideMask(0.01, 0.01, u.screenSize, u.regions), 1);
});

test('T14.4: computeStickerRenderPlan routes blurStage, sorts layerIndex, and preserves anti-bleed suppression across joined handoff', () => {
  // 1. Blur stage routing
  assert.equal(
    computeStickerRenderPlan(
      { stickers: [], stickerBackdrop: makeFrameStickerBackdropScene({ screenBlur: 0, cameraBlur: 0 }) },
      1920,
      1080
    ).blurStage,
    'none'
  );
  const beforeCam = computeStickerRenderPlan(
    { stickers: [], stickerBackdrop: makeFrameStickerBackdropScene({ screenBlur: 14, cameraBlur: 0 }) },
    1920,
    1080
  );
  assert.equal(beforeCam.blurStage, 'beforeCamera');
  assert.equal(beforeCam.blurRadiusPx, 14);

  const beforeStick = computeStickerRenderPlan(
    { stickers: [], stickerBackdrop: makeFrameStickerBackdropScene({ screenBlur: 10, cameraBlur: 20 }) },
    1920,
    1080
  );
  assert.equal(beforeStick.blurStage, 'beforeStickers');
  assert.equal(beforeStick.blurRadiusPx, 20);

  // 2. Joined StickerTransitionTrack handoff keeps screenSuppression == 1 and blur active at exact boundary
  const clipA = makeStickerClip({
    id: 'st-a',
    timing: makeOverlayTiming(0, 2),
    relativePath: 'a.png',
    hidesScreen: true,
    backdropBlur: 12,
    enterDuration: 0.3,
    exitDuration: 0.3,
    layerIndex: 2,
  });
  const clipB = makeStickerClip({
    id: 'st-b',
    timing: makeOverlayTiming(2, 2),
    relativePath: 'b.png',
    hidesScreen: true,
    backdropBlur: 16,
    enterDuration: 0.3,
    exitDuration: 0.3,
    layerIndex: 1,
  });
  const track = new StickerTransitionTrack([clipA, clipB]);
  const handoff = track.sample(2.0);
  assert.equal(handoff.backdrop.screenSuppression, 1);

  const handoffPlan = computeStickerRenderPlan(
    {
      stickers: [
        makeFrameStickerScene({
          id: 's-top',
          relativePath: 'a.png',
          position: { x: 0.5, y: 0.5 },
          width: 0.4,
          rotationRadians: 0,
          opacity: 0.9,
          scale: 1,
          offset: { x: 0, y: 0 },
          cornerRadius: 12,
          borderWidth: 2,
          borderColor: makeHexColor(0xffffff),
          shadowOpacity: 0.3,
          shadowRadius: 10,
          shadowOffset: makeCompositionPoint(0, 6),
          backdropBlur: 0,
          backdropBlurIncludesCamera: false,
          hidesScreen: false,
          hidesCamera: false,
          transitionProgress: 1,
          layerIndex: 5,
        }),
        makeFrameStickerScene({
          id: 's-hidden',
          relativePath: 'hidden.png',
          position: { x: 0.5, y: 0.5 },
          width: 0.2,
          rotationRadians: 0,
          opacity: 0,
          scale: 1,
          offset: { x: 0, y: 0 },
          cornerRadius: 0,
          borderWidth: 0,
          borderColor: makeHexColor(0xffffff),
          shadowOpacity: 0,
          shadowRadius: 0,
          shadowOffset: makeCompositionPoint(0, 0),
          backdropBlur: 0,
          backdropBlurIncludesCamera: false,
          hidesScreen: false,
          hidesCamera: false,
          transitionProgress: 0,
          layerIndex: 0,
        }),
        makeFrameStickerScene({
          id: 's-back',
          relativePath: 'b.png',
          position: { x: 0.25, y: 0.5 },
          width: 0.25,
          rotationRadians: Math.PI / 2,
          opacity: 1,
          scale: 1,
          offset: { x: 0, y: 0 },
          cornerRadius: 8,
          borderWidth: 0,
          borderColor: makeHexColor(0xffffff),
          shadowOpacity: 0,
          shadowRadius: 0,
          shadowOffset: makeCompositionPoint(0, 0),
          backdropBlur: 0,
          backdropBlurIncludesCamera: false,
          hidesScreen: false,
          hidesCamera: false,
          transitionProgress: 1,
          layerIndex: 1,
        }),
      ],
      stickerBackdrop: handoff.backdrop,
    },
    1920,
    1080
  );
  assert.equal(handoffPlan.items.length, 2);
  assert.equal(handoffPlan.items[0].id, 's-back');
  assert.equal(handoffPlan.items[1].id, 's-top');

  // 3. 90 deg rotation + shadow margin expansion
  const rotVerts = buildRotatedQuadVertices([960, 540], [200, 100], Math.PI / 2, 1920, 1080, 0);
  assert.equal(rotVerts.length, 24);
  // Top-right local (+100, -50) rotated by +90 deg -> (+50, +100) => px (1010, 640) => ndcX = (1010/1920)*2 - 1
  const expectedNdcX = (1010 / 1920) * 2 - 1;
  const expectedNdcY = 1 - (640 / 1080) * 2;
  assert.ok(Math.abs(rotVerts[4] - expectedNdcX) < 1e-5);
  assert.ok(Math.abs(rotVerts[5] - expectedNdcY) < 1e-5);

  const shadowRotVerts = buildRotatedQuadVertices([960, 540], [200, 100], 0, 1920, 1080, 20);
  assert.ok(shadowRotVerts[2] < 0);
  assert.ok(shadowRotVerts[3] < 0);
  assert.ok(shadowRotVerts[10] > 1);
  assert.ok(shadowRotVerts[11] > 1);
});

test('T14.5: computeChromePassGeometry insets content quads across all 6 chrome kinds and preserves perspective w > 0', () => {
  const styles: Array<{ style: ScreenFrameStyle; aspect: number; expectedKind: string; expectedCode: number }> = [
    { style: 'windowLight', aspect: 16 / 9, expectedKind: 'window', expectedCode: 0 },
    { style: 'browserDark', aspect: 16 / 9, expectedKind: 'browser', expectedCode: 1 },
    { style: 'devicePhone', aspect: 9 / 16, expectedKind: 'devicePhonePortrait', expectedCode: 2 },
    { style: 'devicePhone', aspect: 16 / 9, expectedKind: 'devicePhoneLandscape', expectedCode: 3 },
    { style: 'deviceTablet', aspect: 3 / 4, expectedKind: 'deviceTabletPortrait', expectedCode: 4 },
    { style: 'deviceTablet', aspect: 4 / 3, expectedKind: 'deviceTabletLandscape', expectedCode: 5 },
  ];

  for (const { style, aspect, expectedKind, expectedCode } of styles) {
    const proj = makeRecorderProject({
      canvas: makeCanvasStyle({
        screenFrame: style,
        padding: 120,
        screenFrameTitle: 'DogSC Studio',
        screenFrameBrowserAddress: 'https://dogsc.app',
      }),
      camera: makeCameraStyle(),
      motion: makeMotionStyle(),
      cursorStyle: makeCursorStyle(),
      openingSequence: makeOpeningSequence({ isEnabled: false }),
      timeline: makeProjectTimeline(),
      zoomAnimations: [],
    });
    const scene = FrameSceneEvaluator.scene(
      proj,
      0.5,
      5,
      makeCompositionSize(1920, 1080),
      aspect
    );
    assert.equal(scene.screen.decoration.kind, 'chrome');
    if (scene.screen.decoration.kind === 'chrome') {
      assert.equal(scene.screen.decoration.chrome.kind, expectedKind);
    }

    const geo = computeChromePassGeometry(scene.screen, 1920, 1080);
    assert.ok(geo !== null);
    assert.equal(geo.kindCode, expectedCode);
    assert.equal(geo.outerVertices.length, 30);
    assert.equal(geo.contentVertices.length, 30);
    for (let v = 0; v < 6; v++) {
      assert.ok(geo.contentVertices[v * 5 + 2] > 0);
    }
    // Inset content quad must stay within projected outer bounds
    assert.ok(geo.contentQuad.topLeft.x >= scene.screen.projectedQuad.topLeft.x - 1e-4);
    assert.ok(geo.contentQuad.topLeft.y >= scene.screen.projectedQuad.topLeft.y - 1e-4);
    assert.ok(geo.contentQuad.bottomRight.x <= scene.screen.projectedQuad.bottomRight.x + 1e-4);
    assert.ok(geo.contentQuad.bottomRight.y <= scene.screen.projectedQuad.bottomRight.y + 1e-4);
  }
});

test('T14.5: computeFocusPassUniforms and evaluateFocusOutsideFactor evaluate radial & rotated linear bands accurately', () => {
  const rect = makeCompositionRect(160, 90, 1600, 900);
  const quad = ScreenProjection.project(rect, 0, 0, 0, 1);

  const radialFocus = makeFocusEffect(false, {
    shape: 'radial',
    target: 'fixed',
    center: { x: 0.5, y: 0.5 },
    size: 0.3,
    softness: 0.4,
    blur: 0.6,
    dimming: 0.25,
  });
  const screenRadial = makeFrameScreenScene({
    sourceCrop: makeNormalizedCrop(),
    baseRect: rect,
    finalRect: rect,
    projectedQuad: quad,
    cornerRadius: 24,
    borderWidth: 0,
    borderColor: makeHexColor(0xffffff),
    borderOpacity: 0,
    shadow: null,
    focusEffect: { effect: radialFocus, center: { x: 0.5, y: 0.5 }, progress: 1.0 },
  });
  const uRad = computeFocusPassUniforms(screenRadial, null);
  assert.ok(uRad !== null);
  assert.equal(uRad.shapeMode, 0);
  assert.equal(evaluateFocusOutsideFactor(0.5, 0.5, uRad), 0);
  assert.equal(evaluateFocusOutsideFactor(0.02, 0.02, uRad), 1);

  const linearFocus = makeFocusEffect(true, {
    shape: 'linear',
    angleDegrees: 45,
    center: { x: 0.5, y: 0.5 },
    size: 0.2,
    softness: 0.2,
    blur: 0.5,
    dimming: 0.3,
  });
  const zoomWithFocus = makeZoomAnimationClip({
    id: 'z-focus',
    startTime: 0,
    endTime: 2.0,
    enterDuration: 0.2,
    exitDuration: 0.2,
    scale: 1.5,
    focus: makeNormalizedPoint(0.5, 0.5),
    focusEffect: linearFocus,
  });
  const evaluatedFocus = FocusEffectEvaluator.scene(
    zoomWithFocus,
    null,
    { x: 0.5, y: 0.5 },
    makeNormalizedCrop(),
    null,
    1.0,
    makeMotionStyle()
  );
  assert.ok(evaluatedFocus !== null);
  const screenLinear = makeFrameScreenScene({
    sourceCrop: makeNormalizedCrop(),
    baseRect: rect,
    finalRect: rect,
    projectedQuad: quad,
    cornerRadius: 24,
    borderWidth: 0,
    borderColor: makeHexColor(0xffffff),
    borderOpacity: 0,
    shadow: null,
    focusEffect: evaluatedFocus,
  });
  const uLin = computeFocusPassUniforms(screenLinear, null);
  assert.ok(uLin !== null);
  assert.equal(uLin.shapeMode, 1);
  // Center is clear (0); point off the 45 deg diagonal is outside (1)
  assert.equal(evaluateFocusOutsideFactor(0.5, 0.5, uLin), 0);
  assert.equal(evaluateFocusOutsideFactor(0.05, 0.95, uLin), 1);
  // Sticker suppression hides focus overlay cleanly
  assert.equal(
    computeFocusPassUniforms(screenLinear, makeFrameStickerBackdropScene({ screenSuppression: 1 })),
    null
  );
});

test('T14.5: opening sequence 3D presets keep positive perspective weights and zero NaNs across Render Passes', () => {
  const presets: OpeningSequencePreset[] = ['轻 3D', '聚拢', '侧滑'];
  const times = [0.0, 0.25, 0.6, 1.3];

  for (const preset of presets) {
    const project = makeRecorderProject({
      canvas: makeCanvasStyle({ padding: 100, screenFrame: 'windowDark' }),
      camera: makeCameraStyle({ shape: 'circle', position: { x: 0.9, y: 0.85 }, size: 0.22 }),
      motion: makeMotionStyle(),
      cursorStyle: makeCursorStyle(),
      openingSequence: makeOpeningSequence({
        isEnabled: true,
        preset,
        duration: 1.2,
        elements: ['屏幕', '摄像头', '贴图'],
      }),
      timeline: makeProjectTimeline({
        stickerClips: [
          makeStickerClip({
            id: 'open-st',
            timing: makeOverlayTiming(0, 3),
            relativePath: 'badge.png',
            opacity: 1,
          }),
        ],
      }),
      zoomAnimations: [],
    });

    const opacities: number[] = [];
    for (const t of times) {
      const scene = FrameSceneEvaluator.scene(
        project,
        t,
        5,
        makeCompositionSize(1920, 1080),
        16 / 9,
        makeCompositionSize(1280, 720)
      );
      opacities.push(scene.screen.opacity);

      const verts = buildProjectedQuadVertices(
        scene.screen.projectedQuad,
        scene.screen.decoration.kind === 'chrome'
          ? scene.screen.decoration.chrome.outerRect
          : scene.screen.finalRect,
        1920,
        1080
      );
      assert.equal(verts.length, 30);
      for (let i = 0; i < 6; i++) {
        assert.ok(verts[i * 5 + 2] > 0 && Number.isFinite(verts[i * 5 + 2]));
      }
      for (let i = 0; i < verts.length; i++) {
        assert.ok(Number.isFinite(verts[i]));
      }

      if (scene.camera && scene.camera.opacity > 0.001) {
        const camUniforms = computeCameraShaderUniforms(scene.camera, scene.stickerBackdrop);
        assert.ok(camUniforms !== null && Number.isFinite(camUniforms.cornerRadius));
      }

      const stickerPlan = computeStickerRenderPlan(scene, 1920, 1080);
      for (const item of stickerPlan.items) {
        assert.ok(Number.isFinite(item.centerPx[0]) && Number.isFinite(item.sizePx[0]));
      }
    }

    // Opening opacity monotonically reaches settled 1.0 after sequence ends
    assert.ok(opacities[0] <= opacities[2]);
    assert.equal(opacities[3], 1.0);
  }
});
