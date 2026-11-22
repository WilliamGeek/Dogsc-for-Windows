// Port of: F:\dogsc-v0.2.0\Sources\RecorderCore\SegmentSceneStyle.swift
// Note: RecorderProject scene-project helpers (L224-274) depend on RecorderProject.additionalSources
// and RecordingSegment.media/sceneStyle/crop, which land in T13.5.

import { clamp } from './swift.ts';
import { type HexColor, hexColorComponents, makeHexColor } from './HexColor.ts';
import {
  type BackgroundSource,
  type CameraStyle,
  type CanvasStyle,
  type CursorStyle,
  type MotionStyle,
  NormalizedCropFull,
  makeCameraStyle,
  makeCanvasStyle,
  makeCursorStyle,
  makeMotionStyle,
} from './ProjectModel.ts';
import { type RecorderProject } from './ProjectMediaModel.ts';
import {
  type ProjectTimeline,
  type RecordingSegment,
  type SourceSequence,
} from './ProjectTimeline.ts';
import { TimelineMediaPlan } from './TimelineMediaPlan.ts';
import { cameraBeautySettingsFromJSON } from './CameraBeauty.ts';

const PRIMARY_SOURCE_ID = '00000000-0000-0000-0000-000000000001';

// Mirrors RecordingAspectTransitions.duration without creating a circular dependency.
export const SEGMENT_APPEARANCE_TRANSITION_DURATION = 0.240;

export type SegmentSceneSegmentLike = RecordingSegment & {
  sourceID?: string | null;
  sceneStyle?: SegmentSceneStyle | null;
  media?: { usesFrameStyle?: boolean; [key: string]: unknown } | null;
};

export function backgroundSourceSceneResourceKey(source: BackgroundSource): string | null {
  switch (source.kind) {
    case 'projectImage':
      return 'project-image:' + source.relativePath;
    case 'systemImage':
      return 'system-image:' + source.absolutePath;
    case 'projectVideo':
      return 'project-video:' + source.relativePath;
    case 'systemVideo':
      return 'system-video:' + source.absolutePath;
    case 'pattern':
    case 'dynamicFlow':
      return null;
  }
}

export function backgroundSourceEquals(lhs: BackgroundSource, rhs: BackgroundSource): boolean {
  if (lhs.kind !== rhs.kind) return false;
  switch (lhs.kind) {
    case 'pattern':
      return lhs.preset === (rhs as Extract<BackgroundSource, { kind: 'pattern' }>).preset;
    case 'dynamicFlow':
      return lhs.preset === (rhs as Extract<BackgroundSource, { kind: 'dynamicFlow' }>).preset;
    case 'projectImage':
      return lhs.relativePath === (rhs as Extract<BackgroundSource, { kind: 'projectImage' }>).relativePath;
    case 'systemImage':
      return lhs.absolutePath === (rhs as Extract<BackgroundSource, { kind: 'systemImage' }>).absolutePath;
    case 'projectVideo':
      return lhs.relativePath === (rhs as Extract<BackgroundSource, { kind: 'projectVideo' }>).relativePath;
    case 'systemVideo':
      return lhs.absolutePath === (rhs as Extract<BackgroundSource, { kind: 'systemVideo' }>).absolutePath;
  }
}

/// Static appearance of one timeline occurrence. Recording media and timed
/// animation tracks remain in their original domains; the output ratio is global.
export interface SegmentSceneStyle {
  canvas: CanvasStyle;
  camera: CameraStyle;
  cursor: CursorStyle;
  motion: MotionStyle;
  presetID: string | null;
  presetName: string | null;
}

export function makeSegmentSceneStyle(
  options: Partial<SegmentSceneStyle> = {},
): SegmentSceneStyle {
  const baseCanvas = options.canvas ? makeCanvasStyle(options.canvas) : makeCanvasStyle();
  return {
    // Crop is owned by the recording source, never by one occurrence.
    // Freezing it here would detach the segment from later re-crops.
    canvas: { ...baseCanvas, crop: NormalizedCropFull },
    camera: options.camera ? makeCameraStyle(options.camera) : makeCameraStyle(),
    cursor: options.cursor ? makeCursorStyle(options.cursor) : makeCursorStyle(),
    motion: options.motion ? makeMotionStyle(options.motion) : makeMotionStyle(),
    presetID: options.presetID ?? null,
    presetName: options.presetName ?? null,
  };
}

export function makeSegmentSceneStyleFromProject(
  project: RecorderProject,
  presetID: string | null = null,
  presetName: string | null = null,
): SegmentSceneStyle {
  return {
    canvas: { ...project.canvas, crop: NormalizedCropFull },
    camera: { ...project.camera, beauty: { ...project.camera.beauty } },
    cursor: { ...project.cursorStyle },
    motion: { ...project.motion },
    presetID,
    presetName,
  };
}

