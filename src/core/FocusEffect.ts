// Port of: F:\dogsc\Sources\RecorderCore\FocusEffect.swift
import { clamp, max, min } from './swift.ts';
import {
  normalizedPointConstrained,
  zoomAnimationClipDuration,
  zoomInterpolatorEasedProgress,
  type NormalizedPoint,
  type ZoomAnimationClip,
  type ZoomEasingPreset,
  type ZoomBezierCurve,
} from './ZoomAnimation.ts';
import type { NormalizedCrop, MotionStyle } from './ProjectModel.ts';
import type { ScreenMotionClip } from './ScreenMotion.ts';

// ---------------------------------------------------------------------------
// TransitionTiming (Shared timing structure used by FocusEffectEvaluator)
// ---------------------------------------------------------------------------
export interface TransitionTiming {
  startTime: number;
  duration: number;
  leadInDuration: number;
  leadInProgressOffset: number;
  easing: ZoomEasingPreset;
  customCurve: ZoomBezierCurve;
  returnDuration: number;
  returnProgressOffset: number;
  preferredLeadInDuration?: number | null;
  preferredReturnDuration?: number | null;
}

// ---------------------------------------------------------------------------
// FocusEffectTarget & FocusEffectShape
// ---------------------------------------------------------------------------
export type FocusEffectTarget = 'animation' | 'pointer' | 'fixed';

export const FocusEffectTargetAllCases: readonly FocusEffectTarget[] = Object.freeze([
  'animation',
  'pointer',
  'fixed',
]);

export type FocusEffectShape = 'radial' | 'linear';

export const FocusEffectShapeAllCases: readonly FocusEffectShape[] = Object.freeze([
  'radial',
  'linear',
]);

// ---------------------------------------------------------------------------
// FocusEffect
// ---------------------------------------------------------------------------
/**
 * Optional per-animation spatial focus. A missing value means no work, not
 * a hidden default effect. All coordinates remain in source-screen space.
 * Swift: `FocusEffect`.
 */
export interface FocusEffect {
  shape?: FocusEffectShape | null;
  angleDegrees?: number | null;
  target: FocusEffectTarget;
  center: NormalizedPoint;
  size: number;
  blur: number;
  softness: number;
  dimming: number;
}

export function makeFocusEffect(
  linear: boolean = false,
  overrides: Partial<FocusEffect> = {},
): FocusEffect {
  if (linear) {
    return {
      shape: 'linear',
      angleDegrees: 0,
      target: 'fixed',
      center: { x: 0.5, y: 0.5 },
      size: 0.32,
      blur: 0.35,
      softness: 0.5,
      dimming: 0,
      ...overrides,
    };
  }
  return {
    shape: null,
    angleDegrees: null,
    target: 'animation',
    center: { x: 0.5, y: 0.5 },
    size: 0.45,
    blur: 0.35,
    softness: 0.5,
    dimming: 0.18,
    ...overrides,
  };
}

export function focusEffectNormalizedAngle(degrees: number): number {
  const result = degrees % 360;
  return result < 0 ? result + 360 : result;
}

export function focusEffectClearHalfWidth(effect: FocusEffect, shortEdge: number): number {
  return (shortEdge * effect.size) / 2;
}

export function focusEffectFeatherWidth(effect: FocusEffect, shortEdge: number): number {
  return max(shortEdge * effect.softness * 0.4, 1);
}

export function focusEffectIsValid(effect: FocusEffect): boolean {
  const checks = [
    effect.center.x,
    effect.center.y,
    effect.blur,
    effect.softness,
    effect.dimming,
  ];
  for (const v of checks) {
    if (!Number.isFinite(v) || v < 0 || v > 1) {
      return false;
    }
  }
  if (effect.angleDegrees != null) {
    if (
      !Number.isFinite(effect.angleDegrees) ||
      effect.angleDegrees < 0 ||
      effect.angleDegrees > 360
    ) {
      return false;
    }
  }
  if (!Number.isFinite(effect.size) || effect.size < 0.1 || effect.size > 1) {
    return false;
  }
  return true;
}

