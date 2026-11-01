// Port of: F:\dogsc\Sources\RecorderCore\EditorTimeline.swift

import { min, max, clamp, newUUID } from './swift.ts';
import {
  type ZoomAnimationClip,
  makeZoomAnimationClip,
  type ZoomKeyframeOrigin,
  type ZoomEasingPreset,
  type ZoomKeyframe,
  makeZoomKeyframe,
  type NormalizedPoint,
  ZoomInterpolator,
  ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE,
} from './ZoomAnimation.ts';
import {
  type TransitionTiming,
  makeTransitionTiming,
} from './ProjectTimeline.ts';

// MARK: - TimelineZoomSegment

export interface TimelineZoomSegment {
  readonly id: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly scale: number;
  readonly origin: ZoomKeyframeOrigin;
  readonly representativeKeyframeID: string;
  readonly easing: ZoomEasingPreset;
  readonly enterDuration: number;
  readonly exitDuration: number;
}

export function makeTimelineZoomSegment(options: {
  id?: string;
  startTime: number;
  endTime: number;
  scale: number;
  origin: ZoomKeyframeOrigin;
  representativeKeyframeID?: string;
  easing?: ZoomEasingPreset;
  enterDuration?: number;
  exitDuration?: number;
}): TimelineZoomSegment {
  const id = options.id ?? newUUID();
  return {
    id,
    startTime: options.startTime,
    endTime: options.endTime,
    scale: options.scale,
    origin: options.origin,
    representativeKeyframeID: options.representativeKeyframeID ?? id,
    easing: options.easing ?? '三次方缓动',
    enterDuration: options.enterDuration ?? 0.7,
    exitDuration: options.exitDuration ?? 0.7,
  };
}

// MARK: - ZoomTrackHitZone

export type ZoomTrackHitZone =
  | { readonly kind: 'empty' }
  | { readonly kind: 'move'; readonly id: string }
  | { readonly kind: 'resize'; readonly id: string; readonly leading: boolean };

export const ZoomTrackHitZoneEmpty: ZoomTrackHitZone = Object.freeze({ kind: 'empty' });

export function makeZoomTrackHitZoneMove(id: string): ZoomTrackHitZone {
  return { kind: 'move', id };
}

export function makeZoomTrackHitZoneResize(id: string, leading: boolean): ZoomTrackHitZone {
  return { kind: 'resize', id, leading };
}

// MARK: - EditorTimelineMath Helpers

function zoomAnimationPrecedes(lhs: ZoomAnimationClip, rhs: ZoomAnimationClip): boolean {
  return lhs.startTime === rhs.startTime ? lhs.id < rhs.id : lhs.startTime < rhs.startTime;
}

function motionTimingPrecedes(
  lhs: { id: string; timing: TransitionTiming },
  rhs: { id: string; timing: TransitionTiming }
): boolean {
  return lhs.timing.startTime === rhs.timing.startTime
    ? lhs.id < rhs.id
    : lhs.timing.startTime < rhs.timing.startTime;
}

function motionItemPrecedes<Element>(
  lhs: Element,
  rhs: Element,
  id: (element: Element) => string,
  timing: (element: Element) => TransitionTiming
): boolean {
  const lhsTiming = timing(lhs);
  const rhsTiming = timing(rhs);
  return lhsTiming.startTime === rhsTiming.startTime
    ? id(lhs) < id(rhs)
    : lhsTiming.startTime < rhsTiming.startTime;
}

function creationNeighbours<Element>(
  rawStart: number,
  items: readonly Element[],
  startTime: (element: Element) => number,
  itemsAreOrdered: boolean
): { previous: Element | null; next: Element | null } {
  if (itemsAreOrdered) {
    let lower = 0;
    let upper = items.length;
    while (lower < upper) {
      const middle = lower + Math.floor((upper - lower) / 2);
      if (startTime(items[middle]) <= rawStart + 0.0001) {
        lower = middle + 1;
      } else {
        upper = middle;
      }
    }
    return {
      previous: lower > 0 ? items[lower - 1] : null,
      next: lower < items.length ? items[lower] : null,
    };
  }

  let previous: Element | null = null;
  let previousStart = -Number.POSITIVE_INFINITY;
  for (const item of items) {
    const candidateStart = startTime(item);
    if (candidateStart <= rawStart + 0.0001 && candidateStart >= previousStart) {
      previous = item;
      previousStart = candidateStart;
    }
  }

  const threshold = previous ? startTime(previous) : -1;
  let next: Element | null = null;
  let nextStart = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const candidateStart = startTime(item);
    if (candidateStart > threshold + 0.0001 && candidateStart < nextStart) {
      next = item;
      nextStart = candidateStart;
    }
  }
  return { previous, next };
}