export function segmentSceneStyleFromJSON(raw: unknown): SegmentSceneStyle {
  if (!raw || typeof raw !== 'object') {
    return makeSegmentSceneStyle();
  }
  const c = raw as Record<string, unknown>;
  const rawCanvas = c.canvas && typeof c.canvas === 'object' ? (c.canvas as Partial<CanvasStyle>) : {};
  const rawCamera = c.camera && typeof c.camera === 'object' ? (c.camera as Record<string, unknown>) : null;
  const rawCursor = c.cursor && typeof c.cursor === 'object' ? (c.cursor as Partial<CursorStyle>) : {};
  const rawMotion = c.motion && typeof c.motion === 'object' ? (c.motion as Partial<MotionStyle>) : {};
  const camera = rawCamera
    ? makeCameraStyle({
        ...(rawCamera as Partial<CameraStyle>),
        beauty: rawCamera.beauty !== undefined ? cameraBeautySettingsFromJSON(rawCamera.beauty) : undefined,
      })
    : makeCameraStyle();
  return {
    // Projects saved while styles still froze a crop fall back to the
    // source's crop, which is what the picture already showed.
    canvas: { ...makeCanvasStyle(rawCanvas), crop: NormalizedCropFull },
    camera,
    cursor: makeCursorStyle(rawCursor),
    motion: makeMotionStyle(rawMotion),
    presetID: typeof c.presetID === 'string' ? c.presetID : null,
    presetName: typeof c.presetName === 'string' ? c.presetName : null,
  };
}

export function segmentSceneStyleApplyToProject(
  style: SegmentSceneStyle,
  project: RecorderProject,
): RecorderProject {
  const aspectRatio = project.canvas.aspectRatio;
  const customAspectRatio = project.canvas.customAspectRatio;
  // The caller already resolved the crop for this occurrence's source.
  const crop = project.canvas.crop;
  return {
    ...project,
    canvas: {
      ...style.canvas,
      aspectRatio,
      customAspectRatio,
      crop,
    },
    camera: {
      ...style.camera,
      beauty: { ...style.camera.beauty },
    },
    cursorStyle: { ...style.cursor },
    motion: { ...style.motion },
  };
}

export interface RecordingSegmentBoundary {
  readonly segment: SegmentSceneSegmentLike | null;
  /// The occurrence immediately before `segment`, nil at the programme start.
  readonly previous: SegmentSceneSegmentLike | null;
  /// `segment`'s output start, i.e. the cut the settling is measured from.
  readonly start: number;
}

export const RecordingSegmentBoundaryNone: RecordingSegmentBoundary = Object.freeze({
  segment: null,
  previous: null,
  start: 0,
});

export function makeRecordingSegmentBoundary(
  segment: SegmentSceneSegmentLike | null,
  previous: SegmentSceneSegmentLike | null,
  start: number,
): RecordingSegmentBoundary {
  return { segment, previous, start };
}

export function recordingSegmentBoundaryInsertedPlayback(
  boundary: RecordingSegmentBoundary,
  time: number,
): { media: NonNullable<SegmentSceneSegmentLike['media']>; localTime: number; playbackRate: number } | null {
  const segment = boundary.segment;
  const media = segment?.media ?? null;
  if (!segment || !media) return null;
  const elapsed = clamp(time - boundary.start, 0, segment.outputDuration);
  return {
    media,
    localTime: segment.sourceStart + elapsed * segment.playbackRate,
    playbackRate: segment.playbackRate,
  };
}

export function projectTimelineRecordingSegmentBoundaryAtOutputTime(
  timeline: ProjectTimeline,
  time: number,
): RecordingSegmentBoundary {
  if (!Number.isFinite(time) || time < 0 || timeline.sourceSequence.kind !== 'edited') {
    return RecordingSegmentBoundaryNone;
  }
  const segments = timeline.sourceSequence.segments as readonly SegmentSceneSegmentLike[];
  let start = 0;
  let previous: SegmentSceneSegmentLike | null = null;
  for (const segment of segments) {
    const end = start + segment.outputDuration;
    if (
      (time > start || TimelineMediaPlan.isSameBoundary(time, start)) &&
      time < end &&
      !TimelineMediaPlan.isSameBoundary(time, end)
    ) {
      return makeRecordingSegmentBoundary(segment, previous, start);
    }
    previous = segment;
    start = end;
  }
  // The editor can park its playhead exactly at the programme end.
  const last = segments.length > 0 ? segments[segments.length - 1] : null;
  if (!last || !TimelineMediaPlan.isSameBoundary(time, start)) {
    return RecordingSegmentBoundaryNone;
  }
  const prevBeforeLast = segments.length > 1 ? segments[segments.length - 2] : null;
  return makeRecordingSegmentBoundary(last, prevBeforeLast, start - last.outputDuration);
}

