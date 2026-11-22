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
import * as rendererExports from '../../web/renderer.ts';
import { makeCompositionRect, makeCompositionPoint } from '../../src/core/CompositionScene.ts';
import { makeFrameScreenScene, makeFrameShadow } from '../../src/core/FrameScene.ts';
import { makeNormalizedCrop } from '../../src/core/ProjectModel.ts';
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
});
