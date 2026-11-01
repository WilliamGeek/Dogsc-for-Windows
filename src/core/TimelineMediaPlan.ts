// Port of: F:\dogsc\Sources\RecorderCore\TimelineMediaPlan.swift

import { min, max, newUUID } from './swift.ts';
import type { MediaTimeRange } from './MediaTimeRange.ts';
import {
  type MediaTimelinePlacement,
  type MediaSyncAnchor,
  MediaSyncAnchorCurve,
  type ProjectMediaReference,
  makeMediaTimelinePlacement,
  makeProjectMediaReference,
} from './MediaTimeline.ts';
import { TimelineMap } from './TimelineMap.ts';
import type { PointerEventRecord } from './ZoomAnimation.ts';
import { PointerTimelineAlignment } from './PointerTimelineAlignment.ts';
import type { SourceSequence } from './ProjectTimeline.ts';

import type { ProjectMediaManifest, RecorderProject } from './ProjectMediaModel.ts';
import { ProjectPointerTrack } from './ProjectPointerTrack.ts';

// MARK: - TimelineMediaSlice

/**
 * One retained source interval placed on the ripple output timeline.
 * The same plan drives preview compositions and deterministic export readers.
 */
export class TimelineMediaSlice {
  readonly id: string;
  readonly segmentID: string;
  readonly outputStart: number;
  readonly sourceStart: number;
  readonly duration: number;
  readonly sourceTimeScale: number;

  constructor(options: {
    id?: string;
    segmentID: string;
    outputStart: number;
    sourceStart: number;
    duration: number;
    sourceTimeScale?: number;
  }) {
    this.id = options.id ?? newUUID();
    this.segmentID = options.segmentID;
    this.outputStart = options.outputStart;
    this.sourceStart = options.sourceStart;
    this.duration = options.duration;
    const scale = options.sourceTimeScale ?? 1;
    this.sourceTimeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  get outputEnd(): number {
    return this.outputStart + this.duration;
  }

  get sourceEnd(): number {
    return this.sourceStart + this.duration * this.sourceTimeScale;
  }

  sourceTime(atOutputTime: number): number | null {
    if (
      !Number.isFinite(atOutputTime) ||
      !(
        atOutputTime > this.outputStart ||
        TimelineMediaPlan.isSameBoundary(atOutputTime, this.outputStart)
      ) ||
      !(atOutputTime < this.outputEnd)
    ) {
      return null;
    }
    const elapsed = max(atOutputTime - this.outputStart, 0);
    return this.sourceStart + elapsed * this.sourceTimeScale;
  }
}

// MARK: - TimelineMediaPlan

/**
 * Final-time media placement generated from the one authoritative
 * TimelineMap. No preview/export implementation is allowed to invent its
 * own offset or cut mapping after this point.
 */
export class TimelineMediaPlan {
  /**
   * Only used to snap arithmetic results back onto an already-authored
   * primary cut. It is deliberately far smaller than any media frame so a
   * real camera/audio availability gap remains a gap.
   */
  private static readonly numericalBoundaryTolerance: number = 0.000000001;

  readonly outputDuration: number;
  readonly slices: readonly TimelineMediaSlice[];

