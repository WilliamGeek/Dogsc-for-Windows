// Port of: F:\dogsc\Sources\RecorderCore\AutoZoomPlanner.swift
import { clamp, max, min } from './swift.ts';
import { PointerEventTimelineOrdering } from './PointerEventTimelineOrdering.ts';
import {
  ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE,
  makeZoomAnimationClip,
  makeZoomKeyframe,
  normalizedPointConstrained,
  zoomAnimationClipDuration,
  zoomAnimationClipEffectEndTime,
  ZoomInterpolator,
  type PointerClick,
  type PointerEventRecord,
  type ZoomAnimationClip,
  type ZoomEasingPreset,
  type ZoomKeyframe,
  type NormalizedPoint,
} from './ZoomAnimation.ts';
import { makeMotionStyle, type MotionStyle } from './ProjectModel.ts';

// ---------------------------------------------------------------------------
// SpatialFocusGroup
// ---------------------------------------------------------------------------
class SpatialFocusGroup {
  readonly firstTime: number;
  private minimumX: number;
  private maximumX: number;
  private minimumY: number;
  private maximumY: number;

  constructor(click: PointerClick) {
    this.firstTime = click.time;
    this.minimumX = click.location.x;
    this.maximumX = click.location.x;
    this.minimumY = click.location.y;
    this.maximumY = click.location.y;
  }

  get focus(): NormalizedPoint {
    return {
      x: (this.minimumX + this.maximumX) / 2,
      y: (this.minimumY + this.maximumY) / 2,
    };
  }

  canInclude(
    click: PointerClick,
    maximumSpanX: number,
    maximumSpanY: number,
  ): boolean {
    return (
      max(this.maximumX, click.location.x) - min(this.minimumX, click.location.x) <=
        maximumSpanX &&
      max(this.maximumY, click.location.y) - min(this.minimumY, click.location.y) <=
        maximumSpanY
    );
  }

  append(click: PointerClick): void {
    this.minimumX = min(this.minimumX, click.location.x);
    this.maximumX = max(this.maximumX, click.location.x);
    this.minimumY = min(this.minimumY, click.location.y);
    this.maximumY = max(this.maximumY, click.location.y);
  }
}

