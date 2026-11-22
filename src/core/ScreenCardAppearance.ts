// Port of: F:\dogsc-v0.2.0\Sources\RecorderCore\ScreenCardAppearance.swift
// & SegmentSceneStyle.swift L224-274 (RecorderProject sceneProject / setSceneStyle helpers).
// Note: cameraAppearanceTransitionSample (L193-215) waits for T13.5b CameraMotionTrack.transitionSample.

import {
  type HexColor,
  hexColorFromJSON,
  makeHexColor,
} from './HexColor.ts';
import {
  type BackgroundSource,
  type CameraStyle,
  type CanvasStyle,
  type NormalizedCrop,
  NormalizedCropFull,
  type ScreenFrameStyle,
  makeCanvasStyle,
  normalizedCropClamped,
  screenFrameStyleFromJSON,
} from './ProjectModel.ts';
import type { RecorderProject } from './ProjectMediaModel.ts';
import type { RecordingSegment } from './ProjectTimeline.ts';
import type { RecordingSource } from './RecordingSource.ts';
import {
  type RecordingSegmentBoundary,
  type SegmentSceneStyle,
  SegmentAppearanceTransition,
  backgroundSourceEquals,
  cameraStyleBlend,
  canvasStyleBlend,
  makeSegmentSceneStyle,
  projectTimelineRecordingSegmentBoundaryAtOutputTime,
  projectTimelineRecordingSegmentByID,
  segmentSceneStyleApplyToProject,
} from './SegmentSceneStyle.ts';

const PRIMARY_SOURCE_ID = '00000000-0000-0000-0000-000000000001';

/// Screen decoration belongs to a recording (or an inserted clip). Canvas
/// background, ratio and layout remain shared by the programme.
export interface ScreenCardAppearance {
  cornerRadius: number;
  borderWidth: number;
  borderColor: HexColor;
  shadowStrength: number;
  insetOpacity: number;
  screenFrame: ScreenFrameStyle;
  screenFrameScale: number;
  screenFrameToolbarScale: number;
  screenFrameOuterCornerRadius: number | null;
  screenFrameContentCornerRadius: number | null;
  screenFrameTitle: string;
  screenFrameBrowserAddress: string;
}

export function makeScreenCardAppearance(
  options: Partial<ScreenCardAppearance> = {},
): ScreenCardAppearance {
  const defaults = makeCanvasStyle();
  return {
    cornerRadius: options.cornerRadius ?? defaults.cornerRadius,
    borderWidth: options.borderWidth ?? defaults.borderWidth,
    borderColor: options.borderColor ?? defaults.borderColor,
    shadowStrength: options.shadowStrength ?? defaults.shadowStrength,
    insetOpacity: options.insetOpacity ?? defaults.insetOpacity,
    screenFrame: options.screenFrame ?? defaults.screenFrame,
    screenFrameScale: options.screenFrameScale ?? defaults.screenFrameScale,
    screenFrameToolbarScale:
      options.screenFrameToolbarScale ?? defaults.screenFrameToolbarScale,
    screenFrameOuterCornerRadius:
      options.screenFrameOuterCornerRadius !== undefined
        ? options.screenFrameOuterCornerRadius
        : defaults.screenFrameOuterCornerRadius,
    screenFrameContentCornerRadius:
      options.screenFrameContentCornerRadius !== undefined
        ? options.screenFrameContentCornerRadius
        : defaults.screenFrameContentCornerRadius,
    screenFrameTitle: options.screenFrameTitle ?? defaults.screenFrameTitle,
    screenFrameBrowserAddress:
      options.screenFrameBrowserAddress ?? defaults.screenFrameBrowserAddress,
  };
}

export function screenCardAppearanceFromCanvas(canvas: CanvasStyle): ScreenCardAppearance {
  return makeScreenCardAppearance(canvas);
}

