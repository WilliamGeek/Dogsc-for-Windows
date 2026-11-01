// Port of: F:\dogsc\Sources\RecorderCore\MediaTimeline.swift

import { min, max, newUUID } from './swift.ts';

// MARK: - MediaSyncAnchor & ProjectMediaReference

export interface MediaSyncAnchor {
  id: string;
  sourceTime: number;
  offset: number;
}

export function makeMediaSyncAnchor(options: {
  id?: string;
  sourceTime: number;
  offset: number;
}): MediaSyncAnchor {
  return {
    id: options.id ?? newUUID(),
    sourceTime: Number.isFinite(options.sourceTime) ? max(options.sourceTime, 0) : 0,
    offset: Number.isFinite(options.offset) ? min(max(options.offset, -10), 10) : 0,
  };
}

export interface ProjectMediaReference {
  relativePath: string;
  startOffset: number;
  sourceStartTime: number;
  sourceTimeScale: number | null;
  sourceEndTime: number | null;
  syncAnchors: readonly MediaSyncAnchor[];
}

export function makeProjectMediaReference(options: {
  relativePath: string;
  startOffset?: number;
  sourceStartTime?: number;
  sourceTimeScale?: number | null;
  sourceEndTime?: number | null;
  syncAnchors?: readonly MediaSyncAnchor[];
}): ProjectMediaReference {
  const startOffset = options.startOffset ?? 0;
  const sourceStartTime = options.sourceStartTime ?? 0;
  const sourceTimeScale = options.sourceTimeScale;
  const sourceEndTime = options.sourceEndTime;

  return {
    relativePath: options.relativePath,
    startOffset: Number.isFinite(startOffset) ? max(startOffset, 0) : 0,
    sourceStartTime: Number.isFinite(sourceStartTime) ? max(sourceStartTime, 0) : 0,
    sourceTimeScale:
      sourceTimeScale != null && Number.isFinite(sourceTimeScale) && sourceTimeScale > 0
        ? sourceTimeScale
        : null,
    sourceEndTime:
      sourceEndTime != null && Number.isFinite(sourceEndTime) && sourceEndTime >= 0
        ? sourceEndTime
        : null,
    syncAnchors: options.syncAnchors ? options.syncAnchors.slice() : [],
  };
}

// MARK: - MediaTimelinePlacement

/// One canonical mapping between a source track and the project timeline.
/// `ProjectMediaReference` describes user/capture placement while the
/// available source range comes from AVFoundation's actual track inventory.
export class MediaTimelinePlacement {
  public readonly timelineStart: number;
  public readonly sourceStart: number;
  public readonly playableDuration: number;
  public readonly sourceTimeScale: number;

  constructor(
    reference: ProjectMediaReference,
    sourceAvailableDuration: number,
    timelineDuration: number,
    sourceAvailableStart: number = 0
  ) {
    const requestedSourceStart = MediaTimelinePlacement.nonnegative(reference.sourceStartTime);
    const availableStart = MediaTimelinePlacement.nonnegative(sourceAvailableStart);
    const availableDuration = MediaTimelinePlacement.nonnegative(sourceAvailableDuration);
    const availableEnd = availableStart + availableDuration;
    const effectiveSourceStart = min(max(requestedSourceStart, availableStart), availableEnd);
    const requestedSourceEnd = reference.sourceEndTime ?? availableEnd;
    const effectiveSourceEnd = min(
      max(requestedSourceEnd, effectiveSourceStart),
      availableEnd
    );
    const unavailableLead = max(effectiveSourceStart - requestedSourceStart, 0);
    const effectiveTimelineStart =
      MediaTimelinePlacement.nonnegative(reference.startOffset) + unavailableLead;
    const safeTimelineDuration = MediaTimelinePlacement.nonnegative(timelineDuration);
    const requestedScale = reference.sourceTimeScale ?? 1;
    const safeScale =
      Number.isFinite(requestedScale) && requestedScale > 0 ? requestedScale : 1;

    this.sourceStart = effectiveSourceStart;
    this.timelineStart = min(effectiveTimelineStart, safeTimelineDuration);
    this.sourceTimeScale = safeScale;
    this.playableDuration = min(
      max(effectiveSourceEnd - effectiveSourceStart, 0) / safeScale,
      max(safeTimelineDuration - this.timelineStart, 0)
    );
  }

