// Port of: F:\dogsc\Sources\RecorderCore\ProjectTimelineEditing.swift

import { min, max, clamp } from './swift.ts';
import {
  type ProjectTimeline,
  type SourceSequence,
  type RecordingSegment,
  type TransitionTiming,
  type PrimarySegmentAudioOverrides,
  makePrimarySegmentAudioOverrides,
  primarySegmentAudioOverridesIsEmpty,
  makeRecordingSegment,
  makeSourceSequenceEdited,
  makeTransitionTiming,
} from './ProjectTimeline.ts';
import { TimelineMap } from './TimelineMap.ts';
import {
  type ZoomAnimationClip,
  makeZoomAnimationClip,
  ZoomInterpolator,
  ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE,
} from './ZoomAnimation.ts';
import { type ScreenMotionClip } from './ScreenMotion.ts';
import { type CameraMotionClip } from './CameraMotion.ts';
import {
  type MosaicClip,
  type StickerClip,
  type OverlayTiming,
} from './OverlayTimeline.ts';
import {
  PROJECT_TIMELINE_EDITING_EPSILON,
  type RecordingSegmentTrimEdge,
  type ProjectTimelineTrack,
  type ProjectTimelineEditingErrorKind,
  ProjectTimelineEditingError,
  makeOutputDeletion,
  rippleTimeline,
  insertingZoom,
  insertingScreenMotion,
  insertingCameraMotion,
  insertingMosaic,
  insertingSticker,
  remappedZoomClips,
  remappedScreenMotionClips,
  remappedCameraMotionClips,
  remappedMosaicClips,
  remappedStickerClips,
  sortZoom,
  sortScreenMotion,
  sortCameraMotion,
  authoredSegment,
  primarySegmentIDs,
  validateProjectTimeline,
  validateProjectTimelineWithSourceDuration,
} from './ProjectTimelineEditingTransforms.ts';

// Re-export transforms and types for a unified ProjectTimelineEditing module
export * from './ProjectTimelineEditingTransforms.ts';

const epsilon = PROJECT_TIMELINE_EDITING_EPSILON;

// MARK: - Audio Overrides

export function primarySegmentAudioOverrides(
  timeline: ProjectTimeline,
  segmentID: string
): PrimarySegmentAudioOverrides {
  return timeline.primarySegmentAudioOverrides[segmentID] ?? makePrimarySegmentAudioOverrides();
}

export function settingPrimarySegmentAudioOverrides(
  timeline: ProjectTimeline,
  segmentID: string,
  overrides: PrimarySegmentAudioOverrides
): ProjectTimeline {
  if (!primarySegmentIDs(timeline.sourceSequence).has(segmentID)) {
    throw new ProjectTimelineEditingError('segmentNotFound', { segmentID });
  }
  const nextOverrides = { ...timeline.primarySegmentAudioOverrides };
  if (primarySegmentAudioOverridesIsEmpty(overrides)) {
    delete nextOverrides[segmentID];
  } else {
    nextOverrides[segmentID] = overrides;
  }
  const result: ProjectTimeline = {
    ...timeline,
    primarySegmentAudioOverrides: nextOverrides,
  };
  validateProjectTimeline(result);
  return result;
}

// MARK: - Materialization

export function materialized(
  timeline: ProjectTimeline,
  fullSourceDuration: number
): ProjectTimeline {
  validateProjectTimelineWithSourceDuration(timeline, fullSourceDuration);
  const map = new TimelineMap({
    sourceSequence: timeline.sourceSequence,
    fullSourceDuration,
  });
  const result: ProjectTimeline = {
    ...timeline,
    sourceSequence: map.materializedSourceSequence(),
  };
  validateProjectTimeline(result);
  return result;
}

// MARK: - Repair Persisted Ripple Transitions

