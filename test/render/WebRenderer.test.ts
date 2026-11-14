// Test for: F:\dogsc-win\web\renderer.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProjectedQuadVertices,
  computeScreenShaderUniforms,
  buildShadowQuadVertices,
  resolveBackgroundShaderParams,
  buildCursorArrowTriangles,
  computeCursorClickEffectPass,
} from '../../web/renderer.ts';
import { ScreenProjection } from '../../src/core/ScreenProjection.ts';
import { makeCompositionRect, makeCompositionPoint } from '../../src/core/CompositionScene.ts';
import {
  makeFrameScreenScene,
  makeFrameShadow,
  makeFrameBackgroundScene,
  makeFrameCursorScene,
} from '../../src/core/FrameScene.ts';
import {
  makeNormalizedCrop,
  BackgroundPatternPresetAllCases,
  DynamicBackgroundPresetAllCases,
} from '../../src/core/ProjectModel.ts';
import { makeHexColor } from '../../src/core/HexColor.ts';
import { makeCursorAssetMetrics, CursorRenderGeometry } from '../../src/core/CursorRenderGeometry.ts';
import { makeNormalizedPoint } from '../../src/core/ZoomAnimation.ts';
import { makePointerClickPhase } from '../../src/core/PointerTrack.ts';

test('T11.4: buildProjectedQuadVertices produces valid homogeneous vertices for orthographic quad', () => {
  const rect = makeCompositionRect(100, 50, 1720, 980);
  const quad = ScreenProjection.project(rect, 0, 0, 0, 1);
  const verts = buildProjectedQuadVertices(quad, rect, 1920, 1080);

  assert.equal(verts.length, 30);
  for (let i = 0; i < verts.length; i++) {
    assert.ok(Number.isFinite(verts[i]), `Vertex float at ${i} should be finite`);
  }

  // Unrotated orthographic/perspective card has w = 1 everywhere
  assert.ok(Math.abs(verts[2] - 1) < 1e-5);
  assert.ok(Math.abs(verts[7] - 1) < 1e-5);
  assert.ok(Math.abs(verts[12] - 1) < 1e-5);
  assert.ok(Math.abs(verts[27] - 1) < 1e-5);
});

test('T11.4: buildProjectedQuadVertices computes positive perspective w values for tilted 3D quad', () => {
  const rect = makeCompositionRect(200, 100, 1520, 880);
  const quad = ScreenProjection.project(rect, 15, -20, 0, 1);
  const verts = buildProjectedQuadVertices(quad, rect, 1920, 1080);

  assert.equal(verts.length, 30);
  for (let v = 0; v < 6; v++) {
    const w = verts[v * 5 + 2];
    assert.ok(w > 0 && Number.isFinite(w), `Vertex ${v} w=${w} must be positive and finite`);
  }

  // With non-zero rotation + perspective, w1 (topRight) or w3 (bottomLeft) should differ from 1
  const wTopRight = verts[1 * 5 + 2];
  const wBottomLeft = verts[5 * 5 + 2];
  assert.ok(Math.abs(wTopRight - 1) > 1e-4 || Math.abs(wBottomLeft - 1) > 1e-4);
});