export function projectTimelineRecordingSegmentAtOutputTime(
  timeline: ProjectTimeline,
  time: number,
): SegmentSceneSegmentLike | null {
  return projectTimelineRecordingSegmentBoundaryAtOutputTime(timeline, time).segment;
}

export function projectTimelineRecordingSegmentByID(
  timeline: ProjectTimeline,
  id: string,
): SegmentSceneSegmentLike | null {
  if (timeline.sourceSequence.kind !== 'edited') return null;
  const segments = timeline.sourceSequence.segments as readonly SegmentSceneSegmentLike[];
  return segments.find((s) => s.id === id) ?? null;
}

function valuesEqual(lhs: unknown, rhs: unknown): boolean {
  if (Object.is(lhs, rhs)) return true;
  if (lhs === null || rhs === null || typeof lhs !== typeof rhs) return false;
  if (typeof lhs !== 'object') return false;
  if (Array.isArray(lhs) || Array.isArray(rhs)) {
    if (!Array.isArray(lhs) || !Array.isArray(rhs) || lhs.length !== rhs.length) return false;
    for (let i = 0; i < lhs.length; i++) {
      if (!valuesEqual(lhs[i], rhs[i])) return false;
    }
    return true;
  }
  const a = lhs as Record<string, unknown>;
  const b = rhs as Record<string, unknown>;
  const keysA = Object.keys(a).filter((k) => a[k] !== undefined);
  const keysB = Object.keys(b).filter((k) => b[k] !== undefined);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!valuesEqual(a[key], b[key])) return false;
  }
  return true;
}

function segmentResolvedSourceID(segment: SegmentSceneSegmentLike): string {
  return segment.media == null ? (segment.sourceID ?? PRIMARY_SOURCE_ID) : PRIMARY_SOURCE_ID;
}

/// Static appearance settling across a cut. It borrows `RecordingAspectTransitions`'
/// window and curve on purpose: a card whose aspect and whose padding move on
/// two different clocks reads as two separate glitches.
export function segmentAppearanceTransitionProgress(time: number, boundary: number): number | null {
  const elapsed = time - boundary;
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= SEGMENT_APPEARANCE_TRANSITION_DURATION) {
    return null;
  }
  const x = elapsed / SEGMENT_APPEARANCE_TRANSITION_DURATION;
  return x * x * (3 - 2 * x);
}

/// Only cards settle into each other. A full-canvas insert (a title card,
/// black) is not a card: easing its padding would slide the next recording
/// in from the edges instead of cutting to it.
export function segmentAppearanceTransitionSettles(segment: SegmentSceneSegmentLike): boolean {
  if (segment.media == null) return true;
  return segment.media.usesFrameStyle === true;
}

/// Two clips drawing their appearance from the same places have nothing to
/// settle. Deciding that from the authored segments alone keeps the common
/// cut — same recording, no per-clip style — off the per-frame path that
/// would otherwise resolve a second canvas.
export function segmentAppearanceTransitionCanSettle(
  previous: SegmentSceneSegmentLike,
  current: SegmentSceneSegmentLike,
): boolean {
  if (!segmentAppearanceTransitionSettles(previous) || !segmentAppearanceTransitionSettles(current)) {
    return false;
  }
  return (
    !valuesEqual(previous.sceneStyle ?? null, current.sceneStyle ?? null) ||
    segmentResolvedSourceID(previous) !== segmentResolvedSourceID(current) ||
    !valuesEqual(previous.media ?? null, current.media ?? null)
  );
}

export const SegmentAppearanceTransition = Object.freeze({
  duration: SEGMENT_APPEARANCE_TRANSITION_DURATION,
  progress: segmentAppearanceTransitionProgress,
  settles: segmentAppearanceTransitionSettles,
  canSettle: segmentAppearanceTransitionCanSettle,
});

/// Per-channel sRGB mix. Border colours are authored as flat swatches, so
/// a linear ramp is what the eye expects between two of them.
export function hexColorMixing(from: HexColor, to: HexColor, progress: number): HexColor {
  if (from.rgb24 === to.rgb24) return to;
  const t = clamp(progress, 0, 1);
  const a = hexColorComponents(from);
  const b = hexColorComponents(to);
  const channel = (x: number, y: number): number =>
    clamp(Math.round((x + (y - x) * t) * 255), 0, 255);
  const r = channel(a.red, b.red);
  const g = channel(a.green, b.green);
  const bl = channel(a.blue, b.blue);
  return makeHexColor(((r << 16) | (g << 8) | bl) >>> 0);
}