function lastItemStartingAtOrBefore<Element>(
  x: number,
  items: readonly Element[],
  startX: (element: Element) => number
): number | null {
  let lower = 0;
  let upper = items.length;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    if (startX(items[middle]) <= x) {
      lower = middle + 1;
    } else {
      upper = middle;
    }
  }
  return lower > 0 ? lower - 1 : null;
}

function zoomAnimationNeighbours(
  animation: ZoomAnimationClip,
  animations: readonly ZoomAnimationClip[]
): { previous: ZoomAnimationClip | null; next: ZoomAnimationClip | null } {
  var previous: ZoomAnimationClip | null = null;
  var next: ZoomAnimationClip | null = null;
  for (const candidate of animations) {
    if (candidate.id === animation.id) continue;
    if (candidate.startTime < animation.startTime - 0.0001) {
      if (previous == null || zoomAnimationPrecedes(previous, candidate)) {
        previous = candidate;
      }
    } else if (candidate.startTime >= animation.endTime - 0.0001) {
      if (next == null || zoomAnimationPrecedes(candidate, next)) {
        next = candidate;
      }
    }
  }
  return { previous, next };
}

// MARK: - EditorTimelineMath Functions

export function fitZoomAnimation(options: {
  start: number;
  end: number;
  among: readonly ZoomAnimationClip[];
  duration: number;
  scale?: number;
  focus?: NormalizedPoint;
  origin?: ZoomKeyframeOrigin;
  easing?: ZoomEasingPreset;
  transitionDuration?: number;
}): ZoomAnimationClip | null {
  const { start, end, among: animations, duration } = options;
  const scale = options.scale ?? 1.6;
  const focus = options.focus ?? { x: 0.5, y: 0.5 };
  const origin = options.origin ?? 'automatic';
  const easing = options.easing ?? '三次方缓动';
  const transitionDuration = options.transitionDuration ?? 0.7;

  if (!Number.isFinite(duration) || duration <= 0) return null;
  const rawStart = min(max(min(start, end), 0), duration);
  const { previous, next } = creationNeighbours(
    rawStart,
    animations,
    a => a.startTime,
    false
  );
  const lowerTouch = previous ? previous.endTime : 0;
  const lowerClear = previous
    ? previous.endTime + effectiveExitDuration(previous, transitionDuration)
    : 0;
  const upper = next ? next.startTime : duration;
  if (upper - lowerTouch <= 0.001) return null;

  const minimumDuration = 0.08;
  let s = min(max(min(start, end), lowerTouch), upper);
  // 起点落入洞口：吸到与前一段相接。
  if (s < lowerClear) s = lowerTouch;
  const isClick = Math.abs(end - start) < 0.08;
  const requestedLength = isClick
    ? min(1.5, max(duration * 0.2, 0.6))
    : max(Math.abs(end - start), minimumDuration);

  let e = s + requestedLength;
  if (e > upper) {
    e = upper;
    const shifted = max(e - requestedLength, lowerTouch);
    if (upper - shifted >= minimumDuration) {
      s = shifted;
    } else {
      s = lowerTouch;
    }
  }
  if (e - s < minimumDuration - 0.0001 || e - s <= 0.001) return null;
  const fittedExit = min(transitionDuration, max(upper - e, 0));
  return makeZoomAnimationClip({
    startTime: s,
    endTime: e,
    scale,
    focus,
    origin,
    easing,
    enterDuration: transitionDuration,
    exitDuration: fittedExit,
    preferredEnterDuration: transitionDuration,
    preferredExitDuration: transitionDuration,
  });
}

