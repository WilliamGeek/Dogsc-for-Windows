// Port of: F:\dogsc\Sources\RecorderCore\TimelineMap.swift

import { min, max } from './swift.ts';
import { type MediaTimeRange, makeMediaTimeRange } from './MediaTimeRange.ts';
import { type PointerEventRecord, makePointerEventRecord } from './ZoomAnimation.ts';
import { PointerEventTimelineOrdering } from './PointerEventTimelineOrdering.ts';
import {
  type RecordingSegment,
  makeRecordingSegment,
  type SourceSequence,
  makeSourceSequenceEdited,
} from './ProjectTimeline.ts';

// MARK: - TimelineMapError

export type TimelineMapErrorKind =
  | 'invalidFullSourceDuration'
  | 'emptyEditedSequence'
  | 'duplicateSegmentID'
  | 'invalidSegment'
  | 'segmentOutsideSource'
  | 'nonMonotonicSegments';

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
      case 'nonMonotonicSegments':
        msg = '主片段不能重复使用同一段源素材。';
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
  readonly sourceStart: number;
  readonly sourceDuration: number;
  readonly playbackRate: number;
  readonly outputStart: number;

  constructor(options: {
    id: string;
    sourceStart: number;
    sourceDuration: number;
    playbackRate?: number;
    outputStart: number;
  }) {
    this.id = options.id;
    this.sourceStart = options.sourceStart;
    this.sourceDuration = options.sourceDuration;
    this.playbackRate = options.playbackRate ?? 1;
    this.outputStart = options.outputStart;
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

export interface TimelineMappedPointerSegment {
  readonly id: string;
  readonly outputRange: MediaTimeRange;
  readonly events: readonly PointerEventRecord[];
}

export function makeTimelineMappedPointerSegment(options: {
  id: string;
  outputRange: MediaTimeRange;
  events: readonly PointerEventRecord[];
}): TimelineMappedPointerSegment {
  return {
    id: options.id,
    outputRange: options.outputRange,
    events: options.events.slice(),
  };
}

// MARK: - TimelineMap

/**
 * Pure mapping between the final ripple timeline and the original recording
 * clock. Array order is output order; source ranges may be rearranged but
 * remain non-overlapping so every original source instant has one owner.
 */
export class TimelineMap {
  static readonly fullRecordingSegmentID = '00000000-0000-4000-8000-000000000001';

  readonly segments: readonly ResolvedRecordingSegment[];
  readonly fullSourceDuration: number;

  constructor(sourceSequence: SourceSequence, fullSourceDuration: number) {
    if (!Number.isFinite(fullSourceDuration) || fullSourceDuration <= 0) {
      throw new TimelineMapError('invalidFullSourceDuration');
    }
    this.fullSourceDuration = fullSourceDuration;

    let authored: readonly RecordingSegment[];
    switch (sourceSequence.kind) {
      case 'fullRecording':
        authored = [
          makeRecordingSegment({
            id: TimelineMap.fullRecordingSegmentID,
            sourceStart: 0,
            sourceDuration: fullSourceDuration,
          }),
        ];
        break;
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
    const epsilon = 1.0 / 120000.0;

    for (const segment of authored) {
      if (identifiers.has(segment.id)) {
        throw new TimelineMapError('duplicateSegmentID', { segmentID: segment.id });
      }
      identifiers.add(segment.id);

      if (
        !Number.isFinite(segment.sourceStart) ||
        !Number.isFinite(segment.sourceDuration) ||
        !Number.isFinite(segment.playbackRate) ||
        segment.sourceStart < 0 ||
        segment.sourceDuration <= 0 ||
        segment.playbackRate <= 0 ||
        !Number.isFinite(segment.sourceEnd)
      ) {
        throw new TimelineMapError('invalidSegment', { segmentID: segment.id });
      }

      const availableDuration = fullSourceDuration;
      if (
        !(
          segment.sourceStart < availableDuration &&
          segment.sourceEnd <= availableDuration + epsilon
        )
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
        })
      );
      outputStart += resolvedDuration / segment.playbackRate;
    }

    for (const current of authored) {
      const candidates = authored.filter(
        (candidate) => candidate.id !== current.id && candidate.sourceStart <= current.sourceStart
      );
      if (candidates.length > 0) {
        const sorted = candidates.slice().sort((lhs, rhs) => {
          if (lhs.sourceStart !== rhs.sourceStart) {
            return lhs.sourceStart - rhs.sourceStart;
          }
          return lhs.id.localeCompare(rhs.id);
        });
        const previous = sorted[sorted.length - 1];
        if (current.sourceStart < previous.sourceEnd - epsilon) {
          throw new TimelineMapError('nonMonotonicSegments', {
            previousID: previous.id,
            currentID: current.id,
          });
        }
      }
    }

    this.segments = resolved;
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
      const middle = lower + Math.floor((upper - lower) / 2);
      if (this.segments[middle].outputEnd <= atOutputTime) {
        lower = middle + 1;
      } else {
        upper = middle;
      }
    }
    if (lower >= this.segments.length) return null;
    const candidate = this.segments[lower];
    return atOutputTime >= candidate.outputStart ? candidate : null;
  }

  sourceTime(atOutputTime: number): number | null {
    const seg = this.segment(atOutputTime);
    if (!seg) return null;
    return seg.sourceStart + (atOutputTime - seg.outputStart) * seg.playbackRate;
  }

  outputTime(forSourceTime: number): number | null {
    if (!Number.isFinite(forSourceTime)) return null;
    const seg = this.segments.find(
      (s) => forSourceTime >= s.sourceStart && forSourceTime < s.sourceEnd
    );
    if (!seg) return null;
    return seg.outputStart + (forSourceTime - seg.sourceStart) / seg.playbackRate;
  }

  outputRange(forSegmentID: string): MediaTimeRange | null {
    return this.segments.find((s) => s.id === idMatch(s.id, forSegmentID))?.outputRange ?? null;
  }

  sourceRange(forSegmentID: string): MediaTimeRange | null {
    return this.segments.find((s) => s.id === idMatch(s.id, forSegmentID))?.sourceRange ?? null;
  }

  materializedSourceSequence(): SourceSequence {
    return makeSourceSequenceEdited(
      this.segments.map((s) =>
        makeRecordingSegment({
          id: s.id,
          sourceStart: s.sourceStart,
          sourceDuration: s.sourceDuration,
          playbackRate: s.playbackRate,
        })
      )
    );
  }

  /**
   * Maps events into output time while retaining cut boundaries. Each group
   * receives the most recent source position as a move seed when possible.
   */
  mapPointerEventSegments(
    sourceEvents: readonly PointerEventRecord[]
  ): TimelineMappedPointerSegment[] {
    const ordered = PointerEventTimelineOrdering.normalized(sourceEvents);
    const result: TimelineMappedPointerSegment[] = [];

    for (const segment of this.segments) {
      const outputRange = segment.outputRange;
      if (!outputRange) continue;

      const lowerIndex = TimelineMap.firstEventIndex(segment.sourceStart, ordered);
      const upperIndex = TimelineMap.firstEventIndex(segment.sourceEnd, ordered);
      const eventsInRange = ordered.slice(lowerIndex, upperIndex);
      const mapped: PointerEventRecord[] = [];

      const firstEvent = eventsInRange[0];
      const startsWithExactEvent =
        firstEvent != null && Math.abs(firstEvent.time - segment.sourceStart) < 0.000001;

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
      const middle = lower + Math.floor((upper - lower) / 2);
      if (events[middle].time < time) {
        lower = middle + 1;
      } else {
        upper = middle;
      }
    }
    return lower;
  }
}

function idMatch(a: string, b: string): string {
  return a.toLowerCase() === b.toLowerCase() ? a : '';
}
