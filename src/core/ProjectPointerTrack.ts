// Port of: F:\dogsc-v0.2.0\Sources\RecorderCore\ProjectPointerTrack.swift

import { min, max } from './swift.ts';
import { type MediaTimeRange, makeMediaTimeRange } from './MediaTimeRange.ts';
import {
  PointerTrack,
  type PointerSample,
  type PointerTrackEvaluation,
} from './PointerTrack.ts';
import {
  type PointerEventRecord,
  NormalizedPoint,
  makeNormalizedPoint,
  type ZoomAnimationClip,
  makeZoomAnimationClip,
  ZoomViewportTransform,
} from './ZoomAnimation.ts';
import { TimelineMap } from './TimelineMap.ts';
import { RecordingSourcePrimaryID } from './RecordingSource.ts';
import {
  type MotionStyle,
  makeMotionStyle,
  type CursorStyle,
  makeCursorStyle,
} from './ProjectModel.ts';
import { BoundedMemoizationCache } from './BoundedMemoizationCache.ts';

const _nextDownBuf = new ArrayBuffer(8);
const _nextDownF64 = new Float64Array(_nextDownBuf);
const _nextDownU64 = new BigInt64Array(_nextDownBuf);

function nextDown(value: number): number {
  if (Number.isNaN(value) || value === -Infinity) return value;
  if (value === Infinity) return Number.MAX_VALUE;
  if (value === 0) return -Number.MIN_VALUE;
  _nextDownF64[0] = value;
  if (value > 0) {
    _nextDownU64[0] -= 1n;
  } else {
    _nextDownU64[0] += 1n;
  }
  return _nextDownF64[0];
}

export type EventsBySourceInput =
  | ReadonlyMap<string, readonly PointerEventRecord[]>
  | Record<string, readonly PointerEventRecord[]>;

// MARK: - ProjectPointerTrackSegment

/**
 * One independently reconstructed pointer path for a retained recording
 * segment. Deleted source movement is never replayed; `ProjectPointerTrack`
 * joins the two retained endpoints in the final output clock instead.
 */
export class ProjectPointerTrackSegment {
  readonly id: string;
  readonly sourceID: string;
  readonly outputRange: MediaTimeRange;
  readonly track: PointerTrack;
  readonly firstClickTime: number | null;
  readonly startsAfterSourceDiscontinuity: boolean;

  constructor(options: {
    id: string;
    outputRange: MediaTimeRange;
    track: PointerTrack;
    startsAfterSourceDiscontinuity?: boolean;
    sourceID?: string;
  }) {
    this.id = options.id;
    this.sourceID = options.sourceID ?? RecordingSourcePrimaryID;
    this.outputRange = options.outputRange;
    this.track = options.track;
    this.startsAfterSourceDiscontinuity =
      options.startsAfterSourceDiscontinuity ?? false;
    const first = options.track.events.find(
      (e) =>
        e.time >= options.outputRange.start &&
        (e.kind === 'leftClick' || e.kind === 'rightClick')
    );
    this.firstClickTime = first ? first.time : null;
  }
}

interface AutomaticCameraFocusSample {
  readonly time: number;
  readonly focus: NormalizedPoint;
}

// MARK: - ProjectPointerTrack

/**
 * Pointer evaluator in the final output-time domain across single or multiple
 * recording sources.
 */
export class ProjectPointerTrack {
  /**
   * CUR-005: long enough to read as a deliberate move, short enough not to
   * hide the first action in the retained clip.
   */
  private static readonly cutBridgeDuration: number = 0.28;
  private static readonly endpointEpsilon: number = 1.0 / 10000.0;

  readonly segments: readonly ProjectPointerTrackSegment[];
  private readonly automaticCameraRanges: readonly MediaTimeRange[];
  private readonly cursorActivityTimes: readonly number[];
  private readonly automaticCameraFocusCache: BoundedMemoizationCache<
    string,
    readonly AutomaticCameraFocusSample[]
  >;

