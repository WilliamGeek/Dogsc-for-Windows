// Port of: F:\dogsc\Sources\RecorderCore\ZoomAnimation.swift (Part 1: lines 1-300)
import { clamp, max, min, newUUID } from './swift.ts';
import type { CursorAssetID } from './ProjectModel.ts';
import type { FocusEffect } from './FocusEffect.ts';

// ---------------------------------------------------------------------------
// NormalizedPoint
// ---------------------------------------------------------------------------
export interface NormalizedPoint {
  x: number;
  y: number;
}

export function makeNormalizedPoint(x: number, y: number): NormalizedPoint {
  return { x, y };
}

export function normalizedPointConstrained(
  point: NormalizedPoint,
  safeInset: number,
): NormalizedPoint {
  const inset = clamp(safeInset, 0, 0.5);
  return {
    x: clamp(point.x, inset, 1 - inset),
    y: clamp(point.y, inset, 1 - inset),
  };
}

// ---------------------------------------------------------------------------
// PointerClick & PointerEventRecord
// ---------------------------------------------------------------------------
export interface PointerClick {
  time: number;
  location: NormalizedPoint;
}

export function makePointerClick(time: number, location: NormalizedPoint): PointerClick {
  return { time, location };
}

export type PointerEventKind = 'move' | 'leftClick' | 'rightClick';

export type PointerModifier =
  | 'command'
  | 'option'
  | 'control'
  | 'shift'
  | 'capsLock'
  | 'function';

export const PointerModifierAllCases: readonly PointerModifier[] = Object.freeze([
  'command',
  'option',
  'control',
  'shift',
  'capsLock',
  'function',
]);

export interface PointerEventRecord {
  time: number;
  location: NormalizedPoint;
  kind: PointerEventKind;
  modifiers: PointerModifier[];
  cursorAssetID?: CursorAssetID | null;
}

export function makePointerEventRecord(
  time: number,
  location: NormalizedPoint,
  kind: PointerEventKind,
  modifiers: PointerModifier[] = [],
  cursorAssetID: CursorAssetID | null = null,
): PointerEventRecord {
  return { time, location, kind, modifiers, cursorAssetID };
}

// ---------------------------------------------------------------------------
// ZoomKeyframeOrigin & ZoomEasingPreset
// ---------------------------------------------------------------------------
export type ZoomKeyframeOrigin = 'automatic' | 'manual';

export type ZoomEasingPreset =
  | '线性'
  | '二次方缓动'
  | '三次方缓动'
  | '五次平滑'
  | '弹簧'
  | '自定义曲线';

export const ZoomEasingPresetAllCases: readonly ZoomEasingPreset[] = Object.freeze([
  '线性',
  '二次方缓动',
  '三次方缓动',
  '五次平滑',
  '弹簧',
  '自定义曲线',
]);

export function zoomEasingPresetShortName(preset: ZoomEasingPreset): string {
  switch (preset) {
    case '线性':
      return '线性';
    case '二次方缓动':
      return '二次';
    case '三次方缓动':
      return '三次';
    case '五次平滑':
      return '五次';
    case '弹簧':
      return '弹簧';
    case '自定义曲线':
      return '自定义';
  }
}

