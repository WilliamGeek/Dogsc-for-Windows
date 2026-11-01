// Port of: F:\dogsc\Sources\RecorderCore\PointerEventTimelineOrdering.swift
// EXEMPLAR FILE — shows `import type` for a type defined in a not-yet-ported file.
import type { PointerEventRecord } from './ZoomAnimation.ts';

function isNormalized(events: readonly PointerEventRecord[]): boolean {
  let previousTime: number | null = null;
  for (const event of events) {
    if (!Number.isFinite(event.time)) return false;
    if (previousTime !== null && event.time < previousTime) return false;
    previousTime = event.time;
  }
  return true;
}

/** Returns the same array when already ordered (Swift shared COW storage). Never mutates input. */
function normalized(events: readonly PointerEventRecord[]): readonly PointerEventRecord[] {
  if (isNormalized(events)) return events;
  const repaired = events.filter((e) => Number.isFinite(e.time));
  repaired.sort((a, b) => a.time - b.time); // JS sort is stable, like Swift's.
  return repaired;
}

export const PointerEventTimelineOrdering = Object.freeze({ isNormalized, normalized });