export function repairingPersistedRippleTransitions(
  timeline: ProjectTimeline,
  defaultTransitionDuration: number = 0.7
): ProjectTimeline {
  if (timeline.sourceSequence.kind !== 'edited' || timeline.sourceSequence.segments.length <= 1) {
    return timeline;
  }
  const segments = timeline.sourceSequence.segments;
  let output = 0.0;
  const gapJunctions: number[] = [];
  for (let index = 0; index < segments.length; index++) {
    output += segments[index].outputDuration;
    if (
      index + 1 < segments.length &&
      segments[index + 1].sourceStart -
        (segments[index].sourceStart + segments[index].sourceDuration) >
        epsilon
    ) {
      gapJunctions.push(output);
    }
  }
  if (gapJunctions.length === 0) return timeline;

  const safeDefault = max(defaultTransitionDuration, 0);
  const zoomClips = timeline.zoomClips.map(c => makeZoomAnimationClip({ ...c }));
  sortZoom(zoomClips);

  for (let index = 0; index < zoomClips.length; index++) {
    const clip = zoomClips[index];
    const isBrokenJunction = gapJunctions.some(
      j => Math.abs(j - clip.endTime) <= ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE
    );
    const touchesNext =
      index + 1 < zoomClips.length &&
      Math.abs(zoomClips[index + 1].startTime - clip.endTime) <=
        ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE;
    if (
      isBrokenJunction &&
      !touchesNext &&
      clip.exitDuration <= epsilon &&
      clip.exitProgressOffset >= 1 - epsilon
    ) {
      const available =
        index + 1 < zoomClips.length
          ? max(zoomClips[index + 1].startTime - clip.endTime, 0)
          : safeDefault;
      zoomClips[index] = makeZoomAnimationClip({
        ...clip,
        exitDuration: min(safeDefault, available),
        exitProgressOffset: 0,
      });
    }
  }

  const screenMotionClips = timeline.screenMotionClips.map(c => ({
    ...c,
    timing: makeTransitionTiming({ ...c.timing }),
  }));
  sortScreenMotion(screenMotionClips);

  for (let index = 0; index < screenMotionClips.length; index++) {
    const timing = screenMotionClips[index].timing;
    const isBrokenJunction = gapJunctions.some(
      j => Math.abs(j - timing.endTime) <= ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE
    );
    const touchesNext =
      index + 1 < screenMotionClips.length &&
      Math.abs(screenMotionClips[index + 1].timing.startTime - timing.endTime) <=
        ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE;
    if (
      isBrokenJunction &&
      !touchesNext &&
      timing.returnDuration <= epsilon &&
      timing.returnProgressOffset >= 1 - epsilon
    ) {
      const available =
        index + 1 < screenMotionClips.length
          ? max(screenMotionClips[index + 1].timing.startTime - timing.endTime, 0)
          : safeDefault;
      screenMotionClips[index] = {
        ...screenMotionClips[index],
        timing: makeTransitionTiming({
          ...timing,
          returnDuration: min(safeDefault, available),
          returnProgressOffset: 0,
        }),
      };
    }
  }

  const cameraMotionClips = timeline.cameraMotionClips.map(c => ({
    ...c,
    timing: makeTransitionTiming({ ...c.timing }),
  }));
  sortCameraMotion(cameraMotionClips);

  for (let index = 0; index < cameraMotionClips.length; index++) {
    const timing = cameraMotionClips[index].timing;
    const isBrokenJunction = gapJunctions.some(
      j => Math.abs(j - timing.endTime) <= ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE
    );
    const touchesNext =
      index + 1 < cameraMotionClips.length &&
      Math.abs(cameraMotionClips[index + 1].timing.startTime - timing.endTime) <=
        ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE;
    if (
      isBrokenJunction &&
      !touchesNext &&
      timing.returnDuration <= epsilon &&
      timing.returnProgressOffset >= 1 - epsilon
    ) {
      const available =
        index + 1 < cameraMotionClips.length
          ? max(cameraMotionClips[index + 1].timing.startTime - timing.endTime, 0)
          : safeDefault;
      cameraMotionClips[index] = {
        ...cameraMotionClips[index],
        timing: makeTransitionTiming({
          ...timing,
          returnDuration: min(safeDefault, available),
          returnProgressOffset: 0,
        }),
      };
    }
  }

  return {
    ...timeline,
    zoomClips,
    screenMotionClips,
    cameraMotionClips,
  };
}

// MARK: - Split Primary Segment

export function splitPrimarySegment(
  timeline: ProjectTimeline,
  outputTime: number,
  newRightSegmentID: string,
  fullSourceDuration: number
): ProjectTimeline {
  validateProjectTimelineWithSourceDuration(timeline, fullSourceDuration);
  const map = new TimelineMap({
    sourceSequence: timeline.sourceSequence,
    fullSourceDuration,
  });
  const resolved = Number.isFinite(outputTime) ? map.segmentAtOutputTime(outputTime) : null;
  if (
    !resolved ||
    outputTime <= resolved.outputStart + epsilon ||
    outputTime >= resolved.outputEnd - epsilon
  ) {
    throw new ProjectTimelineEditingError('splitOutsideSegment');
  }
  if (map.segments.some(s => s.id === newRightSegmentID)) {
    throw new ProjectTimelineEditingError('duplicateSegmentID', {
      segmentID: newRightSegmentID,
    });
  }

  const splitOutputOffset = outputTime - resolved.outputStart;
  const splitSourceOffset = splitOutputOffset * resolved.playbackRate;
  const segments = map.segments.map(authoredSegment);
  const index = segments.findIndex(s => s.id === resolved.id);
  if (index < 0) {
    throw new ProjectTimelineEditingError('segmentNotFound', { segmentID: resolved.id });
  }

  segments[index] = makeRecordingSegment({
    id: segments[index].id,
    sourceStart: segments[index].sourceStart,
    sourceDuration: splitSourceOffset,
    playbackRate: resolved.playbackRate,
  });

  segments.splice(
    index + 1,
    0,
    makeRecordingSegment({
      id: newRightSegmentID,
      sourceStart: resolved.sourceStart + splitSourceOffset,
      sourceDuration: resolved.sourceDuration - splitSourceOffset,
      playbackRate: resolved.playbackRate,
    })
  );

  const primarySegmentAudioOverrides = { ...timeline.primarySegmentAudioOverrides };
  const existingOverrides = timeline.primarySegmentAudioOverrides[resolved.id];
  if (existingOverrides) {
    primarySegmentAudioOverrides[newRightSegmentID] = existingOverrides;
  }

  const result: ProjectTimeline = {
    ...timeline,
    sourceSequence: makeSourceSequenceEdited(segments),
    primarySegmentAudioOverrides,
  };

  validateProjectTimelineWithSourceDuration(result, fullSourceDuration);
  return result;
}