export function screenCardAppearanceApplyToCanvas(
  appearance: ScreenCardAppearance,
  canvas: CanvasStyle,
): CanvasStyle {
  return {
    ...canvas,
    cornerRadius: appearance.cornerRadius,
    borderWidth: appearance.borderWidth,
    borderColor: appearance.borderColor,
    shadowStrength: appearance.shadowStrength,
    insetOpacity: appearance.insetOpacity,
    screenFrame: appearance.screenFrame,
    screenFrameScale: appearance.screenFrameScale,
    screenFrameToolbarScale: appearance.screenFrameToolbarScale,
    screenFrameOuterCornerRadius: appearance.screenFrameOuterCornerRadius,
    screenFrameContentCornerRadius: appearance.screenFrameContentCornerRadius,
    screenFrameTitle: appearance.screenFrameTitle,
    screenFrameBrowserAddress: appearance.screenFrameBrowserAddress,
  };
}

function parseBorderColor(value: unknown, fallback: HexColor): HexColor {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') return hexColorFromJSON(value);
  if (typeof value === 'object' && typeof (value as { rgb24?: unknown }).rgb24 === 'number') {
    return makeHexColor((value as { rgb24: number }).rgb24);
  }
  throw new Error('Expected #RRGGBB string or HexColor object for borderColor');
}

export function screenCardAppearanceFromJSON(raw: unknown): ScreenCardAppearance {
  if (!raw || typeof raw !== 'object') {
    return makeScreenCardAppearance();
  }
  const c = raw as Record<string, unknown>;
  const defaults = makeCanvasStyle();
  return {
    cornerRadius: typeof c.cornerRadius === 'number' ? c.cornerRadius : defaults.cornerRadius,
    borderWidth: typeof c.borderWidth === 'number' ? c.borderWidth : defaults.borderWidth,
    borderColor: parseBorderColor(c.borderColor, defaults.borderColor),
    shadowStrength:
      typeof c.shadowStrength === 'number' ? c.shadowStrength : defaults.shadowStrength,
    insetOpacity: typeof c.insetOpacity === 'number' ? c.insetOpacity : defaults.insetOpacity,
    screenFrame:
      typeof c.screenFrame === 'string'
        ? screenFrameStyleFromJSON(c.screenFrame)
        : defaults.screenFrame,
    screenFrameScale:
      typeof c.screenFrameScale === 'number' ? c.screenFrameScale : defaults.screenFrameScale,
    screenFrameToolbarScale:
      typeof c.screenFrameToolbarScale === 'number'
        ? c.screenFrameToolbarScale
        : defaults.screenFrameToolbarScale,
    screenFrameOuterCornerRadius:
      typeof c.screenFrameOuterCornerRadius === 'number'
        ? c.screenFrameOuterCornerRadius
        : c.screenFrameOuterCornerRadius === null
          ? null
          : defaults.screenFrameOuterCornerRadius,
    screenFrameContentCornerRadius:
      typeof c.screenFrameContentCornerRadius === 'number'
        ? c.screenFrameContentCornerRadius
        : c.screenFrameContentCornerRadius === null
          ? null
          : defaults.screenFrameContentCornerRadius,
    screenFrameTitle:
      typeof c.screenFrameTitle === 'string' ? c.screenFrameTitle : defaults.screenFrameTitle,
    screenFrameBrowserAddress:
      typeof c.screenFrameBrowserAddress === 'string'
        ? c.screenFrameBrowserAddress
        : defaults.screenFrameBrowserAddress,
  };
}

export type ScreenAppearanceTarget =
  | { kind: 'recording'; id: string }
  | { kind: 'insertedSegment'; id: string }
  | { kind: 'segment'; id: string };

// ---------------------------------------------------------------------------
// RecorderProject Screen Appearance & Multi-Source Extensions (Swift L88-287)
// ---------------------------------------------------------------------------

function lookupAdditionalSource(project: RecorderProject, id: string): RecordingSource | null {
  return (project.additionalSources ?? []).find((s) => s.id === id) ?? null;
}

function segmentResolvedSource(segment: RecordingSegment): string {
  return segment.media == null ? (segment.sourceID ?? PRIMARY_SOURCE_ID) : PRIMARY_SOURCE_ID;
}