  constructor(
    timelineMapOrOptions:
      | TimelineMap
      | {
          timelineMap: TimelineMap;
          sourceEvents?: readonly PointerEventRecord[];
          eventsBySource?: EventsBySourceInput;
        },
    sourceEventsOrBySource?: readonly PointerEventRecord[] | EventsBySourceInput
  ) {
    let timelineMap: TimelineMap;
    let eventsBySource: EventsBySourceInput;

    if (timelineMapOrOptions instanceof TimelineMap) {
      timelineMap = timelineMapOrOptions;
      if (Array.isArray(sourceEventsOrBySource)) {
        eventsBySource = new Map([[RecordingSourcePrimaryID, sourceEventsOrBySource]]);
      } else if (sourceEventsOrBySource) {
        eventsBySource = sourceEventsOrBySource as EventsBySourceInput;
      } else {
        eventsBySource = new Map();
      }
    } else {
      timelineMap = timelineMapOrOptions.timelineMap;
      if (timelineMapOrOptions.eventsBySource !== undefined) {
        eventsBySource = timelineMapOrOptions.eventsBySource;
      } else if (timelineMapOrOptions.sourceEvents !== undefined) {
        eventsBySource = new Map([
          [RecordingSourcePrimaryID, timelineMapOrOptions.sourceEvents],
        ]);
      } else {
        eventsBySource = new Map();
      }
    }

    const discontinuities = new Set<string>();
    const recording = timelineMap.segments.filter((s) => s.media == null);
    for (let index = 0; index < recording.length; index++) {
      const segment = recording[index];
      const previousEnd = index > 0 ? recording[index - 1].sourceEnd : 0;
      if (
        Math.abs(segment.sourceStart - previousEnd) >
          ProjectPointerTrack.endpointEpsilon ||
        (index > 0 && recording[index - 1].sourceID !== segment.sourceID)
      ) {
        discontinuities.add(segment.id);
      }
    }

    this.segments = timelineMap.mapPointerEventSegments(eventsBySource).map(
      (mapped) =>
        new ProjectPointerTrackSegment({
          id: mapped.id,
          outputRange: mapped.outputRange,
          track: new PointerTrack(mapped.events),
          startsAfterSourceDiscontinuity: discontinuities.has(mapped.id),
          sourceID: mapped.sourceID,
        })
    );

    // Consecutive segments of the same recording preserve camera run state;
    // switching sources or inserting media splits runs cleanly.
    const ranges: MediaTimeRange[] = [];
    let runStart = 0;
    while (runStart < this.segments.length) {
      let runEnd = runStart;
      while (
        runEnd + 1 < this.segments.length &&
        this.segments[runEnd + 1].sourceID === this.segments[runStart].sourceID &&
        Math.abs(
          this.segments[runEnd].outputRange.end -
            this.segments[runEnd + 1].outputRange.start
        ) <= ProjectPointerTrack.endpointEpsilon
      ) {
        runEnd += 1;
      }
      const start = this.segments[runStart].outputRange.start;
      const dur = this.segments[runEnd].outputRange.end - start;
      const range = makeMediaTimeRange(start, dur)!;
      for (let i = runStart; i <= runEnd; i++) {
        ranges.push(range);
      }
      runStart = runEnd + 1;
    }
    this.automaticCameraRanges = ranges;

    const activity: number[] = [];
    let previous: NormalizedPoint | null = null;
    let previousEnd: number | null = null;
    let previousSourceID: string | null = null;
    for (const segment of this.segments) {
      if (previousSourceID !== segment.sourceID) {
        previous = null;
      }
      if (
        previousEnd != null &&
        segment.outputRange.start > previousEnd + ProjectPointerTrack.endpointEpsilon
      ) {
        previous = null;
      }
      for (const event of segment.track.events) {
        if (event.time >= segment.outputRange.start) {
          const moved =
            previous != null
              ? Math.abs(previous.x - event.location.x) > 0.000001 ||
                Math.abs(previous.y - event.location.y) > 0.000001
              : true;
          if (moved || event.kind !== 'move') {
            activity.push(event.time);
          }
          previous = event.location;
        }
      }
      previousEnd = segment.outputRange.end;
      previousSourceID = segment.sourceID;
    }
    this.cursorActivityTimes = activity;
    this.automaticCameraFocusCache = new BoundedMemoizationCache(4);
  }

  prewarmCursorSpring(motion: MotionStyle): void {
    if (motion.cursor !== '平滑' && motion.cursor !== 'smooth') return;
    for (const segment of this.segments) {
      segment.track.prewarmCursorSpring(motion);
    }
  }

