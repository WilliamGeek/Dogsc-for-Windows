// Port of: F:\dogsc\Sources\RecorderCore\ScreenProjection.swift (complete)
import { max, min } from './swift.ts';
import type { CompositionPoint, CompositionRect } from './CompositionScene.ts';
import { compositionRectMidX, compositionRectMidY } from './CompositionScene.ts';

const EPS9 = 0.000_000_001;

// ---------------------------------------------------------------------------
// ProjectedScreenPointMapper (Swift struct, fileprivate init)
// ---------------------------------------------------------------------------
export interface ProjectedScreenPointMapper {
  readonly sourceRect: CompositionRect;
  readonly topLeft: CompositionPoint;
  readonly a: number;
  readonly b: number;
  readonly d: number;
  readonly e: number;
  readonly perspectiveX: number;
  readonly perspectiveY: number;
}

function makeProjectedScreenPointMapper(
  quad: ProjectedScreenQuad,
  sourceRect: CompositionRect,
): ProjectedScreenPointMapper | null {
  if (
    !(
      Number.isFinite(sourceRect.width) &&
      Number.isFinite(sourceRect.height) &&
      sourceRect.width > 0 &&
      sourceRect.height > 0 &&
      projectedScreenQuadCorners(quad).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    )
  ) {
    return null;
  }

  const dx1 = quad.topRight.x - quad.bottomRight.x;
  const dx2 = quad.bottomLeft.x - quad.bottomRight.x;
  const dx3 = quad.topLeft.x - quad.topRight.x + quad.bottomRight.x - quad.bottomLeft.x;
  const dy1 = quad.topRight.y - quad.bottomRight.y;
  const dy2 = quad.bottomLeft.y - quad.bottomRight.y;
  const dy3 = quad.topLeft.y - quad.topRight.y + quad.bottomRight.y - quad.bottomLeft.y;
  const denominator = dx1 * dy2 - dx2 * dy1;

  let perspectiveX: number;
  let perspectiveY: number;
  if (Math.abs(dx3) <= EPS9 && Math.abs(dy3) <= EPS9) {
    perspectiveX = 0;
    perspectiveY = 0;
  } else {
    if (!(Math.abs(denominator) > EPS9)) return null;
    perspectiveX = (dx3 * dy2 - dx2 * dy3) / denominator;
    perspectiveY = (dx1 * dy3 - dx3 * dy1) / denominator;
  }

  return Object.freeze({
    sourceRect: { ...sourceRect },
    topLeft: { ...quad.topLeft },
    a: quad.topRight.x - quad.topLeft.x + perspectiveX * quad.topRight.x,
    b: quad.bottomLeft.x - quad.topLeft.x + perspectiveY * quad.bottomLeft.x,
    d: quad.topRight.y - quad.topLeft.y + perspectiveX * quad.topRight.y,
    e: quad.bottomLeft.y - quad.topLeft.y + perspectiveY * quad.bottomLeft.y,
    perspectiveX,
    perspectiveY,
  });
}

export function mapperProject(m: ProjectedScreenPointMapper, point: CompositionPoint): CompositionPoint | null {
  if (!(Number.isFinite(point.x) && Number.isFinite(point.y))) return null;
  const x = (point.x - m.sourceRect.x) / m.sourceRect.width;
  const y = (point.y - m.sourceRect.y) / m.sourceRect.height;
  const divisor = m.perspectiveX * x + m.perspectiveY * y + 1;
  if (!(Number.isFinite(divisor) && Math.abs(divisor) > EPS9)) return null;
  const projected = {
    x: (m.a * x + m.b * y + m.topLeft.x) / divisor,
    y: (m.d * x + m.e * y + m.topLeft.y) / divisor,
  };
  if (!(Number.isFinite(projected.x) && Number.isFinite(projected.y))) return null;
  return projected;
}

/**
 * Exact inverse of the same homography used by the renderer. Editing a
 * tilted plane must not approximate perspective using its top/left edges.
 */
export function mapperUnproject(m: ProjectedScreenPointMapper, point: CompositionPoint): CompositionPoint | null {
  if (!(Number.isFinite(point.x) && Number.isFinite(point.y))) return null;
  const aa = m.a - point.x * m.perspectiveX;
  const bb = m.b - point.x * m.perspectiveY;
  const dd = m.d - point.y * m.perspectiveX;
  const ee = m.e - point.y * m.perspectiveY;
  const determinant = aa * ee - bb * dd;
  if (!(Math.abs(determinant) > EPS9)) return null;
  const x = point.x - m.topLeft.x;
  const y = point.y - m.topLeft.y;
  const u = (x * ee - bb * y) / determinant;
  const v = (aa * y - x * dd) / determinant;
  const result = {
    x: m.sourceRect.x + u * m.sourceRect.width,
    y: m.sourceRect.y + v * m.sourceRect.height,
  };
  return Number.isFinite(result.x) && Number.isFinite(result.y) ? result : null;
}