function cloneSegmentWith<K extends keyof RecordingSegment>(
  segment: RecordingSegment,
  patch: Partial<RecordingSegment>,
): RecordingSegment {
  return Object.defineProperties(
    {
      ...segment,
      ...patch,
    },
    {
      sourceEnd: {
        enumerable: true,
        get() {
          return this.sourceStart + this.sourceDuration;
        },
      },
      outputDuration: {
        enumerable: true,
        get() {
          return this.sourceDuration / this.playbackRate;
        },
      },
      resolvedSourceID: {
        enumerable: true,
        get() {
          return this.media == null ? (this.sourceID ?? PRIMARY_SOURCE_ID) : PRIMARY_SOURCE_ID;
        },
      },
    },
  );
}

/// The single crop authority, shared by preview, export and the inspector.
/// An occurrence that opted out of following its recording keeps its own
/// rectangle; everything else follows the source, and an inserted clip
/// never borrows a recording's crop.
export function projectResolvedCrop(
  project: RecorderProject,
  segment: RecordingSegment | null,
): NormalizedCrop {
  if (!segment) return project.canvas.crop;
  if (segment.media != null) return NormalizedCropFull;
  if (segment.crop != null) return normalizedCropClamped(segment.crop);
  const sid = segmentResolvedSource(segment);
  if (sid === PRIMARY_SOURCE_ID) return project.canvas.crop;
  return lookupAdditionalSource(project, sid)?.crop ?? project.canvas.crop;
}

/// Per-occurrence crop overrides, for builders that cannot walk the
/// sequence themselves (the shared aspect-transition table).
export function projectSegmentCrops(project: RecorderProject): Map<string, NormalizedCrop> {
  const result = new Map<string, NormalizedCrop>();
  if (project.timeline.sourceSequence.kind !== 'edited') return result;
  for (const segment of project.timeline.sourceSequence.segments) {
    if (segment.media == null && segment.crop != null) {
      result.set(segment.id, normalizedCropClamped(segment.crop));
    }
  }
  return result;
}

export function projectScreenCanvasForTarget(
  project: RecorderProject,
  target: ScreenAppearanceTarget,
): CanvasStyle {
  let result: CanvasStyle = { ...project.canvas };
  switch (target.kind) {
    case 'segment':
      return projectSceneProjectForSegmentID(project, target.id).canvas;
    case 'recording': {
      if (target.id === PRIMARY_SOURCE_ID) {
        return result;
      }
      const src = lookupAdditionalSource(project, target.id);
      if (src) {
        if (src.screenAppearance) {
          result = screenCardAppearanceApplyToCanvas(src.screenAppearance, result);
        }
        result = { ...result, crop: src.crop };
      }
      return result;
    }
    case 'insertedSegment': {
      result = { ...result, crop: NormalizedCropFull };
      if (project.timeline.sourceSequence.kind === 'edited') {
        const seg = project.timeline.sourceSequence.segments.find((s) => s.id === target.id);
        const media = seg?.media ?? null;
        if (media?.screenAppearance) {
          result = screenCardAppearanceApplyToCanvas(media.screenAppearance, result);
        }
        if (media?.imagePath != null && media.usesFrameStyle === false) {
          result = { ...result, padding: 0 };
        }
      }
      return result;
    }
  }
}

function screenCanvasForSegment(
  project: RecorderProject,
  segment: RecordingSegment | null,
  recordingSourceID: string | null,
): CanvasStyle {
  if (segment?.sceneStyle != null) {
    return {
      ...segment.sceneStyle.canvas,
      aspectRatio: project.canvas.aspectRatio,
      customAspectRatio: project.canvas.customAspectRatio,
      crop: projectResolvedCrop(project, segment),
    };
  }
  let result: CanvasStyle = { ...project.canvas };
  const inserted = segment?.media ?? null;
  if (inserted != null) {
    if (inserted.screenAppearance != null) {
      result = screenCardAppearanceApplyToCanvas(inserted.screenAppearance, result);
    }
    result = { ...result, crop: NormalizedCropFull };
    if (!inserted.usesFrameStyle) {
      if (inserted.imagePath != null) {
        result = { ...result, padding: 0 };
      }
      result = {
        ...result,
        contentScale: 1,
        contentPosition: { x: 0.5, y: 0.5 },
      };
    }
  } else if (recordingSourceID !== null && recordingSourceID !== PRIMARY_SOURCE_ID) {
    const src = lookupAdditionalSource(project, recordingSourceID);
    if (src) {
      if (src.screenAppearance != null) {
        result = screenCardAppearanceApplyToCanvas(src.screenAppearance, result);
      }
      result = { ...result, crop: src.crop };
    }
  }
  if (segment != null) {
    result = { ...result, crop: projectResolvedCrop(project, segment) };
  }
  return result;
}

