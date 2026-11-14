// Test for: F:\dogsc-win\web\renderer.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectedQuadVertices } from '../../web/renderer.ts';
import { ScreenProjection } from '../../src/core/ScreenProjection.ts';
import { makeCompositionRect } from '../../src/core/CompositionScene.ts';

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
