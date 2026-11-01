import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CursorRenderGeometry,
  makeCursorAssetMetrics,
  makeCursorAssetPoint,
  makeCursorAssetSize,
} from '../../src/core/CursorRenderGeometry.ts';
import { HexColorWhite } from '../../src/core/HexColor.ts';
import { makeCompositionPoint } from '../../src/core/CompositionScene.ts';

test('T4.4: CursorRenderGeometry.layout hotspot and sizing per Swift L145-184', () => {
  const metrics = makeCursorAssetMetrics({
    hotspot: makeCursorAssetPoint(0, 0),
    intrinsicSize: makeCursorAssetSize(32, 44),
    clickColor: HexColorWhite,
  });

  const pointer = makeCompositionPoint(100, 200);

  // At canvasShortEdge = 1080, canonicalHeight = 44, styleSize = 1.0
  // referenceHeight = 1080 * 44 / 1080 * 1.0 = 44
  // imageScale = 44 / 44 = 1.0
  const layout = CursorRenderGeometry.layout(pointer, 1080, 1.0, metrics);
  assert.ok(layout != null);
  assert.equal(layout.origin.x, 100);
  assert.equal(layout.origin.y, 200);
  assert.equal(layout.size.width, 32);
  assert.equal(layout.size.height, 44);
  assert.equal(layout.clickEffectHeight, 44);
  assert.equal(layout.clickDiameter, 44 * 1.45);

  // Centered hotspot (0.5, 0.5)
  const centeredMetrics = makeCursorAssetMetrics({
    hotspot: makeCursorAssetPoint(0.5, 0.5),
    intrinsicSize: makeCursorAssetSize(40, 40),
    clickColor: HexColorWhite,
    scaleReferenceHeight: 40,
  });
  const centeredLayout = CursorRenderGeometry.layout(pointer, 1080, 1.0, centeredMetrics);
  assert.ok(centeredLayout != null);
  // referenceHeight = 44, imageScale = 44 / 40 = 1.1
  // width = 40 * 1.1 = 44, height = 44
  // origin = (100 - 44*0.5, 200 - 44*0.5) = (78, 178)
  assert.equal(centeredLayout.origin.x, 78);
  assert.equal(centeredLayout.origin.y, 178);

  // Invalid input rejection
  assert.equal(
    CursorRenderGeometry.layout(pointer, 0, 1.0, metrics),
    null,
  );
  assert.equal(
    CursorRenderGeometry.layout(pointer, 1080, 1.0, {
      ...metrics,
      intrinsicSize: makeCursorAssetSize(0, 44),
    }),
    null,
  );
});

test('T4.4: CursorRenderGeometry.clickGeometry presets and bounds per Swift L187-357', () => {
  // style = 'none' returns null
  assert.equal(CursorRenderGeometry.clickGeometry('none', 0.5, 44), null);
  // progress out of bounds [0, 1] returns null
  assert.equal(CursorRenderGeometry.clickGeometry('ripple', -0.1, 44), null);
  assert.equal(CursorRenderGeometry.clickGeometry('ripple', 1.1, 44), null);

  // ripple at t=0
  const ripple0 = CursorRenderGeometry.clickGeometry('ripple', 0, 44);
  assert.ok(ripple0 != null);
  assert.equal(ripple0.style, 'ripple');
  // primaryDiameter = 44 * (0.45 + 0) = 19.8
  assert.ok(Math.abs(ripple0.primaryDiameter - 19.8) < 1e-6);
  assert.ok(ripple0.secondaryIsFilled);
  // secondaryDiameter = 44 * 0.28 = 12.32
  assert.ok(Math.abs(ripple0.secondaryDiameter - 12.32) < 1e-6);

  // ripple at t=0.5 (progress >= 0.35 -> secondary dot vanishes)
  const rippleMid = CursorRenderGeometry.clickGeometry('ripple', 0.5, 44);
  assert.ok(rippleMid != null);
  assert.equal(rippleMid.secondaryDiameter, 0);
  assert.equal(rippleMid.secondaryIsFilled, false);

  // glow
  const glow = CursorRenderGeometry.clickGeometry('glow', 0.1, 44);
  assert.ok(glow != null);
  assert.ok(glow.primaryIsFilled);
  assert.ok(glow.secondaryIsFilled);

  // pulse
  const pulse = CursorRenderGeometry.clickGeometry('pulse', 0.2, 44);
  assert.ok(pulse != null);
  assert.equal(pulse.primaryIsFilled, false);
  assert.ok(pulse.secondaryIsFilled);

  // burst
  const burst = CursorRenderGeometry.clickGeometry('burst', 0.3, 44);
  assert.ok(burst != null);
  assert.ok(burst.accentOffset > 0);
  assert.ok(burst.accentSize > 0);
});