export function projectScreenCanvasAtOutputTime(
  project: RecorderProject,
  time: number,
  recordingSourceID: string | null,
  boundary?: RecordingSegmentBoundary,
): CanvasStyle {
  const b = boundary ?? projectTimelineRecordingSegmentBoundaryAtOutputTime(project.timeline, time);
  const current = b.segment as RecordingSegment | null;
  const previous = b.previous as RecordingSegment | null;
  const result = screenCanvasForSegment(project, current, recordingSourceID);
  if (!current || !previous) return result;
  if (!SegmentAppearanceTransition.canSettle(previous, current)) return result;
  const progress = SegmentAppearanceTransition.progress(time, b.start);
  if (progress === null) return result;
  const from = screenCanvasForSegment(project, previous, segmentResolvedSource(previous));
  return canvasStyleBlend(result, from, progress);
}

export function projectSettledCameraAtOutputTime(
  project: RecorderProject,
  time: number,
  boundary?: RecordingSegmentBoundary,
): CameraStyle {
  const b = boundary ?? projectTimelineRecordingSegmentBoundaryAtOutputTime(project.timeline, time);
  const current = b.segment as RecordingSegment | null;
  const previous = b.previous as RecordingSegment | null;
  const result: CameraStyle = current?.sceneStyle?.camera ?? project.camera;
  if (!current || !previous) return result;
  if (!SegmentAppearanceTransition.canSettle(previous, current)) return result;
  const progress = SegmentAppearanceTransition.progress(time, b.start);
  if (progress === null) return result;
  return cameraStyleBlend(result, previous.sceneStyle?.camera ?? project.camera, progress);
}

/// Paused authoring has to show the clip's own authored values: a playhead
/// parked just after a cut would otherwise sit inside the appearance
/// settling window, and the inspector's numbers would not match the
/// picture. Handing the outgoing clip this clip's appearance leaves the
/// blend nothing to interpolate, without a presentation flag in the
/// document. Playback and export keep the real settling.
export function projectSettlingSegmentAppearance(
  project: RecorderProject,
  atOutputTime: number,
): RecorderProject {
  const boundary = projectTimelineRecordingSegmentBoundaryAtOutputTime(
    project.timeline,
    atOutputTime,
  );
  const current = boundary.segment as RecordingSegment | null;
  const previous = boundary.previous as RecordingSegment | null;
  if (!current || !previous) return project;
  if (!SegmentAppearanceTransition.canSettle(previous, current)) return project;
  if (SegmentAppearanceTransition.progress(atOutputTime, boundary.start) === null) return project;
  if (project.timeline.sourceSequence.kind !== 'edited') return project;
  const segments = project.timeline.sourceSequence.segments;
  const index = segments.findIndex((s) => s.id === previous.id);
  if (index < 0) return project;

  const sceneProj = projectSceneProjectForSegmentID(project, current.id);
  const baseStyle = makeSegmentSceneStyle({
    canvas: sceneProj.canvas,
    camera: sceneProj.camera,
    cursor: sceneProj.cursorStyle,
    motion: sceneProj.motion,
    presetID: previous.sceneStyle?.presetID ?? null,
    presetName: previous.sceneStyle?.presetName ?? null,
  });
  const nextSegments = segments.slice();
  nextSegments[index] = cloneSegmentWith(nextSegments[index], { sceneStyle: baseStyle });
  return {
    ...project,
    timeline: {
      ...project.timeline,
      sourceSequence: { kind: 'edited', segments: nextSegments },
    },
  };
}

