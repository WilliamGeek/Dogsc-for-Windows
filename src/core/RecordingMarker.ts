// Port of: F:\dogsc-v0.2.0\Sources\RecorderCore\RecordingMarker.swift
import { max, newUUID } from './swift.ts';

const PRIMARY_SOURCE_ID = '00000000-0000-0000-0000-000000000001';

/**
 * An editorial note anchored to the original recording, never a rendered track.
 * Keeping the source anchor lets ripple edits, retiming and undo share one truth.
 */
export interface RecordingMarker {
  readonly id: string;
  readonly sourceTime: number;
  readonly number: number;
  /// Markers use the original recording clock; null means the primary source.
  readonly sourceID: string | null;
}

export function recordingMarkerResolvedSourceID(marker: RecordingMarker): string {
  return marker.sourceID ?? PRIMARY_SOURCE_ID;
}

/** Swift `init(id:sourceTime:number:sourceID:)` */
export function makeRecordingMarker(
  sourceTimeOrOptions:
    | number
    | { id?: string; sourceTime: number; number: number; sourceID?: string | null },
  number?: number,
  id?: string,
  sourceID?: string | null,
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
      sourceID: sourceTimeOrOptions.sourceID ?? null,
    });
  }
  return Object.freeze({
    id: id ?? newUUID(),
    sourceTime: Number.isFinite(sourceTimeOrOptions) ? max(sourceTimeOrOptions, 0) : 0,
    number: Number.isFinite(number!) ? max(number!, 1) : 1,
    sourceID: sourceID ?? null,
  });
}

export const RecordingMarker = Object.freeze({
  make: makeRecordingMarker,
  resolvedSourceID: recordingMarkerResolvedSourceID,
});