// MARK: - Trim Primary Segment

export function trimPrimarySegment(
  timeline: ProjectTimeline,
  segmentID: string,
  edge: RecordingSegmentTrimEdge,
  outputTime: number,
  fullSourceDuration: number,
  defaultTransitionDuration: number = 0.7
): ProjectTimeline {
  validateProjectTimelineWithSourceDuration(timeline, fullSourceDuration);
  const map = new TimelineMap({
    sourceSequence: timeline.sourceSequence,
    fullSourceDuration,
  });
  const resolved = map.segments.find(s => s.id === segmentID);
  if (!resolved) {
    throw new ProjectTimelineEditingError('segmentNotFound', { segmentID });
  }
  if (!Number.isFinite(outputTime)) {
    throw new ProjectTimelineEditingError('trimOutsideSegment', { segmentID });
  }

  const segments = map.segments.map(authoredSegment);
  const index = segments.findIndex(s => s.id === segmentID);
  if (index < 0) {
    throw new ProjectTimelineEditingError('segmentNotFound', { segmentID });
  }

  let deletion: ReturnType<typeof makeOutputDeletion>;

  switch (edge) {
    case 'left': {
      if (Math.abs(outputTime - resolved.outputStart) <= epsilon) {
        return timeline;
      }
      if (outputTime < resolved.outputStart - epsilon) {
        // Extending left
        let previousSourceEnd = 0;
        for (let i = 0; i < segments.length; i++) {
          if (i !== index && segments[i].sourceEnd <= resolved.sourceStart + epsilon) {
            previousSourceEnd = max(previousSourceEnd, segments[i].sourceEnd);
          }
        }
        const available = max(resolved.sourceStart - previousSourceEnd, 0);
        const outputAmount = resolved.outputStart - outputTime;
        const sourceAmount = outputAmount * resolved.playbackRate;
        if (sourceAmount > available + epsilon) {
          throw new ProjectTimelineEditingError('trimOutsideSegment', { segmentID });
        }
        segments[index] = makeRecordingSegment({
          id: segments[index].id,
          sourceStart: segments[index].sourceStart - sourceAmount,
          sourceDuration: segments[index].sourceDuration + sourceAmount,
          playbackRate: resolved.playbackRate,
        });

        const zoomClips = timeline.zoomClips.map(c =>
          insertingZoom(c, resolved.outputStart, outputAmount)
        );
        const screenMotionClips = timeline.screenMotionClips.map(c =>
          insertingScreenMotion(c, resolved.outputStart, outputAmount)
        );
        const cameraMotionClips = timeline.cameraMotionClips.map(c =>
          insertingCameraMotion(c, resolved.outputStart, outputAmount)
        );
        const mosaicClips = timeline.mosaicClips.map(c =>
          insertingMosaic(c, resolved.outputStart, outputAmount)
        );
        const stickerClips = timeline.stickerClips.map(c =>
          insertingSticker(c, resolved.outputStart, outputAmount)
        );
        sortZoom(zoomClips);
        sortScreenMotion(screenMotionClips);
        sortCameraMotion(cameraMotionClips);

        const result: ProjectTimeline = {
          ...timeline,
          sourceSequence: makeSourceSequenceEdited(segments),
          zoomClips,
          screenMotionClips,
          cameraMotionClips,
          mosaicClips,
          stickerClips,
        };
        validateProjectTimelineWithSourceDuration(result, fullSourceDuration);
        return result;
      }
      if (
        outputTime <= resolved.outputStart + epsilon ||
        outputTime >= resolved.outputEnd - epsilon
      ) {
        throw new ProjectTimelineEditingError('trimOutsideSegment', { segmentID });
      }
      const sourceAmount = (outputTime - resolved.outputStart) * resolved.playbackRate;
      segments[index] = makeRecordingSegment({
        id: segments[index].id,
        sourceStart: segments[index].sourceStart + sourceAmount,
        sourceDuration: segments[index].sourceDuration - sourceAmount,
        playbackRate: resolved.playbackRate,
      });
      deletion = makeOutputDeletion(resolved.outputStart, outputTime);
      break;
    }

    case 'right': {
      if (Math.abs(outputTime - resolved.outputEnd) <= epsilon) {
        return timeline;
      }
      if (outputTime > resolved.outputEnd + epsilon) {
        // Extending right
        let nextSourceStart = fullSourceDuration;
        for (let i = 0; i < segments.length; i++) {
          if (i !== index && segments[i].sourceStart >= resolved.sourceEnd - epsilon) {
            nextSourceStart = min(nextSourceStart, segments[i].sourceStart);
          }
        }
        const available = max(nextSourceStart - resolved.sourceEnd, 0);
        const outputAmount = outputTime - resolved.outputEnd;
        const sourceAmount = outputAmount * resolved.playbackRate;
        if (sourceAmount > available + epsilon) {
          throw new ProjectTimelineEditingError('trimOutsideSegment', { segmentID });
        }
        segments[index] = makeRecordingSegment({
          id: segments[index].id,
          sourceStart: segments[index].sourceStart,
          sourceDuration: segments[index].sourceDuration + sourceAmount,
          playbackRate: resolved.playbackRate,
        });

        const zoomClips = timeline.zoomClips.map(c =>
          insertingZoom(c, resolved.outputEnd, outputAmount)
        );
        const screenMotionClips = timeline.screenMotionClips.map(c =>
          insertingScreenMotion(c, resolved.outputEnd, outputAmount)
        );
        const cameraMotionClips = timeline.cameraMotionClips.map(c =>
          insertingCameraMotion(c, resolved.outputEnd, outputAmount)
        );
        const mosaicClips = timeline.mosaicClips.map(c =>
          insertingMosaic(c, resolved.outputEnd, outputAmount)
        );
        const stickerClips = timeline.stickerClips.map(c =>
          insertingSticker(c, resolved.outputEnd, outputAmount)
        );
        sortZoom(zoomClips);
        sortScreenMotion(screenMotionClips);
        sortCameraMotion(cameraMotionClips);

        const result: ProjectTimeline = {
          ...timeline,
          sourceSequence: makeSourceSequenceEdited(segments),
          zoomClips,
          screenMotionClips,
          cameraMotionClips,
          mosaicClips,
          stickerClips,
        };
        validateProjectTimelineWithSourceDuration(result, fullSourceDuration);
        return result;
      }
      if (
        outputTime <= resolved.outputStart + epsilon ||
        outputTime >= resolved.outputEnd - epsilon
      ) {
        throw new ProjectTimelineEditingError('trimOutsideSegment', { segmentID });
      }
      segments[index] = makeRecordingSegment({
        id: segments[index].id,
        sourceStart: segments[index].sourceStart,
        sourceDuration: (outputTime - resolved.outputStart) * resolved.playbackRate,
        playbackRate: resolved.playbackRate,
      });
      deletion = makeOutputDeletion(outputTime, resolved.outputEnd);
      break;
    }
  }

  return rippleTimeline(
    timeline,
    makeSourceSequenceEdited(segments),
    deletion,
    deletion.end >= map.outputDuration - epsilon,
    fullSourceDuration,
    defaultTransitionDuration
  );
}