/// Materialize the previous shared appearance without changing old pixels.
/// A later edit to the primary recording must not restyle these sources.
export function projectPreserveLegacyScreenAppearances(
  project: RecorderProject,
): RecorderProject {
  const previous = makeScreenCardAppearance(project.canvas);
  let nextAdditional = project.additionalSources ?? [];
  let changedAdditional = false;
  nextAdditional = nextAdditional.map((src) => {
    if (src.screenAppearance != null) return src;
    changedAdditional = true;
    return { ...src, screenAppearance: { ...previous } };
  });

  let nextTimeline = project.timeline;
  if (project.timeline.sourceSequence.kind === 'edited') {
    let changedSegs = false;
    const nextSegs = project.timeline.sourceSequence.segments.map((seg) => {
      if (seg.media != null && seg.media.screenAppearance == null) {
        changedSegs = true;
        return cloneSegmentWith(seg, {
          media: { ...seg.media, screenAppearance: { ...previous } },
        });
      }
      return seg;
    });
    if (changedSegs) {
      nextTimeline = {
        ...project.timeline,
        sourceSequence: { kind: 'edited', segments: nextSegs },
      };
    }
  }

  if (!changedAdditional && nextTimeline === project.timeline) {
    return project;
  }
  return {
    ...project,
    additionalSources: nextAdditional,
    timeline: nextTimeline,
  };
}

