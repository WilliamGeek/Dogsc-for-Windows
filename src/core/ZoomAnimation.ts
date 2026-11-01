// Port of: F:\dogsc\Sources\RecorderCore\ZoomAnimation.swift
import { clamp, max, min, newUUID } from './swift.ts';
import type { CursorAssetID } from './ProjectModel.ts';
import type { FocusEffect } from './FocusEffect.ts';
import { TimelineTrackOrdering } from './TimelineTrackOrdering.ts';
import {
  ZoomTransitionResolution,
  zoomAnimationClipRequestedEnterDuration,
  zoomAnimationClipRequestedExitDuration,
} from './ZoomTransitionResolution.ts';
import {
  makeMotionStyle,
  type MotionStyle,
  type NormalizedCrop,
  NormalizedCropFull,
  normalizedCropClamped,
} from './ProjectModel.ts';
import type { CompositionRect } from './CompositionScene.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const ZOOM_VIEWPORT_TRANSFORM_FOCUS_EDGE_INSET = 0.0;
export const ZOOM_VIEWPORT_TRANSFORM_COMPOSITION_GUIDE_INSET = 0.12;
export const ZOOM_VIEWPORT_TRANSFORM_FRAMING_TARGET_INSET = 0.30;
export const ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE = 1.0 / 120.0;

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
  timeOrOptions:
    | number
    | {
        time: number;
        location: NormalizedPoint;
        kind: PointerEventKind;
        modifiers?: PointerModifier[];
        cursorAssetID?: CursorAssetID | null;
      },
  location?: NormalizedPoint,
  kind?: PointerEventKind,
  modifiers: PointerModifier[] = [],
  cursorAssetID: CursorAssetID | null = null,
): PointerEventRecord {
  if (typeof timeOrOptions === 'object') {
    return {
      time: timeOrOptions.time,
      location: timeOrOptions.location,
      kind: timeOrOptions.kind,
      modifiers: timeOrOptions.modifiers ?? [],
      cursorAssetID: timeOrOptions.cursorAssetID ?? null,
    };
  }
  return {
    time: timeOrOptions,
    location: location!,
    kind: kind!,
    modifiers,
    cursorAssetID,
  };
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

/**
 * Reconstructs zoom clips from legacy point-in-time keyframes.
 * Swift: `ZoomAnimationClip.migrating(keyframes:defaultEasing:baseScale:)`.
 */
export function zoomAnimationClipMigrating(
  keyframes: readonly ZoomKeyframe[],
  defaultEasing: ZoomEasingPreset = '三次方缓动',
  baseScale: number = 1,
): ZoomAnimationClip[] {
  const ordered = keyframes
    .filter((k) => Number.isFinite(k.time) && k.time >= 0)
    .slice()
    .sort((lhs, rhs) => {
      if (lhs.time === rhs.time) {
        return lhs.id < rhs.id ? -1 : lhs.id > rhs.id ? 1 : 0;
      }
      return lhs.time - rhs.time;
    });

  if (ordered.length === 0) return [];

  const threshold = baseScale + 0.000_1;
  const result: ZoomAnimationClip[] = [];
  let index = 0;

  while (index < ordered.length) {
    if (ordered[index].scale <= threshold) {
      index += 1;
      continue;
    }
    const firstZoomedIndex = index;
    let lastZoomedIndex = index;
    while (
      lastZoomedIndex + 1 < ordered.length &&
      ordered[lastZoomedIndex + 1].scale > threshold
    ) {
      lastZoomedIndex += 1;
    }
    const startIndex = max(firstZoomedIndex - 1, 0);
    const start = ordered[startIndex].time;
    const end =
      lastZoomedIndex + 1 < ordered.length
        ? ordered[lastZoomedIndex + 1].time
        : max(ordered[lastZoomedIndex].time + 0.6, start + 0.6);

    const frames = ordered.slice(firstZoomedIndex, lastZoomedIndex + 1);
    let representative = frames[0];
    for (let i = 1; i < frames.length; i++) {
      const f = frames[i];
      if (
        f.scale > representative.scale ||
        (f.scale === representative.scale && f.time > representative.time)
      ) {
        representative = f;
      }
    }
    const hasManual = frames.some((f) => f.origin === 'manual');
    const origin: ZoomKeyframeOrigin = hasManual ? 'manual' : 'automatic';

    if (end - start > 0.01) {
      result.push(
        makeZoomAnimationClip({
          startTime: start,
          endTime: end,
          scale: representative.scale,
          focus: representative.focus,
          origin,
          easing: defaultEasing,
        }),
      );
    }
    index = lastZoomedIndex + 1;
  }
  return result;
}

// ---------------------------------------------------------------------------
// ZoomKeyframe
// ---------------------------------------------------------------------------
export interface ZoomKeyframe {
  id: string;
  time: number;
  scale: number;
  focus: NormalizedPoint;
  origin: ZoomKeyframeOrigin;
}

export function makeZoomKeyframe(options: {
  id?: string;
  time: number;
  scale: number;
  focus: NormalizedPoint;
  origin?: ZoomKeyframeOrigin;
}): ZoomKeyframe {
  return {
    id: options.id ?? newUUID(),
    time: options.time,
    scale: options.scale,
    focus: options.focus,
    origin: options.origin ?? 'automatic',
  };
}

// ---------------------------------------------------------------------------
// ManualZoomViewportTransition
// ---------------------------------------------------------------------------
/**
 * A manual hand-off travels between two fully framed viewports.
 * Swift: `ManualZoomViewportTransition`.
 */
export interface ManualZoomViewportTransition {
  fromScale: number;
  fromFocus: NormalizedPoint;
  toScale: number;
  toFocus: NormalizedPoint;
  progress: number;
}

export function makeManualZoomViewportTransition(
  fromScale: number,
  fromFocus: NormalizedPoint,
  toScale: number,
  toFocus: NormalizedPoint,
  progress: number,
): ManualZoomViewportTransition {
  return { fromScale, fromFocus, toScale, toFocus, progress };
}

// ---------------------------------------------------------------------------
// ZoomSample
// ---------------------------------------------------------------------------
export interface ZoomSample {
  scale: number;
  focus: NormalizedPoint;
  framingProgress: number;
  targetScale: number;
  manualViewportTransition: ManualZoomViewportTransition | null;
}

export function makeZoomSample(
  scale: number,
  focus: NormalizedPoint,
  framingProgress: number | null = null,
  targetScale: number | null = null,
  manualViewportTransition: ManualZoomViewportTransition | null = null,
): ZoomSample {
  const defaultFraming = scale > 1.0001 ? 1 : 0;
  return {
    scale,
    focus,
    framingProgress: clamp(framingProgress ?? defaultFraming, 0, 1),
    targetScale: max(targetScale ?? scale, 1),
    manualViewportTransition: manualViewportTransition ?? null,
  };
}

// ---------------------------------------------------------------------------
// ZoomViewportTransform
// ---------------------------------------------------------------------------
export interface ZoomViewportTransform {
  scale: number;
  translation: NormalizedPoint;
}

export function makeZoomViewportTransform(
  scale: number,
  translation: NormalizedPoint,
): ZoomViewportTransform {
  return { scale, translation };
}

/**
 * Applies the normalized, top-left-origin viewport transform.
 * Swift: `ZoomViewportTransform.applying(to:)`.
 */
export function zoomViewportTransformApply(
  transform: ZoomViewportTransform,
  point: NormalizedPoint,
): NormalizedPoint {
  return {
    x: 0.5 + transform.scale * (point.x - 0.5) + transform.translation.x,
    y: 0.5 + transform.scale * (point.y - 0.5) + transform.translation.y,
  };
}

/**
 * Calculates the transform matrix from a sample, crop, and visible rect.
 * Swift: `ZoomViewportTransform.make(from:crop:covering:)`.
 */
export function makeZoomViewportTransformFromSample(
  sample: ZoomSample,
  crop: NormalizedCrop = NormalizedCropFull,
  coveringVisibleRect: CompositionRect | null = null,
): ZoomViewportTransform {
  if (sample.manualViewportTransition != null) {
    const transition = sample.manualViewportTransition;
    const from = makeZoomViewportTransformFromSample(
      makeZoomSample(transition.fromScale, transition.fromFocus, 1),
      crop,
      coveringVisibleRect,
    );
    const to = makeZoomViewportTransformFromSample(
      makeZoomSample(transition.toScale, transition.toFocus, 1),
      crop,
      coveringVisibleRect,
    );
    const progress = clamp(transition.progress, 0, 1);
    return {
      scale: from.scale + (to.scale - from.scale) * progress,
      translation: {
        x: from.translation.x + (to.translation.x - from.translation.x) * progress,
        y: from.translation.y + (to.translation.y - from.translation.y) * progress,
      },
    };
  }

  const scale = clamp(sample.scale, 1, 6);
  const safeCrop = normalizedCropClamped(crop);
  const localFocus: NormalizedPoint = normalizedPointConstrained(
    {
      x: clamp((sample.focus.x - safeCrop.x) / safeCrop.width, 0, 1),
      y: clamp((sample.focus.y - safeCrop.y) / safeCrop.height, 0, 1),
    },
    ZOOM_VIEWPORT_TRANSFORM_FOCUS_EDGE_INSET,
  );
  const destination = normalizedPointConstrained(
    localFocus,
    ZOOM_VIEWPORT_TRANSFORM_FRAMING_TARGET_INSET,
  );
  const progress = clamp(sample.framingProgress, 0, 1);
  const desiredPoint: NormalizedPoint = {
    x: localFocus.x + (destination.x - localFocus.x) * progress,
    y: localFocus.y + (destination.y - localFocus.y) * progress,
  };
  const scaledPoint: NormalizedPoint = {
    x: 0.5 + scale * (localFocus.x - 0.5),
    y: 0.5 + scale * (localFocus.y - 0.5),
  };

  let translationX = desiredPoint.x - scaledPoint.x;
  let translationY = desiredPoint.y - scaledPoint.y;

  if (coveringVisibleRect != null) {
    translationX = min(
      max(translationX, coveringVisibleRect.x + coveringVisibleRect.width - 0.5 - scale / 2),
      coveringVisibleRect.x - 0.5 + scale / 2,
    );
    translationY = min(
      max(translationY, coveringVisibleRect.y + coveringVisibleRect.height - 0.5 - scale / 2),
      coveringVisibleRect.y - 0.5 + scale / 2,
    );
  }

  return {
    scale,
    translation: { x: translationX, y: translationY },
  };
}

export const ZoomViewportTransform = Object.freeze({
  focusEdgeInset: ZOOM_VIEWPORT_TRANSFORM_FOCUS_EDGE_INSET,
  compositionGuideInset: ZOOM_VIEWPORT_TRANSFORM_COMPOSITION_GUIDE_INSET,
  framingTargetInset: ZOOM_VIEWPORT_TRANSFORM_FRAMING_TARGET_INSET,
  make: makeZoomViewportTransformFromSample,
  applying: zoomViewportTransformApply,
});

// ---------------------------------------------------------------------------
// ZoomAnimationTrack
// ---------------------------------------------------------------------------
export class ZoomAnimationTrack {
  readonly animations: readonly ZoomAnimationClip[];
  readonly outputDuration: number | null;
  private readonly authoredAnimations: readonly ZoomAnimationClip[];
  private readonly animationIndicesByID: Map<string, number>;
  private readonly prefixMaximumEffectEnd: readonly number[];

  constructor(
    authoredAnimations: readonly ZoomAnimationClip[],
    outputDuration: number | null = null,
  ) {
    this.authoredAnimations = authoredAnimations;
    this.outputDuration = outputDuration;
    const animations =
      outputDuration != null
        ? ZoomTransitionResolution.resolve(authoredAnimations, outputDuration)
        : authoredAnimations.slice();

    if (TimelineTrackOrdering.zoomAnimationsNeedRepair(animations)) {
      this.animations = animations
        .filter((a) => zoomAnimationClipDuration(a) > 0.001)
        .slice()
        .sort((lhs, rhs) => {
          if (lhs.startTime === rhs.startTime) {
            return lhs.id < rhs.id ? -1 : lhs.id > rhs.id ? 1 : 0;
          }
          return lhs.startTime - rhs.startTime;
        });
    } else {
      this.animations = animations;
    }

    const indicesByID = new Map<string, number>();
    for (let index = 0; index < this.animations.length; index++) {
      const animation = this.animations[index];
      if (!indicesByID.has(animation.id)) {
        indicesByID.set(animation.id, index);
      }
    }
    this.animationIndicesByID = indicesByID;

    let maximumEffectEnd = -Infinity;
    const prefixEnds: number[] = [];
    for (const animation of this.animations) {
      maximumEffectEnd = max(maximumEffectEnd, zoomAnimationClipEffectEndTime(animation));
      prefixEnds.push(maximumEffectEnd);
    }
    this.prefixMaximumEffectEnd = prefixEnds;
  }

  bounded(duration: number | null): ZoomAnimationTrack {
    if (duration != null && duration !== this.outputDuration) {
      return new ZoomAnimationTrack(this.authoredAnimations, duration);
    }
    return this;
  }

  sample(
    time: number,
    motion: MotionStyle = makeMotionStyle(),
    automaticFocus: NormalizedPoint | null = null,
    inheritedAutomaticFocus: NormalizedPoint | null = null,
    reanchorAutomaticEntry: boolean = false,
  ): ZoomSample {
    return zoomInterpolatorSampleOrdered(
      this.animations,
      this.activeClipIndex(time),
      time,
      motion,
      automaticFocus,
      inheritedAutomaticFocus,
      reanchorAutomaticEntry,
    );
  }

  activeClip(time: number): ZoomAnimationClip | null {
    const index = this.activeClipIndex(time);
    return index != null ? this.animations[index] : null;
  }

  activeAutomaticClip(time: number): ZoomAnimationClip | null {
    const clip = this.activeClip(time);
    return clip != null && clip.origin === 'automatic' ? clip : null;
  }

  adjacentPreviousClip(clip: ZoomAnimationClip): ZoomAnimationClip | null {
    const index = this.animationIndicesByID.get(clip.id);
    if (index == null || index <= 0) return null;
    const previous = this.animations[index - 1];
    if (Math.abs(previous.endTime - clip.startTime) <= ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE) {
      return previous;
    }
    return null;
  }

  activeClipIndex(time: number): number | null {
    if (!Number.isFinite(time) || this.animations.length === 0) return null;
    let lower = 0;
    let upper = this.animations.length;
    while (lower < upper) {
      const middle = lower + Math.floor((upper - lower) / 2);
      if (this.animations[middle].startTime <= time) {
        lower = middle + 1;
      } else {
        upper = middle;
      }
    }
    if (!(lower > 0)) return null;
    let index = lower - 1;
    while (true) {
      const clip = this.animations[index];
      if (time >= clip.startTime && time <= zoomAnimationClipEffectEndTime(clip)) {
        return index;
      }
      if (index > 0 && this.prefixMaximumEffectEnd[index - 1] >= time) {
        index -= 1;
      } else {
        return null;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// ZoomInterpolator
// ---------------------------------------------------------------------------
function interpolate(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

/**
 * A normalized under-damped spring tuned for this editor.
 * Swift: `ZoomInterpolator.springProgress(_:mass:stiffness:damping:)`.
 */
export function zoomSpringProgress(
  value: number,
  mass: number,
  stiffness: number,
  damping: number,
): number {
  const t = clamp(value, 0, 1);
  if (t <= 0 || t >= 1) return t;

  const safeMass = max(mass, 0.01);
  const safeStiffness = max(stiffness, 0.01);
  const safeDamping = max(damping, 0.01);
  const omega0 = Math.sqrt(safeStiffness / safeMass);
  const zeta = min(safeDamping / (2 * Math.sqrt(safeStiffness * safeMass)), 0.9999);
  const omegaD = omega0 * Math.sqrt(max(1 - zeta * zeta, Number.MIN_VALUE));
  const duration = 0.72;

  function response(seconds: number): number {
    const envelope = Math.exp(-zeta * omega0 * seconds);
    const oscillation =
      Math.cos(omegaD * seconds) +
      ((zeta * omega0) / omegaD) * Math.sin(omegaD * seconds);
    return 1 - envelope * oscillation;
  }

  const denom = response(duration);
  return clamp(response(t * duration) / denom, 0, 1);
}

export function zoomInterpolatorEasedProgress(
  value: number,
  preset: ZoomEasingPreset,
  customCurve: ZoomBezierCurve = ZoomBezierCurveCubic,
  motion: MotionStyle = makeMotionStyle(),
): number {
  const t = clamp(value, 0, 1);
  switch (preset) {
    case '线性':
      return zoomBezierCurveValue(ZoomBezierCurveLinear, t);
    case '二次方缓动':
      return zoomBezierCurveValue(ZoomBezierCurveQuadratic, t);
    case '三次方缓动':
      return zoomBezierCurveValue(ZoomBezierCurveCubic, t);
    case '五次平滑':
      return zoomBezierCurveValue(ZoomBezierCurveQuintic, t);
    case '弹簧':
      return zoomSpringProgress(
        t,
        motion.screenSpringMass,
        motion.screenSpringStiffness,
        motion.screenSpringDamping,
      );
    case '自定义曲线':
      return zoomBezierCurveValue(customCurve, t);
  }
}

export function zoomInterpolatorAutomaticTargetFocus(
  clip: ZoomAnimationClip,
  automaticFocus: NormalizedPoint | null = null,
): NormalizedPoint {
  const base = normalizedPointConstrained(clip.focus, ZOOM_VIEWPORT_TRANSFORM_FOCUS_EDGE_INSET);
  if (clip.origin === 'automatic' && automaticFocus != null) {
    return normalizedPointConstrained(automaticFocus, ZOOM_VIEWPORT_TRANSFORM_FOCUS_EDGE_INSET);
  }
  return base;
}

export function zoomInterpolatorSampleOrdered(
  orderedAnimations: readonly ZoomAnimationClip[],
  activeClipIndex: number | null,
  time: number,
  motion: MotionStyle,
  automaticFocus: NormalizedPoint | null,
  inheritedAutomaticFocus: NormalizedPoint | null,
  reanchorAutomaticEntry: boolean,
): ZoomSample {
  const center: NormalizedPoint = { x: 0.5, y: 0.5 };
  if (
    activeClipIndex == null ||
    activeClipIndex < 0 ||
    activeClipIndex >= orderedAnimations.length
  ) {
    return makeZoomSample(1, center, 0, 1);
  }

  const clip = orderedAnimations[activeClipIndex];
  const targetFocus = zoomInterpolatorAutomaticTargetFocus(clip, automaticFocus);

  const previous = activeClipIndex > 0 ? orderedAnimations[activeClipIndex - 1] : null;
  const adjacentPrevious =
    previous != null &&
    Math.abs(previous.endTime - clip.startTime) <= ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE
      ? previous
      : null;

  const inheritedStart: ZoomSample | null =
    adjacentPrevious != null
      ? makeZoomSample(
          adjacentPrevious.scale,
          zoomInterpolatorAutomaticTargetFocus(adjacentPrevious, inheritedAutomaticFocus),
          1,
          adjacentPrevious.scale,
        )
      : null;

  let zoomProgress: number;
  let requestedEnterDuration: number;
  if (inheritedStart != null && clip.enterDuration <= 0.001) {
    requestedEnterDuration = motion.defaultZoomTransitionDuration;
  } else {
    requestedEnterDuration = clip.enterDuration;
  }
  const effectiveEnterDuration = min(requestedEnterDuration, zoomAnimationClipDuration(clip));

  if (effectiveEnterDuration > 0.001 && time < clip.startTime + effectiveEnterDuration) {
    const local = (time - clip.startTime) / effectiveEnterDuration;
    const offset = reanchorAutomaticEntry ? 0 : clip.enterProgressOffset;
    const linear = offset + (1 - offset) * local;
    zoomProgress = zoomInterpolatorEasedProgress(linear, clip.easing, clip.customCurve, motion);
  } else if (time <= clip.endTime) {
    zoomProgress = 1;
  } else if (clip.exitDuration > 0.001) {
    const local = (time - clip.endTime) / clip.exitDuration;
    const linear = clip.exitProgressOffset + (1 - clip.exitProgressOffset) * local;
    zoomProgress =
      1 - zoomInterpolatorEasedProgress(linear, clip.easing, clip.customCurve, motion);
  } else {
    zoomProgress = 0;
  }

  if (inheritedStart != null && time <= clip.endTime) {
    const manualTransition: ManualZoomViewportTransition | null =
      clip.origin === 'manual'
        ? makeManualZoomViewportTransition(
            inheritedStart.scale,
            inheritedStart.focus,
            clip.scale,
            clip.focus,
            zoomProgress,
          )
        : null;

    return makeZoomSample(
      interpolate(inheritedStart.scale, clip.scale, zoomProgress),
      {
        x: interpolate(inheritedStart.focus.x, targetFocus.x, zoomProgress),
        y: interpolate(inheritedStart.focus.y, targetFocus.y, zoomProgress),
      },
      1,
      interpolate(inheritedStart.scale, clip.scale, zoomProgress),
      manualTransition,
    );
  }

  return makeZoomSample(
    interpolate(1, clip.scale, zoomProgress),
    targetFocus,
    zoomProgress,
    clip.scale,
  );
}

export function zoomInterpolatorSampleKeyframes(
  keyframes: readonly ZoomKeyframe[],
  time: number,
  motion: MotionStyle = makeMotionStyle(),
): ZoomSample {
  const ordered = keyframes.slice().sort((a, b) => a.time - b.time);
  if (ordered.length === 0) {
    return makeZoomSample(1, { x: 0.5, y: 0.5 }, 0, 1);
  }
  const first = ordered[0];
  if (time <= first.time) {
    return makeZoomSample(
      first.scale,
      first.focus,
      first.scale > 1.0001 ? 1 : 0,
      first.scale,
    );
  }
  const last = ordered[ordered.length - 1];
  if (time >= last.time) {
    return makeZoomSample(
      last.scale,
      last.focus,
      last.scale > 1.0001 ? 1 : 0,
      last.scale,
    );
  }

  let upperIndex = -1;
  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i].time >= time) {
      upperIndex = i;
      break;
    }
  }

  if (upperIndex <= 0) {
    return makeZoomSample(
      first.scale,
      first.focus,
      first.scale > 1.0001 ? 1 : 0,
      first.scale,
    );
  }

  const lower = ordered[upperIndex - 1];
  const upper = ordered[upperIndex];
  const duration = max(upper.time - lower.time, Number.MIN_VALUE);
  const linearProgress = clamp((time - lower.time) / duration, 0, 1);
  let progress: number;

  if (motion.screen === '聚焦') {
    progress = zoomSpringProgress(
      linearProgress,
      motion.screenSpringMass,
      motion.screenSpringStiffness,
      motion.screenSpringDamping,
    );
  } else {
    const t = linearProgress;
    progress = t * t * t * (t * (t * 6 - 15) + 10);
  }

  const sampledScale = interpolate(lower.scale, upper.scale, progress);
  const segmentTargetScale = max(lower.scale, upper.scale);
  const framingProgress =
    segmentTargetScale > 1.0001
      ? clamp((sampledScale - 1) / (segmentTargetScale - 1), 0, 1)
      : 0;

  return makeZoomSample(
    sampledScale,
    {
      x: interpolate(lower.focus.x, upper.focus.x, progress),
      y: interpolate(lower.focus.y, upper.focus.y, progress),
    },
    framingProgress,
    segmentTargetScale,
  );
}

// ---------------------------------------------------------------------------
// ZoomTrackCacheStore
// ---------------------------------------------------------------------------
function areZoomAnimationClipsEqual(
  a: readonly ZoomAnimationClip[],
  b: readonly ZoomAnimationClip[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.startTime !== y.startTime ||
      x.endTime !== y.endTime ||
      x.scale !== y.scale ||
      x.focus.x !== y.focus.x ||
      x.focus.y !== y.focus.y ||
      x.origin !== y.origin ||
      x.easing !== y.easing ||
      x.enterDuration !== y.enterDuration ||
      x.exitDuration !== y.exitDuration ||
      x.enterProgressOffset !== y.enterProgressOffset ||
      x.exitProgressOffset !== y.exitProgressOffset
    ) {
      return false;
    }
  }
  return true;
}

export class ZoomTrackCacheStore {
  private entries: Array<{ key: readonly ZoomAnimationClip[]; track: ZoomAnimationTrack }> = [];

  track(animations: readonly ZoomAnimationClip[]): ZoomAnimationTrack {
    const foundIndex = this.entries.findIndex((entry) =>
      areZoomAnimationClipsEqual(entry.key, animations),
    );
    if (foundIndex >= 0) {
      const hit = this.entries[foundIndex];
      if (foundIndex > 0) {
        this.entries.splice(foundIndex, 1);
        this.entries.unshift(hit);
      }
      return hit.track;
    }
    const track = new ZoomAnimationTrack(animations);
    this.entries.unshift({ key: animations, track });
    if (this.entries.length > 4) {
      this.entries.pop();
    }
    return track;
  }
}

const zoomTrackCache = new ZoomTrackCacheStore();

export function zoomInterpolatorSample(
  animations: readonly ZoomAnimationClip[],
  time: number,
  motion: MotionStyle = makeMotionStyle(),
  automaticFocus: NormalizedPoint | null = null,
  inheritedAutomaticFocus: NormalizedPoint | null = null,
  reanchorAutomaticEntry: boolean = false,
): ZoomSample {
  return zoomTrackCache.track(animations).sample(
    time,
    motion,
    automaticFocus,
    inheritedAutomaticFocus,
    reanchorAutomaticEntry,
  );
}

export const ZoomInterpolator = Object.freeze({
  adjacencyTolerance: ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE,
  sample: zoomInterpolatorSample,
  sampleOrdered: zoomInterpolatorSampleOrdered,
  automaticTargetFocus: zoomInterpolatorAutomaticTargetFocus,
  easedProgress: zoomInterpolatorEasedProgress,
  sampleKeyframes: zoomInterpolatorSampleKeyframes,
  springProgress: zoomSpringProgress,
});