// MARK: - Remove Primary Segment

export function removePrimarySegment(
  timeline: ProjectTimeline,
  segmentID: string,
  fullSourceDuration: number,
  defaultTransitionDuration: number = 0.7
): ProjectTimeline {
  validateProjectTimelineWithSourceDuration(timeline, fullSourceDuration);
  const map = new TimelineMap({
    sourceSequence: timeline.sourceSequence,
    fullSourceDuration,
  });
  const removed = map.segments.find(s => s.id === segmentID);
  if (!removed) {
    throw new ProjectTimelineEditingError('segmentNotFound', { segmentID });
  }
  if (map.segments.length <= 1) {
    throw new ProjectTimelineEditingError('cannotRemoveFinalSegment');
  }
  const retained = map.segments.filter(s => s.id !== segmentID).map(authoredSegment);
  return rippleTimeline(
    timeline,
    makeSourceSequenceEdited(retained),
    makeOutputDeletion(removed.outputStart, removed.outputEnd),
    removed.outputEnd >= map.outputDuration - epsilon,
    fullSourceDuration,
    defaultTransitionDuration
  );
}

// MARK: - Move Primary Segment

export function movePrimarySegment(
  timeline: ProjectTimeline,
  segmentID: string,
  requestedIndex: number,
  fullSourceDuration: number
): ProjectTimeline {
  validateProjectTimelineWithSourceDuration(timeline, fullSourceDuration);
  const oldMap = new TimelineMap({
    sourceSequence: timeline.sourceSequence,
    fullSourceDuration,
  });
  const oldIndex = oldMap.segments.findIndex(s => s.id === segmentID);
  if (oldIndex < 0) {
    throw new ProjectTimelineEditingError('segmentNotFound', { segmentID });
  }
  const finalIndex = min(max(requestedIndex, 0), oldMap.segments.length - 1);
  if (finalIndex === oldIndex) return timeline;

  const segments = oldMap.segments.map(authoredSegment);
  const [moved] = segments.splice(oldIndex, 1);
  segments.splice(finalIndex, 0, moved);

  const newMap = new TimelineMap({
    sourceSequence: makeSourceSequenceEdited(segments),
    fullSourceDuration,
  });
  const newStarts = new Map(newMap.segments.map(s => [s.id, s.outputStart]));

  const result: ProjectTimeline = {
    ...timeline,
    sourceSequence: makeSourceSequenceEdited(segments),
    zoomClips: remappedZoomClips(timeline.zoomClips, oldMap, newStarts, newMap.outputDuration),
    screenMotionClips: remappedScreenMotionClips(
      timeline.screenMotionClips,
      oldMap,
      newStarts,
      newMap.outputDuration
    ),
    cameraMotionClips: remappedCameraMotionClips(
      timeline.cameraMotionClips,
      oldMap,
      newStarts,
      newMap.outputDuration
    ),
    mosaicClips: remappedMosaicClips(timeline.mosaicClips, oldMap, newStarts, newMap.outputDuration),
    stickerClips: remappedStickerClips(
      timeline.stickerClips,
      oldMap,
      newStarts,
      newMap.outputDuration
    ),
  };

  validateProjectTimelineWithSourceDuration(result, fullSourceDuration);
  return result;
}

