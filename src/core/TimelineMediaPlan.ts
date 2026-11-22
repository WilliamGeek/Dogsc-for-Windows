// Port of: F:\dogsc-v0.2.0\Sources\RecorderCore\TimelineMediaPlan.swift

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
import type { InsertedMedia, SourceSequence } from './ProjectTimeline.ts';
import type { ProjectMediaManifest, RecorderProject } from './ProjectMediaModel.ts';
import { ProjectPointerTrack } from './ProjectPointerTrack.ts';
import { RecordingSourcePrimaryID } from './RecordingSource.ts';

// MARK: - TimelineMediaSlice

/**
 * One retained source interval placed on the ripple output timeline.
 * The same plan drives preview compositions and deterministic export readers.
 */
export class TimelineMediaSlice {
  readonly id: string;
  readonly segmentID: string;
  readonly sourceID: string;
  readonly outputStart: number;
  readonly sourceStart: number;
  readonly duration: number;
  readonly sourceTimeScale: number;
  /// Inserted video this slice reads instead of the recording.
  readonly media: InsertedMedia | null;

  constructor(options: {
    id?: string;
    segmentID: string;
    outputStart: number;
    sourceStart: number;
    duration: number;
    sourceTimeScale?: number;
    media?: InsertedMedia | null;
    sourceID?: string;
  }) {
    this.id = options.id ?? newUUID();
    this.segmentID = options.segmentID;
    this.sourceID = options.sourceID ?? RecordingSourcePrimaryID;
    this.outputStart = options.outputStart;
    this.sourceStart = options.sourceStart;
    this.duration = options.duration;
    this.media = options.media ?? null;
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

export type TimelineMediaPlanOptions =
  | { primary: TimelineMap }
  | {
      timelineMap: TimelineMap;
      auxiliary: MediaTimelinePlacement;
      sourceID?: string;
      syncAnchors?: readonly MediaSyncAnchor[];
      sourceAvailableRange?: MediaTimeRange | null;
    }
  | {
      outputDuration: number;
      combining: readonly TimelineMediaPlan[];
    }
  | {
      clipping: TimelineMediaPlan;
      to: MediaTimeRange;
    };

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

  constructor(options: TimelineMediaPlanOptions) {
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
            media: seg.media,
            sourceID: seg.sourceID,
          })
      );
      return;
    }

    if ('combining' in options) {
      this.outputDuration = options.outputDuration;
      this.slices = options.combining
        .flatMap((p) => p.slices)
        .sort((a, b) => a.outputStart - b.outputStart);
      return;
    }

    if ('clipping' in options) {
      this.outputDuration = options.clipping.outputDuration;
      const range = options.to;
      const clipped: TimelineMediaSlice[] = [];
      for (const slice of options.clipping.slices) {
        const start = max(slice.outputStart, range.start);
        const end = min(slice.outputEnd, range.end);
        if (end > start && !TimelineMediaPlan.isSameBoundary(start, end)) {
          clipped.push(
            new TimelineMediaSlice({
              id: slice.id,
              segmentID: slice.segmentID,
              outputStart: start,
              sourceStart: slice.sourceStart + (start - slice.outputStart) * slice.sourceTimeScale,
              duration: end - start,
              sourceTimeScale: slice.sourceTimeScale,
              media: slice.media,
              sourceID: slice.sourceID,
            })
          );
        }
      }
      this.slices = clipped;
      return;
    }

    const {
      timelineMap,
      auxiliary: placement,
      sourceID = RecordingSourcePrimaryID,
      syncAnchors = [],
      sourceAvailableRange = null,
    } = options;
    this.outputDuration = timelineMap.outputDuration;

    if (syncAnchors.length === 0) {
      const result: TimelineMediaSlice[] = [];
      for (const segment of timelineMap.segments) {
        // Camera and audio of the recording are absent in inserts.
        if (segment.media != null || segment.sourceID !== sourceID) continue;
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
              sourceID,
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
      if (segment.media != null || segment.sourceID !== sourceID) continue;
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
            sourceID,
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
    if (!slice || slice.sourceID !== RecordingSourcePrimaryID) return null;
    return slice.sourceTime(atOutputTime);
  }

  contains(outputTime: number): boolean {
    return this.slice(outputTime) != null;
  }

  slice(atOutputTime: number): TimelineMediaSlice | null {
    if (!Number.isFinite(atOutputTime) || atOutputTime < 0) return null;
    let lower = 0;
    let upper = this.slices.length;
    while (lower < upper) {
      const middle = lower + Math.trunc((upper - lower) / 2);
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

// MARK: - AuxiliaryMediaClockAlignment (retained for backward compatibility)

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

// MARK: - RecordingSourceMedia & ProjectTimelineMediaPlan

/// Validated source-clock inventory. Asset loading stays outside RecorderCore.
export interface RecordingSourceMedia {
  manifest: ProjectMediaManifest | null;
  videoRange: MediaTimeRange;
  systemAudioRange: MediaTimeRange | null;
  cameraRange: MediaTimeRange | null;
  microphoneRange: MediaTimeRange | null;
  pointerEvents: readonly PointerEventRecord[];
}

export function makeRecordingSourceMedia(options: {
  manifest: ProjectMediaManifest | null;
  videoRange: MediaTimeRange;
  systemAudioRange?: MediaTimeRange | null;
  cameraRange?: MediaTimeRange | null;
  microphoneRange?: MediaTimeRange | null;
  pointerEvents?: readonly PointerEventRecord[];
}): RecordingSourceMedia {
  return {
    manifest: options.manifest,
    videoRange: options.videoRange,
    systemAudioRange: options.systemAudioRange ?? null,
    cameraRange: options.cameraRange ?? null,
    microphoneRange: options.microphoneRange ?? null,
    pointerEvents: options.pointerEvents ? options.pointerEvents.slice() : [],
  };
}

/**
 * Every time-bearing source resolved onto one final output clock. Missing
 * auxiliary tracks remain gaps; they never borrow another source's media.
 */
export class ProjectTimelineMediaPlan {
  readonly timelineMap: TimelineMap;
  readonly primary: TimelineMediaPlan;
  readonly systemAudio: TimelineMediaPlan | null;
  readonly camera: TimelineMediaPlan | null;
  readonly microphone: TimelineMediaPlan | null;
  readonly pointer: ProjectPointerTrack;
  readonly sources: ReadonlyMap<string, RecordingSourceMedia>;

  get sourceTimeOffsets(): Map<string, number> {
    const result = new Map<string, number>();
    for (const [id, src] of this.sources.entries()) {
      result.set(id, src.videoRange.start);
    }
    return result;
  }

  get primarySourceTimeOffset(): number {
    return this.sources.get(RecordingSourcePrimaryID)?.videoRange.start ?? 0;
  }

  constructor(options: {
    sourceSequence?: SourceSequence;
    project?: RecorderProject;
    sources?: ReadonlyMap<string, RecordingSourceMedia> | Record<string, RecordingSourceMedia>;
    mediaManifest?: ProjectMediaManifest | null;
    primaryVideoRange?: MediaTimeRange;
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

    const sourcesMap = new Map<string, RecordingSourceMedia>();
    if (options.sources !== undefined) {
      if (options.sources instanceof Map) {
        for (const [k, v] of (options.sources as ReadonlyMap<string, RecordingSourceMedia>).entries()) {
          sourcesMap.set(k, v);
        }
      } else {
        for (const [k, v] of Object.entries(
          options.sources as Record<string, RecordingSourceMedia>
        )) {
          sourcesMap.set(k, v);
        }
      }
    } else if (options.primaryVideoRange) {
      const mediaManifest = options.mediaManifest ?? options.project?.media ?? null;
      sourcesMap.set(
        RecordingSourcePrimaryID,
        makeRecordingSourceMedia({
          manifest: mediaManifest,
          videoRange: options.primaryVideoRange,
          systemAudioRange: options.systemAudioRange ?? null,
          cameraRange: options.cameraRange ?? null,
          microphoneRange: options.microphoneRange ?? null,
          pointerEvents: options.sourcePointerEvents ?? [],
        })
      );
    } else {
      throw new Error('ProjectTimelineMediaPlan requires sources or primaryVideoRange');
    }

    this.sources = sourcesMap;
    const durations = new Map<string, number>();
    for (const [id, src] of sourcesMap.entries()) {
      durations.set(id, src.videoRange.duration);
    }
    const map = new TimelineMap({ sourceSequence, sourceDurations: durations });
    this.timelineMap = map;
    this.primary = new TimelineMediaPlan({ primary: map });

    const systemPlans: TimelineMediaPlan[] = [];
    const cameraPlans: TimelineMediaPlan[] = [];
    const microphonePlans: TimelineMediaPlan[] = [];
    const alignedPrimaryEvents: PointerEventRecord[] = [];

    for (const [id, source] of sourcesMap.entries()) {
      if (source.systemAudioRange) {
        const sharedStart = max(source.systemAudioRange.start, source.videoRange.start);
        const placement = makeMediaTimelinePlacement({
          reference: makeProjectMediaReference({
            relativePath: source.manifest?.screen.relativePath ?? 'screen',
            startOffset: max(source.systemAudioRange.start - source.videoRange.start, 0),
            sourceStartTime: sharedStart,
          }),
          sourceAvailableStart: source.systemAudioRange.start,
          sourceAvailableDuration: source.systemAudioRange.duration,
          timelineDuration: source.videoRange.duration,
        });
        systemPlans.push(
          new TimelineMediaPlan({ timelineMap: map, auxiliary: placement, sourceID: id })
        );
      }

      const cameraPlan = ProjectTimelineMediaPlan.auxiliaryPlan(
        source.manifest?.camera ?? null,
        source.cameraRange,
        id,
        map,
        source.videoRange.duration
      );
      if (cameraPlan) cameraPlans.push(cameraPlan);

      const micPlan = ProjectTimelineMediaPlan.auxiliaryPlan(
        source.manifest?.microphone ?? null,
        source.microphoneRange,
        id,
        map,
        source.videoRange.duration
      );
      if (micPlan) microphonePlans.push(micPlan);

      if (id === RecordingSourcePrimaryID) {
        const aligned = PointerTimelineAlignment.align(
          source.pointerEvents,
          source.manifest?.pointerEvents?.startOffset ?? 0,
          source.manifest?.pointerEvents?.sourceStartTime ?? 0
        );
        alignedPrimaryEvents.push(...aligned);
      }
    }

    this.systemAudio =
      systemPlans.length === 0
        ? null
        : new TimelineMediaPlan({ outputDuration: map.outputDuration, combining: systemPlans });
    this.camera =
      cameraPlans.length === 0
        ? null
        : new TimelineMediaPlan({ outputDuration: map.outputDuration, combining: cameraPlans });
    this.microphone =
      microphonePlans.length === 0
        ? null
        : new TimelineMediaPlan({ outputDuration: map.outputDuration, combining: microphonePlans });
    // Note: Multi-source ProjectPointerTrack(eventsBySource) completes in T13.5b-2.
    this.pointer = new ProjectPointerTrack(map, alignedPrimaryEvents);
  }

  get outputDuration(): number {
    return this.primary.outputDuration;
  }

  private static auxiliaryPlan(
    reference: ProjectMediaReference | null,
    availableRange: MediaTimeRange | null,
    sourceID: string,
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
      sourceID,
      syncAnchors: reference.syncAnchors,
      sourceAvailableRange: availableRange,
    });
  }
}