export function projectSetScreenAppearance(
  project: RecorderProject,
  appearance: ScreenCardAppearance,
  target: ScreenAppearanceTarget,
): RecorderProject {
  let result = projectPreserveLegacyScreenAppearances(project);
  switch (target.kind) {
    case 'segment': {
      const seg = projectTimelineRecordingSegmentByID(result.timeline, target.id) as RecordingSegment | null;
      const baseProj = projectSceneProjectForSegmentID(result, target.id);
      let style = makeSegmentSceneStyle({
        canvas: baseProj.canvas,
        camera: baseProj.camera,
        cursor: baseProj.cursorStyle,
        motion: baseProj.motion,
      });
      if (seg?.sceneStyle != null) style = seg.sceneStyle;
      style = {
        ...style,
        canvas: screenCardAppearanceApplyToCanvas(appearance, style.canvas),
      };
      return projectSetSceneStyleForSegmentID(result, style, target.id);
    }
    case 'recording': {
      if (target.id === PRIMARY_SOURCE_ID) {
        return {
          ...result,
          canvas: screenCardAppearanceApplyToCanvas(appearance, result.canvas),
        };
      }
      const index = result.additionalSources.findIndex((s) => s.id === target.id);
      if (index < 0) return result;
      const nextAdditional = result.additionalSources.slice();
      nextAdditional[index] = {
        ...nextAdditional[index],
        screenAppearance: { ...appearance },
      };
      return { ...result, additionalSources: nextAdditional };
    }
    case 'insertedSegment': {
      if (result.timeline.sourceSequence.kind !== 'edited') return result;
      const segments = result.timeline.sourceSequence.segments;
      const index = segments.findIndex((s) => s.id === target.id);
      if (index < 0 || segments[index].media == null) return result;
      const nextSegments = segments.slice();
      nextSegments[index] = cloneSegmentWith(nextSegments[index], {
        media: {
          ...nextSegments[index].media!,
          screenAppearance: { ...appearance },
          usesFrameStyle: true,
        },
      });
      return {
        ...result,
        timeline: {
          ...result.timeline,
          sourceSequence: { kind: 'edited', segments: nextSegments },
        },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// SegmentSceneStyle RecorderProject Helpers (from SegmentSceneStyle.swift L224-274)
// ---------------------------------------------------------------------------

export function projectSceneProjectForSegmentID(
  project: RecorderProject,
  id: string | null,
): RecorderProject {
  if (id === null) return project;
  const segment = projectTimelineRecordingSegmentByID(project.timeline, id) as RecordingSegment | null;
  if (!segment) return project;
  let result: RecorderProject = {
    ...project,
    canvas: projectScreenCanvasForTarget(
      project,
      segment.media == null
        ? { kind: 'recording', id: segmentResolvedSource(segment) }
        : { kind: 'insertedSegment', id },
    ),
  };
  // `apply(to:)` preserves whatever crop the caller resolved, so the
  // occurrence's own rectangle has to be in place before the style runs.
  result = {
    ...result,
    canvas: {
      ...result.canvas,
      crop: projectResolvedCrop(project, segment),
    },
  };
  if (segment.sceneStyle != null) {
    result = segmentSceneStyleApplyToProject(segment.sceneStyle, result);
  }
  if (segment.media?.usesFrameStyle === false && segment.sceneStyle == null) {
    result = {
      ...result,
      canvas: {
        ...result.canvas,
        contentScale: 1,
        contentPosition: { x: 0.5, y: 0.5 },
      },
    };
  }
  return result;
}

export function projectSceneProjectAtOutputTime(
  project: RecorderProject,
  time: number,
): RecorderProject {
  const seg = projectTimelineRecordingSegmentBoundaryAtOutputTime(project.timeline, time)
    .segment as RecordingSegment | null;
  if (!seg?.sceneStyle) return project;
  return segmentSceneStyleApplyToProject(seg.sceneStyle, project);
}

export function projectSetSceneStyleForSegmentID(
  project: RecorderProject,
  style: SegmentSceneStyle,
  id: string,
): RecorderProject {
  if (project.timeline.sourceSequence.kind !== 'edited') return project;
  const segments = project.timeline.sourceSequence.segments;
  const index = segments.findIndex((s) => s.id === id);
  if (index < 0) return project;
  const nextSegments = segments.slice();
  const prev = nextSegments[index];
  nextSegments[index] = cloneSegmentWith(prev, {
    sceneStyle: style,
    media: prev.media != null ? { ...prev.media, usesFrameStyle: true } : prev.media,
  });
  return {
    ...project,
    timeline: {
      ...project.timeline,
      sourceSequence: { kind: 'edited', segments: nextSegments },
    },
  };
}

export function projectSegmentSceneStyles(
  project: RecorderProject,
): Map<string, SegmentSceneStyle> {
  const result = new Map<string, SegmentSceneStyle>();
  if (project.timeline.sourceSequence.kind !== 'edited') return result;
  for (const segment of project.timeline.sourceSequence.segments) {
    if (segment.sceneStyle != null) {
      result.set(segment.id, segment.sceneStyle);
    }
  }
  return result;
}

/// All file-backed scene backgrounds, for loading and freezing export assets.
export function projectSceneBackgroundSources(project: RecorderProject): BackgroundSource[] {
  const result: BackgroundSource[] = [project.canvas.backgroundSource];
  if (project.timeline.sourceSequence.kind === 'edited') {
    for (const segment of project.timeline.sourceSequence.segments) {
      const bg = segment.sceneStyle?.canvas.backgroundSource;
      if (bg && !result.some((existing) => backgroundSourceEquals(existing, bg))) {
        result.push(bg);
      }
    }
  }
  return result;
}

export const ScreenCardAppearance = Object.freeze({
  make: makeScreenCardAppearance,
  fromCanvas: screenCardAppearanceFromCanvas,
  applyToCanvas: screenCardAppearanceApplyToCanvas,
  fromJSON: screenCardAppearanceFromJSON,
  resolvedCrop: projectResolvedCrop,
  segmentCrops: projectSegmentCrops,
  screenCanvasForTarget: projectScreenCanvasForTarget,
  screenCanvasAtOutputTime: projectScreenCanvasAtOutputTime,
  settledCameraAtOutputTime: projectSettledCameraAtOutputTime,
  settlingSegmentAppearance: projectSettlingSegmentAppearance,
  preserveLegacyScreenAppearances: projectPreserveLegacyScreenAppearances,
  setScreenAppearance: projectSetScreenAppearance,
});