// MARK: - Restore Primary Gaps

export function restorePrimaryGap(
  timeline: ProjectTimeline,
  previousSegmentID: string,
  nextSegmentID: string,
  restoredSegmentID: string,
  fullSourceDuration: number
): ProjectTimeline {
  validateProjectTimelineWithSourceDuration(timeline, fullSourceDuration);
  const map = new TimelineMap({
    sourceSequence: timeline.sourceSequence,
    fullSourceDuration,
  });
  if (map.segments.some(s => s.id === restoredSegmentID)) {
    throw new ProjectTimelineEditingError('duplicateSegmentID', {
      segmentID: restoredSegmentID,
    });
  }
  const previousIndex = map.segments.findIndex(s => s.id === previousSegmentID);
  if (
    previousIndex < 0 ||
    previousIndex + 1 >= map.segments.length ||
    map.segments[previousIndex + 1].id !== nextSegmentID
  ) {
    throw new ProjectTimelineEditingError('restoreJunctionNotFound', {
      firstID: previousSegmentID,
      secondID: nextSegmentID,
    });
  }

  const previous = map.segments[previousIndex];
  const next = map.segments[previousIndex + 1];
  const restoredDuration = next.sourceStart - previous.sourceEnd;
  if (restoredDuration <= epsilon) {
    throw new ProjectTimelineEditingError('noRestorableSourceGap', {
      firstID: previousSegmentID,
      secondID: nextSegmentID,
    });
  }

  const segments = map.segments.map(authoredSegment);
  segments.splice(
    previousIndex + 1,
    0,
    makeRecordingSegment({
      id: restoredSegmentID,
      sourceStart: previous.sourceEnd,
      sourceDuration: restoredDuration,
    })
  );

  const insertionTime = previous.outputEnd;
  const primarySegmentAudioOverrides = { ...timeline.primarySegmentAudioOverrides };
  const prevOverrides = timeline.primarySegmentAudioOverrides[previousSegmentID];
  if (prevOverrides) {
    primarySegmentAudioOverrides[restoredSegmentID] = prevOverrides;
  }

  const zoomClips = timeline.zoomClips.map(c =>
    insertingZoom(c, insertionTime, restoredDuration)
  );
  const screenMotionClips = timeline.screenMotionClips.map(c =>
    insertingScreenMotion(c, insertionTime, restoredDuration)
  );
  const cameraMotionClips = timeline.cameraMotionClips.map(c =>
    insertingCameraMotion(c, insertionTime, restoredDuration)
  );
  const mosaicClips = timeline.mosaicClips.map(c =>
    insertingMosaic(c, insertionTime, restoredDuration)
  );
  const stickerClips = timeline.stickerClips.map(c =>
    insertingSticker(c, insertionTime, restoredDuration)
  );
  sortZoom(zoomClips);
  sortScreenMotion(screenMotionClips);
  sortCameraMotion(cameraMotionClips);

  const result: ProjectTimeline = {
    ...timeline,
    sourceSequence: makeSourceSequenceEdited(segments),
    primarySegmentAudioOverrides,
    zoomClips,
    screenMotionClips,
    cameraMotionClips,
    mosaicClips,
    stickerClips,
  };

  validateProjectTimelineWithSourceDuration(result, fullSourceDuration);
  return result;
}

