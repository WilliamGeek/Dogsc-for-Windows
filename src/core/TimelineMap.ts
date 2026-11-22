// Port of: F:\dogsc-v0.2.0\Sources\RecorderCore\TimelineMap.swift

import { min, max } from './swift.ts';
import { type MediaTimeRange, makeMediaTimeRange } from './MediaTimeRange.ts';
import type { NormalizedCrop } from './ProjectModel.ts';
import { type PointerEventRecord, makePointerEventRecord } from './ZoomAnimation.ts';
import { PointerEventTimelineOrdering } from './PointerEventTimelineOrdering.ts';
import {
  type InsertedMedia,
  type RecordingSegment,
  makeRecordingSegment,
  type SourceSequence,
  makeSourceSequenceEdited,
  recordingSegmentResolvedSourceID,
} from './ProjectTimeline.ts';
import { RecordingSourcePrimaryID } from './RecordingSource.ts';
import type { SegmentSceneStyle } from './SegmentSceneStyle.ts';

const NUMERICAL_BOUNDARY_TOLERANCE = 0.000_000_001;

function isSameBoundary(lhs: number, rhs: number): boolean {
  return Math.abs(lhs - rhs) <= NUMERICAL_BOUNDARY_TOLERANCE;
}

// MARK: - TimelineMapError

export type TimelineMapErrorKind =
  | 'invalidFullSourceDuration'
  | 'emptyEditedSequence'
  | 'duplicateSegmentID'
  | 'invalidSegment'
  | 'segmentOutsideSource';

export class TimelineMapError extends Error {
  readonly kind: TimelineMapErrorKind;
  readonly segmentID?: string;
  readonly previousID?: string;
  readonly currentID?: string;

  constructor(
    kind: TimelineMapErrorKind,
    options?: { segmentID?: string; previousID?: string; currentID?: string }
  ) {
    let msg: string;
    switch (kind) {
      case 'invalidFullSourceDuration':
        msg = '主录屏时长必须是正的有限数。';
        break;
      case 'emptyEditedSequence':
        msg = '剪辑后至少需要保留一个主录屏片段。';
        break;
      case 'duplicateSegmentID':
        msg = '时间线中存在重复的主片段。';
        break;
      case 'invalidSegment':
        msg = '主片段包含无效的时间范围。';
        break;
      case 'segmentOutsideSource':
        msg = '主片段超出原始录屏可用时长。';
        break;
    }
    super(msg);
    this.name = 'TimelineMapError';
    this.kind = kind;
    this.segmentID = options?.segmentID;
    this.previousID = options?.previousID;
    this.currentID = options?.currentID;
  }
}

// MARK: - ResolvedRecordingSegment

export class ResolvedRecordingSegment {
  readonly id: string;
  readonly sourceID: string;
  readonly sourceStart: number;
  readonly sourceDuration: number;
  readonly playbackRate: number;
  readonly outputStart: number;
  /// Non-nil for an inserted video: source times are in that file and the
  /// recording's camera, audio and pointer are absent for this span.
  readonly media: InsertedMedia | null;
  readonly sceneStyle: SegmentSceneStyle | null;
  /// nil follows the recording source's crop; a value is this occurrence's own.
  readonly crop: NormalizedCrop | null;

  constructor(options: {
    id: string;
    sourceStart: number;
    sourceDuration: number;
    playbackRate?: number;
    outputStart: number;
    media?: InsertedMedia | null;
    sourceID?: string;
    sceneStyle?: SegmentSceneStyle | null;
    crop?: NormalizedCrop | null;
  }) {
    this.id = options.id;
    this.sourceID = options.sourceID ?? RecordingSourcePrimaryID;
    this.sourceStart = options.sourceStart;
    this.sourceDuration = options.sourceDuration;
    this.playbackRate = options.playbackRate ?? 1;
    this.outputStart = options.outputStart;
    this.media = options.media ?? null;
    this.sceneStyle = options.sceneStyle ?? null;
    this.crop = options.crop ?? null;
  }

  get isInserted(): boolean {
    return this.media != null;
  }

  get sourceEnd(): number {
    return this.sourceStart + this.sourceDuration;
  }

  get outputDuration(): number {
    return this.sourceDuration / this.playbackRate;
  }

  get outputEnd(): number {
    return this.outputStart + this.outputDuration;
  }

  get sourceRange(): MediaTimeRange | null {
    return makeMediaTimeRange(this.sourceStart, this.sourceDuration);
  }

  get outputRange(): MediaTimeRange | null {
    return makeMediaTimeRange(this.outputStart, this.outputDuration);
  }
}

