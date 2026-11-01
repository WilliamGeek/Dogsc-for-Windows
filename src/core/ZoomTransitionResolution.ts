// Port of: F:\dogsc\Sources\RecorderCore\ZoomTransitionResolution.swift
import { max, min } from './swift.ts';
import {
  ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE,
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
  return (
    clip.preferredExitDuration ??
    (clip.exitDuration > 0.000_1 ? clip.exitDuration : max(defaultTransition, 0))
  );
}

export function zoomAnimationClipPreserveTransitionIntent(
  clip: ZoomAnimationClip,
  defaultTransition: number = 0.7,
): ZoomAnimationClip {
  const preferredEnterDuration = clip.preferredEnterDuration ?? clip.enterDuration;
  const preferredExitDuration =
    clip.preferredExitDuration ?? zoomAnimationClipRequestedExitDuration(clip, defaultTransition);
  return {
    ...clip,
    preferredEnterDuration,
    preferredExitDuration,
  };
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
    const ordered = animations
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

    return ordered.map((authored, index) => {
      const clip: ZoomAnimationClip = { ...authored };
      const next = index + 1 < ordered.length ? ordered[index + 1] : null;
      const requestedEnter = max(zoomAnimationClipRequestedEnterDuration(clip), 0);
      const requestedExit = max(zoomAnimationClipRequestedExitDuration(clip), 0);
      if (next != null) {
        const gap = max(next.startTime - clip.endTime, 0);
        clip.exitDuration =
          gap <= ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE ? 0 : min(requestedExit, gap);
      } else {
        const available = max(outputDuration - clip.startTime, 0);
        // A short final zoom reserves a real entrance and return. For
        // a longer zoom only its final hold is shortened, never the
        // requested transition stored in the project.
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
