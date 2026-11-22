// Port of: F:\dogsc-v0.2.0\Sources\RecorderCore\RecordingProjectImport.swift

import { min, max, newUUID } from './swift.ts';
import type { RecorderProject } from './ProjectMediaModel.ts';
import {
  type OverlayTiming,
  makeOverlayTiming,
} from './OverlayTimeline.ts';
import { makeMediaAsset } from './PostProductionModel.ts';
import {
  type PrimarySegmentAudioOverrides,
  type ProjectTimeline,
  type RecordingSegment,
  type TransitionTiming,
  makeInsertedMedia,
  makePrimarySegmentAudioOverrides,
  makeRecordingSegment,
  makeSourceSequenceEdited,
  makeTransitionTiming,
} from './ProjectTimeline.ts';
import { makeRecordingMarker, recordingMarkerResolvedSourceID } from './RecordingMarker.ts';
import {
  RecordingSourcePrimaryID,
  type RecordingSource,
  projectSources,
} from './RecordingSource.ts';
import { projectStabilizeRecordingColors } from './RecordingSourceEditing.ts';
import { screenCardAppearanceFromCanvas } from './ScreenCardAppearance.ts';
import {
  type TimelineSourceDurationsInput,
  TimelineMap,
  toSourceDurationsMap,
} from './TimelineMap.ts';
import {
  ProjectTimelineEditingError,
  insertMediaSegment,
  sortCameraMotion,
  sortScreenMotion,
  sortZoom,
  timelineInsertionTime,
  timelineSplitEdits,
  validate,
} from './ProjectTimelineEditing.ts';
import { ProjectValidator } from './ProjectValidator.ts';
import { type ZoomAnimationClip, makeZoomAnimationClip } from './ZoomAnimation.ts';

export { timelineInsertionTime, timelineSplitEdits };

// MARK: - Options & Types

export interface RecordingProjectImportOptions {
  includesMotion: boolean;
  includesSubtitles: boolean;
  includesOverlays: boolean;
  includesAudio: boolean;
  copiesMedia: boolean;
}

export function makeRecordingProjectImportOptions(
  options: Partial<RecordingProjectImportOptions> = {}
): RecordingProjectImportOptions {
  return {
    includesMotion: options.includesMotion ?? true,
    includesSubtitles: options.includesSubtitles ?? true,
    includesOverlays: options.includesOverlays ?? true,
    includesAudio: options.includesAudio ?? true,
    copiesMedia: options.copiesMedia ?? true,
  };
}

export type SourceIDMapInput = ReadonlyMap<string, string> | Record<string, string>;

function toSourceIDMap(input: SourceIDMapInput): Map<string, string> {
  if (input instanceof Map) {
    return new Map(input as ReadonlyMap<string, string>);
  }
  return new Map(Object.entries(input as Record<string, string>));
}

// MARK: - Helpers

function appendImportedSources(
  imported: RecorderProject,
  current: RecorderProject,
  currentDurations: Map<string, number>,
  importedDurations: Map<string, number>,
  idMap: Map<string, string>
): { project: RecorderProject; durations: Map<string, number> } {
  const stabilized = projectStabilizeRecordingColors(current);
  let nextColor = -1;
  for (const s of stabilized.additionalSources ?? []) {
    if (s.colorIndex != null && s.colorIndex > nextColor) {
      nextColor = s.colorIndex;
    }
  }
  nextColor += 1;

  const knownSourceIDs = new Set(projectSources(stabilized).map(s => s.id));
  const addedSources: RecordingSource[] = [];
  const durations = new Map(currentDurations);

  for (const source of projectSources(imported)) {
    const id = idMap.get(source.id);
    const duration = importedDurations.get(source.id);
    if (
      id === undefined ||
      id === RecordingSourcePrimaryID ||
      knownSourceIDs.has(id) ||
      duration === undefined ||
      !Number.isFinite(duration) ||
      !(duration > 0)
    ) {
      throw new ProjectTimelineEditingError('invalidSourceSequence');
    }
    knownSourceIDs.add(id);
    addedSources.push({
      ...source,
      id,
      colorIndex: nextColor++,
      screenAppearance:
        source.screenAppearance ?? screenCardAppearanceFromCanvas(imported.canvas),
    });
    durations.set(id, duration);
  }

  return {
    project: {
      ...stabilized,
      additionalSources: [...(stabilized.additionalSources ?? []), ...addedSources],
    },
    durations,
  };
}