// MARK: - TimelineMappedPointerSegment

/// Pointer events are kept in groups across cuts. Flattening them would let an
/// interpolator travel through a deleted interval toward the next segment's
/// first position, creating motion that never existed in the finished video.
export interface TimelineMappedPointerSegment {
  readonly id: string;
  readonly sourceID: string;
  readonly outputRange: MediaTimeRange;
  readonly events: readonly PointerEventRecord[];
}

export function makeTimelineMappedPointerSegment(options: {
  id: string;
  sourceID?: string;
  outputRange: MediaTimeRange;
  events: readonly PointerEventRecord[];
}): TimelineMappedPointerSegment {
  return {
    id: options.id,
    sourceID: options.sourceID ?? RecordingSourcePrimaryID,
    outputRange: options.outputRange,
    events: options.events.slice(),
  };
}

// MARK: - RecordingSourcePosition & RecordingOutputPosition

/// A recording time is meaningful only with its source and occurrence.
export interface RecordingSourcePosition {
  readonly sourceID: string;
  readonly segmentID: string;
  readonly time: number;
}

export interface RecordingOutputPosition {
  readonly segmentID: string;
  readonly time: number;
  readonly id: string;
}

// MARK: - TimelineMap

export type TimelineSourceDurationsInput =
  | number
  | ReadonlyMap<string, number>
  | Record<string, number>;

export function toSourceDurationsMap(
  input: TimelineSourceDurationsInput,
): Map<string, number> {
  if (typeof input === 'number') {
    return new Map([[RecordingSourcePrimaryID, input]]);
  }
  if (input instanceof Map) {
    return new Map(input as ReadonlyMap<string, number>);
  }
  return new Map(Object.entries(input as Record<string, number>));
}

/**
 * Array order is output order. A source interval may occur repeatedly; the
 * segment ID disambiguates each independently editable use of that interval.
 */
export class TimelineMap {
  static readonly fullRecordingSegmentID = '00000000-0000-4000-8000-000000000001';

  readonly segments: readonly ResolvedRecordingSegment[];
  readonly sourceDurations: ReadonlyMap<string, number>;

  constructor(
    sourceSequenceOrOptions:
      | SourceSequence
      | {
          sourceSequence: SourceSequence;
          fullSourceDuration?: number;
          sourceDurations?: ReadonlyMap<string, number> | Record<string, number>;
        },
    durationOrMap?: TimelineSourceDurationsInput
  ) {
    let sourceSequence: SourceSequence;
    let durationsMap: Map<string, number>;

    if (
      typeof sourceSequenceOrOptions === 'object' &&
      sourceSequenceOrOptions !== null &&
      'sourceSequence' in sourceSequenceOrOptions
    ) {
      sourceSequence = sourceSequenceOrOptions.sourceSequence;
      if (sourceSequenceOrOptions.sourceDurations !== undefined) {
        durationsMap = toSourceDurationsMap(sourceSequenceOrOptions.sourceDurations);
      } else if (sourceSequenceOrOptions.fullSourceDuration !== undefined) {
        durationsMap = new Map([[RecordingSourcePrimaryID, sourceSequenceOrOptions.fullSourceDuration]]);
      } else {
        throw new TimelineMapError('invalidFullSourceDuration');
      }
    } else {
      sourceSequence = sourceSequenceOrOptions as SourceSequence;
      if (durationOrMap === undefined) {
        throw new TimelineMapError('invalidFullSourceDuration');
      }
      durationsMap = toSourceDurationsMap(durationOrMap);
    }

    for (const d of durationsMap.values()) {
      if (!Number.isFinite(d) || !(d > 0)) {
        throw new TimelineMapError('invalidFullSourceDuration');
      }
    }
    this.sourceDurations = durationsMap;

    let authored: readonly RecordingSegment[];
    switch (sourceSequence.kind) {
      case 'fullRecording': {
        const primaryDuration = durationsMap.get(RecordingSourcePrimaryID);
        if (primaryDuration === undefined) {
          throw new TimelineMapError('invalidFullSourceDuration');
        }
        authored = [
          makeRecordingSegment({
            id: TimelineMap.fullRecordingSegmentID,
            sourceStart: 0,
            sourceDuration: primaryDuration,
          }),
        ];
        break;
      }
      case 'edited':
        if (sourceSequence.segments.length === 0) {
          throw new TimelineMapError('emptyEditedSequence');
        }
        authored = sourceSequence.segments;
        break;
    }

    const identifiers = new Set<string>();
    let outputStart = 0;
    const resolved: ResolvedRecordingSegment[] = [];
    const epsilon = 1.0 / 120_000.0;

    for (const segment of authored) {
      if (identifiers.has(segment.id)) {
        throw new TimelineMapError('duplicateSegmentID', { segmentID: segment.id });
      }
      identifiers.add(segment.id);

      const segSourceEnd = segment.sourceStart + segment.sourceDuration;
      if (
        !Number.isFinite(segment.sourceStart) ||
        !Number.isFinite(segment.sourceDuration) ||
        !Number.isFinite(segment.playbackRate) ||
        segment.sourceStart < 0 ||
        segment.sourceDuration <= 0 ||
        segment.playbackRate <= 0 ||
        !Number.isFinite(segSourceEnd)
      ) {
        throw new TimelineMapError('invalidSegment', { segmentID: segment.id });
      }

      const segSourceID = recordingSegmentResolvedSourceID(segment);
      const availableDuration = segment.media?.fileDuration ?? durationsMap.get(segSourceID);
      if (
        availableDuration === undefined ||
        !Number.isFinite(availableDuration) ||
        !(availableDuration > 0) ||
        !(segment.sourceStart < availableDuration) ||
        !(segSourceEnd <= availableDuration + epsilon)
      ) {
        throw new TimelineMapError('segmentOutsideSource', { segmentID: segment.id });
      }

      const resolvedDuration = min(segment.sourceDuration, availableDuration - segment.sourceStart);
      if (!(resolvedDuration > 0)) {
        throw new TimelineMapError('segmentOutsideSource', { segmentID: segment.id });
      }

      resolved.push(
        new ResolvedRecordingSegment({
          id: segment.id,
          sourceStart: segment.sourceStart,
          sourceDuration: resolvedDuration,
          playbackRate: segment.playbackRate,
          outputStart,
          media: segment.media ?? null,
          sourceID: segSourceID,
          sceneStyle: segment.sceneStyle ?? null,
          crop: segment.crop ?? null,
        })
      );
      outputStart += resolvedDuration / segment.playbackRate;
    }

    this.segments = resolved;
  }

