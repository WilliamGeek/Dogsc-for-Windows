import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ScreenProjection, projectedScreenQuadCorners, projectedScreenQuadProjector,
  mapperProject, mapperUnproject, projectedScreenQuadContains, projectedScreenQuadCenter,
  projectedScreenQuadBounds, projectedScreenQuadSemanticResizeDelta,
} from '../../src/core/ScreenProjection.ts';
import { makeCompositionRect } from '../../src/core/CompositionScene.ts';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !≈ ${b}`);
const rect = makeCompositionRect(100, 50, 1600, 900);

test('zero rotation → quad equals rect corners (any perspective)', () => {
  for (const p of [0, 1, 2]) {
    const q = ScreenProjection.project(rect, 0, 0, 0, p);
    near(q.topLeft.x, 100); near(q.topLeft.y, 50);
    near(q.bottomRight.x, 1700); near(q.bottomRight.y, 950);
  }
});

test('perspective 0 is orthographic → parallelogram', () => {
  const q = ScreenProjection.project(rect, 0, 30, 0, 0);
  near(q.topRight.x - q.topLeft.x, q.bottomRight.x - q.bottomLeft.x);
  near(q.topRight.y - q.topLeft.y, q.bottomRight.y - q.bottomLeft.y);
  // rotation around Y by 30° shrinks width by cos(30°) (Swift L320, z=0 plane)
  near(q.topRight.x - q.topLeft.x, 1600 * Math.cos(Math.PI / 6));
});

test('homography: corners map exactly and unproject(project(p)) ≈ p', () => {
  const q = ScreenProjection.project(rect, 20, -25, 5, 1);
  const m = projectedScreenQuadProjector(q, rect)!;
  assert.ok(m);
  const src = [
    [100, 50], [1700, 50], [1700, 950], [100, 950],
  ];
  const corners = projectedScreenQuadCorners(q);
  src.forEach(([x, y], i) => {
    const p = mapperProject(m, { x, y })!;
    near(p.x, corners[i].x, 1e-6); near(p.y, corners[i].y, 1e-6);
  });
  for (const [x, y] of [[900, 500], [150, 900], [1650, 80], [400, 300], [1200, 700]]) {
    const back = mapperUnproject(m, mapperProject(m, { x, y })!)!;
    near(back.x, x, 1e-6); near(back.y, y, 1e-6);
  }
});

test('contains / center / bounds', () => {
  const q = ScreenProjection.project(rect, 15, 20, 0, 1);
  assert.equal(projectedScreenQuadContains(q, projectedScreenQuadCenter(q)), true);
  assert.equal(projectedScreenQuadContains(q, { x: -5000, y: -5000 }), false);
  assert.equal(projectedScreenQuadContains(q, { x: Number.NaN, y: 0 }), false);
  assert.equal(projectedScreenQuadContains(q, q.topLeft), true); // boundary included
  const b = projectedScreenQuadBounds(q);
  assert.ok(b.width > 0 && b.height > 0);
});

test('mapper rejects degenerate source rect; resize delta along diagonal', () => {
  const q = ScreenProjection.project(rect, 0, 0, 0, 0);
  assert.equal(projectedScreenQuadProjector(q, makeCompositionRect(0, 0, 0, 10)), null);
  assert.equal(projectedScreenQuadSemanticResizeDelta(q, { x: Number.NaN, y: 0 }, 100), 0);
  // perpendicular drag contributes nothing
  const dx = 1600, dy = 900, len = Math.hypot(dx, dy);
  near(projectedScreenQuadSemanticResizeDelta(q, { x: -dy / len, y: dx / len }, 100), 0);
});

test('extreme rotation never yields NaN (denominator floor, Swift L332)', () => {
  const q = ScreenProjection.project(rect, 89, 89, 0, 2);
  for (const c of projectedScreenQuadCorners(q)) assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y));
});