function shiftedClips<C extends { id: string; timing: OverlayTiming }>(
  clips: readonly C[],
  delta: number
): C[] {
  return clips.map(clip => ({
    ...clip,
    id: newUUID(),
    timing: makeOverlayTiming(clip.timing.startTime + delta, clip.timing.duration),
  }));
}

function boundTransitions<C extends { timing: TransitionTiming }>(
  clips: readonly C[],
  end: number
): C[] {
  return clips
    .filter(c => c.timing.startTime < end)
    .map(c => {
      const t = c.timing;
      const duration = min(t.duration, end - t.startTime);
      const boundedEnd = t.startTime + duration;
      const returnDuration = min(t.returnDuration, max(end - boundedEnd, 0));
      return {
        ...c,
        timing: makeTransitionTiming({
          ...t,
          duration,
          returnDuration,
        }),
      };
    });
}

function boundOverlays<C extends { timing: OverlayTiming }>(
  clips: readonly C[],
  end: number
): C[] {
  return clips
    .filter(c => c.timing.startTime < end)
    .map(c => ({
      ...c,
      timing: makeOverlayTiming(
        c.timing.startTime,
        min(c.timing.duration, end - c.timing.startTime)
      ),
    }));
}

function boundedEdits(original: ProjectTimeline, end: number): ProjectTimeline {
  const zoomClips: ZoomAnimationClip[] = original.zoomClips
    .filter(c => c.startTime < end)
    .map(c => {
      const newEnd = min(c.endTime, end);
      const exitDuration = min(c.exitDuration, max(end - newEnd, 0));
      return makeZoomAnimationClip({
        ...c,
        endTime: newEnd,
        exitDuration,
      });
    });

  return {
    ...original,
    zoomClips,
    screenMotionClips: boundTransitions(original.screenMotionClips, end),
    cameraMotionClips: boundTransitions(original.cameraMotionClips, end),
    mosaicClips: boundOverlays(original.mosaicClips, end),
    stickerClips: boundOverlays(original.stickerClips, end),
    animationClips: boundOverlays(original.animationClips, end),
    audioClips: boundOverlays(original.audioClips, end),
    videoClips: boundOverlays(original.videoClips, end),
    subtitleCues: boundOverlays(original.subtitleCues, end),
  };
}

// MARK: - RecordingProjectImport

/**
 * Joins an external project's recordings, media assets, and markers into the
 * current project as sources without altering the main track.
 */
export function adding(
  imported: RecorderProject,
  current: RecorderProject,
  currentDurations: TimelineSourceDurationsInput,
  importedDurations: TimelineSourceDurationsInput,
  sourceIDs: SourceIDMapInput
): RecorderProject {
  const curDurationsMap = toSourceDurationsMap(currentDurations);
  const impDurationsMap = toSourceDurationsMap(importedDurations);
  const idMap = toSourceIDMap(sourceIDs);

  const appended = appendImportedSources(
    imported,
    current,
    curDurationsMap,
    impDurationsMap,
    idMap
  );
  const durations = appended.durations;
  const importedAssets = imported.timeline.mediaAssets.map(asset =>
    makeMediaAsset({ ...asset, id: newUUID() })
  );
  const importedMarkers = imported.recordingMarkers.flatMap(marker => {
    const mappedID = idMap.get(recordingMarkerResolvedSourceID(marker));
    return mappedID !== undefined
      ? [
          makeRecordingMarker({
            sourceTime: marker.sourceTime,
            number: marker.number,
            sourceID: mappedID,
          }),
        ]
      : [];
  });

  const result: RecorderProject = {
    ...appended.project,
    timeline: {
      ...appended.project.timeline,
      mediaAssets: [...appended.project.timeline.mediaAssets, ...importedAssets],
    },
    recordingMarkers: [...appended.project.recordingMarkers, ...importedMarkers],
  };

  validate(result.timeline, durations);
  ProjectValidator.validate(result);
  return result;
}

/**
 * Places an imported programme, with its authored segments and effects,
 * into `current` at `requestedTime`.
 */