function spatialFocusGroups(
  clicks: readonly PointerClick[],
  maximumSpanX: number,
  maximumSpanY: number,
): SpatialFocusGroup[] {
  const groups: SpatialFocusGroup[] = [];
  for (const click of clicks) {
    const last = groups.length > 0 ? groups[groups.length - 1] : null;
    if (last != null && last.canInclude(click, maximumSpanX, maximumSpanY)) {
      last.append(click);
    } else {
      groups.push(new SpatialFocusGroup(click));
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function orderedValidClicks(clicks: readonly PointerClick[]): PointerClick[] {
  let previousTime: number | null = null;
  let isAlreadyOrdered = true;
  for (const click of clicks) {
    if (!Number.isFinite(click.time) || click.time < 0) {
      isAlreadyOrdered = false;
      break;
    }
    if (previousTime != null && click.time < previousTime) {
      isAlreadyOrdered = false;
      break;
    }
    previousTime = click.time;
  }
  if (isAlreadyOrdered) return clicks.slice();
  return clicks
    .filter((c) => Number.isFinite(c.time) && c.time >= 0)
    .slice()
    .sort((a, b) => a.time - b.time);
}

function lastIndexAtOrBefore(time: number, clicks: readonly PointerClick[]): number | null {
  let lower = 0;
  let upper = clicks.length;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    if (clicks[middle].time <= time) {
      lower = middle + 1;
    } else {
      upper = middle;
    }
  }
  return lower === 0 ? null : lower - 1;
}

function firstIndexAfter(time: number, events: readonly PointerEventRecord[]): number {
  let lower = 0;
  let upper = events.length;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    if (events[middle].time <= time) {
      lower = middle + 1;
    } else {
      upper = middle;
    }
  }
  return lower;
}

function areCurvesEqual(a: ZoomAnimationClip['customCurve'], b: ZoomAnimationClip['customCurve']): boolean {
  return a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2;
}

function mergingConnectedAutomaticEnvelopes(
  animations: readonly ZoomAnimationClip[],
): ZoomAnimationClip[] {
  const ordered = animations.slice().sort((lhs, rhs) => {
    if (lhs.startTime === rhs.startTime) {
      return lhs.id < rhs.id ? -1 : lhs.id > rhs.id ? 1 : 0;
    }
    return lhs.startTime - rhs.startTime;
  });

  const result: ZoomAnimationClip[] = [];
  const tolerance = 0.000_001;

  for (const animation of ordered) {
    const previous = result.length > 0 ? result[result.length - 1] : null;
    if (
      previous != null &&
      previous.origin === 'automatic' &&
      animation.origin === 'automatic' &&
      previous.exitDuration <= ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE &&
      Math.abs(previous.endTime - animation.startTime) <= ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE &&
      Math.abs(previous.scale - animation.scale) <= tolerance &&
      previous.easing === animation.easing &&
      areCurvesEqual(previous.customCurve, animation.customCurve)
    ) {
      const merged: ZoomAnimationClip = {
        ...previous,
        endTime: max(previous.endTime, animation.endTime),
        exitDuration: animation.exitDuration,
      };
      result[result.length - 1] = merged;
    } else {
      result.push(animation);
    }
  }
  return result;
}

function extendingAutomaticHoldsThroughPointerActivity(
  planned: readonly ZoomAnimationClip[],
  clicks: readonly PointerClick[],
  pointerEvents: readonly PointerEventRecord[],
  activityIdleGap: number = 1.4,
  settleHold: number = 0.55,
): ZoomAnimationClip[] {
  if (planned.length === 0 || clicks.length === 0) return planned.slice();
  const normalizedEvents = PointerEventTimelineOrdering.normalized(pointerEvents);
  const orderedEvents = normalizedEvents.every((e) => e.time >= 0)
    ? normalizedEvents
    : normalizedEvents.filter((e) => e.time >= 0);
  const orderedClicks = orderedValidClicks(clicks);
  const result: ZoomAnimationClip[] = planned.map((c) => ({ ...c }));

  for (let index = 0; index < result.length; index++) {
    const clip = result[index];
    if (clip.exitDuration <= 0.001) continue;

    const lastClickIndex = lastIndexAtOrBefore(clip.endTime + 0.000_1, orderedClicks);
    if (lastClickIndex == null) continue;
    const lastClick = orderedClicks[lastClickIndex];
    if (lastClick.time < clip.startTime - 0.000_1) continue;

    const nextStart = index + 1 < result.length ? result[index + 1].startTime : Infinity;
    let previousActivityTime = lastClick.time;
    let activityEndTime = lastClick.time;
    let eventIndex = firstIndexAfter(lastClick.time, orderedEvents);

    while (eventIndex < orderedEvents.length) {
      const event = orderedEvents[eventIndex];
      if (event.time >= nextStart - 0.000_1) break;
      if (event.time - previousActivityTime > activityIdleGap) break;
      previousActivityTime = event.time;
      activityEndTime = event.time;
      eventIndex += 1;
    }

    if (!(activityEndTime > lastClick.time + 0.000_1)) continue;
    const extendedEnd = min(max(clip.endTime, activityEndTime + settleHold), nextStart);
    if (!(extendedEnd > clip.endTime + 0.000_1)) continue;

    result[index].endTime = extendedEnd;
    if (Number.isFinite(nextStart)) {
      result[index].exitDuration = min(result[index].exitDuration, max(nextStart - extendedEnd, 0));
    }
  }
  return result;
}

function matchesLegacyPlan(
  candidate: ZoomAnimationClip,
  expected: ZoomAnimationClip,
): boolean {
  const tolerance = 0.000_001;
  return (
    Math.abs(candidate.startTime - expected.startTime) <= tolerance &&
    Math.abs(candidate.endTime - expected.endTime) <= tolerance &&
    Math.abs(candidate.scale - expected.scale) <= tolerance &&
    Math.abs(candidate.focus.x - expected.focus.x) <= tolerance &&
    Math.abs(candidate.focus.y - expected.focus.y) <= tolerance &&
    candidate.easing === expected.easing &&
    areCurvesEqual(candidate.customCurve, expected.customCurve) &&
    Math.abs(candidate.enterDuration - expected.enterDuration) <= tolerance &&
    Math.abs(candidate.exitDuration - expected.exitDuration) <= tolerance
  );
}

function matchesSourceClampedAutomaticPlan(
  candidates: readonly ZoomAnimationClip[],
  expected: readonly ZoomAnimationClip[],
): boolean {
  if (candidates.length !== expected.length || candidates.length === 0) return false;
  const candidateLast = candidates[candidates.length - 1];
  const expectedLast = expected[expected.length - 1];
  const tolerance = 0.000_001;

  for (let i = 0; i < candidates.length - 1; i++) {
    if (!matchesLegacyPlan(candidates[i], expected[i])) return false;
  }

  return (
    Math.abs(candidateLast.startTime - expectedLast.startTime) <= tolerance &&
    candidateLast.endTime > candidateLast.startTime &&
    candidateLast.endTime < zoomAnimationClipEffectEndTime(expectedLast) - tolerance &&
    Math.abs(candidateLast.scale - expectedLast.scale) <= tolerance &&
    Math.abs(candidateLast.focus.x - expectedLast.focus.x) <= tolerance &&
    Math.abs(candidateLast.focus.y - expectedLast.focus.y) <= tolerance &&
    candidateLast.easing === expectedLast.easing &&
    areCurvesEqual(candidateLast.customCurve, expectedLast.customCurve) &&
    Math.abs(candidateLast.enterDuration - expectedLast.enterDuration) <= tolerance &&
    candidateLast.exitDuration <= tolerance
  );
}

function makePerClickLegacyAnimations(
  clicks: readonly PointerClick[],
  zoomScale: number = 1.6,
  enterDuration: number = 0.42,
  holdDuration: number = 0.9,
  exitDuration: number = 0.44,
  clickGroupGap: number = 1.4,
  safeInset: number = 0.12,
  easing: ZoomEasingPreset = '三次方缓动',
): ZoomAnimationClip[] {
  const ordered = orderedValidClicks(clicks);
  const groups: PointerClick[][] = [];
  for (const click of ordered) {
    const lastGroup = groups.length > 0 ? groups[groups.length - 1] : null;
    const previous = lastGroup != null && lastGroup.length > 0 ? lastGroup[lastGroup.length - 1] : null;
    if (previous != null && click.time - previous.time <= clickGroupGap) {
      lastGroup!.push(click);
    } else {
      groups.push([click]);
    }
  }

  const result: ZoomAnimationClip[] = [];
  let earliestNextStart = 0;
  for (const group of groups) {
    if (group.length === 0) continue;
    const first = group[0];
    const last = group[group.length - 1];
    const starts: number[] = [max(first.time - enterDuration * 0.18, earliestNextStart, 0)];
    for (let i = 1; i < group.length; i++) {
      const click = group[i];
      starts.push(max(click.time - enterDuration, starts[starts.length - 1] + 0.16));
    }
    for (let index = 0; index < group.length; index++) {
      const isLast = index === group.length - 1;
      const end = isLast
        ? max(last.time + holdDuration, starts[index] + enterDuration)
        : starts[index + 1];
      result.push(
        makeZoomAnimationClip({
          startTime: starts[index],
          endTime: end,
          scale: zoomScale,
          focus: normalizedPointConstrained(group[index].location, safeInset),
          origin: 'automatic',
          easing,
          enterDuration,
          exitDuration: isLast ? exitDuration : 0,
        }),
      );
    }
    const lastClip = result.length > 0 ? result[result.length - 1] : null;
    earliestNextStart = lastClip != null ? zoomAnimationClipEffectEndTime(lastClip) : last.time;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API Functions (Swift: AutoZoomPlanner)
// ---------------------------------------------------------------------------

/**
 * Plans automatic zoom clips for a sequence of pointer click events.
 * Swift: `AutoZoomPlanner.makeAnimations(for clicks: [PointerClick], ...)`.
 */
export function makeAnimationsFromClicks(
  clicks: readonly PointerClick[],
  options: {
    zoomScale?: number;
    enterDuration?: number;
    holdDuration?: number;
    exitDuration?: number;
    clickGroupGap?: number;
    safeInset?: number;
    easing?: ZoomEasingPreset;
  } = {},
): ZoomAnimationClip[] {
  const zoomScale = options.zoomScale ?? 1.6;
  const enterDuration = options.enterDuration ?? 0.7;
  const holdDuration = options.holdDuration ?? 0.9;
  const exitDuration = options.exitDuration ?? 0.7;
  const clickGroupGap = options.clickGroupGap ?? 1.4;
  const safeInset = options.safeInset ?? 0.12;
  const easing = options.easing ?? '弹簧';

  const ordered = orderedValidClicks(clicks);
  const temporalGroups: PointerClick[][] = [];
  for (const click of ordered) {
    const lastGroup =
      temporalGroups.length > 0 ? temporalGroups[temporalGroups.length - 1] : null;
    const previous =
      lastGroup != null && lastGroup.length > 0 ? lastGroup[lastGroup.length - 1] : null;
    if (previous != null && click.time - previous.time <= clickGroupGap) {
      lastGroup!.push(click);
    } else {
      temporalGroups.push([click]);
    }
  }

  const animations: ZoomAnimationClip[] = [];
  let earliestNextStart = 0;

  for (const temporalGroup of temporalGroups) {
    if (temporalGroup.length === 0) continue;
    const first = temporalGroup[0];
    const last = temporalGroup[temporalGroup.length - 1];

    const visibleExtent = 1 / max(zoomScale, 1);
    const focusGroups = spatialFocusGroups(
      temporalGroup,
      visibleExtent * 0.50,
      visibleExtent * 0.70,
    );
    if (focusGroups.length === 0) continue;

    const starts: number[] = [];
    starts.push(max(first.time - enterDuration * 0.18, earliestNextStart, 0));
    for (let i = 1; i < focusGroups.length; i++) {
      const focusGroup = focusGroups[i];
      const minimumStart = starts[starts.length - 1] + 0.16;
      starts.push(max(focusGroup.firstTime - enterDuration, minimumStart));
    }

    for (let index = 0; index < focusGroups.length; index++) {
      const start = starts[index];
      const isLast = index === focusGroups.length - 1;
      const end = isLast
        ? max(last.time + holdDuration, start + enterDuration)
        : starts[index + 1];
      if (!(end - start > 0.01)) continue;

      animations.push(
        makeZoomAnimationClip({
          startTime: start,
          endTime: end,
          scale: zoomScale,
          focus: normalizedPointConstrained(focusGroups[index].focus, safeInset),
          origin: 'automatic',
          easing,
          enterDuration,
          exitDuration: isLast ? exitDuration : 0,
        }),
      );
    }

    const lastAnim = animations.length > 0 ? animations[animations.length - 1] : null;
    earliestNextStart = lastAnim != null ? zoomAnimationClipEffectEndTime(lastAnim) : last.time;
  }

  return animations;
}

/**
 * Plans automatic zoom clips for a timeline of raw pointer event records.
 * Swift: `AutoZoomPlanner.makeAnimations(for pointerEvents: [PointerEventRecord], ...)`.
 */
export function makeAnimationsFromPointerEvents(
  pointerEvents: readonly PointerEventRecord[],
  options: {
    zoomScale?: number;
    easing?: ZoomEasingPreset;
    transitionDuration?: number;
  } = {},
): ZoomAnimationClip[] {
  const zoomScale = options.zoomScale ?? 1.6;
  const easing = options.easing ?? '弹簧';
  const transitionDuration = options.transitionDuration ?? 0.7;

  const clicks: PointerClick[] = [];
  for (const event of pointerEvents) {
    if (event.kind === 'leftClick' || event.kind === 'rightClick') {
      clicks.push({ time: event.time, location: event.location });
    }
  }

  const duration = clamp(transitionDuration, 0, 5);
  const planned = makeAnimationsFromClicks(clicks, {
    zoomScale,
    enterDuration: duration,
    exitDuration: duration,
    easing,
  });

  const extended = extendingAutomaticHoldsThroughPointerActivity(
    planned,
    clicks,
    pointerEvents,
  );

  return mergingConnectedAutomaticEnvelopes(extended);
}

/**
 * Repairs legacy automatic animation tracks without mutating manual edits.
 * Swift: `AutoZoomPlanner.repairingLegacyAutomaticAnimations`.
 */
export function repairingLegacyAutomaticAnimations(
  animations: readonly ZoomAnimationClip[],
  pointerEvents: readonly PointerEventRecord[],
  easing: ZoomEasingPreset = '三次方缓动',
  transitionDuration: number = 0.7,
): ZoomAnimationClip[] {
  if (animations.length === 0 || !animations.every((a) => a.origin === 'automatic')) {
    return animations.slice();
  }

  const clicks: PointerClick[] = [];
  for (const event of pointerEvents) {
    if (event.kind === 'leftClick' || event.kind === 'rightClick') {
      clicks.push({ time: event.time, location: event.location });
    }
  }

  const legacyEasings: ZoomEasingPreset[] = [easing];
  if (easing !== '三次方缓动') {
    legacyEasings.push('三次方缓动');
  }

  const currentDuration = clamp(transitionDuration, 0, 5);
  const matchesExpectedPlan = (expected: readonly ZoomAnimationClip[]): boolean => {
    return (
      expected.length === animations.length &&
      (expected.every((exp, idx) => matchesLegacyPlan(animations[idx], exp)) ||
        matchesSourceClampedAutomaticPlan(animations, expected))
    );
  };

  const currentSegmentedPlans: ZoomAnimationClip[][] = [];
  for (const legacyEasing of legacyEasings) {
    const currentSegmented = makeAnimationsFromClicks(clicks, {
      enterDuration: currentDuration,
      exitDuration: currentDuration,
      easing: legacyEasing,
    });
    const activityExtendedCurrentSegmented =
      extendingAutomaticHoldsThroughPointerActivity(
        currentSegmented,
        clicks,
        pointerEvents,
      );
    currentSegmentedPlans.push(currentSegmented);
    currentSegmentedPlans.push(activityExtendedCurrentSegmented);
  }

  if (currentSegmentedPlans.some(matchesExpectedPlan)) {
    return mergingConnectedAutomaticEnvelopes(animations).map((clip) => ({
      ...clip,
      easing,
    }));
  }

  const knownLegacyPlans: ZoomAnimationClip[][] = [];
  for (const legacyEasing of legacyEasings) {
    const currentLegacy = makeAnimationsFromClicks(clicks, {
      enterDuration: 0.42,
      exitDuration: 0.44,
      easing: legacyEasing,
    });
    const perClickLegacy = makePerClickLegacyAnimations(
      clicks,
      1.6,
      0.42,
      0.9,
      0.44,
      1.4,
      0.12,
      legacyEasing,
    );
    const activityExtendedCurrentLegacy =
      extendingAutomaticHoldsThroughPointerActivity(
        currentLegacy,
        clicks,
        pointerEvents,
      );
    const activityExtendedPerClickLegacy =
      extendingAutomaticHoldsThroughPointerActivity(
        perClickLegacy,
        clicks,
        pointerEvents,
      );
    knownLegacyPlans.push(
      currentLegacy,
      activityExtendedCurrentLegacy,
      perClickLegacy,
      activityExtendedPerClickLegacy,
    );
  }

  const matchesKnownAutomaticPlanner = knownLegacyPlans.some(matchesExpectedPlan);
  if (!matchesKnownAutomaticPlanner) return animations.slice();

  const regrouped = makeAnimationsFromClicks(clicks, {
    enterDuration: currentDuration,
    exitDuration: currentDuration,
    easing,
  });
  const extended = extendingAutomaticHoldsThroughPointerActivity(
    regrouped,
    clicks,
    pointerEvents,
  );
  return mergingConnectedAutomaticEnvelopes(extended);
}

/**
 * Clips zoom animation clips to an output duration.
 * Swift: `AutoZoomPlanner.clipped(_:to:)` for [ZoomAnimationClip].
 */
export function clippedAnimations(
  animations: readonly ZoomAnimationClip[],
  duration: number,
): ZoomAnimationClip[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const result: ZoomAnimationClip[] = [];
  for (const animation of animations) {
    if (animation.startTime >= duration) continue;
    const endTime = min(animation.endTime, duration);
    const exitDuration = min(animation.exitDuration, max(duration - endTime, 0));
    if (endTime - animation.startTime > 0.01) {
      result.push({
        ...animation,
        endTime,
        exitDuration,
      });
    }
  }
  return result;
}

/**
 * Clips zoom keyframes to an output duration, sampling the exact boundary state.
 * Swift: `AutoZoomPlanner.clipped(_:to:motion:)` for [ZoomKeyframe].
 */
export function clippedKeyframes(
  keyframes: readonly ZoomKeyframe[],
  duration: number,
  motion: MotionStyle = makeMotionStyle(),
): ZoomKeyframe[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const endSample = ZoomInterpolator.sampleKeyframes(keyframes, duration, motion);
  const clipped = keyframes.filter((k) => k.time >= 0 && k.time < duration).slice();
  clipped.push(
    makeZoomKeyframe({
      time: duration,
      scale: endSample.scale,
      focus: endSample.focus,
    }),
  );
  return clipped.sort((a, b) => a.time - b.time);
}

/**
 * Legacy keyframe generation from clicks.
 * Swift: `AutoZoomPlanner.makeKeyframes(for clicks: [PointerClick], ...)`.
 */
export function makeKeyframesFromClicks(
  clicks: readonly PointerClick[],
  options: {
    baseScale?: number;
    zoomScale?: number;
    enterDuration?: number;
    holdDuration?: number;
    exitDuration?: number;
    clickGroupGap?: number;
    safeInset?: number;
  } = {},
): ZoomKeyframe[] {
  const baseScale = options.baseScale ?? 1;
  const zoomScale = options.zoomScale ?? 1.6;
  const enterDuration = options.enterDuration ?? 0.42;
  const holdDuration = options.holdDuration ?? 0.9;
  const exitDuration = options.exitDuration ?? 0.44;
  const clickGroupGap = options.clickGroupGap ?? 1.4;
  const safeInset = options.safeInset ?? 0.12;

  const center: NormalizedPoint = { x: 0.5, y: 0.5 };
  const keyframes: ZoomKeyframe[] = [
    makeZoomKeyframe({ time: 0, scale: baseScale, focus: center }),
  ];

  const orderedClicks = clicks.slice().sort((a, b) => a.time - b.time);
  const groups: PointerClick[][] = [];
  for (const click of orderedClicks) {
    const lastGroup = groups.length > 0 ? groups[groups.length - 1] : null;
    const previous =
      lastGroup != null && lastGroup.length > 0 ? lastGroup[lastGroup.length - 1] : null;
    if (previous != null && click.time - previous.time <= clickGroupGap) {
      lastGroup!.push(click);
    } else {
      groups.push([click]);
    }
  }

  for (const group of groups) {
    if (group.length === 0) continue;
    const first = group[0];
    const last = group[group.length - 1];
    const firstFocus = normalizedPointConstrained(first.location, safeInset);
    const start = max(first.time - enterDuration * 0.18, 0);
    const zoomed = start + enterDuration;
    const release = max(last.time + holdDuration, zoomed + holdDuration);

    keyframes.push(makeZoomKeyframe({ time: start, scale: baseScale, focus: firstFocus }));
    keyframes.push(makeZoomKeyframe({ time: zoomed, scale: zoomScale, focus: firstFocus }));

    for (let i = 1; i < group.length; i++) {
      const click = group[i];
      keyframes.push(
        makeZoomKeyframe({
          time: max(click.time, zoomed),
          scale: zoomScale,
          focus: normalizedPointConstrained(click.location, safeInset),
        }),
      );
    }

    keyframes.push(
      makeZoomKeyframe({
        time: release,
        scale: zoomScale,
        focus: normalizedPointConstrained(last.location, safeInset),
      }),
    );
    keyframes.push(
      makeZoomKeyframe({ time: release + exitDuration, scale: baseScale, focus: center }),
    );
  }

  return keyframes.sort((a, b) => a.time - b.time);
}

/**
 * Legacy keyframe generation from pointer events.
 * Swift: `AutoZoomPlanner.makeKeyframes(for pointerEvents: [PointerEventRecord], ...)`.
 */
export function makeKeyframesFromPointerEvents(
  pointerEvents: readonly PointerEventRecord[],
  options: {
    baseScale?: number;
    zoomScale?: number;
  } = {},
): ZoomKeyframe[] {
  const clicks: PointerClick[] = [];
  for (const event of pointerEvents) {
    if (event.kind === 'leftClick' || event.kind === 'rightClick') {
      clicks.push({ time: event.time, location: event.location });
    }
  }
  return makeKeyframesFromClicks(clicks, options);
}

export const AutoZoomPlanner = Object.freeze({
  makeAnimationsFromPointerEvents,
  makeAnimationsFromClicks,
  repairingLegacyAutomaticAnimations,
  clippedAnimations,
  clippedKeyframes,
  makeKeyframesFromPointerEvents,
  makeKeyframesFromClicks,
});