export function manualZoomAnimation(options: {
  start: number;
  end: number;
  duration: number;
  scale?: number;
  focus?: NormalizedPoint;
  easing?: ZoomEasingPreset;
  transitionDuration?: number;
}): ZoomAnimationClip | null {
  const { start, end, duration } = options;
  const scale = options.scale ?? 1.6;
  const focus = options.focus ?? { x: 0.5, y: 0.5 };
  const easing = options.easing ?? '三次方缓动';
  const transitionDuration = options.transitionDuration ?? 0.7;

  if (!Number.isFinite(duration) || duration <= 0) return null;
  const rawStart = min(max(min(start, end), 0), duration);
  const draggedDuration = Math.abs(end - start);
  const requestedEnd =
    draggedDuration < 0.08
      ? min(rawStart + min(1.5, max(duration * 0.2, 0.6)), duration)
      : min(max(max(start, end), 0), duration);
  const minimumDuration = min(0.24, max(duration - rawStart, 0));
  const rangeEnd = min(max(requestedEnd, rawStart + minimumDuration), duration);
  if (rangeEnd - rawStart <= 0.01) return null;

  return makeZoomAnimationClip({
    startTime: rawStart,
    endTime: rangeEnd,
    scale,
    focus,
    origin: 'manual',
    easing,
    enterDuration: transitionDuration,
    exitDuration: transitionDuration,
  });
}

export function manualZoomRangeKeyframes(options: {
  start: number;
  end: number;
  duration: number;
  scale?: number;
  focus?: NormalizedPoint;
}): ZoomKeyframe[] {
  const { start, end, duration } = options;
  const scale = options.scale ?? 1.6;
  const focus = options.focus ?? { x: 0.5, y: 0.5 };

  if (!Number.isFinite(duration) || duration <= 0) return [];
  const rawStart = min(max(min(start, end), 0), duration);
  const draggedDuration = Math.abs(end - start);
  const requestedEnd =
    draggedDuration < 0.08
      ? min(rawStart + min(1.5, max(duration * 0.2, 0.6)), duration)
      : min(max(max(start, end), 0), duration);
  const minimumDuration = min(0.6, max(duration - rawStart, 0));
  const rangeEnd = min(max(requestedEnd, rawStart + minimumDuration), duration);
  if (rangeEnd - rawStart <= 0.01) return [];

  const transition = min(0.28, (rangeEnd - rawStart) * 0.3);
  const zoomInTime = rawStart + transition;
  const zoomOutTime = max(rangeEnd - transition, zoomInTime + 0.001);
  return [
    makeZoomKeyframe({ time: rawStart, scale: 1, focus, origin: 'manual' }),
    makeZoomKeyframe({ time: zoomInTime, scale: max(scale, 1), focus, origin: 'manual' }),
    makeZoomKeyframe({ time: zoomOutTime, scale: max(scale, 1), focus, origin: 'manual' }),
    makeZoomKeyframe({ time: rangeEnd, scale: 1, focus, origin: 'manual' }),
  ];
}

export function clampedTime(x: number, width: number, duration: number): number {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(duration) || duration <= 0) {
    return 0;
  }
  return min(max(x / width, 0), 1) * duration;
}

export function xPosition(time: number, width: number, duration: number): number {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(duration) || duration <= 0) {
    return 0;
  }
  return min(max(time / duration, 0), 1) * width;
}

export function zoomSegments(
  animations: readonly ZoomAnimationClip[],
  duration: number
): TimelineZoomSegment[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  return animations
    .filter(a => Number.isFinite(a.startTime) && Number.isFinite(a.endTime) && a.endTime > a.startTime)
    .map(clip =>
      makeTimelineZoomSegment({
        id: clip.id,
        startTime: min(max(clip.startTime, 0), duration),
        endTime: min(max(clip.endTime, 0), duration),
        scale: clip.scale,
        origin: clip.origin,
        representativeKeyframeID: clip.id,
        easing: clip.easing,
        enterDuration: clip.enterDuration,
        exitDuration: clip.exitDuration,
      })
    )
    .filter(seg => seg.endTime - seg.startTime > 0.001)
    .sort((a, b) => (a.startTime === b.startTime ? a.id.localeCompare(b.id) : a.startTime - b.startTime));
}