  constructor(
    options:
      | { primary: TimelineMap }
      | {
          timelineMap: TimelineMap;
          auxiliary: MediaTimelinePlacement;
          syncAnchors?: readonly MediaSyncAnchor[];
          sourceAvailableRange?: MediaTimeRange | null;
        }
  ) {
    if ('primary' in options) {
      const timelineMap = options.primary;
      this.outputDuration = timelineMap.outputDuration;
      this.slices = timelineMap.segments.map(
        (seg) =>
          new TimelineMediaSlice({
            id: seg.id,
            segmentID: seg.id,
            outputStart: seg.outputStart,
            sourceStart: seg.sourceStart,
            duration: seg.outputDuration,
            sourceTimeScale: seg.playbackRate,
          })
      );
      return;
    }

    const { timelineMap, auxiliary: placement, syncAnchors = [], sourceAvailableRange = null } =
      options;
    this.outputDuration = timelineMap.outputDuration;

    if (syncAnchors.length === 0) {
      const result: TimelineMediaSlice[] = [];
      for (const segment of timelineMap.segments) {
        const retainedStart = max(segment.sourceStart, placement.timelineStart);
        const retainedEnd = min(segment.sourceEnd, placement.timelineEnd);
        const startsAtPrimaryBoundary = TimelineMediaPlan.isSameBoundary(
          retainedStart,
          segment.sourceStart
        );
        const endsAtPrimaryBoundary = TimelineMediaPlan.isSameBoundary(
          retainedEnd,
          segment.sourceEnd
        );
        const outputStart = startsAtPrimaryBoundary
          ? segment.outputStart
          : segment.outputStart + (retainedStart - segment.sourceStart) / segment.playbackRate;

        let duration: number;
        if (startsAtPrimaryBoundary && endsAtPrimaryBoundary) {
          duration = segment.outputDuration;
        } else {
          const outputEnd = endsAtPrimaryBoundary
            ? segment.outputEnd
            : segment.outputStart + (retainedEnd - segment.sourceStart) / segment.playbackRate;
          duration = outputEnd - outputStart;
        }

        if (duration > 0) {
          result.push(
            new TimelineMediaSlice({
              id: segment.id,
              segmentID: segment.id,
              outputStart,
              sourceStart: placement.sourceTime(retainedStart) ?? placement.sourceStart,
              duration,
              sourceTimeScale: placement.sourceTimeScale * segment.playbackRate,
            })
          );
        }
      }
      this.slices = result;
      return;
    }

    const curve = new MediaSyncAnchorCurve(syncAnchors);
    const availableStart = sourceAvailableRange?.start ?? 0;
    const availableEnd = sourceAvailableRange?.end ?? Number.MAX_VALUE;

    const result: TimelineMediaSlice[] = [];
    for (const segment of timelineMap.segments) {
      const retainedStart = max(segment.sourceStart, placement.timelineStart);
      const retainedEnd = min(segment.sourceEnd, placement.timelineEnd);
      if (!(retainedEnd - retainedStart > 0.000001)) {
        continue;
      }

      const boundaries = [retainedStart];
      for (const anchor of syncAnchors) {
        if (anchor.sourceTime > retainedStart + 0.000001 && anchor.sourceTime < retainedEnd - 0.000001) {
          boundaries.push(anchor.sourceTime);
        }
      }
      boundaries.push(retainedEnd);
      boundaries.sort((a, b) => a - b);

      for (let index = 0; index < boundaries.length - 1; index++) {
        const primaryStart = boundaries[index];
        const primaryEnd = boundaries[index + 1];
        const startsAtPrimaryBoundary = TimelineMediaPlan.isSameBoundary(
          primaryStart,
          segment.sourceStart
        );
        const endsAtPrimaryBoundary = TimelineMediaPlan.isSameBoundary(
          primaryEnd,
          segment.sourceEnd
        );
        const outputStart = startsAtPrimaryBoundary
          ? segment.outputStart
          : segment.outputStart + (primaryStart - segment.sourceStart) / segment.playbackRate;
        const outputEnd = endsAtPrimaryBoundary
          ? segment.outputEnd
          : segment.outputStart + (primaryEnd - segment.sourceStart) / segment.playbackRate;
        const duration =
          startsAtPrimaryBoundary && endsAtPrimaryBoundary
            ? segment.outputDuration
            : outputEnd - outputStart;

        if (!(duration > 0.000001)) continue;

        const baseStart =
          placement.sourceStart +
          (primaryStart - placement.timelineStart) * placement.sourceTimeScale;
        const baseEnd =
          placement.sourceStart +
          (primaryEnd - placement.timelineStart) * placement.sourceTimeScale;
        const correctedStart = min(
          max(baseStart + curve.offset(primaryStart), availableStart),
          availableEnd
        );
        const correctedEnd = min(
          max(baseEnd + curve.offset(primaryEnd), availableStart),
          availableEnd
        );
        const correctedDuration = correctedEnd - correctedStart;
        if (!(correctedDuration > 0.000001)) continue;

        result.push(
          new TimelineMediaSlice({
            id: segment.id,
            segmentID: segment.id,
            outputStart,
            sourceStart: correctedStart,
            duration,
            sourceTimeScale: correctedDuration / duration,
          })
        );
      }
    }

    this.slices = result;
  }

  get playableDuration(): number {
    return this.slices.reduce((acc, slice) => acc + slice.duration, 0);
  }

  sourceTime(atOutputTime: number): number | null {
    const slice = this.slice(atOutputTime);
    return slice ? slice.sourceTime(atOutputTime) : null;
  }

  contains(outputTime: number): boolean {
    return this.sourceTime(outputTime) != null;
  }

  slice(atOutputTime: number): TimelineMediaSlice | null {
    if (!Number.isFinite(atOutputTime) || atOutputTime < 0) return null;
    let lower = 0;
    let upper = this.slices.length;
    while (lower < upper) {
      const middle = lower + Math.floor((upper - lower) / 2);
      const end = this.slices[middle].outputEnd;
      if (end < atOutputTime || TimelineMediaPlan.isSameBoundary(end, atOutputTime)) {
        lower = middle + 1;
      } else {
        upper = middle;
      }
    }
    if (lower >= this.slices.length) return null;
    const candidate = this.slices[lower];
    return atOutputTime > candidate.outputStart ||
      TimelineMediaPlan.isSameBoundary(atOutputTime, candidate.outputStart)
      ? candidate
      : null;
  }