// ---------------------------------------------------------------------------
// ProjectedScreenQuad
// ---------------------------------------------------------------------------
export interface ProjectedScreenQuad {
  topLeft: CompositionPoint;
  topRight: CompositionPoint;
  bottomRight: CompositionPoint;
  bottomLeft: CompositionPoint;
}

export function makeProjectedScreenQuad(
  topLeft: CompositionPoint,
  topRight: CompositionPoint,
  bottomRight: CompositionPoint,
  bottomLeft: CompositionPoint,
): ProjectedScreenQuad {
  return { topLeft, topRight, bottomRight, bottomLeft };
}

/** Swift `Array.min()` / `.max()` semantics (first element, then strict `<` / `>`). */
function arrayMin(values: number[]): number | null {
  if (values.length === 0) return null;
  let r = values[0];
  for (let i = 1; i < values.length; i++) if (values[i] < r) r = values[i];
  return r;
}
function arrayMax(values: number[]): number | null {
  if (values.length === 0) return null;
  let r = values[0];
  for (let i = 1; i < values.length; i++) if (values[i] > r) r = values[i];
  return r;
}

export function projectedScreenQuadBounds(quad: ProjectedScreenQuad): CompositionRect {
  const points = projectedScreenQuadCorners(quad);
  const minX = arrayMin(points.map((p) => p.x)) ?? 0;
  const maxX = arrayMax(points.map((p) => p.x)) ?? 0;
  const minY = arrayMin(points.map((p) => p.y)) ?? 0;
  const maxY = arrayMax(points.map((p) => p.y)) ?? 0;
  return { x: minX, y: minY, width: max(maxX - minX, 0), height: max(maxY - minY, 0) };
}

/**
 * Corners in the same semantic order as the unprojected screen. Keeping
 * this order explicit lets editor interaction geometry follow the exact
 * quad consumed by the renderer instead of falling back to its axis-
 * aligned bounds.
 */
export function projectedScreenQuadCorners(quad: ProjectedScreenQuad): CompositionPoint[] {
  return [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
}

/**
 * The projected centre used by interaction affordances. For a perspective
 * quad this is intentionally the average of all four visible corners,
 * rather than the centre of the axis-aligned bounds.
 */
export function projectedScreenQuadCenter(quad: ProjectedScreenQuad): CompositionPoint {
  const c = projectedScreenQuadCorners(quad);
  return {
    x: c.reduce((s, p) => s + p.x, 0) / 4,
    y: c.reduce((s, p) => s + p.y, 0) / 4,
  };
}

/** The semantic lower-right corner remains the resize affordance even after rotation. */
export function projectedScreenQuadResizeHandlePoint(quad: ProjectedScreenQuad): CompositionPoint {
  return quad.bottomRight;
}

/**
 * Projects an arbitrary point authored in `sourceRect` through the same
 * homography as the four screen corners. Coordinates outside the rectangle
 * are intentionally supported for cursor sprites and shadows.
 * Swift: `project(_:from:)`.
 */
export function projectedScreenQuadProject(
  quad: ProjectedScreenQuad,
  point: CompositionPoint,
  sourceRect: CompositionRect,
): CompositionPoint | null {
  const projector = projectedScreenQuadProjector(quad, sourceRect);
  return projector === null ? null : mapperProject(projector, point);
}

/** Builds the unit-square homography once so several overlay corners can reuse it. */
export function projectedScreenQuadProjector(
  quad: ProjectedScreenQuad,
  sourceRect: CompositionRect,
): ProjectedScreenPointMapper | null {
  return makeProjectedScreenPointMapper(quad, sourceRect);
}

/**
 * Converts a canvas-space drag into a signed resize amount along the
 * screen's semantic top-left → bottom-right diagonal. Normalized by the
 * caller's reference length.
 */
export function projectedScreenQuadSemanticResizeDelta(
  quad: ProjectedScreenQuad,
  translation: CompositionPoint,
  referenceLength: number,
): number {
  if (!(Number.isFinite(translation.x) && Number.isFinite(translation.y) && Number.isFinite(referenceLength))) return 0;
  const handle = projectedScreenQuadResizeHandlePoint(quad);
  const dx = handle.x - quad.topLeft.x;
  const dy = handle.y - quad.topLeft.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0.000_001)) return 0;
  const unitX = dx / length;
  const unitY = dy / length;
  const projectedTravel = translation.x * unitX + translation.y * unitY;
  const identityEquivalentGain = Math.abs(unitX) + Math.abs(unitY);
  return (projectedTravel * identityEquivalentGain) / max(referenceLength, 1);
}