export function splitZoomAnimation(
  animation: ZoomAnimationClip,
  time: number,
  minimumDuration: number = 0.16
): [ZoomAnimationClip, ZoomAnimationClip] | null {
  const splitTime = min(max(time, animation.startTime), animation.endTime);
  if (
    splitTime - animation.startTime < minimumDuration ||
    animation.endTime - splitTime < minimumDuration
  ) {
    return null;
  }
  animation.preserveTransitionIntent();
  const left = makeZoomAnimationClip({
    ...animation,
    endTime: splitTime,
    exitDuration: 0,
  });

  const right = makeZoomAnimationClip({
    ...animation,
    id: newUUID(),
    startTime: splitTime,
    enterDuration: max(animation.enterDuration, 0.15),
  });
  return [left, right];
}

export function zoomSequenceIsValid(
  previous: ZoomAnimationClip,
  next: ZoomAnimationClip,
  previousExit?: number | null
): boolean {
  if (next.startTime < previous.endTime - 0.0001) return false;
  if (next.startTime - previous.endTime <= ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE) {
    return true;
  }
  const exit = previousExit ?? previous.exitDuration;
  return next.startTime >= previous.endTime + exit - 0.0001;
}

export function effectiveExitDuration(clip: ZoomAnimationClip, defaultExit: number): number {
  return clip.requestedExitDuration(defaultExit);
}

export function exitNormalizations(
  id: string,
  animations: readonly ZoomAnimationClip[],
  defaultExit: number
): ZoomAnimationClip[] {
  const edited = animations.find(a => a.id === id);
  if (!edited) return [];
  let predecessor: ZoomAnimationClip | null = null;
  let successor: ZoomAnimationClip | null = null;
  for (const candidate of animations) {
    if (candidate.id === id) continue;
    if (zoomAnimationPrecedes(candidate, edited)) {
      if (predecessor == null || zoomAnimationPrecedes(predecessor, candidate)) {
        predecessor = candidate;
      }
    } else if (successor == null || zoomAnimationPrecedes(candidate, successor)) {
      successor = candidate;
    }
  }

  const patches: ZoomAnimationClip[] = [];
  function appendPatch(clip: ZoomAnimationClip, next: ZoomAnimationClip | null): void {
    const touchesSuccessor = next
      ? Math.abs(next.startTime - clip.endTime) <= ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE
      : false;
    if (touchesSuccessor) return;
    const requested = clip.requestedExitDuration(defaultExit);
    const available = next ? next.startTime - clip.endTime : requested;
    let exitDuration = min(requested, max(available, 0));
    let exitProgressOffset = clip.exitProgressOffset;
    if (exitDuration > clip.exitDuration + 0.000001) {
      exitProgressOffset = 0;
    }
    if (exitDuration !== clip.exitDuration || exitProgressOffset !== clip.exitProgressOffset) {
      const patched = makeZoomAnimationClip({
        ...clip,
        exitDuration,
        exitProgressOffset,
      });
      patches.push(patched);
    }
  }

  if (predecessor) appendPatch(predecessor, edited);
  appendPatch(edited, successor);
  return patches;
}

export function movingZoomAnimation(
  animation: ZoomAnimationClip,
  proposedStart: number,
  animations: readonly ZoomAnimationClip[],
  duration: number,
  defaultExit: number = 0.7
): ZoomAnimationClip {
  const { previous, next } = zoomAnimationNeighbours(animation, animations);
  const previousEnd = previous ? previous.endTime : 0;
  const previousClear = previousEnd + (previous ? effectiveExitDuration(previous, defaultExit) : 0);
  const nextStart = next ? next.startTime : duration;
  const ownExit = effectiveExitDuration(animation, defaultExit);
  const touchStart = nextStart - animation.duration;
  if (touchStart < previousEnd - 0.0001) return animation;

  function isValid(start: number): boolean {
    const touchesPrevious = start <= previousEnd + ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE;
    const clearsPrevious = start >= previousClear - 0.0001;
    const end = start + animation.duration;
    const touchesNext = nextStart - end <= ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE;
    const clearsNext = end + ownExit <= nextStart + 0.0001;
    return (touchesPrevious || clearsPrevious) && (touchesNext || clearsNext);
  }

  let start = min(max(proposedStart, previousEnd), touchStart);
  if (!isValid(start)) {
    const candidates = [
      previousEnd,
      previousClear,
      touchStart,
      touchStart - ownExit,
    ].filter(s => isValid(s) && s >= previousEnd - 0.0001 && s <= touchStart + 0.0001);
    if (candidates.length === 0) return animation;
    candidates.sort((a, b) => Math.abs(a - proposedStart) - Math.abs(b - proposedStart));
    start = candidates[0];
  }

  const moved = makeZoomAnimationClip({
    ...animation,
    startTime: start,
    endTime: start + animation.duration,
    enterProgressOffset: Math.abs(start - animation.startTime) > 0.000001 ? 0 : animation.enterProgressOffset,
    exitProgressOffset: Math.abs(start - animation.startTime) > 0.000001 ? 0 : animation.exitProgressOffset,
  });
  if (Math.abs(start - animation.startTime) > 0.000001) {
    moved.preserveTransitionIntent(defaultExit);
  }
  return moved;
}

