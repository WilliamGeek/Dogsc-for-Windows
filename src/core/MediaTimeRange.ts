// Port of: F:\dogsc\Sources\RecorderCore\MediaTimeRange.swift
// EXEMPLAR FILE — shows a Swift struct with a failable `init?` and computed properties.
import { max, min, toInt } from './swift.ts';

/** A media track's position on its asset timeline. Immutable (Swift `let` fields). */
export interface MediaTimeRange {
  readonly start: number;
  readonly duration: number;
}

/** Swift `init?(start:duration:)` → returns `null` where Swift returns `nil`. */
export function makeMediaTimeRange(start: number, duration: number): MediaTimeRange | null {
  const end = start + duration;
  if (!(Number.isFinite(start) && Number.isFinite(duration) && duration > 0 && Number.isFinite(end))) {
    return null;
  }
  return Object.freeze({ start, duration });
}

/** Swift computed property `end`. */
export function mediaTimeRangeEnd(range: MediaTimeRange): number {
  return range.start + range.duration;
}

/**
 * Maps an absolute presentation timestamp into a fixed-size timeline
 * bucket. The range is end-exclusive, matching Core Media time ranges.
 * Swift: `bucketIndex(forPresentationTime:bucketCount:) -> Int?`.
 */
export function mediaTimeRangeBucketIndex(
  range: MediaTimeRange,
  timestamp: number,
  bucketCount: number,
): number | null {
  if (!(bucketCount > 0 && Number.isFinite(timestamp) && timestamp >= range.start && timestamp < mediaTimeRangeEnd(range))) {
    return null;
  }
  const normalized = (timestamp - range.start) / range.duration;
  return min(max(toInt(normalized * bucketCount), 0), bucketCount - 1);
}