  public get sourceEnd(): number {
    return this.sourceStart + this.playableDuration * this.sourceTimeScale;
  }

  public get timelineEnd(): number {
    return this.timelineStart + this.playableDuration;
  }

  public sourceTime(timelineTime: number): number | null {
    if (
      !Number.isFinite(timelineTime) ||
      timelineTime < this.timelineStart ||
      timelineTime >= this.timelineEnd
    ) {
      return null;
    }
    return this.sourceStart + (timelineTime - this.timelineStart) * this.sourceTimeScale;
  }

  public timelineTime(sourceTime: number): number | null {
    if (
      !Number.isFinite(sourceTime) ||
      sourceTime < this.sourceStart ||
      sourceTime >= this.sourceEnd
    ) {
      return null;
    }
    return this.timelineStart + (sourceTime - this.sourceStart) / this.sourceTimeScale;
  }

  public contains(timelineTime: number): boolean {
    return this.sourceTime(timelineTime) != null && this.playableDuration > 0;
  }

  private static nonnegative(value: number): number {
    return Number.isFinite(value) ? max(value, 0) : 0;
  }
}

export function makeMediaTimelinePlacement(options: {
  reference: ProjectMediaReference;
  sourceAvailableStart?: number;
  sourceAvailableDuration: number;
  timelineDuration: number;
}): MediaTimelinePlacement {
  return new MediaTimelinePlacement(
    options.reference,
    options.sourceAvailableDuration,
    options.timelineDuration,
    options.sourceAvailableStart ?? 0
  );
}

// MARK: - MediaSyncAnchorCurve

/// Evaluates piecewise-linear camera clock corrections against the original
/// screen source clock. Before the first authored point the curve grows from
/// an implicit zero correction at source time zero; after the final point it
/// holds the last correction.
export class MediaSyncAnchorCurve {
  public readonly anchors: readonly MediaSyncAnchor[];

  constructor(anchors: readonly MediaSyncAnchor[]) {
    this.anchors = anchors
      .slice()
      .sort((a, b) => {
        if (a.sourceTime !== b.sourceTime) {
          return a.sourceTime < b.sourceTime ? -1 : 1;
        }
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
  }

  public offset(sourceTime: number): number {
    if (!Number.isFinite(sourceTime) || this.anchors.length === 0) {
      return 0;
    }
    const safeTime = max(sourceTime, 0);
    const first = this.anchors[0];

    // Preserve the implicit zero-correction origin without copying the
    // complete anchor array.
    if (first.sourceTime > 0.000001 && safeTime <= first.sourceTime) {
      const progress = min(max(safeTime / first.sourceTime, 0), 1);
      return first.offset * progress;
    }
    if (safeTime <= first.sourceTime) {
      return first.offset;
    }

    // Binary search for first right-hand point.
    let lower = 1;
    let upper = this.anchors.length;
    while (lower < upper) {
      const middle = Math.trunc(lower + (upper - lower) / 2);
      if (this.anchors[middle].sourceTime < safeTime) {
        lower = middle + 1;
      } else {
        upper = middle;
      }
    }

    if (lower >= this.anchors.length) {
      return this.anchors[this.anchors.length - 1]?.offset ?? 0;
    }

    const left = this.anchors[lower - 1];
    const right = this.anchors[lower];
    const span = right.sourceTime - left.sourceTime;
    if (span <= 0.000001) {
      return right.offset;
    }
    const progress = min(max((safeTime - left.sourceTime) / span, 0), 1);
    return left.offset + (right.offset - left.offset) * progress;
  }
}