export function resizingZoomAnimation(options: {
  animation: ZoomAnimationClip;
  proposedStart?: number | null;
  proposedEnd?: number | null;
  among: readonly ZoomAnimationClip[];
  duration: number;
  minimumDuration?: number;
  defaultExit?: number;
}): ZoomAnimationClip {
  const { animation, proposedStart, proposedEnd, among: animations, duration } = options;
  const minimumDuration = options.minimumDuration ?? 0.16;
  const defaultExit = options.defaultExit ?? 0.7;

  const { previous, next } = zoomAnimationNeighbours(animation, animations);
  const previousEnd = previous ? previous.endTime : 0;
  const previousClear = previousEnd + (previous ? effectiveExitDuration(previous, defaultExit) : 0);
  const nextStart = next ? next.startTime : duration;
  const ownExit = effectiveExitDuration(animation, defaultExit);

  let currentStart = animation.startTime;
  let currentEnd = animation.endTime;
  let enterProgressOffset = animation.enterProgressOffset;
  let exitProgressOffset = animation.exitProgressOffset;

  if (proposedStart != null) {
    const lowerBound = previousEnd;
    const upperBound = animation.endTime - minimumDuration;
    function isValid(start: number): boolean {
      if (start > upperBound + 0.0001) return false;
      return (
        start <= previousEnd + ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE ||
        start >= previousClear - 0.0001
      );
    }
    let start = min(max(proposedStart, lowerBound), max(upperBound, lowerBound));
    if (!isValid(start)) {
      const candidates = [previousEnd, previousClear, upperBound].filter(
        s => isValid(s) && s >= lowerBound - 0.0001
      );
      if (candidates.length > 0) {
        candidates.sort((a, b) => Math.abs(a - proposedStart) - Math.abs(b - proposedStart));
        start = candidates[0];
      } else {
        start = animation.startTime;
      }
    }
    currentStart = start;
    if (Math.abs(start - animation.startTime) > 0.000001) {
      enterProgressOffset = 0;
    }
  }

  if (proposedEnd != null) {
    const lowerBound = currentStart + minimumDuration;
    const upperBound = nextStart;
    function isValid(end: number): boolean {
      if (end < lowerBound - 0.0001) return false;
      return (
        nextStart - end <= ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE ||
        end + ownExit <= nextStart + 0.0001
      );
    }
    let end = min(max(proposedEnd, lowerBound), max(upperBound, lowerBound));
    if (!isValid(end)) {
      const candidates = [nextStart, nextStart - ownExit, lowerBound].filter(
        e => isValid(e) && e <= upperBound + 0.0001
      );
      if (candidates.length > 0) {
        candidates.sort((a, b) => Math.abs(a - proposedEnd) - Math.abs(b - proposedEnd));
        end = candidates[0];
      } else {
        end = animation.endTime;
      }
    }
    currentEnd = end;
    if (Math.abs(end - animation.endTime) > 0.000001) {
      exitProgressOffset = 0;
    }
  }

  const resized = makeZoomAnimationClip({
    ...animation,
    startTime: currentStart,
    endTime: currentEnd,
    enterProgressOffset,
    exitProgressOffset,
  });
  if (
    Math.abs(currentStart - animation.startTime) > 0.000001 ||
    Math.abs(currentEnd - animation.endTime) > 0.000001
  ) {
    resized.preserveTransitionIntent(defaultExit);
  }
  return resized;
}

