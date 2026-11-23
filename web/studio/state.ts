/**
 * web/studio/state.ts
 *
 * Pure state mutators & undo/redo history stack for DogSC Studio.
 * Directly delegates to src/core/ algorithms & validates every change with ProjectValidator.
 * Strictly ZERO node:* imports.
 */

import { clamp, newUUID } from '../../src/core/swift.ts';
import {
  decodeRecorderProject,
  encodeRecorderProject,
  type RecorderProject,
} from '../../src/core/ProjectMediaModel.ts';
import { ProjectValidator } from '../../src/core/ProjectValidator.ts';
import { AutoZoomPlanner } from '../../src/core/AutoZoomPlanner.ts';
import { TimelineMap, type ResolvedRecordingSegment } from '../../src/core/TimelineMap.ts';
import {
  fitZoomAnimation,
  movingZoomAnimation,
  resizingZoomAnimation,
  exitNormalizations,
} from '../../src/core/EditorTimeline.ts';
import {
  materialized,
  splitPrimarySegment,
  removePrimarySegment,
} from '../../src/core/ProjectTimelineEditing.ts';
import { settingPlaybackRate } from '../../src/core/ProjectTimelineRetime.ts';
import {
  makeMosaicClip,
  makeOverlayTiming,
  makeNormalizedOverlayRect,
  type MosaicClip,
} from '../../src/core/OverlayTimeline.ts';
import {
  makeZoomAnimationClip,
  type ZoomAnimationClip,
  type PointerEventRecord,
  type NormalizedPoint,
} from '../../src/core/ZoomAnimation.ts';

export type StudioTool = 'select' | 'cut';
export type StudioInspectorTab = 'frame' | 'zoom' | 'opening' | 'cursor' | 'camera' | 'audio';
export type StudioSaveState = 'saved' | 'dirty' | 'saving' | 'error';

export type StudioSelection =
  | null
  | { kind: 'segment'; id: string }
  | { kind: 'zoom'; id: string }
  | { kind: 'mosaic'; id: string }
  | { kind: 'marker'; id: string };

export interface StudioMutationResult {
  project: RecorderProject;
  selection?: StudioSelection;
}

/**
 * Immutable JSON-snapshot Undo / Redo stack preserving Schema v28 fidelity.
 */
export class StudioHistory {
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private readonly maxDepth: number;

  constructor(maxDepth: number = 80) {
    this.maxDepth = Math.max(4, maxDepth);
  }

