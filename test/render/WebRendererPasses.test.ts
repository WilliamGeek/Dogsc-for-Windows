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
import * as rendererExports from '../../web/renderer.ts';
import {
  makeCompositionRect,
  makeCompositionPoint,
  CompositionSceneEvaluator,
} from '../../src/core/CompositionScene.ts';
import {
  makeFrameScreenScene,
  makeFrameCameraScene,
  makeFrameMosaicScene,
  makeFrameShadow,
} from '../../src/core/FrameScene.ts';
import { CameraContentFill } from '../../src/core/CameraContentFill.ts';
import { makeCameraBeautySettings } from '../../src/core/CameraBeauty.ts';
import { makeNormalizedCrop, makeCameraStyle } from '../../src/core/ProjectModel.ts';
import { makeHexColor } from '../../src/core/HexColor.ts';
import { ScreenProjection } from '../../src/core/ScreenProjection.ts';
import { makeFrameStickerBackdropScene } from '../../src/core/StickerTransition.ts';

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