export function zoomHitZone(options: {
  x: number;
  y: number;
  segments: readonly TimelineZoomSegment[];
  width: number;
  duration: number;
  selectedID?: string | null;
  hoveredID?: string | null;
  trackHeight?: number;
  barHeight?: number;
  minimumSegmentWidth?: number;
  segmentsAreOrdered?: boolean;
}): ZoomTrackHitZone {
  const { x, y, segments, width, duration, selectedID, hoveredID } = options;
  const trackHeight = options.trackHeight ?? 56;
  const barHeight = options.barHeight ?? 42;
  const minimumSegmentWidth = options.minimumSegmentWidth ?? 14;
  const segmentsAreOrdered = options.segmentsAreOrdered ?? false;

  if (
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    return ZoomTrackHitZoneEmpty;
  }

  const barMinY = (trackHeight - barHeight) / 2;
  const barMaxY = barMinY + barHeight;
  if (y < barMinY || y > barMaxY) return ZoomTrackHitZoneEmpty;

  function zone(segment: TimelineZoomSegment): ZoomTrackHitZone | null {
    const startX = (segment.startTime / duration) * width;
    const segmentWidth = max(
      ((segment.endTime - segment.startTime) / duration) * width,
      minimumSegmentWidth
    );
    if (x < startX || x > startX + segmentWidth) return null;
    if (segment.id === selectedID || segment.id === hoveredID) {
      const handleHalfWidth = min(9, segmentWidth * 0.35);
      if (x - startX <= handleHalfWidth) {
        return makeZoomTrackHitZoneResize(segment.id, true);
      }
      if (startX + segmentWidth - x <= handleHalfWidth) {
        return makeZoomTrackHitZoneResize(segment.id, false);
      }
    }
    return makeZoomTrackHitZoneMove(segment.id);
  }

  if (segmentsAreOrdered) {
    const index = lastItemStartingAtOrBefore(x, segments, s => (s.startTime / duration) * width);
    if (index == null) return ZoomTrackHitZoneEmpty;
    return zone(segments[index]) ?? ZoomTrackHitZoneEmpty;
  }

  for (let i = segments.length - 1; i >= 0; i--) {
    const hit = zone(segments[i]);
    if (hit) return hit;
  }
  return ZoomTrackHitZoneEmpty;
}

export function motionHitZone<Element>(options: {
  x: number;
  y: number;
  items: readonly Element[];
  id?: (element: Element) => string;
  timing?: (element: Element) => TransitionTiming;
  width: number;
  duration: number;
  selectedID?: string | null;
  hoveredID?: string | null;
  trackHeight?: number;
  barHeight?: number;
  minimumClipWidth?: number;
  itemsAreOrdered?: boolean;
}): ZoomTrackHitZone {
  const { x, y, items, width, duration, selectedID, hoveredID } = options;
  const id = options.id ?? ((el: any) => el.id);
  const timing = options.timing ?? ((el: any) => el.timing);
  const trackHeight = options.trackHeight ?? 46;
  const barHeight = options.barHeight ?? 36;
  const minimumClipWidth = options.minimumClipWidth ?? 7;
  const itemsAreOrdered = options.itemsAreOrdered ?? false;

  if (
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    return ZoomTrackHitZoneEmpty;
  }

  const barMinY = (trackHeight - barHeight) / 2;
  const barMaxY = barMinY + barHeight;
  if (y < barMinY || y > barMaxY) return ZoomTrackHitZoneEmpty;

  function zone(item: Element): ZoomTrackHitZone | null {
    const clipID = id(item);
    const clipTiming = timing(item);
    const startX = (clipTiming.startTime / duration) * width;
    const clipWidth = max(
      ((clipTiming.endTime - clipTiming.startTime) / duration) * width,
      minimumClipWidth
    );
    if (x < startX || x > startX + clipWidth) return null;
    if (clipID === selectedID || clipID === hoveredID) {
      const handleHalfWidth = min(8, clipWidth * 0.35);
      if (x - startX <= handleHalfWidth) {
        return makeZoomTrackHitZoneResize(clipID, true);
      }
      if (startX + clipWidth - x <= handleHalfWidth) {
        return makeZoomTrackHitZoneResize(clipID, false);
      }
    }
    return makeZoomTrackHitZoneMove(clipID);
  }

  if (itemsAreOrdered) {
    const index = lastItemStartingAtOrBefore(x, items, i => (timing(i).startTime / duration) * width);
    if (index == null) return ZoomTrackHitZoneEmpty;
    return zone(items[index]) ?? ZoomTrackHitZoneEmpty;
  }

  for (let i = items.length - 1; i >= 0; i--) {
    const hit = zone(items[i]);
    if (hit) return hit;
  }
  return ZoomTrackHitZoneEmpty;
}