// ---------------------------------------------------------------------------
// ZoomBezierCurve
// ---------------------------------------------------------------------------
export interface ZoomBezierCurve {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function makeZoomBezierCurve(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): ZoomBezierCurve {
  return {
    x1: clamp(x1, 0, 1),
    y1: clamp(y1, 0, 1),
    x2: clamp(x2, 0, 1),
    y2: clamp(y2, 0, 1),
  };
}

export const ZoomBezierCurveLinear: ZoomBezierCurve = Object.freeze(makeZoomBezierCurve(0, 0, 1, 1));
export const ZoomBezierCurveQuadratic: ZoomBezierCurve = Object.freeze(
  makeZoomBezierCurve(0.45, 0, 0.55, 1),
);
export const ZoomBezierCurveCubic: ZoomBezierCurve = Object.freeze(
  makeZoomBezierCurve(0.65, 0, 0.35, 1),
);
export const ZoomBezierCurveQuintic: ZoomBezierCurve = Object.freeze(
  makeZoomBezierCurve(0.82, 0, 0.18, 1),
);

export function zoomEasingPresetCurve(preset: ZoomEasingPreset): ZoomBezierCurve {
  switch (preset) {
    case '线性':
      return ZoomBezierCurveLinear;
    case '二次方缓动':
      return ZoomBezierCurveQuadratic;
    case '三次方缓动':
      return ZoomBezierCurveCubic;
    case '五次平滑':
      return ZoomBezierCurveQuintic;
    case '弹簧':
    case '自定义曲线':
      return ZoomBezierCurveCubic;
  }
}

export function zoomBezierCurvePoint(curve: ZoomBezierCurve, parameter: number): NormalizedPoint {
  const t = clamp(parameter, 0, 1);
  const inverse = 1 - t;
  const x =
    3 * inverse * inverse * t * curve.x1 +
    3 * inverse * t * t * curve.x2 +
    t * t * t;
  const y =
    3 * inverse * inverse * t * curve.y1 +
    3 * inverse * t * t * curve.y2 +
    t * t * t;
  return { x, y };
}

function zoomBezierCurveXDerivative(curve: ZoomBezierCurve, parameter: number): number {
  const t = clamp(parameter, 0, 1);
  const inverse = 1 - t;
  return (
    3 * inverse * inverse * curve.x1 +
    6 * inverse * t * (curve.x2 - curve.x1) +
    3 * t * t * (1 - curve.x2)
  );
}

/**
 * Returns the curve's Y value for a normalized time (X). Newton-Raphson
 * handles the common case; bisection guarantees a stable answer for very
 * flat user-authored handles.
 * Swift: `ZoomBezierCurve.value(at:)`.
 */
export function zoomBezierCurveValue(curve: ZoomBezierCurve, normalizedTime: number): number {
  const targetX = clamp(normalizedTime, 0, 1);
  if (!(targetX > 0 && targetX < 1)) return targetX;
  let parameter = targetX;

  // Newton-Raphson: up to 7 iterations
  for (let i = 0; i < 7; i++) {
    const point = zoomBezierCurvePoint(curve, parameter);
    const error = point.x - targetX;
    if (Math.abs(error) < 0.000_01) return point.y;
    const derivative = zoomBezierCurveXDerivative(curve, parameter);
    if (Math.abs(derivative) < 0.000_01) break;
    const next = parameter - error / derivative;
    if (next < 0 || next > 1) break;
    parameter = next;
  }

  // Bisection fallback: up to 18 iterations
  let lower = 0.0;
  let upper = 1.0;
  parameter = targetX;
  for (let i = 0; i < 18; i++) {
    const point = zoomBezierCurvePoint(curve, parameter);
    if (Math.abs(point.x - targetX) < 0.000_01) return point.y;
    if (point.x < targetX) {
      lower = parameter;
    } else {
      upper = parameter;
    }
    parameter = (lower + upper) / 2;
  }
  return zoomBezierCurvePoint(curve, parameter).y;
}

// ---------------------------------------------------------------------------
// ZoomAnimationClip
// ---------------------------------------------------------------------------
export const ZOOM_VIEWPORT_TRANSFORM_FOCUS_EDGE_INSET = 0.0;
export const ZOOM_VIEWPORT_TRANSFORM_COMPOSITION_GUIDE_INSET = 0.12;

export interface ZoomAnimationClip {
  id: string;
  startTime: number;
  endTime: number;
  scale: number;
  focus: NormalizedPoint;
  origin: ZoomKeyframeOrigin;
  easing: ZoomEasingPreset;
  customCurve: ZoomBezierCurve;
  enterDuration: number;
  exitDuration: number;
  enterProgressOffset: number;
  exitProgressOffset: number;
  focusEffect: FocusEffect | null;
  preferredEnterDuration: number | null;
  preferredExitDuration: number | null;
}

export function makeZoomAnimationClip(
  options: {
    id?: string;
    startTime: number;
    endTime: number;
    scale?: number;
    focus?: NormalizedPoint;
    origin?: ZoomKeyframeOrigin;
    easing?: ZoomEasingPreset;
    customCurve?: ZoomBezierCurve;
    enterDuration?: number;
    exitDuration?: number;
    enterProgressOffset?: number;
    exitProgressOffset?: number;
    focusEffect?: FocusEffect | null;
    preferredEnterDuration?: number | null;
    preferredExitDuration?: number | null;
  },
): ZoomAnimationClip {
  const id = options.id ?? newUUID();
  const startTime = max(options.startTime, 0);
  const endTime = max(options.endTime, startTime);
  const scale = max(options.scale ?? 1.6, 1);
  const rawFocus = options.focus ?? { x: 0.5, y: 0.5 };
  const focus = normalizedPointConstrained(rawFocus, ZOOM_VIEWPORT_TRANSFORM_FOCUS_EDGE_INSET);
  const origin = options.origin ?? 'manual';
  const easing = options.easing ?? '三次方缓动';
  const customCurve = options.customCurve ?? ZoomBezierCurveCubic;
  const enterDuration = clamp(options.enterDuration ?? 0.7, 0, 5);
  const exitDuration = clamp(options.exitDuration ?? 0.7, 0, 5);
  const enterProgressOffset = clamp(options.enterProgressOffset ?? 0, 0, 1);
  const exitProgressOffset = clamp(options.exitProgressOffset ?? 0, 0, 1);
  const focusEffect = options.focusEffect ?? null;
  const preferredEnterDuration = options.preferredEnterDuration ?? null;
  const preferredExitDuration = options.preferredExitDuration ?? null;

  return {
    id,
    startTime,
    endTime,
    scale,
    focus,
    origin,
    easing,
    customCurve,
    enterDuration,
    exitDuration,
    enterProgressOffset,
    exitProgressOffset,
    focusEffect,
    preferredEnterDuration,
    preferredExitDuration,
  };
}

export function zoomAnimationClipDuration(clip: ZoomAnimationClip): number {
  return max(clip.endTime - clip.startTime, 0);
}

export function zoomAnimationClipEffectEndTime(clip: ZoomAnimationClip): number {
  return clip.endTime + clip.exitDuration;
}
