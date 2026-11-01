// Port of: F:\dogsc\Sources\RecorderCore\ProjectTimelineRetime.swift

import { min, max } from './swift.ts';
import {
  type ProjectTimeline,
  type RecordingSegment,
  makeRecordingSegment,
  makeSourceSequenceEdited,
  makeProjectTimeline,
  RECORDING_SEGMENT_MINIMUM_PLAYBACK_RATE,
  RECORDING_SEGMENT_MAXIMUM_PLAYBACK_RATE,
  type TransitionTiming,
  makeTransitionTiming,
} from './ProjectTimeline.ts';
import { TimelineMap } from './TimelineMap.ts';
import {
  type ZoomAnimationClip,
  makeZoomAnimationClip,
  ZoomInterpolator,
} from './ZoomAnimation.ts';
import { type ScreenMotionClip } from './ScreenMotion.ts';
import { type CameraMotionClip } from './CameraMotion.ts';
import {
  type OverlayTiming,
  makeOverlayTiming,
  type MosaicClip,
  type StickerClip,
} from './OverlayTimeline.ts';
import { ProjectValidator } from './ProjectValidator.ts';

import {
  type ProjectTimelineEditingErrorKind,
  ProjectTimelineEditingError,
} from './ProjectTimelineEditingTransforms.ts';
export {
  type ProjectTimelineEditingErrorKind,
  ProjectTimelineEditingError,
};

// MARK: - PlaybackRateTimeTransform

class PlaybackRateTimeTransform {
  readonly segmentStart: number;
  readonly oldSegmentEnd: number;
  readonly newSegmentEnd: number;
  readonly insideScale: number;

  constructor(options: {
    segmentStart: number;
    oldSegmentEnd: number;
    newSegmentEnd: number;
    insideScale: number;
  }) {
    this.segmentStart = options.segmentStart;
    this.oldSegmentEnd = options.oldSegmentEnd;
    this.newSegmentEnd = options.newSegmentEnd;
    this.insideScale = options.insideScale;
  }

  get tailOffset(): number {
    return this.newSegmentEnd - this.oldSegmentEnd;
  }

  mapAnchor(time: number): number {
    if (!Number.isFinite(time)) return time;
    if (time <= this.segmentStart) return time;
    if (time >= this.oldSegmentEnd) return time + this.tailOffset;
    return this.segmentStart + (time - this.segmentStart) * this.insideScale;
  }

  mapOverlayTiming(timing: OverlayTiming): OverlayTiming {
    return makeOverlayTiming({
      startTime: this.mapAnchor(timing.startTime),
      duration: timing.duration,
    });
  }

  mapTransitionTiming(timing: TransitionTiming): TransitionTiming {
    return makeTransitionTiming({
      ...timing,
      startTime: this.mapAnchor(timing.startTime),
    });
  }

  mapZoom(clip: ZoomAnimationClip): ZoomAnimationClip {
    const duration = clip.duration;
    const startTime = this.mapAnchor(clip.startTime);
    return makeZoomAnimationClip({
      ...clip,
      startTime,
      endTime: startTime + duration,
    });
  }
}

// MARK: - Helper Functions

export function zoomSequenceIsValid(
  previous: ZoomAnimationClip,
  next: ZoomAnimationClip,
  previousExit?: number | null
): boolean {
  if (next.startTime < previous.endTime - 0.0001) return false;
  if (next.startTime - previous.endTime <= ZoomInterpolator.adjacencyTolerance) {
    return true;
  }
  const exit = previousExit ?? previous.exitDuration;
  return next.startTime >= previous.endTime + exit - 0.0001;
}

export function nonoverlappingZoomClips(
  clips: readonly ZoomAnimationClip[]
): ZoomAnimationClip[] {
  const result: ZoomAnimationClip[] = [];
  for (const orig of clips) {
    let clip = orig;
    const previous = result.length > 0 ? result[result.length - 1] : null;
    if (previous && !zoomSequenceIsValid(previous, clip)) {
      const minimumStart =
        clip.startTime < previous.endTime
          ? previous.endTime
          : previous.effectEndTime;
      const duration = clip.duration;
      clip = makeZoomAnimationClip({
        ...clip,
        startTime: minimumStart,
        endTime: minimumStart + duration,
      });
    }
    result.push(clip);
  }
  return result;
}

function nonoverlappingTransitionClips<Clip extends { timing: TransitionTiming }>(
  clips: readonly Clip[],
  setTiming: (clip: Clip, timing: TransitionTiming) => Clip
): Clip[] {
  const result: Clip[] = [];
  for (const orig of clips) {
    let clip = orig;
    let current = clip.timing;
    const previousClip = result.length > 0 ? result[result.length - 1] : null;
    if (previousClip) {
      const previous = previousClip.timing;
      const gap = current.startTime - previous.endTime;
      const touches = gap <= ZoomInterpolator.adjacencyTolerance;
      const clearsReturn = current.startTime >= previous.effectEndTime - 0.0001;
      if (
        current.startTime < previous.endTime - 0.0001 ||
        (!touches && !clearsReturn)
      ) {
        const newStart =
          current.startTime < previous.endTime
            ? previous.endTime
            : previous.effectEndTime;
        current = makeTransitionTiming({ ...current, startTime: newStart });
        clip = setTiming(clip, current);
      }
    }
    result.push(clip);
  }
  return result;
}

export function nonoverlappingScreenMotionClips(
  clips: readonly ScreenMotionClip[]
): ScreenMotionClip[] {
  return nonoverlappingTransitionClips(clips, (clip, timing) => ({
    ...clip,
    timing,
  }));
}