export function inserting(
  imported: RecorderProject,
  current: RecorderProject,
  requestedTime: number,
  currentDurations: TimelineSourceDurationsInput,
  importedDurations: TimelineSourceDurationsInput,
  options: RecordingProjectImportOptions,
  sourceIDs: SourceIDMapInput
): RecorderProject {
  const curDurationsMap = toSourceDurationsMap(currentDurations);
  const impDurationsMap = toSourceDurationsMap(importedDurations);
  const idMap = toSourceIDMap(sourceIDs);

  const incomingMap = new TimelineMap(imported.timeline.sourceSequence, impDurationsMap);
  const currentMap = new TimelineMap(current.timeline.sourceSequence, curDurationsMap);
  const time = timelineInsertionTime(requestedTime, currentMap);

  const appended = appendImportedSources(
    imported,
    current,
    curDurationsMap,
    impDurationsMap,
    idMap
  );
  const durations = appended.durations;
  const result = appended.project;

  const segmentIDs = new Map<string, string>();
  const segments: RecordingSegment[] = [];
  for (const resolved of incomingMap.segments) {
    const id = newUUID();
    segmentIDs.set(resolved.id, id);
    const mappedSourceID = idMap.get(resolved.sourceID);
    if (resolved.media == null && mappedSourceID === undefined) {
      throw new ProjectTimelineEditingError('invalidSourceSequence');
    }
    const media = resolved.media
      ? makeInsertedMedia({
          ...resolved.media,
          screenAppearance:
            resolved.media.screenAppearance ?? screenCardAppearanceFromCanvas(imported.canvas),
        })
      : null;
    segments.push(
      makeRecordingSegment({
        id,
        sourceStart: resolved.sourceStart,
        sourceDuration: resolved.sourceDuration,
        playbackRate: resolved.playbackRate,
        media,
        sourceID: resolved.media == null ? (mappedSourceID ?? null) : null,
        sceneStyle: resolved.sceneStyle,
        crop: resolved.crop,
      })
    );
  }

  // Freeze effective audio gains and mute states onto each imported occurrence
  // so destination global defaults never retroactively alter it.
  const frozenOverrides: Record<string, PrimarySegmentAudioOverrides> = {};
  for (const seg of incomingMap.segments) {
    const id = segmentIDs.get(seg.id);
    if (!id) continue;
    const ov = imported.timeline.primarySegmentAudioOverrides[seg.id];
    frozenOverrides[id] = makePrimarySegmentAudioOverrides({
      systemVolume: ov?.systemVolume ?? imported.audio.systemVolume,
      microphoneVolume: ov?.microphoneVolume ?? imported.audio.microphoneVolume,
      isSystemMuted: ov?.isSystemMuted ?? imported.audio.isSystemMuted,
      isMicrophoneMuted: ov?.isMicrophoneMuted ?? imported.audio.isMicrophoneMuted,
    });
  }

  let edits: ProjectTimeline = {
    ...imported.timeline,
    primarySegmentAudioOverrides: frozenOverrides,
    zoomClips: options.includesMotion ? imported.timeline.zoomClips : [],
    screenMotionClips: options.includesMotion ? imported.timeline.screenMotionClips : [],
    cameraMotionClips: options.includesMotion ? imported.timeline.cameraMotionClips : [],
    subtitleCues: options.includesSubtitles ? imported.timeline.subtitleCues : [],
    mosaicClips: options.includesOverlays ? imported.timeline.mosaicClips : [],
    stickerClips: options.includesOverlays ? imported.timeline.stickerClips : [],
    animationClips: options.includesOverlays ? imported.timeline.animationClips : [],
    videoClips: options.includesOverlays ? imported.timeline.videoClips : [],
    audioClips: options.includesAudio ? imported.timeline.audioClips : [],
  };

  edits = boundedEdits(edits, incomingMap.outputDuration);

  const groupIDs = new Map<string, string>();
  const remapGroup = (oldID: string | null): string | null => {
    if (oldID === null) return null;
    const existing = groupIDs.get(oldID);
    if (existing !== undefined) return existing;
    const nextID = newUUID();
    groupIDs.set(oldID, nextID);
    return nextID;
  };

  const shiftedZoomClips = edits.zoomClips.map(c =>
    makeZoomAnimationClip({
      ...c,
      id: newUUID(),
      startTime: c.startTime + time,
      endTime: c.endTime + time,
    })
  );
  const shiftedScreenMotionClips = edits.screenMotionClips.map(c => ({
    ...c,
    id: newUUID(),
    groupID: remapGroup(c.groupID),
    timing: makeTransitionTiming({
      ...c.timing,
      startTime: c.timing.startTime + time,
    }),
  }));
  const shiftedCameraMotionClips = edits.cameraMotionClips.map(c => ({
    ...c,
    id: newUUID(),
    groupID: remapGroup(c.groupID),
    timing: makeTransitionTiming({
      ...c.timing,
      startTime: c.timing.startTime + time,
    }),
  }));
  const shiftedMosaicClips = shiftedClips(edits.mosaicClips, time);
  const shiftedStickerClips = shiftedClips(edits.stickerClips, time);
  const shiftedAnimationClips = shiftedClips(edits.animationClips, time);
  const shiftedAudioClips = shiftedClips(edits.audioClips, time);
  const shiftedVideoClips = shiftedClips(edits.videoClips, time);
  const shiftedSubtitleCues = shiftedClips(edits.subtitleCues, time);
  const remappedMediaAssets = edits.mediaAssets.map(a =>
    makeMediaAsset({ ...a, id: newUUID() })
  );

  const placeholderID = newUUID();
  let timeline = insertMediaSegment(
    timelineSplitEdits(current.timeline, time),
    makeInsertedMedia({
      path: 'import-placeholder',
      fileDuration: incomingMap.outputDuration,
      name: '',
    }),
    time,
    incomingMap.outputDuration,
    placeholderID,
    durations
  );

  if (timeline.sourceSequence.kind !== 'edited') {
    throw new ProjectTimelineEditingError('invalidSourceSequence');
  }
  const placeholderIndex = timeline.sourceSequence.segments.findIndex(s => s.id === placeholderID);
  if (placeholderIndex < 0) {
    throw new ProjectTimelineEditingError('invalidSourceSequence');
  }
  const authored = timeline.sourceSequence.segments.slice();
  authored.splice(placeholderIndex, 1, ...segments);

  const mergedZoom = [...timeline.zoomClips, ...shiftedZoomClips];
  const mergedScreenMotion = [...timeline.screenMotionClips, ...shiftedScreenMotionClips];
  const mergedCameraMotion = [...timeline.cameraMotionClips, ...shiftedCameraMotionClips];
  sortZoom(mergedZoom);
  sortScreenMotion(mergedScreenMotion);
  sortCameraMotion(mergedCameraMotion);

  timeline = {
    ...timeline,
    sourceSequence: makeSourceSequenceEdited(authored),
    primarySegmentAudioOverrides: {
      ...timeline.primarySegmentAudioOverrides,
      ...edits.primarySegmentAudioOverrides,
    },
    zoomClips: mergedZoom,
    screenMotionClips: mergedScreenMotion,
    cameraMotionClips: mergedCameraMotion,
    mosaicClips: [...timeline.mosaicClips, ...shiftedMosaicClips],
    stickerClips: [...timeline.stickerClips, ...shiftedStickerClips],
    animationClips: [...timeline.animationClips, ...shiftedAnimationClips],
    audioClips: [...timeline.audioClips, ...shiftedAudioClips],
    videoClips: [...timeline.videoClips, ...shiftedVideoClips],
    subtitleCues: [...timeline.subtitleCues, ...shiftedSubtitleCues],
    mediaAssets: [...timeline.mediaAssets, ...remappedMediaAssets],
  };

  const importedMarkers = imported.recordingMarkers.flatMap(marker => {
    const mappedID = idMap.get(recordingMarkerResolvedSourceID(marker));
    return mappedID !== undefined
      ? [
          makeRecordingMarker({
            sourceTime: marker.sourceTime,
            number: marker.number,
            sourceID: mappedID,
          }),
        ]
      : [];
  });

  const finalProject: RecorderProject = {
    ...result,
    timeline,
    recordingMarkers: [...result.recordingMarkers, ...importedMarkers],
  };

  validate(finalProject.timeline, durations);
  ProjectValidator.validate(finalProject);
  return finalProject;
}

export const RecordingProjectImport = Object.freeze({
  adding,
  inserting,
  insertionTime: timelineInsertionTime,
  splitEdits: timelineSplitEdits,
});