export function fitMotionTiming<Element = TransitionTiming>(options: {
  start: number;
  end: number;
  among: readonly Element[];
  timing?: (element: Element) => TransitionTiming;
  duration: number;
  easing?: ZoomEasingPreset;
  returnDuration: number;
  leadInDuration?: number | null;
  itemsAreOrdered?: boolean;
}): TransitionTiming | null {
  const { start, end, among: items, duration, returnDuration } = options;
  const timing = options.timing ?? ((el: any) => el as TransitionTiming);
  const easing = options.easing ?? '三次方缓动';
  const leadInDuration = options.leadInDuration ?? null;
  const itemsAreOrdered = options.itemsAreOrdered ?? false;

  if (!Number.isFinite(duration) || duration <= 0) return null;
  const rawStart = min(max(min(start, end), 0), duration);
  const { previous: prevItem, next: nextItem } = creationNeighbours(
    rawStart,
    items,
    i => timing(i).startTime,
    itemsAreOrdered
  );
  const previous = prevItem ? timing(prevItem) : null;
  const next = nextItem ? timing(nextItem) : null;

  const lowerTouch = previous ? previous.endTime : 0;
  const lowerClear = previous
    ? previous.endTime + (previous.returnDuration > 0.0001 ? previous.returnDuration : returnDuration)
    : 0;
  const upper = next ? next.startTime : duration;
  if (upper - lowerTouch <= 0.001) return null;

  const minimumDuration = 0.16;
  let s = min(max(min(start, end), lowerTouch), upper);
  if (s < lowerClear) s = lowerTouch;
  const isClick = Math.abs(end - start) < 0.08;
  const requestedLength = isClick
    ? min(1.2, max(duration * 0.15, 0.5))
    : max(Math.abs(end - start), minimumDuration);

  let e = s + requestedLength;
  if (e > upper) {
    e = upper;
    const shifted = max(e - requestedLength, lowerTouch);
    if (upper - shifted >= minimumDuration) {
      s = shifted;
    } else {
      s = lowerTouch;
    }
  }
  if (e - s < minimumDuration - 0.0001 || e - s <= 0.001) return null;
  const fittedReturn = min(returnDuration, max(upper - e, 0));
  const fittedLeadIn = min(max(leadInDuration ?? (e - s), 0), e - s);

  return makeTransitionTiming({
    startTime: s,
    duration: e - s,
    leadInDuration: fittedLeadIn,
    easing,
    returnDuration: fittedReturn,
    preferredLeadInDuration: min(max(leadInDuration ?? (e - s), 0), 5),
    preferredReturnDuration: min(max(returnDuration, 0), 5),
  });
}