  static isSameBoundary(lhs: number, rhs: number): boolean {
    return Math.abs(lhs - rhs) <= TimelineMediaPlan.numericalBoundaryTolerance;
  }
}

// MARK: - AuxiliaryMediaClockAlignment

/**
 * Aligns both ends of an independently clocked capture. This is deliberately
 * inferred for legacy projects: a fixed start trim cannot repair drift, while
 * the finalized source and primary durations provide a stable second anchor.
 */
export const AuxiliaryMediaClockAlignment = {
  inferredSourceTimeScale(
    reference: ProjectMediaReference,
    availableRange: MediaTimeRange,
    timelineDuration: number
  ): number | null {
    const sourceStart = min(
      max(reference.sourceStartTime, availableRange.start),
      availableRange.end
    );
    const sourceSpan = availableRange.end - sourceStart;
    const timelineSpan = timelineDuration - max(reference.startOffset, 0);
    if (
      !Number.isFinite(sourceSpan) ||
      !Number.isFinite(timelineSpan) ||
      sourceSpan <= 0.1 ||
      timelineSpan <= 0.1
    ) {
      return null;
    }
    const scale = sourceSpan / timelineSpan;
    if (scale < 0.9 || scale > 1.1) return null;
    return scale;
  },
};

// MARK: - ProjectTimelineMediaPlan

/**
 * Every time-bearing source resolved onto the one final output clock.
 */
export class ProjectTimelineMediaPlan {
  readonly timelineMap: TimelineMap;
  readonly primary: TimelineMediaPlan;
  readonly systemAudio: TimelineMediaPlan | null;
  readonly camera: TimelineMediaPlan | null;
  readonly microphone: TimelineMediaPlan | null;
  readonly pointer: ProjectPointerTrack;
  readonly primarySourceTimeOffset: number;

  constructor(options: {
    sourceSequence?: SourceSequence;
    project?: RecorderProject;
    mediaManifest?: ProjectMediaManifest | null;
    primaryVideoRange: MediaTimeRange;
    systemAudioRange?: MediaTimeRange | null;
    cameraRange?: MediaTimeRange | null;
    microphoneRange?: MediaTimeRange | null;
    sourcePointerEvents?: readonly PointerEventRecord[];
  }) {
    const sourceSequence =
      options.sourceSequence ?? options.project?.timeline.sourceSequence;
    if (!sourceSequence) {
      throw new Error('ProjectTimelineMediaPlan requires sourceSequence or project');
    }
    const mediaManifest = options.mediaManifest ?? options.project?.media ?? null;
    const primaryVideoRange = options.primaryVideoRange;
    const systemAudioRange = options.systemAudioRange ?? null;
    const cameraRange = options.cameraRange ?? null;
    const microphoneRange = options.microphoneRange ?? null;
    const sourcePointerEvents = options.sourcePointerEvents ?? [];

    const map = new TimelineMap(sourceSequence, primaryVideoRange.duration);
    this.timelineMap = map;
    this.primary = new TimelineMediaPlan({ primary: map });
    this.primarySourceTimeOffset = primaryVideoRange.start;

    if (systemAudioRange) {
      const sharedSourceStart = max(systemAudioRange.start, primaryVideoRange.start);
      const placement = makeMediaTimelinePlacement({
        reference: makeProjectMediaReference({
          relativePath: mediaManifest?.screen.relativePath ?? 'screen',
          startOffset: max(systemAudioRange.start - primaryVideoRange.start, 0),
          sourceStartTime: sharedSourceStart,
        }),
        sourceAvailableStart: systemAudioRange.start,
        sourceAvailableDuration: systemAudioRange.duration,
        timelineDuration: primaryVideoRange.duration,
      });
      this.systemAudio = new TimelineMediaPlan({ timelineMap: map, auxiliary: placement });
    } else {
      this.systemAudio = null;
    }

    this.camera = ProjectTimelineMediaPlan.auxiliaryPlan(
      mediaManifest?.camera ?? null,
      cameraRange,
      map,
      primaryVideoRange.duration
    );

    this.microphone = ProjectTimelineMediaPlan.auxiliaryPlan(
      mediaManifest?.microphone ?? null,
      microphoneRange,
      map,
      primaryVideoRange.duration
    );

    this.pointer = new ProjectPointerTrack(
      map,
      PointerTimelineAlignment.align(
        sourcePointerEvents,
        mediaManifest?.pointerEvents?.startOffset ?? 0,
        mediaManifest?.pointerEvents?.sourceStartTime ?? 0
      )
    );
  }

  get outputDuration(): number {
    return this.primary.outputDuration;
  }

  private static auxiliaryPlan(
    reference: ProjectMediaReference | null,
    availableRange: MediaTimeRange | null,
    timelineMap: TimelineMap,
    timelineDuration: number
  ): TimelineMediaPlan | null {
    if (!reference || !availableRange) return null;
    const placement = makeMediaTimelinePlacement({
      reference,
      sourceAvailableStart: availableRange.start,
      sourceAvailableDuration: availableRange.duration,
      timelineDuration,
    });
    return new TimelineMediaPlan({
      timelineMap,
      auxiliary: placement,
      syncAnchors: reference.syncAnchors,
      sourceAvailableRange: availableRange,
    });
  }
}
