// Port of: F:\dogsc-v0.2.0\Sources\RecorderCore\RecordingSourceEditing.swift

import { min, max, newUUID } from './swift.ts';
import type { RecorderProject } from './ProjectMediaModel.ts';
import {
  type SourceSequence,
  makeInsertedMedia,
  makeRecordingSegment,
  makeSourceSequenceEdited,
  makeSourceSequenceFullRecording,
  recordingSegmentResolvedSourceID,
} from './ProjectTimeline.ts';
import { RecordingSourcePrimaryID, projectSourceByID } from './RecordingSource.ts';
import { recordingMarkerResolvedSourceID } from './RecordingMarker.ts';
import {
  type TimelineSourceDurationsInput,
  TimelineMap,
  toSourceDurationsMap,
} from './TimelineMap.ts';
import {
  ProjectTimelineEditingError,
  insertMediaSegment,
  removePrimarySegment,
  prunedPrimarySegmentAudioOverrides,
  timelineInsertionTime,
  timelineSplitEdits,
  validate,
} from './ProjectTimelineEditing.ts';
import { ProjectValidator } from './ProjectValidator.ts';

export { timelineInsertionTime, timelineSplitEdits };

// MARK: - RecorderProject Color Stabilization

export function projectStabilizeRecordingColors(project: RecorderProject): RecorderProject {
  const additional = project.additionalSources ?? [];
  let changed = false;
  const nextAdditional = additional.map((source, index) => {
    if (source.colorIndex !== null && source.colorIndex !== undefined) {
      return source;
    }
    changed = true;
    return {
      ...source,
      colorIndex: index,
    };
  });
  if (!changed) return project;
  return {
    ...project,
    additionalSources: nextAdditional,
  };
}

// MARK: - RecordingSourceEditing

export function usageCount(sourceID: string, sequence: SourceSequence): number {
  switch (sequence.kind) {
    case 'fullRecording':
      return sourceID === RecordingSourcePrimaryID ? 1 : 0;
    case 'edited': {
      let count = 0;
      for (const seg of sequence.segments) {
        if (seg.media == null && recordingSegmentResolvedSourceID(seg) === sourceID) {
          count += 1;
        }
      }
      return count;
    }
  }
}

/**
 * `sourceRange` is the span of the recording to insert; null inserts all of it.
 */
export function insertingFullRecording(
  sourceID: string,
  project: RecorderProject,
  requestedTime: number,
  sourceDurations: TimelineSourceDurationsInput,
  sourceRange: { lowerBound: number; upperBound: number } | null = null
): RecorderProject {
  const durations = toSourceDurationsMap(sourceDurations);
  const duration = durations.get(sourceID);
  if (
    projectSourceByID(project, sourceID) == null ||
    duration === undefined ||
    !Number.isFinite(duration) ||
    !(duration > 0)
  ) {
    throw new ProjectTimelineEditingError('invalidSourceSequence');
  }

  const sourceStart = min(max(sourceRange?.lowerBound ?? 0, 0), max(duration - 0.1, 0));
  const rawSpan = sourceRange ? sourceRange.upperBound - sourceRange.lowerBound : duration;
  const span = min(max(rawSpan, 0.1), duration - sourceStart);

  const map = new TimelineMap(project.timeline.sourceSequence, durations);
  const time = timelineInsertionTime(requestedTime, map);
  const id = newUUID();

  let timeline = insertMediaSegment(
    timelineSplitEdits(project.timeline, time),
    makeInsertedMedia({ path: 'recording-placeholder', fileDuration: duration, name: '' }),
    time,
    span,
    id,
    durations
  );

  if (timeline.sourceSequence.kind !== 'edited') {
    throw new ProjectTimelineEditingError('invalidSourceSequence');
  }
  const index = timeline.sourceSequence.segments.findIndex(s => s.id === id);
  if (index < 0) {
    throw new ProjectTimelineEditingError('invalidSourceSequence');
  }
  const segments = timeline.sourceSequence.segments.slice();
  segments[index] = makeRecordingSegment({
    id,
    sourceStart,
    sourceDuration: span,
    sourceID: sourceID === RecordingSourcePrimaryID ? null : sourceID,
  });
  timeline = {
    ...timeline,
    sourceSequence: makeSourceSequenceEdited(segments),
  };
  validate(timeline, durations);
  return {
    ...project,
    timeline,
  };
}

export function removing(
  sourceID: string,
  project: RecorderProject,
  sourceDurations: TimelineSourceDurationsInput
): RecorderProject {
  const durations = toSourceDurationsMap(sourceDurations);
  if (
    sourceID === RecordingSourcePrimaryID ||
    !(project.additionalSources ?? []).some(s => s.id === sourceID)
  ) {
    throw new ProjectTimelineEditingError('invalidSourceSequence');
  }

  const map = new TimelineMap(project.timeline.sourceSequence, durations);
  const removed = map.segments.filter(s => s.media == null && s.sourceID === sourceID);
  if (removed.length >= map.segments.length) {
    throw new ProjectTimelineEditingError('cannotRemoveFinalSegment');
  }

  let result = projectStabilizeRecordingColors(project);
  for (let i = removed.length - 1; i >= 0; i--) {
    result = {
      ...result,
      timeline: removePrimarySegment(
        result.timeline,
        removed[i].id,
        durations,
        result.motion.defaultZoomTransitionDuration
      ),
    };
  }
  result = {
    ...result,
    additionalSources: (result.additionalSources ?? []).filter(s => s.id !== sourceID),
    recordingMarkers: result.recordingMarkers.filter(
      m => recordingMarkerResolvedSourceID(m) !== sourceID
    ),
  };
  ProjectValidator.validate(result);
  return result;
}

/**
 * Drops main-track segments referencing missing additional sources so a
 * partially missing project can still reopen cleanly.
 */
export function droppingMissingSources(
  project: RecorderProject
): { project: RecorderProject; droppedSegments: number } {
  const available = new Set<string>([
    RecordingSourcePrimaryID,
    ...(project.additionalSources ?? []).map(s => s.id),
  ]);
  let result: RecorderProject = {
    ...project,
    recordingMarkers: project.recordingMarkers.filter(m =>
      available.has(recordingMarkerResolvedSourceID(m))
    ),
  };

  if (result.timeline.sourceSequence.kind !== 'edited') {
    return { project: result, droppedSegments: 0 };
  }
  const segments = result.timeline.sourceSequence.segments;
  const kept = segments.filter(
    s => s.media != null || available.has(recordingSegmentResolvedSourceID(s))
  );
  if (kept.length >= segments.length) {
    return { project: result, droppedSegments: 0 };
  }

  const nextSequence =
    kept.length === 0 ? makeSourceSequenceFullRecording() : makeSourceSequenceEdited(kept);
  result = {
    ...result,
    timeline: {
      ...result.timeline,
      sourceSequence: nextSequence,
      primarySegmentAudioOverrides: prunedPrimarySegmentAudioOverrides(
        result.timeline.primarySegmentAudioOverrides,
        nextSequence
      ),
    },
  };
  return { project: result, droppedSegments: segments.length - kept.length };
}

export const RecordingSourceEditing = Object.freeze({
  usageCount,
  insertingFullRecording,
  removing,
  droppingMissingSources,
  stabilizeRecordingColors: projectStabilizeRecordingColors,
});