export function motionReturnNormalizations<Element = { id: string; timing: TransitionTiming }>(options: {
  editedID: string;
  among: readonly Element[];
  id?: (element: Element) => string;
  timing?: (element: Element) => TransitionTiming;
  defaultReturn: number;
}): Array<{ id: string; timing: TransitionTiming }> {
  const { editedID, among: items, defaultReturn } = options;
  const id = options.id ?? ((el: any) => el.id);
  const timing = options.timing ?? ((el: any) => el.timing);

  const editedItem = items.find(i => id(i) === editedID);
  if (!editedItem) return [];
  const edited = { id: id(editedItem), timing: timing(editedItem) };

  let predecessor: { id: string; timing: TransitionTiming } | null = null;
  let successor: { id: string; timing: TransitionTiming } | null = null;

  for (const item of items) {
    if (id(item) === editedID) continue;
    const candidate = { id: id(item), timing: timing(item) };
    if (motionTimingPrecedes(candidate, edited)) {
      if (predecessor == null || motionTimingPrecedes(predecessor, candidate)) {
        predecessor = candidate;
      }
    } else if (successor == null || motionTimingPrecedes(candidate, successor)) {
      successor = candidate;
    }
  }

  const patches: Array<{ id: string; timing: TransitionTiming }> = [];
  function appendPatch(
    clip: { id: string; timing: TransitionTiming },
    next: { id: string; timing: TransitionTiming } | null
  ): void {
    const touchesSuccessor = next
      ? Math.abs(next.timing.startTime - clip.timing.endTime) <=
        ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE
      : false;
    if (touchesSuccessor) return;

    const requested = clip.timing.requestedReturnDuration(defaultReturn);
    const available = next ? next.timing.startTime - clip.timing.endTime : requested;
    let returnDuration = min(requested, max(available, 0));
    let returnProgressOffset = clip.timing.returnProgressOffset;
    if (returnDuration > clip.timing.returnDuration + 0.000001) {
      returnProgressOffset = 0;
    }
    if (
      returnDuration !== clip.timing.returnDuration ||
      returnProgressOffset !== clip.timing.returnProgressOffset
    ) {
      const patched = makeTransitionTiming({
        ...clip.timing,
        returnDuration,
        returnProgressOffset,
      });
      patches.push({ id: clip.id, timing: patched });
    }
  }

  if (predecessor) appendPatch(predecessor, edited);
  appendPatch(edited, successor);
  return patches;
}

export function zoomSegmentsFromKeyframes(
  keyframes: readonly ZoomKeyframe[],
  duration: number,
  baseScale: number = 1
): TimelineZoomSegment[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const ordered = keyframes
    .filter(k => Number.isFinite(k.time) && k.time >= 0 && k.time <= duration)
    .sort((lhs, rhs) => (lhs.time === rhs.time ? lhs.id.localeCompare(rhs.id) : lhs.time - rhs.time));
  if (ordered.length === 0) return [];

  const zoomThreshold = baseScale + 0.0001;
  const segments: TimelineZoomSegment[] = [];
  let index = 0;

  while (index < ordered.length) {
    if (ordered[index].scale <= zoomThreshold) {
      index++;
      continue;
    }

    const firstZoomedIndex = index;
    const startIndex = max(firstZoomedIndex - 1, 0);
    let endIndex = firstZoomedIndex;
    while (endIndex + 1 < ordered.length && ordered[endIndex + 1].scale > zoomThreshold) {
      endIndex++;
    }

    const startTime = min(max(ordered[startIndex].time, 0), duration);
    const rawEndTime = endIndex + 1 < ordered.length ? ordered[endIndex + 1].time : duration;
    const endTime = min(max(rawEndTime, startTime), duration);
    const zoomedFrames = ordered.slice(firstZoomedIndex, endIndex + 1);

    let representative = zoomedFrames[0];
    for (const frame of zoomedFrames) {
      if (frame.scale > representative.scale) {
        representative = frame;
      } else if (frame.scale === representative.scale && frame.time < representative.time) {
        representative = frame;
      }
    }
    const origin: ZoomKeyframeOrigin = zoomedFrames.some(f => f.origin === 'manual')
      ? 'manual'
      : 'automatic';

    if (endTime - startTime > 0.001) {
      segments.push(
        makeTimelineZoomSegment({
          id: representative.id,
          startTime,
          endTime,
          scale: representative.scale,
          origin,
          representativeKeyframeID: representative.id,
          easing: '三次方缓动',
          enterDuration: 0.55,
          exitDuration: 0.55,
        })
      );
    }
    index = endIndex + 1;
  }
  return segments;
}

// MARK: - EditorTimelineMath Namespace

export const EditorTimelineMath = Object.freeze({
  fitZoomAnimation,
  manualZoomAnimation,
  manualZoomRangeKeyframes,
  clampedTime,
  xPosition,
  zoomSegments,
  split: splitZoomAnimation,
  zoomSequenceIsValid,
  effectiveExitDuration,
  exitNormalizations,
  moving: movingZoomAnimation,
  resizing: resizingZoomAnimation,
  zoomHitZone,
  motionHitZone,
  fitMotionTiming,
  motionReturnNormalizations,
  zoomSegmentsFromKeyframes,
});