/// Eases the measurable half of this occurrence's appearance out of the
/// previous one. Everything whose midpoint would be nonsense snaps: the
/// mockup kind (no silhouette exists between a MacBook and a phone), the
/// background asset, the frame's text, and the crop — the crop decides
/// which source pixels are sampled and already has its own aspect morph.
export function canvasStyleBlend(
  target: CanvasStyle,
  previous: CanvasStyle,
  progress: number,
): CanvasStyle {
  const t = clamp(progress, 0, 1);
  const mix = (a: number, b: number): number => a + (b - a) * t;
  const sameBg = backgroundSourceEquals(previous.backgroundSource, target.backgroundSource);
  const sameFrame = previous.screenFrame === target.screenFrame;
  return {
    ...target,
    padding: mix(previous.padding, target.padding),
    contentScale: mix(previous.contentScale, target.contentScale),
    contentPosition: {
      x: mix(previous.contentPosition.x, target.contentPosition.x),
      y: mix(previous.contentPosition.y, target.contentPosition.y),
    },
    cornerRadius: mix(previous.cornerRadius, target.cornerRadius),
    borderWidth: mix(previous.borderWidth, target.borderWidth),
    borderColor: hexColorMixing(previous.borderColor, target.borderColor, t),
    shadowStrength: mix(previous.shadowStrength, target.shadowStrength),
    insetOpacity: mix(previous.insetOpacity, target.insetOpacity),
    backgroundBlur: mix(previous.backgroundBlur, target.backgroundBlur),
    patternScale: sameBg ? mix(previous.patternScale, target.patternScale) : target.patternScale,
    patternOpacity: sameBg
      ? mix(previous.patternOpacity, target.patternOpacity)
      : target.patternOpacity,
    screenFrameScale: sameFrame
      ? mix(previous.screenFrameScale, target.screenFrameScale)
      : target.screenFrameScale,
    screenFrameToolbarScale: sameFrame
      ? mix(previous.screenFrameToolbarScale, target.screenFrameToolbarScale)
      : target.screenFrameToolbarScale,
    screenFrameOuterCornerRadius:
      sameFrame &&
      previous.screenFrameOuterCornerRadius !== null &&
      target.screenFrameOuterCornerRadius !== null
        ? mix(previous.screenFrameOuterCornerRadius, target.screenFrameOuterCornerRadius)
        : target.screenFrameOuterCornerRadius,
    screenFrameContentCornerRadius:
      sameFrame &&
      previous.screenFrameContentCornerRadius !== null &&
      target.screenFrameContentCornerRadius !== null
        ? mix(previous.screenFrameContentCornerRadius, target.screenFrameContentCornerRadius)
        : target.screenFrameContentCornerRadius,
  };
}

/// The bubble settles across a cut like the card does: jumping from one
/// corner to the other, or resizing in one frame, reads as a dropped
/// frame. Shape geometry is interpolated separately as a continuous
/// CameraMotionSample; the authored shape enum remains the target's.
export function cameraStyleBlend(
  target: CameraStyle,
  previous: CameraStyle,
  progress: number,
): CameraStyle {
  if (previous.isHidden !== target.isHidden) {
    return {
      ...target,
      beauty: { ...target.beauty },
    };
  }
  const t = clamp(progress, 0, 1);
  const mix = (a: number, b: number): number => a + (b - a) * t;
  return {
    ...target,
    position: {
      x: mix(previous.position.x, target.position.x),
      y: mix(previous.position.y, target.position.y),
    },
    size: mix(previous.size, target.size),
    roundness: mix(previous.roundness, target.roundness),
    borderWidth: mix(previous.borderWidth, target.borderWidth),
    shadowStrength: mix(previous.shadowStrength, target.shadowStrength),
    scaleDuringZoom: mix(previous.scaleDuringZoom, target.scaleDuringZoom),
    contentScale: mix(previous.contentScale, target.contentScale),
    beauty: {
      smoothing: mix(previous.beauty.smoothing, target.beauty.smoothing),
      whitening: mix(previous.beauty.whitening, target.beauty.whitening),
    },
    contentPosition: {
      x: mix(previous.contentPosition.x, target.contentPosition.x),
      y: mix(previous.contentPosition.y, target.contentPosition.y),
    },
  };
}

export function sourceSequenceWithoutSceneStyles(sequence: SourceSequence): SourceSequence {
  if (sequence.kind !== 'edited') return sequence;
  return {
    kind: 'edited',
    segments: (sequence.segments as readonly SegmentSceneSegmentLike[]).map((seg) => {
      const copy = { ...seg };
      delete copy.sceneStyle;
      return copy;
    }),
  };
}

export const SegmentSceneStyle = Object.freeze({
  make: makeSegmentSceneStyle,
  fromProject: makeSegmentSceneStyleFromProject,
  fromJSON: segmentSceneStyleFromJSON,
  applyToProject: segmentSceneStyleApplyToProject,
});