export const FocusEffect = Object.freeze({
  make: makeFocusEffect,
  normalizedAngle: focusEffectNormalizedAngle,
  clearHalfWidth: focusEffectClearHalfWidth,
  featherWidth: focusEffectFeatherWidth,
  isValid: focusEffectIsValid,
});

// ---------------------------------------------------------------------------
// FrameFocusScene
// ---------------------------------------------------------------------------
export interface FrameFocusScene {
  effect: FocusEffect;
  center: NormalizedPoint;
  progress: number;
}

export function makeFrameFocusScene(
  effect: FocusEffect,
  center: NormalizedPoint,
  progress: number,
): FrameFocusScene {
  return { effect, center, progress };
}

// ---------------------------------------------------------------------------
// FocusEffectEvaluator
// ---------------------------------------------------------------------------
function calculateTimingProgress(
  timing: TransitionTiming,
  time: number,
  holds: boolean,
  motion: MotionStyle,
): number {
  if (time < timing.startTime) return 0;
  const enter = min(timing.leadInDuration, timing.duration);
  let linear: number;
  let exiting: boolean;

  if (enter > 0 && time < timing.startTime + enter) {
    linear =
      timing.leadInProgressOffset +
      ((1 - timing.leadInProgressOffset) * (time - timing.startTime)) / enter;
    exiting = false;
  } else if (time < timing.startTime + timing.duration) {
    return 1;
  } else if (timing.returnDuration > 0) {
    linear =
      timing.returnProgressOffset +
      ((1 - timing.returnProgressOffset) * (time - (timing.startTime + timing.duration))) /
        timing.returnDuration;
    exiting = true;
  } else {
    return holds ? 1 : 0;
  }

  const eased = zoomInterpolatorEasedProgress(
    clamp(linear, 0, 1),
    timing.easing,
    timing.customCurve,
    motion,
  );
  return clamp(exiting ? 1 - eased : eased, 0, 1);
}

export const FocusEffectEvaluator = Object.freeze({
  scene(
    zoom: ZoomAnimationClip | null,
    screen: ScreenMotionClip | null,
    zoomFocus: NormalizedPoint,
    crop: NormalizedCrop,
    pointer: NormalizedPoint | null,
    time: number,
    motion: MotionStyle,
  ): FrameFocusScene | null {
    let effect: FocusEffect;
    let anchor: NormalizedPoint;
    let timing: TransitionTiming;
    let holds: boolean;

    // An explicitly enabled 3D focus owns the single effect when both
    // tracks overlap. Never stack two full-frame blurs accidentally.
    if (screen != null && screen.focusEffect != null) {
      const selected = screen.focusEffect;
      const linear: FocusEffect = { ...selected };
      if (linear.shape == null) {
        linear.shape = 'linear';
        linear.target = 'fixed';
        linear.dimming = 0;
      }
      effect = linear;
      anchor = {
        x: crop.x + screen.target.position.x * crop.width,
        y: crop.y + screen.target.position.y * crop.height,
      };
      timing = screen.timing;
      holds = timing.returnDuration === 0;
    } else if (zoom != null && zoom.focusEffect != null) {
      effect = zoom.focusEffect;
      anchor = zoomFocus;
      timing = {
        startTime: zoom.startTime,
        duration: zoomAnimationClipDuration(zoom),
        leadInDuration: zoom.enterDuration,
        easing: zoom.easing,
        customCurve: zoom.customCurve,
        returnDuration: zoom.exitDuration,
        leadInProgressOffset: zoom.enterProgressOffset,
        returnProgressOffset: zoom.exitProgressOffset,
      };
      holds = false;
    } else {
      return null;
    }

    if (!focusEffectIsValid(effect) || (effect.blur <= 0 && effect.dimming <= 0)) {
      return null;
    }

    const amount = calculateTimingProgress(timing, time, holds, motion);
    if (!(amount > 0)) return null;

    let center: NormalizedPoint;
    switch (effect.target) {
      case 'animation':
        center = anchor;
        break;
      case 'pointer':
        center = pointer ?? anchor;
        break;
      case 'fixed':
        center = effect.center;
        break;
    }

    return {
      effect,
      center: normalizedPointConstrained(center, 0),
      progress: amount,
    };
  },
});