export function restorePrimaryLeadingGap(
  timeline: ProjectTimeline,
  restoredSegmentID: string,
  fullSourceDuration: number
): ProjectTimeline {
  validateProjectTimelineWithSourceDuration(timeline, fullSourceDuration);
  const map = new TimelineMap({
    sourceSequence: timeline.sourceSequence,
    fullSourceDuration,
  });
  const first = map.segments[0];
  if (!first || first.sourceStart <= epsilon) {
    throw new ProjectTimelineEditingError('noRestorableLeadingSourceGap', {
      segmentID: first?.id ?? restoredSegmentID,
    });
  }
  if (map.segments.some(s => s.id === restoredSegmentID)) {
    throw new ProjectTimelineEditingError('duplicateSegmentID', {
      segmentID: restoredSegmentID,
    });
  }

  const restoredDuration = first.sourceStart;
  const segments = map.segments.map(authoredSegment);
  segments.unshift(
    makeRecordingSegment({
      id: restoredSegmentID,
      sourceStart: 0,
      sourceDuration: restoredDuration,
    })
  );

  const primarySegmentAudioOverrides = { ...timeline.primarySegmentAudioOverrides };
  const firstOverrides = timeline.primarySegmentAudioOverrides[first.id];
  if (firstOverrides) {
    primarySegmentAudioOverrides[restoredSegmentID] = firstOverrides;
  }

  const zoomClips = timeline.zoomClips.map(c => insertingZoom(c, 0, restoredDuration));
  const screenMotionClips = timeline.screenMotionClips.map(c =>
    insertingScreenMotion(c, 0, restoredDuration)
  );
  const cameraMotionClips = timeline.cameraMotionClips.map(c =>
    insertingCameraMotion(c, 0, restoredDuration)
  );
  const mosaicClips = timeline.mosaicClips.map(c => insertingMosaic(c, 0, restoredDuration));
  const stickerClips = timeline.stickerClips.map(c => insertingSticker(c, 0, restoredDuration));
  sortZoom(zoomClips);
  sortScreenMotion(screenMotionClips);
  sortCameraMotion(cameraMotionClips);

  const result: ProjectTimeline = {
    ...timeline,
    sourceSequence: makeSourceSequenceEdited(segments),
    primarySegmentAudioOverrides,
    zoomClips,
    screenMotionClips,
    cameraMotionClips,
    mosaicClips,
    stickerClips,
  };

  validateProjectTimelineWithSourceDuration(result, fullSourceDuration);
  return result;
}

export function restorePrimaryTrailingGap(
  timeline: ProjectTimeline,
  restoredSegmentID: string,
  fullSourceDuration: number
): ProjectTimeline {
  validateProjectTimelineWithSourceDuration(timeline, fullSourceDuration);
  const map = new TimelineMap({
    sourceSequence: timeline.sourceSequence,
    fullSourceDuration,
  });
  const last = map.segments[map.segments.length - 1];
  if (!last || fullSourceDuration - last.sourceEnd <= epsilon) {
    throw new ProjectTimelineEditingError('noRestorableTrailingSourceGap', {
      segmentID: last?.id ?? restoredSegmentID,
    });
  }
  if (map.segments.some(s => s.id === restoredSegmentID)) {
    throw new ProjectTimelineEditingError('duplicateSegmentID', {
      segmentID: restoredSegmentID,
    });
  }

  const segments = map.segments.map(authoredSegment);
  segments.push(
    makeRecordingSegment({
      id: restoredSegmentID,
      sourceStart: last.sourceEnd,
      sourceDuration: fullSourceDuration - last.sourceEnd,
    })
  );

  const primarySegmentAudioOverrides = { ...timeline.primarySegmentAudioOverrides };
  const lastOverrides = timeline.primarySegmentAudioOverrides[last.id];
  if (lastOverrides) {
    primarySegmentAudioOverrides[restoredSegmentID] = lastOverrides;
  }

  const result: ProjectTimeline = {
    ...timeline,
    sourceSequence: makeSourceSequenceEdited(segments),
    primarySegmentAudioOverrides,
  };

  validateProjectTimelineWithSourceDuration(result, fullSourceDuration);
  return result;
}

// MARK: - Merge Adjacent Primary Segments