  reset(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  push(project: RecorderProject): void {
    const encoded = encodeRecorderProject(project);
    if (this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1] === encoded) {
      return;
    }
    this.undoStack.push(encoded);
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  undo(current: RecorderProject): RecorderProject | null {
    const prevJson = this.undoStack.pop();
    if (!prevJson) return null;
    this.redoStack.push(encodeRecorderProject(current));
    return decodeRecorderProject(JSON.parse(prevJson));
  }

  redo(current: RecorderProject): RecorderProject | null {
    const nextJson = this.redoStack.pop();
    if (!nextJson) return null;
    this.undoStack.push(encodeRecorderProject(current));
    return decodeRecorderProject(JSON.parse(nextJson));
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}

export function resolveTimelineSegments(
  project: RecorderProject,
  sourceDuration: number
): ResolvedRecordingSegment[] {
  const safeDur = Number.isFinite(sourceDuration) && sourceDuration > 0 ? sourceDuration : 1;
  const map = new TimelineMap(project.timeline.sourceSequence, safeDur);
  return map.segments.slice();
}

export function computeTimelineOutputDuration(
  project: RecorderProject,
  sourceDuration: number
): number {
  const safeDur = Number.isFinite(sourceDuration) && sourceDuration > 0 ? sourceDuration : 1;
  const map = new TimelineMap(project.timeline.sourceSequence, safeDur);
  return Math.max(0.05, map.outputDuration);
}

function validateAndWrap(
  project: RecorderProject,
  selection?: StudioSelection
): StudioMutationResult {
  ProjectValidator.validate(project);
  return selection !== undefined ? { project, selection } : { project };
}

export function splitSegmentAtTime(
  project: RecorderProject,
  sourceDuration: number,
  outputTime: number
): StudioMutationResult {
  const matTimeline =
    project.timeline.sourceSequence.kind === 'fullRecording'
      ? materialized(project.timeline, sourceDuration)
      : project.timeline;
  const rightId = newUUID();
  const nextTimeline = splitPrimarySegment(matTimeline, outputTime, rightId, sourceDuration);
  const nextProject: RecorderProject = { ...project, timeline: nextTimeline };
  return validateAndWrap(nextProject, { kind: 'segment', id: rightId });
}

export function deleteSegmentById(
  project: RecorderProject,
  sourceDuration: number,
  segmentId: string
): StudioMutationResult {
  const map = new TimelineMap(project.timeline.sourceSequence, sourceDuration);
  if (map.segments.length <= 1) {
    throw new Error('至少需要保留一个主视频片段');
  }
  const nextTimeline = removePrimarySegment(project.timeline, segmentId, sourceDuration);
  const remainingMap = new TimelineMap(nextTimeline.sourceSequence, sourceDuration);
  const nextSel: StudioSelection =
    remainingMap.segments.length > 0
      ? { kind: 'segment', id: remainingMap.segments[0].id }
      : null;
  const nextProject: RecorderProject = { ...project, timeline: nextTimeline };
  return validateAndWrap(nextProject, nextSel);
}

export function setSegmentPlaybackRate(
  project: RecorderProject,
  sourceDuration: number,
  segmentId: string,
  rate: number
): StudioMutationResult {
  const matTimeline =
    project.timeline.sourceSequence.kind === 'fullRecording'
      ? materialized(project.timeline, sourceDuration)
      : project.timeline;
  const resolvedSegmentId =
    project.timeline.sourceSequence.kind === 'fullRecording'
      ? new TimelineMap(matTimeline.sourceSequence, sourceDuration).segments[0]?.id ?? segmentId
      : segmentId;
  const nextTimeline = settingPlaybackRate(rate, resolvedSegmentId, matTimeline, sourceDuration);
  const nextProject: RecorderProject = { ...project, timeline: nextTimeline };
  return validateAndWrap(nextProject, { kind: 'segment', id: resolvedSegmentId });
}

function normalizeZoomClipArray(
  clips: readonly ZoomAnimationClip[],
  editedId: string | null,
  defaultExit: number
): ZoomAnimationClip[] {
  const sorted = clips.slice().sort((a, b) => a.startTime - b.startTime);
  if (!editedId) return sorted;
  const patches = exitNormalizations(editedId, sorted, defaultExit);
  if (patches.length === 0) return sorted;
  const byId = new Map(patches.map((p) => [p.id, p]));
  return sorted.map((c) => byId.get(c.id) ?? c);
}

export function addZoomClipAtTime(
  project: RecorderProject,
  outputDuration: number,
  startTime: number,
  focus?: NormalizedPoint
): StudioMutationResult {
  const defaultExit = project.motion.defaultZoomTransitionDuration ?? 0.7;
  const clip = fitZoomAnimation({
    start: startTime,
    end: startTime,
    among: project.timeline.zoomClips,
    duration: outputDuration,
    scale: project.motion.defaultZoomScale ?? 1.8,
    focus: focus ?? { x: 0.5, y: 0.5 },
    origin: 'manual',
    easing: project.motion.defaultZoomEasing ?? '弹簧',
    transitionDuration: defaultExit,
  });
  if (!clip) {
    throw new Error('当前时间位置没有足够的空闲区间添加缩放片段');
  }
  const zoomClips = normalizeZoomClipArray(
    [...project.timeline.zoomClips, clip],
    clip.id,
    defaultExit
  );
  const nextProject: RecorderProject = {
    ...project,
    timeline: { ...project.timeline, zoomClips },
  };
  return validateAndWrap(nextProject, { kind: 'zoom', id: clip.id });
}

export function moveZoomClipById(
  project: RecorderProject,
  outputDuration: number,
  clipId: string,
  proposedStart: number
): StudioMutationResult {
  const existing = project.timeline.zoomClips.find((c) => c.id === clipId);
  if (!existing) throw new Error(`找不到缩放片段: ${clipId}`);
  const defaultExit = project.motion.defaultZoomTransitionDuration ?? 0.7;
  const moved = movingZoomAnimation(
    existing,
    proposedStart,
    project.timeline.zoomClips,
    outputDuration,
    defaultExit
  );
  const zoomClips = normalizeZoomClipArray(
    project.timeline.zoomClips.map((c) => (c.id === clipId ? moved : c)),
    clipId,
    defaultExit
  );
  const nextProject: RecorderProject = {
    ...project,
    timeline: { ...project.timeline, zoomClips },
  };
  return validateAndWrap(nextProject, { kind: 'zoom', id: clipId });
}

export function resizeZoomClipById(
  project: RecorderProject,
  outputDuration: number,
  clipId: string,
  edge: 'left' | 'right',
  proposedTime: number
): StudioMutationResult {
  const existing = project.timeline.zoomClips.find((c) => c.id === clipId);
  if (!existing) throw new Error(`找不到缩放片段: ${clipId}`);
  const defaultExit = project.motion.defaultZoomTransitionDuration ?? 0.7;
  const resized = resizingZoomAnimation({
    animation: existing,
    proposedStart: edge === 'left' ? proposedTime : null,
    proposedEnd: edge === 'right' ? proposedTime : null,
    among: project.timeline.zoomClips,
    duration: outputDuration,
    defaultExit,
  });
  const zoomClips = normalizeZoomClipArray(
    project.timeline.zoomClips.map((c) => (c.id === clipId ? resized : c)),
    clipId,
    defaultExit
  );
  const nextProject: RecorderProject = {
    ...project,
    timeline: { ...project.timeline, zoomClips },
  };
  return validateAndWrap(nextProject, { kind: 'zoom', id: clipId });
}

export function updateZoomClipById(
  project: RecorderProject,
  clipId: string,
  patch: Partial<
    Pick<
      ZoomAnimationClip,
      'scale' | 'focus' | 'easing' | 'enterDuration' | 'exitDuration' | 'origin'
    >
  >
): StudioMutationResult {
  const existing = project.timeline.zoomClips.find((c) => c.id === clipId);
  if (!existing) throw new Error(`找不到缩放片段: ${clipId}`);
  const updated = makeZoomAnimationClip({
    ...existing,
    ...patch,
    scale: patch.scale !== undefined ? clamp(patch.scale, 1.05, 4.0) : existing.scale,
    focus: patch.focus
      ? { x: clamp(patch.focus.x, 0, 1), y: clamp(patch.focus.y, 0, 1) }
      : existing.focus,
  });
  const zoomClips = project.timeline.zoomClips.map((c) => (c.id === clipId ? updated : c));
  const nextProject: RecorderProject = {
    ...project,
    timeline: { ...project.timeline, zoomClips },
  };
  return validateAndWrap(nextProject, { kind: 'zoom', id: clipId });
}

export function deleteZoomClipById(
  project: RecorderProject,
  clipId: string
): StudioMutationResult {
  const remaining = project.timeline.zoomClips.filter((c) => c.id !== clipId);
  const defaultExit = project.motion.defaultZoomTransitionDuration ?? 0.7;
  const zoomClips = normalizeZoomClipArray(
    remaining,
    remaining[0]?.id ?? null,
    defaultExit
  );
  const nextProject: RecorderProject = {
    ...project,
    timeline: { ...project.timeline, zoomClips },
  };
  return validateAndWrap(nextProject, null);
}

export function addMosaicClipAtTime(
  project: RecorderProject,
  outputDuration: number,
  startTime: number,
  style: 'blur' | 'spotlight' = 'blur'
): StudioMutationResult {
  const safeDur = Math.max(0.4, Math.min(2.0, Math.max(0.4, outputDuration - startTime)));
  const clampedStart = clamp(startTime, 0, Math.max(0, outputDuration - 0.4));
  const clip = makeMosaicClip({
    timing: makeOverlayTiming(clampedStart, Math.min(safeDur, Math.max(0.4, outputDuration - clampedStart))),
    sourceRect: makeNormalizedOverlayRect(0.32, 0.36, 0.36, 0.28),
    style,
  });
  const mosaicClips = [...project.timeline.mosaicClips, clip].sort(
    (a, b) => a.timing.startTime - b.timing.startTime
  );
  const nextProject: RecorderProject = {
    ...project,
    timeline: { ...project.timeline, mosaicClips },
  };
  return validateAndWrap(nextProject, { kind: 'mosaic', id: clip.id });
}

export function moveMosaicClipById(
  project: RecorderProject,
  outputDuration: number,
  clipId: string,
  proposedStart: number
): StudioMutationResult {
  const existing = project.timeline.mosaicClips.find((c) => c.id === clipId);
  if (!existing) throw new Error(`找不到马赛克/聚光灯片段: ${clipId}`);
  const maxStart = Math.max(0, outputDuration - existing.timing.duration);
  const clampedStart = clamp(proposedStart, 0, maxStart);
  const updated: MosaicClip = {
    ...existing,
    timing: makeOverlayTiming(clampedStart, existing.timing.duration),
  };
  const mosaicClips = project.timeline.mosaicClips
    .map((c) => (c.id === clipId ? updated : c))
    .sort((a, b) => a.timing.startTime - b.timing.startTime);
  const nextProject: RecorderProject = {
    ...project,
    timeline: { ...project.timeline, mosaicClips },
  };
  return validateAndWrap(nextProject, { kind: 'mosaic', id: clipId });
}

export function updateMosaicClipById(
  project: RecorderProject,
  clipId: string,
  patch: Partial<Pick<MosaicClip, 'style' | 'intensity' | 'spotlightDimming' | 'cornerRadius' | 'sourceRect'>>
): StudioMutationResult {
  const existing = project.timeline.mosaicClips.find((c) => c.id === clipId);
  if (!existing) throw new Error(`找不到马赛克/聚光灯片段: ${clipId}`);
  const updated: MosaicClip = {
    ...existing,
    ...patch,
    intensity: patch.intensity !== undefined ? clamp(patch.intensity, 0.05, 1) : existing.intensity,
    spotlightDimming:
      patch.spotlightDimming !== undefined
        ? clamp(patch.spotlightDimming, 0.05, 0.9)
        : existing.spotlightDimming,
    cornerRadius:
      patch.cornerRadius !== undefined
        ? clamp(patch.cornerRadius, 0, 0.5)
        : existing.cornerRadius,
  };
  const mosaicClips = project.timeline.mosaicClips.map((c) => (c.id === clipId ? updated : c));
  const nextProject: RecorderProject = {
    ...project,
    timeline: { ...project.timeline, mosaicClips },
  };
  return validateAndWrap(nextProject, { kind: 'mosaic', id: clipId });
}

export function deleteMosaicClipById(
  project: RecorderProject,
  clipId: string
): StudioMutationResult {
  const mosaicClips = project.timeline.mosaicClips.filter((c) => c.id !== clipId);
  const nextProject: RecorderProject = {
    ...project,
    timeline: { ...project.timeline, mosaicClips },
  };
  return validateAndWrap(nextProject, null);
}

export function recomputeAutoZoomClips(
  project: RecorderProject,
  pointerEvents: readonly PointerEventRecord[]
): StudioMutationResult {
  const zoomClips = AutoZoomPlanner.makeAnimationsFromPointerEvents(pointerEvents, {
    zoomScale: project.motion.defaultZoomScale ?? 1.8,
    transitionDuration: project.motion.defaultZoomTransitionDuration ?? 0.7,
    easing: project.motion.defaultZoomEasing ?? '弹簧',
  });
  const nextProject: RecorderProject = {
    ...project,
    timeline: { ...project.timeline, zoomClips },
  };
  return validateAndWrap(
    nextProject,
    zoomClips.length > 0 ? { kind: 'zoom', id: zoomClips[0].id } : null
  );
}