  evaluation(
    outputTime: number,
    motion: MotionStyle = makeMotionStyle(),
    style: CursorStyle = makeCursorStyle(),
    automaticEntry: ZoomAnimationClip | null = null
  ): PointerTrackEvaluation {
    const segmentIndex = this.segmentIndex(outputTime);
    if (segmentIndex == null) {
      return { position: null, cursor: null };
    }
    const segment = this.segments[segmentIndex];
    const segmentStyle: CursorStyle = { ...style, hideWhenIdle: false };
    let current = segment.track.evaluation(outputTime, motion, segmentStyle);

    if (style.hideWhenIdle) {
      let lo = 0;
      let hi = this.cursorActivityTimes.length;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (this.cursorActivityTimes[mid] <= outputTime) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
      }
      if (lo > 0 && outputTime - this.cursorActivityTimes[lo - 1] > style.idleDelay) {
        current = { ...current, cursor: null };
      }
    }

    if (
      automaticEntry != null &&
      this.automaticEntryStartsAfterCut(automaticEntry) &&
      Math.abs(automaticEntry.startTime - segment.outputRange.start) <=
        ProjectPointerTrack.endpointEpsilon
    ) {
      return current;
    }

    if (segmentIndex > 0) {
      const bridgedPosition = this.cutBridgePosition(
        outputTime,
        segmentIndex,
        motion,
        style
      );
      if (bridgedPosition != null) {
        const bridgedCursor = current.cursor
          ? { ...current.cursor, location: bridgedPosition }
          : null;
        return {
          position: bridgedPosition,
          cursor: bridgedCursor,
        };
      }
    }