export function mergeAdjacentPrimarySegments(
  timeline: ProjectTimeline,
  previousSegmentID: string,
  nextSegmentID: string,
  fullSourceDuration: number
): ProjectTimeline {
  validateProjectTimelineWithSourceDuration(timeline, fullSourceDuration);
  const map = new TimelineMap({
    sourceSequence: timeline.sourceSequence,
    fullSourceDuration,
  });
  const previousIndex = map.segments.findIndex(s => s.id === previousSegmentID);
  if (
    previousIndex < 0 ||
    previousIndex + 1 >= map.segments.length ||
    map.segments[previousIndex + 1].id !== nextSegmentID
  ) {
    throw new ProjectTimelineEditingError('restoreJunctionNotFound', {
      firstID: previousSegmentID,
      secondID: nextSegmentID,
    });
  }

  const previous = map.segments[previousIndex];
  const next = map.segments[previousIndex + 1];

  if (Math.abs(next.sourceStart - previous.sourceEnd) > epsilon) {
    throw new ProjectTimelineEditingError('cannotMergeDeletedGap', {
      firstID: previousSegmentID,
      secondID: nextSegmentID,
    });
  }
  if (Math.abs(next.playbackRate - previous.playbackRate) > epsilon) {
    throw new ProjectTimelineEditingError('cannotMergeDifferentPlaybackRates', {
      firstID: previousSegmentID,
      secondID: nextSegmentID,
    });
  }

  const prevAudio = primarySegmentAudioOverrides(timeline, previousSegmentID);
  const nextAudio = primarySegmentAudioOverrides(timeline, nextSegmentID);
  const audioMatches =
    prevAudio.systemVolume === nextAudio.systemVolume &&
    prevAudio.microphoneVolume === nextAudio.microphoneVolume &&
    prevAudio.isSystemMuted === nextAudio.isSystemMuted &&
    prevAudio.isMicrophoneMuted === nextAudio.isMicrophoneMuted;
  if (!audioMatches) {
    throw new ProjectTimelineEditingError('cannotMergeDifferentAudioOverrides', {
      firstID: previousSegmentID,
      secondID: nextSegmentID,
    });
  }

  const segments = map.segments.map(authoredSegment);
  segments[previousIndex] = makeRecordingSegment({
    id: previous.id,
    sourceStart: previous.sourceStart,
    sourceDuration: next.sourceEnd - previous.sourceStart,
    playbackRate: previous.playbackRate,
  });
  segments.splice(previousIndex + 1, 1);

  const nextOverrides = { ...timeline.primarySegmentAudioOverrides };
  delete nextOverrides[nextSegmentID];

  const result: ProjectTimeline = {
    ...timeline,
    sourceSequence: makeSourceSequenceEdited(segments),
    primarySegmentAudioOverrides: nextOverrides,
  };

  validateProjectTimelineWithSourceDuration(result, fullSourceDuration);
  return result;
}

// MARK: - Screen Motion Editing

export function insertingScreenMotionClip(
  clip: ScreenMotionClip,
  timeline: ProjectTimeline
): ProjectTimeline {
  if (timeline.screenMotionClips.some(c => c.id === clip.id)) {
    throw new ProjectTimelineEditingError('duplicateClipID', {
      track: 'screenMotion',
      clipID: clip.id,
    });
  }
  const screenMotionClips = [...timeline.screenMotionClips, clip];
  sortScreenMotion(screenMotionClips);
  const result: ProjectTimeline = {
    ...timeline,
    screenMotionClips,
  };
  validateProjectTimeline(result);
  return result;
}

export function removingScreenMotionClip(
  id: string,
  timeline: ProjectTimeline,
  defaultReturn: number = 0.7
): ProjectTimeline {
  const ordered = timeline.screenMotionClips.slice();
  sortScreenMotion(ordered);
  const removedIndex = ordered.findIndex(c => c.id === id);
  if (removedIndex < 0) {
    throw new ProjectTimelineEditingError('missingClip', {
      track: 'screenMotion',
      clipID: id,
    });
  }
  const predecessorID = removedIndex > 0 ? ordered[removedIndex - 1].id : null;
  const screenMotionClips = timeline.screenMotionClips.filter(c => c.id !== id);
  sortScreenMotion(screenMotionClips);

  if (predecessorID) {
    const index = screenMotionClips.findIndex(c => c.id === predecessorID);
    if (index >= 0) {
      const original = screenMotionClips[index].timing;
      const timing = makeTransitionTiming({ ...original });
      timing.preserveTransitionIntent(defaultReturn);
      const requested = timing.requestedReturnDuration(defaultReturn);
      const available =
        index + 1 < screenMotionClips.length
          ? screenMotionClips[index + 1].timing.startTime - timing.endTime
          : requested;
      if (available > ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE) {
        let returnDuration = min(requested, max(available, 0));
        let returnProgressOffset = timing.returnProgressOffset;
        if (returnDuration > original.returnDuration + 0.000_001) {
          returnProgressOffset = 0;
        }
        screenMotionClips[index] = {
          ...screenMotionClips[index],
          timing: makeTransitionTiming({
            ...timing,
            returnDuration,
            returnProgressOffset,
          }),
        };
      }
    }
  }

  const result: ProjectTimeline = {
    ...timeline,
    screenMotionClips,
  };
  validateProjectTimeline(result);
  return result;
}

export function replacingScreenMotionClip(
  id: string,
  timeline: ProjectTimeline,
  clip: ScreenMotionClip
): ProjectTimeline {
  if (id !== clip.id) {
    throw new ProjectTimelineEditingError('mismatchedClipID', {
      track: 'screenMotion',
      expectedID: id,
      actualID: clip.id,
    });
  }
  const index = timeline.screenMotionClips.findIndex(c => c.id === id);
  if (index < 0) {
    throw new ProjectTimelineEditingError('missingClip', {
      track: 'screenMotion',
      clipID: id,
    });
  }
  const screenMotionClips = [...timeline.screenMotionClips];
  screenMotionClips[index] = clip;
  sortScreenMotion(screenMotionClips);
  const result: ProjectTimeline = {
    ...timeline,
    screenMotionClips,
  };
  validateProjectTimeline(result);
  return result;
}