test('T11.5a: computeScreenShaderUniforms extracts corner radius and effective border parameters', () => {
  const rect = makeCompositionRect(100, 100, 1720, 880);
  const quad = ScreenProjection.project(rect, 0, 0, 0, 1);

  // Case 1: explicit borderWidth > 0 -> effective border alpha >= 0.85
  const screenWithBorder = makeFrameScreenScene({
    sourceCrop: makeNormalizedCrop(),
    fittedRect: rect,
    baseRect: rect,
    finalRect: rect,
    projectedQuad: quad,
    cornerRadius: 24,
    borderWidth: 4,
    borderColor: makeHexColor(0xff0000),
    borderOpacity: 0.2,
    shadow: null,
  });
  const u1 = computeScreenShaderUniforms(screenWithBorder);
  assert.deepEqual(u1.screenSize, [1720, 880]);
  assert.equal(u1.cornerRadius, 24);
  assert.equal(u1.effectiveBorderWidth, 4);
  assert.ok(Math.abs(u1.borderColor[0] - 1) < 1e-6);
  assert.ok(Math.abs(u1.borderColor[3] - 0.85) < 1e-6);

  // Case 2: borderWidth === 0 with inset borderOpacity > 0 -> 1.5px micro rim
  const screenWithRim = makeFrameScreenScene({
    sourceCrop: makeNormalizedCrop(),
    fittedRect: rect,
    baseRect: rect,
    finalRect: rect,
    projectedQuad: quad,
    cornerRadius: 16,
    borderWidth: 0,
    borderColor: makeHexColor(0xffffff),
    borderOpacity: 0.125,
    shadow: null,
  });
  const u2 = computeScreenShaderUniforms(screenWithRim);
  assert.equal(u2.cornerRadius, 16);
  assert.equal(u2.effectiveBorderWidth, 1.5);
  assert.ok(Math.abs(u2.borderColor[3] - 0.125) < 1e-6);
});

test('T11.5b: buildShadowQuadVertices returns null when shadow is disabled and expanded vertices when enabled', () => {
  const rect = makeCompositionRect(160, 90, 1600, 900);
  const quad = ScreenProjection.project(rect, 10, -15, 0, 1);

  const noShadowScreen = makeFrameScreenScene({
    sourceCrop: makeNormalizedCrop(),
    fittedRect: rect,
    baseRect: rect,
    finalRect: rect,
    projectedQuad: quad,
    cornerRadius: 24,
    borderWidth: 0,
    borderColor: makeHexColor(0xffffff),
    borderOpacity: 0,
    shadow: null,
  });
  assert.equal(buildShadowQuadVertices(noShadowScreen, 1920, 1080), null);

  const withShadowScreen = makeFrameScreenScene({
    sourceCrop: makeNormalizedCrop(),
    fittedRect: rect,
    baseRect: rect,
    finalRect: rect,
    projectedQuad: quad,
    cornerRadius: 24,
    borderWidth: 0,
    borderColor: makeHexColor(0xffffff),
    borderOpacity: 0.125,
    shadow: makeFrameShadow({
      color: makeHexColor(0x000000),
      opacity: 0.35,
      radius: 22,
      offset: makeCompositionPoint(0, 12),
    }),
  });

  const screenVerts = buildProjectedQuadVertices(quad, rect, 1920, 1080);
  const shadowVerts = buildShadowQuadVertices(withShadowScreen, 1920, 1080);
  assert.ok(shadowVerts !== null);
  assert.equal(shadowVerts.length, 30);

  for (let i = 0; i < shadowVerts.length; i++) {
    assert.ok(Number.isFinite(shadowVerts[i]), `Shadow vertex float ${i} must be finite`);
  }

  // Shadow topLeft (corner 0) should be farther left (smaller ndcX) and higher (larger ndcY) than screen topLeft
  assert.ok(shadowVerts[0] < screenVerts[0]);
  assert.ok(shadowVerts[1] > screenVerts[1]);
  // Shadow uv topLeft should be negative (< 0)
  assert.ok(shadowVerts[3] < 0);
  assert.ok(shadowVerts[4] < 0);
});

