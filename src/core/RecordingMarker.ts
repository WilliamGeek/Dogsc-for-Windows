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
  sourceTimeOrOptions: number | { id?: string; sourceTime: number; number: number },
  number?: number,
  id?: string,
): RecordingMarker {
  if (typeof sourceTimeOrOptions === 'object') {
    return Object.freeze({
      id: sourceTimeOrOptions.id ?? newUUID(),
      sourceTime: Number.isFinite(sourceTimeOrOptions.sourceTime)
        ? max(sourceTimeOrOptions.sourceTime, 0)
        : 0,
      number: Number.isFinite(sourceTimeOrOptions.number)
        ? max(sourceTimeOrOptions.number, 1)
        : 1,
    });
  }
  return Object.freeze({
    id: id ?? newUUID(),
    sourceTime: Number.isFinite(sourceTimeOrOptions) ? max(sourceTimeOrOptions, 0) : 0,
    number: Number.isFinite(number!) ? max(number!, 1) : 1,
  });
}