    return current;
  }

  sample(
    outputTime: number,
    motion: MotionStyle = makeMotionStyle(),
    style: CursorStyle = makeCursorStyle()
  ): PointerSample | null {
    return this.evaluation(outputTime, motion, style).cursor;
  }

  automaticEntryStartsAfterCut(clip: ZoomAnimationClip): boolean {
    if (clip.origin !== 'automatic') return false;
    const index = this.segmentIndex(clip.startTime);
    if (index == null) return false;
    const segment = this.segments[index];
    return (
      segment.startsAfterSourceDiscontinuity &&
      Math.abs(segment.outputRange.start - clip.startTime) <=
        ProjectPointerTrack.endpointEpsilon
    );
  }

  /**
   * Stable-region camera following constrained inside the active same-source
   * contiguous run.
   */
  automaticCameraFocus(
    outputTime: number,
    clip: ZoomAnimationClip,
    motion: MotionStyle = makeMotionStyle()
  ): NormalizedPoint {
    const lookupTime = min(
      max(outputTime, clip.startTime),
      max(clip.startTime, nextDown(clip.endTime))
    );
    let scopedClip = clip;
    const segIdx = this.segmentIndex(lookupTime);
    if (segIdx != null) {
      const range = this.automaticCameraRanges[segIdx];
      let nextStart = clip.startTime;
      let nextFocus = clip.focus;
      let nextEnterDuration = clip.enterDuration;
      let nextEnterProgressOffset = clip.enterProgressOffset;
      if (clip.startTime < range.start) {
        nextStart = range.start;
        const firstIdx = this.segmentIndex(range.start);
        if (firstIdx != null && this.segments[firstIdx].track.events.length > 0) {
          nextFocus = this.segments[firstIdx].track.events[0].location;
        }
        nextEnterDuration = 0;
        nextEnterProgressOffset = 0;
      }
      scopedClip = makeZoomAnimationClip({
        ...clip,
        startTime: nextStart,
        endTime: min(clip.endTime, range.end),
        focus: nextFocus,
        enterDuration: nextEnterDuration,
        enterProgressOffset: nextEnterProgressOffset,
      });
    }

    const baseFocus = NormalizedPoint.constrained(
      scopedClip.focus,
      ZoomViewportTransform.focusEdgeInset
    );
    if (
      scopedClip.origin !== 'automatic' ||
      !Number.isFinite(outputTime) ||
      !(scopedClip.endTime > scopedClip.startTime)
    ) {
      return baseFocus;
    }

    const key = `${scopedClip.id}:${scopedClip.startTime}:${scopedClip.endTime}:${scopedClip.scale}:${baseFocus.x}:${baseFocus.y}:${scopedClip.enterDuration}:${scopedClip.enterProgressOffset}:${motion.screen}:${motion.screenSpringMass}:${motion.screenSpringStiffness}:${motion.screenSpringDamping}`;

    const samples = this.automaticCameraFocusCache.value(key, () => {
      return this.makeAutomaticCameraFocusSamples(
        scopedClip,
        this.automaticEntryFocus(scopedClip, baseFocus),
        motion
      );
    });

    if (!samples) return baseFocus;

    return this.interpolatedAutomaticCameraFocus(
      min(max(outputTime, scopedClip.startTime), scopedClip.endTime),
      samples,
      baseFocus
    );
  }

  private automaticEntryFocus(
    clip: ZoomAnimationClip,
    fallback: NormalizedPoint
  ): NormalizedPoint {
    if (
      !(
        clip.enterProgressOffset <= ProjectPointerTrack.endpointEpsilon ||
        this.automaticEntryStartsAfterCut(clip)
      )
    ) {
      return fallback;
    }
    const index = this.segmentIndex(clip.startTime);
    if (index == null) return fallback;
    const segment = this.segments[index];
    const entryEnd = min(
      clip.startTime + min(max(clip.enterDuration, 0), clip.duration),
      segment.outputRange.end
    );

    const entryEvents = segment.track.eventsRange(clip.startTime, entryEnd);
    const entryClick = entryEvents.find(
      (e) =>
        e.time < segment.outputRange.end &&
        (e.kind === 'leftClick' || e.kind === 'rightClick')
    );
    const focus =
      entryClick?.location ??
      ProjectPointerTrack.interpolatedRawPosition(clip.startTime, segment.track.events);

    return focus
      ? NormalizedPoint.constrained(focus, ZoomViewportTransform.focusEdgeInset)
      : fallback;
  }

  private makeAutomaticCameraFocusSamples(
    clip: ZoomAnimationClip,
    baseFocus: NormalizedPoint,
    motion: MotionStyle
  ): readonly AutomaticCameraFocusSample[] {
    const interval = 1.0 / 120.0;
    const visibleHalfSpan = 1 / (2 * max(clip.scale, 1));
    const restAreaInsetRatio = 0.22;
    const restAreaHalfSpan = max(
      visibleHalfSpan - 2 * visibleHalfSpan * restAreaInsetRatio,
      0.01
    );
    const followStart = min(
      clip.startTime + min(max(clip.enterDuration, 0), clip.duration),
      clip.endTime
    );
    const mass = max(motion.screenSpringMass, 0.01);
    const stiffness = max(motion.screenSpringStiffness, 0.01);
    const damping = max(motion.screenSpringDamping, 0.01);

    let position = baseFocus;
    let target = baseFocus;
    let velocityX = 0.0;
    let velocityY = 0.0;
    let sampleTime = clip.startTime;
    const result: AutomaticCameraFocusSample[] = [
      { time: sampleTime, focus: position },
    ];

    while (sampleTime < clip.endTime) {
      const index = this.segmentIndex(sampleTime);
      if (index == null) break;
      const segment = this.segments[index];
      const nextTime = min(sampleTime + interval, clip.endTime, segment.outputRange.end);
      if (!(nextTime > sampleTime)) break;

      if (nextTime >= followStart) {
        const cursor = ProjectPointerTrack.interpolatedRawPosition(
          min(nextTime, nextDown(segment.outputRange.end)),
          segment.track.events
        );
        if (cursor) {
          let tx = target.x;
          let ty = target.y;
          if (
            cursor.x < target.x - restAreaHalfSpan ||
            cursor.x > target.x + restAreaHalfSpan
          ) {
            tx = cursor.x;
          }
          if (
            cursor.y < target.y - restAreaHalfSpan ||
            cursor.y > target.y + restAreaHalfSpan
          ) {
            ty = cursor.y;
          }
          target = NormalizedPoint.constrained(
            makeNormalizedPoint(tx, ty),
            ZoomViewportTransform.focusEdgeInset
          );
        }
      }

      const deltaTime = max(nextTime - sampleTime, 0);
      const accelerationX =
        (stiffness * (target.x - position.x) - damping * velocityX) / mass;
      const accelerationY =
        (stiffness * (target.y - position.y) - damping * velocityY) / mass;
      velocityX += accelerationX * deltaTime;
      velocityY += accelerationY * deltaTime;
      position = NormalizedPoint.constrained(
        makeNormalizedPoint(
          position.x + velocityX * deltaTime,
          position.y + velocityY * deltaTime
        ),
        ZoomViewportTransform.focusEdgeInset
      );
      sampleTime = nextTime;
      result.push({ time: sampleTime, focus: position });
    }

    return result;
  }

  private static interpolatedRawPosition(
    time: number,
    events: readonly PointerEventRecord[]
  ): NormalizedPoint | null {
    const first = events[0];
    if (!first) return null;
    if (time <= first.time) return first.location;
    const last = events[events.length - 1];
    if (!last || time >= last.time) return last?.location ?? null;

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
    const upperIndex = min(lower, events.length - 1);
    const lowerIndex = max(upperIndex - 1, 0);
    const a = events[lowerIndex];
    const b = events[upperIndex];
    const duration = max(b.time - a.time, 1e-15);
    const progress = min(max((time - a.time) / duration, 0), 1);
    return makeNormalizedPoint(
      a.location.x + (b.location.x - a.location.x) * progress,
      a.location.y + (b.location.y - a.location.y) * progress
    );
  }

  private interpolatedAutomaticCameraFocus(
    time: number,
    samples: readonly AutomaticCameraFocusSample[],
    fallback: NormalizedPoint
  ): NormalizedPoint {
    const first = samples[0];
    if (!first) return fallback;
    if (time <= first.time) return first.focus;
    const last = samples[samples.length - 1];
    if (!last || time >= last.time) return last?.focus ?? fallback;

    let lower = 0;
    let upper = samples.length;
    while (lower < upper) {
      const middle = lower + Math.floor((upper - lower) / 2);
      if (samples[middle].time <= time) {
        lower = middle + 1;
      } else {
        upper = middle;
      }
    }
    const upperIndex = min(lower, samples.length - 1);
    const lowerIndex = max(upperIndex - 1, 0);
    const a = samples[lowerIndex];
    const b = samples[upperIndex];
    const duration = max(b.time - a.time, 1e-15);
    const progress = min(max((time - a.time) / duration, 0), 1);
    return makeNormalizedPoint(
      a.focus.x + (b.focus.x - a.focus.x) * progress,
      a.focus.y + (b.focus.y - a.focus.y) * progress
    );
  }

  private cutBridgePosition(
    time: number,
    segmentIndex: number,
    motion: MotionStyle,
    style: CursorStyle
  ): NormalizedPoint | null {
    const segment = this.segments[segmentIndex];
    const start = segment.outputRange.start;
    if (time < start) return null;

    const availableUntilClick =
      segment.firstClickTime != null
        ? max(segment.firstClickTime - start, 0)
        : null;
    const duration = min(
      min(
        ProjectPointerTrack.cutBridgeDuration,
        availableUntilClick ?? ProjectPointerTrack.cutBridgeDuration
      ),
      segment.outputRange.duration
    );
    if (
      !(duration > ProjectPointerTrack.endpointEpsilon) ||
      !(time < start + duration)
    ) {
      return null;
    }

    const previous = this.segments[segmentIndex - 1];
    if (
      previous.sourceID !== segment.sourceID ||
      Math.abs(previous.outputRange.end - start) > ProjectPointerTrack.endpointEpsilon
    ) {
      return null;
    }

    const previousTime = max(
      previous.outputRange.start,
      previous.outputRange.end - ProjectPointerTrack.endpointEpsilon
    );
    const from = previous.track.evaluation(previousTime, motion, style).position;
    const to = segment.track.evaluation(start + duration, motion, style).position;
    if (!from || !to) return null;

    const linear = min(max((time - start) / duration, 0), 1);
    const eased =
      linear * linear * linear * (linear * (linear * 6 - 15) + 10);
    return makeNormalizedPoint(
      from.x + (to.x - from.x) * eased,
      from.y + (to.y - from.y) * eased
    );
  }

  private segmentIndex(time: number): number | null {
    if (!Number.isFinite(time) || time < 0) return null;
    let lower = 0;
    let upper = this.segments.length;
    while (lower < upper) {
      const middle = lower + Math.floor((upper - lower) / 2);
      if (this.segments[middle].outputRange.end <= time) {
        lower = middle + 1;
      } else {
        upper = middle;
      }
    }
    if (lower >= this.segments.length) return null;
    const candidate = this.segments[lower];
    if (time < candidate.outputRange.start) return null;
    return lower;
  }
}
