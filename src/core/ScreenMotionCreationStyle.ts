// Port of: F:\dogsc\Sources\RecorderCore\ScreenMotionCreationStyle.swift
import { min, max } from './swift.ts';
import {
  makeScreenMotionClip,
  type ScreenMotionClip,
  type ScreenMotionState,
} from './ScreenMotion.ts';
import { focusEffectIsValid, type FocusEffect, type TransitionTiming } from './FocusEffect.ts';
import type { ZoomEasingPreset, ZoomBezierCurve } from './ZoomAnimation.ts';

/**
 * Reusable appearance and transition settings, independent of clip placement,
 * identity and linked-camera groups.
 * Swift: `ScreenMotionCreationStyle`.
 */
export interface ScreenMotionCreationStyle {
  target: ScreenMotionState;
  focusEffect: FocusEffect | null;
  easing: ZoomEasingPreset;
  customCurve: ZoomBezierCurve;
  leadInDuration: number;
  returnDuration: number;
}

export function makeScreenMotionCreationStyleFromClip(
  clip: ScreenMotionClip,
): ScreenMotionCreationStyle {
  const leadIn = clip.timing.preferredLeadInDuration ?? clip.timing.leadInDuration;
  const ret =
    clip.timing.preferredReturnDuration ??
    (clip.timing.returnDuration > 0.000_1 ? clip.timing.returnDuration : max(0.7, 0));

  return {
    target: clip.target,
    focusEffect: clip.focusEffect ?? null,
    easing: clip.timing.easing,
    customCurve: clip.timing.customCurve,
    leadInDuration: leadIn,
    returnDuration: ret,
  };
}

export function screenMotionCreationStyleIsValid(style: ScreenMotionCreationStyle): boolean {
  const values = [
    style.target.position.x,
    style.target.position.y,
    style.target.scale,
    style.target.rotationX,
    style.target.rotationY,
    style.target.rotationZ,
    style.target.perspective,
    style.leadInDuration,
    style.returnDuration,
    style.customCurve.x1,
    style.customCurve.y1,
    style.customCurve.x2,
    style.customCurve.y2,
  ];

  if (!values.every((v) => Number.isFinite(v))) return false;
  if (style.target.position.x < 0 || style.target.position.x > 1) return false;
  if (style.target.position.y < 0 || style.target.position.y > 1) return false;
  if (!(style.target.scale > 0)) return false;
  if (style.target.perspective < 0) return false;
  if (style.leadInDuration < 0 || style.leadInDuration > 5) return false;
  if (style.returnDuration < 0 || style.returnDuration > 5) return false;
  if (style.focusEffect != null && !focusEffectIsValid(style.focusEffect)) return false;

  return true;
}

export function screenMotionCreationStyleCreateClip(
  style: ScreenMotionCreationStyle,
  baseTiming: TransitionTiming,
): ScreenMotionClip {
  const timing: TransitionTiming = {
    ...baseTiming,
    easing: style.easing,
    customCurve: style.customCurve,
    preferredLeadInDuration: style.leadInDuration,
    preferredReturnDuration: style.returnDuration,
    leadInDuration: min(style.leadInDuration, baseTiming.duration),
    returnDuration: min(style.returnDuration, baseTiming.returnDuration),
    leadInProgressOffset: 0,
    returnProgressOffset: 0,
  };

  return makeScreenMotionClip({
    timing,
    target: style.target,
    focusEffect: style.focusEffect,
  });
}

export const ScreenMotionCreationStyle = Object.freeze({
  fromClip: makeScreenMotionCreationStyleFromClip,
  isValid: screenMotionCreationStyleIsValid,
  createClip: screenMotionCreationStyleCreateClip,
});
