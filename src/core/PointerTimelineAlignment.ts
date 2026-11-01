// Port of: F:\dogsc\Sources\RecorderCore\PointerTimelineAlignment.swift
import { max } from './swift.ts';
import { PointerEventTimelineOrdering } from './PointerEventTimelineOrdering.ts';
import type { PointerEventRecord } from './ZoomAnimation.ts';

/**
 * Bakes the pointer recorder's independent host-clock placement into the saved event times.
 * A pointer tap may start just before the first video frame; in that case the last pre-roll
 * position becomes a non-clicking seed at t=0 instead of shifting the whole path late or
 * creating a phantom click.
 */
function align(
  events: readonly PointerEventRecord[],
  startOffset: number,
  sourceStartTime: number,
): readonly PointerEventRecord[] {
  const shift = max(startOffset, 0) - max(sourceStartTime, 0);
  if (shift === 0) {
    return PointerEventTimelineOrdering.normalized(events);
  }
  let lastPreRoll: PointerEventRecord | null = null;
  const aligned: PointerEventRecord[] = [];

  for (const event of PointerEventTimelineOrdering.normalized(events)) {
    const time = event.time + shift;
    if (time < 0) {
      lastPreRoll = event;
      continue;
    }
    if (aligned.length === 0 && lastPreRoll !== null && time > 0.000_001) {
      aligned.push({
        time: 0,
        location: lastPreRoll.location,
        kind: 'move',
        modifiers: [...(lastPreRoll.modifiers ?? [])],
        cursorAssetID: lastPreRoll.cursorAssetID ?? null,
      });
    }
    aligned.push({
      time: max(time, 0),
      location: event.location,
      kind: event.kind,
      modifiers: [...(event.modifiers ?? [])],
      cursorAssetID: event.cursorAssetID ?? null,
    });
  }

  if (aligned.length === 0 && lastPreRoll !== null) {
    aligned.push({
      time: 0,
      location: lastPreRoll.location,
      kind: 'move',
      modifiers: [...(lastPreRoll.modifiers ?? [])],
      cursorAssetID: lastPreRoll.cursorAssetID ?? null,
    });
  }
  return aligned;
}

export const PointerTimelineAlignment = Object.freeze({ align });