function cross(start: CompositionPoint, end: CompositionPoint, point: CompositionPoint): number {
  return (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
}

function pointLiesOnSegment(
  point: CompositionPoint,
  start: CompositionPoint,
  end: CompositionPoint,
  tolerance: number,
): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!(lengthSquared > tolerance * tolerance)) {
    return Math.hypot(point.x - start.x, point.y - start.y) <= tolerance;
  }
  const parameter = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  if (!(parameter >= -tolerance && parameter <= 1 + tolerance)) return false;
  const nearest = { x: start.x + parameter * dx, y: start.y + parameter * dy };
  return Math.hypot(point.x - nearest.x, point.y - nearest.y) <= tolerance;
}

/**
 * Returns whether a canvas-space point lies inside the projected screen.
 * Boundary points are included. Works for clockwise and counter-clockwise
 * quads and returns `false` for non-finite or collapsed geometry.
 */
export function projectedScreenQuadContains(
  quad: ProjectedScreenQuad,
  point: CompositionPoint,
  tolerance: number = 0.000_001,
): boolean {
  const corners = projectedScreenQuadCorners(quad);
  if (
    !(
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      Number.isFinite(tolerance) &&
      corners.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    )
  ) {
    return false;
  }
  const epsilon = max(tolerance, 0);
  let twiceArea = 0;
  for (let i = 0; i < corners.length; i++) {
    const s = corners[i];
    const e = corners[(i + 1) % corners.length];
    twiceArea += s.x * e.y - e.x * s.y;
  }
  if (!(Math.abs(twiceArea) > epsilon)) return false;

  let windingNumber = 0;
  for (let i = 0; i < corners.length; i++) {
    const start = corners[i];
    const end = corners[(i + 1) % corners.length];
    if (pointLiesOnSegment(point, start, end, epsilon)) return true;
    if (start.y <= point.y) {
      if (end.y > point.y && cross(start, end, point) > epsilon) windingNumber += 1;
    } else if (end.y <= point.y && cross(start, end, point) < -epsilon) {
      windingNumber -= 1;
    }
  }
  return windingNumber !== 0;
}

// ---------------------------------------------------------------------------
// ScreenProjection (caseless enum namespace)
// ---------------------------------------------------------------------------
function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

/**
 * Deterministic projection geometry for the decorated screen layer.
 * Input and output both use top-left canvas coordinates. `perspective == 0`
 * is orthographic; larger values increase depth without changing an
 * unrotated card.
 */
function project(
  rect: CompositionRect,
  rotationX: number,
  rotationY: number,
  rotationZ: number,
  perspective: number,
  anchor: CompositionPoint | null = null,
): ProjectedScreenQuad {
  const safeWidth = max(rect.width, 0);
  const safeHeight = max(rect.height, 0);
  const fallbackAnchor = { x: compositionRectMidX(rect), y: compositionRectMidY(rect) };
  const pivot =
    anchor !== null && Number.isFinite(anchor.x) && Number.isFinite(anchor.y) ? anchor : fallbackAnchor;
  const maximumDimension = max(rect.width, rect.height, 1);
  const depth = min(max(perspective, 0), 2);
  const cameraDistance = depth > 0 ? (maximumDimension * 2) / max(depth, 0.000_1) : Number.POSITIVE_INFINITY;

  const rx = degreesToRadians(rotationX);
  const ry = degreesToRadians(rotationY);
  const rz = degreesToRadians(rotationZ);
  const sinX = Math.sin(rx), cosX = Math.cos(rx);
  const sinY = Math.sin(ry), cosY = Math.cos(ry);
  const sinZ = Math.sin(rz), cosZ = Math.cos(rz);

  const point = (x: number, y: number): CompositionPoint => {
    // Rotate around X, then Y, then Z. The screen starts on z=0.
    const xAfterX = x;
    const yAfterX = y * cosX;
    const zAfterX = y * sinX;

    const xAfterY = xAfterX * cosY + zAfterX * sinY;
    const yAfterY = yAfterX;
    const zAfterY = -xAfterX * sinY + zAfterX * cosY;

    const xAfterZ = xAfterY * cosZ - yAfterY * sinZ;
    const yAfterZ = xAfterY * sinZ + yAfterY * cosZ;

    let projectionScale: number;
    if (Number.isFinite(cameraDistance)) {
      // Keep the denominator away from zero for authored extremes.
      const denominator = max(cameraDistance - zAfterY, cameraDistance * 0.12);
      projectionScale = cameraDistance / denominator;
    } else {
      projectionScale = 1;
    }
    return { x: pivot.x + xAfterZ * projectionScale, y: pivot.y + yAfterZ * projectionScale };
  };

  return {
    topLeft: point(rect.x - pivot.x, rect.y - pivot.y),
    topRight: point(rect.x + safeWidth - pivot.x, rect.y - pivot.y),
    bottomRight: point(rect.x + safeWidth - pivot.x, rect.y + safeHeight - pivot.y),
    bottomLeft: point(rect.x - pivot.x, rect.y + safeHeight - pivot.y),
  };
}

export const ScreenProjection = Object.freeze({ project });

