// Port of: F:\dogsc\Sources\RecorderCore\RecordingMarker.swift
import { max, newUUID } from './swift.ts';

/**
 * An editorial note anchored to the original recording, never a rendered track.
 * Keeping the source anchor lets ripple edits, retiming and undo share one truth.
 */
export interface RecordingMarker {
  readonly id: string;
  readonly sourceTime: number;
  readonly number: number;
}

/** Swift `init(id:sourceTime:number:)` */
export function makeRecordingMarker(
  sourceTime: number,
  number: number,
  id: string = newUUID(),
): RecordingMarker {
  return Object.freeze({
    id,
    sourceTime: Number.isFinite(sourceTime) ? max(sourceTime, 0) : 0,
    number: max(number, 1),
  });
}