test('T11.5c: resolveBackgroundShaderParams produces valid colors and pattern modes for all presets', () => {
  const verifyColor = (rgb: [number, number, number], label: string) => {
    for (const c of rgb) {
      assert.ok(Number.isFinite(c) && c >= 0 && c <= 1, `Invalid color channel in ${label}: ${c}`);
    }
  };

  for (const preset of BackgroundPatternPresetAllCases) {
    const bg = makeFrameBackgroundScene({
      source: { kind: 'pattern', preset },
      blurRadius: 0,
      patternScale: 1.5,
      patternOpacity: 0.8,
    });
    const params = resolveBackgroundShaderParams(bg, 1.25);
    verifyColor(params.topLeftColor, `${preset}.topLeft`);
    verifyColor(params.bottomRightColor, `${preset}.bottomRight`);
    verifyColor(params.accentColor, `${preset}.accent`);
    verifyColor(params.gridColor, `${preset}.grid`);
    assert.ok([0, 1, 2, 3].includes(params.patternMode));
    assert.equal(params.patternScale, 1.5);
    assert.equal(params.patternOpacity, 0.8);
    assert.equal(params.time, 1.25);
  }

  for (const preset of DynamicBackgroundPresetAllCases) {
    const bg = makeFrameBackgroundScene({
      source: { kind: 'dynamicFlow', preset },
      blurRadius: 10,
      patternScale: 1.0,
      patternOpacity: 1.0,
    });
    const params = resolveBackgroundShaderParams(bg, 2.5);
    verifyColor(params.topLeftColor, `${preset}.topLeft`);
    verifyColor(params.bottomRightColor, `${preset}.bottomRight`);
    verifyColor(params.accentColor, `${preset}.accent`);
    verifyColor(params.gridColor, `${preset}.grid`);
    assert.ok([0, 1, 2, 3].includes(params.patternMode));
    assert.equal(params.time, 2.5);
  }
});

test('T11.5d: buildCursorArrowTriangles produces 5 finite triangles and shrinks cleanly on click', () => {
  const tip = makeCompositionPoint(960, 540);
  const idle = buildCursorArrowTriangles(tip, 40, 0, false);
  const clicking = buildCursorArrowTriangles(tip, 40, 0, true);

  assert.equal(idle.length, 30);
  assert.equal(clicking.length, 30);
  for (let i = 0; i < 30; i++) {
    assert.ok(Number.isFinite(idle[i]), `Idle vertex float ${i} must be finite`);
    assert.ok(Number.isFinite(clicking[i]), `Clicking vertex float ${i} must be finite`);
  }

  // First vertex of first triangle is exact tip at (960, 540) when scaleMultiplier=1.0
  assert.equal(idle[0], 960);
  assert.equal(idle[1], 540);

  // Second vertex of first triangle is (0, 1.0) -> (960, 540 + 40) when idle vs (960, 540 + 40*0.92) when clicking
  assert.ok(Math.abs(idle[3] - 580) < 1e-3);
  assert.ok(Math.abs(clicking[3] - (540 + 40 * 0.92)) < 1e-3);
});

test('T11.5d: computeCursorClickEffectPass projects cursor tip and produces valid click ripple geometry', () => {
  const rect = makeCompositionRect(160, 90, 1600, 900);
  const quad = ScreenProjection.project(rect, 0, 0, 0, 1);
  const screen = makeFrameScreenScene({
    sourceCrop: makeNormalizedCrop(),
    fittedRect: rect,
    baseRect: rect,
    finalRect: rect,
    projectedQuad: quad,
    cornerRadius: 24,
    borderWidth: 0,
    borderColor: makeHexColor(0xffffff),
    borderOpacity: 0.125,
    shadow: null,
  });

  const pointer = makeCompositionPoint(960, 540);
  const metrics = makeCursorAssetMetrics({
    hotspot: { x: 0, y: 0 },
    intrinsicSize: { width: 32, height: 32 },
    clickColor: makeHexColor(0x38bdf8),
  });
  const layout = CursorRenderGeometry.layout(pointer, 1080, 1.25, metrics)!;
  const clickPhase = makePointerClickPhase(0.25, 0.09, 0.36, 'leftClick');

  const cursor = makeFrameCursorScene({
    assetID: 'system.arrow',
    metrics,
    normalizedScreenPosition: makeNormalizedPoint(0.5, 0.5),
    layout,
    isClicking: true,
    clickPhase,
    clickStyle: 'ripple',
    shadow: null,
  });

  const pass = computeCursorClickEffectPass(cursor, screen);
  assert.ok(Math.abs(pass.tipPx.x - 960) < 1e-4);
  assert.ok(Math.abs(pass.tipPx.y - 540) < 1e-4);
  assert.ok(pass.clickGeo !== null);
  assert.ok(pass.clickGeo.primaryDiameter > 0);
  assert.ok(pass.clickGeo.primaryOpacity > 0);
});