// MARK: - Camera Motion Editing

export function insertingCameraMotionClip(
  clip: CameraMotionClip,
  timeline: ProjectTimeline
): ProjectTimeline {
  if (timeline.cameraMotionClips.some(c => c.id === clip.id)) {
    throw new ProjectTimelineEditingError('duplicateClipID', {
      track: 'cameraMotion',
      clipID: clip.id,
    });
  }
  const cameraMotionClips = [...timeline.cameraMotionClips, clip];
  sortCameraMotion(cameraMotionClips);
  const result: ProjectTimeline = {
    ...timeline,
    cameraMotionClips,
  };
  validateProjectTimeline(result);
  return result;
}

export function removingCameraMotionClip(
  id: string,
  timeline: ProjectTimeline,
  defaultReturn: number = 0.7
): ProjectTimeline {
  const ordered = timeline.cameraMotionClips.slice();
  sortCameraMotion(ordered);
  const removedIndex = ordered.findIndex(c => c.id === id);
  if (removedIndex < 0) {
    throw new ProjectTimelineEditingError('missingClip', {
      track: 'cameraMotion',
      clipID: id,
    });
  }
  const predecessorID = removedIndex > 0 ? ordered[removedIndex - 1].id : null;
  const cameraMotionClips = timeline.cameraMotionClips.filter(c => c.id !== id);
  sortCameraMotion(cameraMotionClips);

  if (predecessorID) {
    const index = cameraMotionClips.findIndex(c => c.id === predecessorID);
    if (index >= 0) {
      const original = cameraMotionClips[index].timing;
      const timing = makeTransitionTiming({ ...original });
      timing.preserveTransitionIntent(defaultReturn);
      const requested = timing.requestedReturnDuration(defaultReturn);
      const available =
        index + 1 < cameraMotionClips.length
          ? cameraMotionClips[index + 1].timing.startTime - timing.endTime
          : requested;
      if (available > ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE) {
        let returnDuration = min(requested, max(available, 0));
        let returnProgressOffset = timing.returnProgressOffset;
        if (returnDuration > original.returnDuration + 0.000_001) {
          returnProgressOffset = 0;
        }
        cameraMotionClips[index] = {
          ...cameraMotionClips[index],
          timing: makeTransitionTiming({
            ...timing,
            returnDuration,
            returnProgressOffset,
          }),
        };
      }
    }
  }

  const result: ProjectTimeline = {
    ...timeline,
    cameraMotionClips,
  };
  validateProjectTimeline(result);
  return result;
}

export function replacingCameraMotionClip(
  id: string,
  timeline: ProjectTimeline,
  clip: CameraMotionClip
): ProjectTimeline {
  if (id !== clip.id) {
    throw new ProjectTimelineEditingError('mismatchedClipID', {
      track: 'cameraMotion',
      expectedID: id,
      actualID: clip.id,
    });
  }
  const index = timeline.cameraMotionClips.findIndex(c => c.id === id);
  if (index < 0) {
    throw new ProjectTimelineEditingError('missingClip', {
      track: 'cameraMotion',
      clipID: id,
    });
  }
  const cameraMotionClips = [...timeline.cameraMotionClips];
  cameraMotionClips[index] = clip;
  sortCameraMotion(cameraMotionClips);
  const result: ProjectTimeline = {
    ...timeline,
    cameraMotionClips,
  };
  validateProjectTimeline(result);
  return result;
}

// MARK: - Validation

export function validate(timeline: ProjectTimeline, fullSourceDuration?: number): void {
  if (fullSourceDuration != null) {
    validateProjectTimelineWithSourceDuration(timeline, fullSourceDuration);
  } else {
    validateProjectTimeline(timeline);
  }
}

// MARK: - ProjectTimelineEditing Namespace

export const ProjectTimelineEditing = Object.freeze({
  epsilon: PROJECT_TIMELINE_EDITING_EPSILON,
  primarySegmentAudioOverrides,
  settingPrimarySegmentAudioOverrides,
  materialized,
  repairingPersistedRippleTransitions,
  splitPrimarySegment,
  trimPrimarySegment,
  removePrimarySegment,
  movePrimarySegment,
  restorePrimaryGap,
  restorePrimaryLeadingGap,
  restorePrimaryTrailingGap,
  mergeAdjacentPrimarySegments,
  insertingScreenMotion: insertingScreenMotionClip,
  removingScreenMotion: removingScreenMotionClip,
  replacingScreenMotion: replacingScreenMotionClip,
  insertingCameraMotion: insertingCameraMotionClip,
  removingCameraMotion: removingCameraMotionClip,
  replacingCameraMotion: replacingCameraMotionClip,
  validate,
});
