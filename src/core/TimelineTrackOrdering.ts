// Port of: F:\dogsc\Sources\RecorderCore\TimelineTrackOrdering.swift
import { max } from './swift.ts';
import type { ZoomAnimationClip } from './ZoomAnimation.ts';
import type { ScreenMotionClip } from './ScreenMotion.ts';
import type { CameraMotionClip } from './CameraMotion.ts';

/**
 * Cheap validation gates for immutable playback-track construction.
 * Authored editor arrays normally stay in deterministic start-time order and drag
 * constraints prevent clips from crossing neighbours.
 */
function zoomAnimationsNeedRepair(animations: readonly ZoomAnimationClip[]): boolean {
  for (let index = 0; index < animations.length; index++) {
    const animation = animations[index];
    const duration = max(animation.endTime - animation.startTime, 0);
    if (!(duration > 0.001)) {
      return true;
    }
    if (index > 0 && zoomPrecedes(animation, animations[index - 1])) {
      return true;
    }
  }
  return false;
}

function motionClipsNeedRepair<Element>(
  clips: readonly Element[],
  identity: (element: Element) => { id: string; startTime: number },
): boolean {
  if (clips.length <= 1) return false;
  for (let index = 1; index < clips.length; index++) {
    const current = identity(clips[index]);
    const previous = identity(clips[index - 1]);
    if (
      current.startTime < previous.startTime ||
      (current.startTime === previous.startTime && current.id < previous.id)
    ) {
      return true;
    }
  }
  return false;
}

function screenMotionClipsNeedRepair(clips: readonly ScreenMotionClip[]): boolean {
  return motionClipsNeedRepair(clips, (c) => ({ id: c.id, startTime: c.timing.startTime }));
}

function cameraMotionClipsNeedRepair(clips: readonly CameraMotionClip[]): boolean {
  return motionClipsNeedRepair(clips, (c) => ({ id: c.id, startTime: c.timing.startTime }));
}

function zoomPrecedes(lhs: ZoomAnimationClip, rhs: ZoomAnimationClip): boolean {
  return lhs.startTime === rhs.startTime
    ? lhs.id < rhs.id
    : lhs.startTime < rhs.startTime;
}

export const TimelineTrackOrdering = Object.freeze({
  zoomAnimationsNeedRepair,
  screenMotionClipsNeedRepair,
  cameraMotionClipsNeedRepair,
});