export function nonoverlappingCameraMotionClips(
  clips: readonly CameraMotionClip[]
): CameraMotionClip[] {
  return nonoverlappingTransitionClips(clips, (clip, timing) => ({
    ...clip,
    timing,
  }));
}

export function zoomOrder(lhs: ZoomAnimationClip, rhs: ZoomAnimationClip): number {
  if (lhs.startTime !== rhs.startTime) return lhs.startTime - rhs.startTime;
  return lhs.id.localeCompare(rhs.id);
}

export function screenMotionOrder(
  lhs: ScreenMotionClip,
  rhs: ScreenMotionClip
): number {
  if (lhs.timing.startTime !== rhs.timing.startTime) {
    return lhs.timing.startTime - rhs.timing.startTime;
  }
  return lhs.id.localeCompare(rhs.id);
}

export function cameraMotionOrder(
  lhs: CameraMotionClip,
  rhs: CameraMotionClip
): number {
  if (lhs.timing.startTime !== rhs.timing.startTime) {
    return lhs.timing.startTime - rhs.timing.startTime;
  }
  return lhs.id.localeCompare(rhs.id);
}

export function sortZoom(clips: ZoomAnimationClip[]): void {
  clips.sort(zoomOrder);
}

export function sortScreenMotion(clips: ScreenMotionClip[]): void {
  clips.sort(screenMotionOrder);
}

export function sortCameraMotion(clips: CameraMotionClip[]): void {
  clips.sort(cameraMotionOrder);
}

// MARK: - Retiming Implementation

export function settingPlaybackRate(
  requestedRate: number,
  segmentID: string,
  timeline: ProjectTimeline,
  fullSourceDuration: number
): ProjectTimeline {
  ProjectValidator.validate(timeline);
  const oldMap = new TimelineMap(timeline.sourceSequence, fullSourceDuration);
  const resolved = oldMap.segments.find(
    (s) => s.id.toLowerCase() === segmentID.toLowerCase()
  );
  if (!resolved) {
    throw new ProjectTimelineEditingError('segmentNotFound', { segmentID });
  }

  const rate = min(
    max(
      Number.isFinite(requestedRate)
        ? requestedRate
        : RECORDING_SEGMENT_MINIMUM_PLAYBACK_RATE,
      RECORDING_SEGMENT_MINIMUM_PLAYBACK_RATE
    ),
    RECORDING_SEGMENT_MAXIMUM_PLAYBACK_RATE
  );
  const epsilon = 1.0 / 120000.0;
  if (Math.abs(rate - resolved.playbackRate) <= epsilon) {
    return timeline;
  }

  const authored = oldMap.segments.map((s) =>
    makeRecordingSegment({
      id: s.id,
      sourceStart: s.sourceStart,
      sourceDuration: s.sourceDuration,
      playbackRate: s.playbackRate,
    })
  );
  const index = authored.findIndex(
    (s) => s.id.toLowerCase() === segmentID.toLowerCase()
  );
  if (index === -1) {
    throw new ProjectTimelineEditingError('segmentNotFound', { segmentID });
  }
  authored[index].playbackRate = rate;

  const transform = new PlaybackRateTimeTransform({
    segmentStart: resolved.outputStart,
    oldSegmentEnd: resolved.outputEnd,
    newSegmentEnd: resolved.outputStart + resolved.sourceDuration / rate,
    insideScale: resolved.playbackRate / rate,
  });

  const editedSourceSequence = makeSourceSequenceEdited(authored);
  const zoomClips = nonoverlappingZoomClips(
    timeline.zoomClips.map((c) => transform.mapZoom(c))
  );
  const screenMotionClips = nonoverlappingScreenMotionClips(
    timeline.screenMotionClips.map((clip) => ({
      ...clip,
      timing: transform.mapTransitionTiming(clip.timing),
    }))
  );
  const cameraMotionClips = nonoverlappingCameraMotionClips(
    timeline.cameraMotionClips.map((clip) => ({
      ...clip,
      timing: transform.mapTransitionTiming(clip.timing),
    }))
  );
  const mosaicClips = timeline.mosaicClips.map((clip) => ({
    ...clip,
    timing: transform.mapTransitionTiming(clip.timing),
  }));
  const stickerClips = timeline.stickerClips.map((clip) => {
    const timing = transform.mapOverlayTiming(clip.timing);
    return {
      ...clip,
      timing,
      enterDuration: min(clip.enterDuration, timing.duration),
      exitDuration: min(clip.exitDuration, timing.duration),
    };
  });

  sortZoom(zoomClips);
  sortScreenMotion(screenMotionClips);
  sortCameraMotion(cameraMotionClips);
  mosaicClips.sort((lhs, rhs) => {
    if (lhs.timing.startTime !== rhs.timing.startTime) {
      return lhs.timing.startTime - rhs.timing.startTime;
    }
    return lhs.id.localeCompare(rhs.id);
  });
  stickerClips.sort((lhs, rhs) => {
    if (lhs.layerIndex !== rhs.layerIndex) {
      return lhs.layerIndex - rhs.layerIndex;
    }
    return lhs.id.localeCompare(rhs.id);
  });

  const result = makeProjectTimeline({
    sourceSequence: editedSourceSequence,
    primarySegmentAudioOverrides: timeline.primarySegmentAudioOverrides,
    zoomClips,
    screenMotionClips,
    cameraMotionClips,
    mosaicClips,
    stickerClips,
  });

  ProjectValidator.validate(result);
  return result;
}

export const ProjectTimelineRetime = Object.freeze({
  settingPlaybackRate,
  nonoverlappingZoomClips,
  nonoverlappingScreenMotionClips,
  nonoverlappingCameraMotionClips,
  sortZoom,
  sortScreenMotion,
  sortCameraMotion,
  zoomSequenceIsValid,
});
