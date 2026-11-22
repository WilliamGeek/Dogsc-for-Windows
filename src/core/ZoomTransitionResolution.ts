// Port of: F:\dogsc-v0.2.0\Sources\RecorderCore\ZoomTransitionResolution.swift
import { max, min } from './swift.ts';
import {
  ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE,
  makeZoomAnimationClip,
  zoomAnimationClipDuration,
  type ZoomAnimationClip,
} from './ZoomAnimation.ts';

export function zoomAnimationClipRequestedEnterDuration(clip: ZoomAnimationClip): number {
  return clip.preferredEnterDuration ?? clip.enterDuration;
}

export function zoomAnimationClipRequestedExitDuration(
  clip: ZoomAnimationClip,
  defaultTransition: number = 0.7,
): number {
  const requested =
    clip.preferredExitDuration ??
    (clip.exitDuration > 0.000_1 ? clip.exitDuration : max(defaultTransition, 0));
  if (
    clip.transitionIntentVersion === 0 &&
    clip.origin === 'automatic' &&
    requested > 0 &&
    requested < 1.0 / 30.0
  ) {
    return max(defaultTransition, 0);
  }
  return requested;
}

export function zoomAnimationClipPreserveTransitionIntent(
  clip: ZoomAnimationClip,
  defaultTransition: number = 0.7,
): ZoomAnimationClip {
  const exit = zoomAnimationClipRequestedExitDuration(clip, defaultTransition);
  return makeZoomAnimationClip({
    ...clip,
    preferredEnterDuration: clip.preferredEnterDuration ?? clip.enterDuration,
    preferredExitDuration: exit,
    transitionIntentVersion: 1,
  });
}

/**
 * Shared by the inspector, preview and export. Project-authored ranges remain
 * intact when the output tail is trimmed, so restoring media does not destroy
 * hidden animation content. Only the evaluated windows are fitted to the end.
 * Swift: `ZoomTransitionResolution`.
 */
export const ZoomTransitionResolution = Object.freeze({
  resolve(
    animations: readonly ZoomAnimationClip[],
    outputDuration: number,
  ): ZoomAnimationClip[] {
    if (!Number.isFinite(outputDuration) || outputDuration <= 0) {
      return [];
    }
    const sorted = animations
      .filter((a) => a.startTime < outputDuration && zoomAnimationClipDuration(a) > 0.001)
      .slice()
      .sort((a, b) =>
        a.startTime === b.startTime
          ? a.id < b.id
            ? -1
            : a.id > b.id
            ? 1
            : 0
          : a.startTime - b.startTime,
      );

    // Omit isolated automatic entrance fragments reduced to under two 60 Hz frames.
    const ordered = sorted.filter((clip, index) => {
      const continues =
        index > 0 &&
        Math.abs(sorted[index - 1].endTime - clip.startTime) <=
          ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE;
      if (
        clip.origin === 'automatic' &&
        !continues &&
        clip.enterProgressOffset === 0 &&
        zoomAnimationClipDuration(clip) < min(zoomAnimationClipRequestedEnterDuration(clip), 1.0 / 30.0)
      ) {
        return false;
      }
      return true;
    });

    return ordered.map((authored, index) => {
      const clip = makeZoomAnimationClip({ ...authored });
      const next = index + 1 < ordered.length ? ordered[index + 1] : null;
      const requestedEnter = max(zoomAnimationClipRequestedEnterDuration(clip), 0);
      const requestedExit = max(zoomAnimationClipRequestedExitDuration(clip), 0);
      if (next != null) {
        const gap = max(next.startTime - clip.endTime, 0);
        if (
          clip.origin === 'automatic' &&
          next.origin === 'automatic' &&
          gap > 0 &&
          gap < 1.0 / 60.0 &&
          requestedExit > gap
        ) {
          clip.endTime = next.startTime;
          clip.exitDuration = 0;
        } else {
          clip.exitDuration =
            gap <= ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE ? 0 : min(requestedExit, gap);
        }
      } else {
        const available = max(outputDuration - clip.startTime, 0);
        const exit = min(requestedExit, max(available - min(requestedEnter, available * 0.5), 0));
        clip.endTime = min(clip.endTime, outputDuration - exit);
        if (clip.endTime < authored.endTime - 0.000_001) {
          clip.exitProgressOffset = 0;
        }
        clip.exitDuration = min(requestedExit, max(outputDuration - clip.endTime, 0));
      }
      clip.enterDuration = min(requestedEnter, zoomAnimationClipDuration(clip));
      return clip;
    });
  },
});