  get fullSourceDuration(): number {
    return this.sourceDurations.get(RecordingSourcePrimaryID) ?? 0;
  }

  get outputDuration(): number {
    return this.segments.length > 0 ? this.segments[this.segments.length - 1].outputEnd : 0;
  }

  segment(atOutputTime: number): ResolvedRecordingSegment | null {
    if (!Number.isFinite(atOutputTime) || atOutputTime < 0 || atOutputTime >= this.outputDuration) {
      return null;
    }
    let lower = 0;
    let upper = this.segments.length;
    while (lower < upper) {
      const middle = lower + Math.trunc((upper - lower) / 2);
      const end = this.segments[middle].outputEnd;
      if (end < atOutputTime || isSameBoundary(end, atOutputTime)) {
        lower = middle + 1;
      } else {
        upper = middle;
      }
    }
    if (lower >= this.segments.length) return null;
    const candidate = this.segments[lower];
    return atOutputTime > candidate.outputStart || isSameBoundary(atOutputTime, candidate.outputStart)
      ? candidate
      : null;
  }

  segmentAtOutputTime(atOutputTime: number): ResolvedRecordingSegment | null {
    return this.segment(atOutputTime);
  }

  sourcePosition(atOutputTime: number): RecordingSourcePosition | null {
    const seg = this.segment(atOutputTime);
    if (!seg || seg.isInserted) return null;
    return {
      sourceID: seg.sourceID,
      segmentID: seg.id,
      time: seg.sourceStart + max(atOutputTime - seg.outputStart, 0) * seg.playbackRate,
    };
  }

  sourceTime(atOutputTime: number): number | null {
    const position = this.sourcePosition(atOutputTime);
    if (!position || position.sourceID !== RecordingSourcePrimaryID) return null;
    return position.time;
  }

  outputPositions(forSourceTime: number, sourceID: string): RecordingOutputPosition[] {
    if (!Number.isFinite(forSourceTime)) return [];
    const result: RecordingOutputPosition[] = [];
    for (const seg of this.segments) {
      if (
        !seg.isInserted &&
        seg.sourceID === sourceID &&
        forSourceTime >= seg.sourceStart &&
        forSourceTime < seg.sourceEnd
      ) {
        const mapped = seg.outputStart + (forSourceTime - seg.sourceStart) / seg.playbackRate;
        result.push({
          segmentID: seg.id,
          id: seg.id,
          time: mapped,
        });
      }
    }
    return result;
  }

  outputTime(forSourceTime: number, inSegmentID?: string): number | null {
    if (inSegmentID !== undefined) {
      if (!Number.isFinite(forSourceTime)) return null;
      const seg = this.segments.find((s) => s.id === inSegmentID);
      if (!seg || forSourceTime < seg.sourceStart || forSourceTime >= seg.sourceEnd) {
        return null;
      }
      return seg.outputStart + (forSourceTime - seg.sourceStart) / seg.playbackRate;
    }
    const positions = this.outputPositions(forSourceTime, RecordingSourcePrimaryID);
    return positions.length > 0 ? positions[0].time : null;
  }

  outputRange(forSegmentID: string): MediaTimeRange | null {
    return this.segments.find((s) => s.id === forSegmentID)?.outputRange ?? null;
  }

  sourceRange(forSegmentID: string): MediaTimeRange | null {
    return this.segments.find((s) => s.id === forSegmentID)?.sourceRange ?? null;
  }

  materializedSourceSequence(): SourceSequence {
    return makeSourceSequenceEdited(
      this.segments.map((s) =>
        makeRecordingSegment({
          id: s.id,
          sourceStart: s.sourceStart,
          sourceDuration: s.sourceDuration,
          playbackRate: s.playbackRate,
          media: s.media,
          sourceID: s.sourceID === RecordingSourcePrimaryID ? null : s.sourceID,
          sceneStyle: s.sceneStyle,
          crop: s.crop,
        })
      )
    );
  }

  /**
   * Maps events into output time while retaining cut boundaries. Each group
   * receives the most recent source position as a move seed when possible.
   */
  mapPointerEventSegments(
    sourceEventsOrBySource:
      | readonly PointerEventRecord[]
      | ReadonlyMap<string, readonly PointerEventRecord[]>
      | Record<string, readonly PointerEventRecord[]>
  ): TimelineMappedPointerSegment[] {
    const rawBySource = new Map<string, readonly PointerEventRecord[]>();
    if (Array.isArray(sourceEventsOrBySource)) {
      rawBySource.set(RecordingSourcePrimaryID, sourceEventsOrBySource);
    } else if (sourceEventsOrBySource instanceof Map) {
      for (const [k, v] of sourceEventsOrBySource.entries()) {
        rawBySource.set(k, v);
      }
    } else {
      for (const [k, v] of Object.entries(
        sourceEventsOrBySource as Record<string, readonly PointerEventRecord[]>
      )) {
        rawBySource.set(k, v);
      }
    }

    const orderedSources = new Map<string, readonly PointerEventRecord[]>();
    for (const [k, events] of rawBySource.entries()) {
      orderedSources.set(k, PointerEventTimelineOrdering.normalized(events));
    }

    const result: TimelineMappedPointerSegment[] = [];
    for (const segment of this.segments) {
      if (segment.media != null) continue;
      const outputRange = segment.outputRange;
      if (!outputRange) continue;

      const ordered = orderedSources.get(segment.sourceID) ?? [];
      const lowerIndex = TimelineMap.firstEventIndex(segment.sourceStart, ordered);
      const upperIndex = TimelineMap.firstEventIndex(segment.sourceEnd, ordered);
      const eventsInRange = ordered.slice(lowerIndex, upperIndex);
      const mapped: PointerEventRecord[] = [];

      const firstEvent = eventsInRange[0];
      const startsWithExactEvent =
        firstEvent != null && Math.abs(firstEvent.time - segment.sourceStart) < 0.000_001;

      if (!startsWithExactEvent && lowerIndex > 0) {
        const seed = ordered[lowerIndex - 1];
        mapped.push(
          makePointerEventRecord({
            time: segment.outputStart,
            location: seed.location,
            kind: 'move',
            modifiers: seed.modifiers,
            cursorAssetID: seed.cursorAssetID,
          })
        );
      }

      for (const event of eventsInRange) {
        mapped.push(
          makePointerEventRecord({
            time:
              segment.outputStart + (event.time - segment.sourceStart) / segment.playbackRate,
            location: event.location,
            kind: event.kind,
            modifiers: event.modifiers,
            cursorAssetID: event.cursorAssetID,
          })
        );
      }

      result.push(
        makeTimelineMappedPointerSegment({
          id: segment.id,
          sourceID: segment.sourceID,
          outputRange,
          events: mapped,
        })
      );
    }

    return result;
  }

  private static firstEventIndex(
    time: number,
    events: readonly PointerEventRecord[]
  ): number {
    let lower = 0;
    let upper = events.length;
    while (lower < upper) {
      const middle = lower + Math.trunc((upper - lower) / 2);
      if (events[middle].time < time) {
        lower = middle + 1;
      } else {
        upper = middle;
      }
    }
    return lower;
  }
}
