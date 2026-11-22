// Port of: F:\dogsc-v0.2.0\Sources\RecorderCore\OverlayTimeline.swift

import { clamp, min, max, newUUID, toInt } from './swift.ts';
import {
  type HexColor,
  HexColorWhite,
  hexColorFromJSON,
  makeHexColor,
} from './HexColor.ts';
import { type ElementMotionCurve } from './ElementMotion.ts';
import {
  type NormalizedPoint,
  makeNormalizedPoint,
} from './ZoomAnimation.ts';
import {
  type ScreenCardAppearance,
  screenCardAppearanceFromJSON,
} from './ScreenCardAppearance.ts';
import {
  type SegmentSceneStyle,
  segmentSceneStyleFromJSON,
} from './SegmentSceneStyle.ts';

function parseHexColorFlexible(value: unknown): HexColor {
  if (typeof value === 'string') return hexColorFromJSON(value);
  if (typeof value === 'object' && value !== null && typeof (value as { rgb24?: unknown }).rgb24 === 'number') {
    return makeHexColor((value as { rgb24: number }).rgb24);
  }
  return hexColorFromJSON(value);
}

// MARK: - NormalizedOverlayRect

/// A normalized, top-left-origin rectangle authored directly on the preview.
export interface NormalizedOverlayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function makeNormalizedOverlayRect(
  x: number,
  y: number,
  width: number,
  height: number
): NormalizedOverlayRect {
  return { x, y, width, height };
}

export const NormalizedOverlayRectCentered: NormalizedOverlayRect = Object.freeze(
  makeNormalizedOverlayRect(0.35, 0.39, 0.30, 0.22)
);

export function normalizedOverlayRectClamped(rect: NormalizedOverlayRect): NormalizedOverlayRect {
  const safeWidth = min(max(Number.isFinite(rect.width) ? rect.width : 0.30, 0.01), 1);
  const safeHeight = min(max(Number.isFinite(rect.height) ? rect.height : 0.22, 0.01), 1);
  return {
    x: min(max(Number.isFinite(rect.x) ? rect.x : 0.35, 0), 1 - safeWidth),
    y: min(max(Number.isFinite(rect.y) ? rect.y : 0.39, 0), 1 - safeHeight),
    width: safeWidth,
    height: safeHeight,
  };
}

export const NormalizedOverlayRect = Object.freeze({
  centered: NormalizedOverlayRectCentered,
  make: makeNormalizedOverlayRect,
  clamped: normalizedOverlayRectClamped,
});

// MARK: - OverlayTiming

export interface OverlayTiming {
  startTime: number;
  duration: number;
  readonly endTime: number;
}

export function makeOverlayTiming(
  startTimeOrOptions: number | { startTime: number; duration?: number },
  duration: number = 3
): OverlayTiming {
  if (typeof startTimeOrOptions === 'object') {
    const s = startTimeOrOptions.startTime;
    const d = startTimeOrOptions.duration ?? 3;
    return {
      startTime: s,
      duration: d,
      get endTime(): number {
        return this.startTime + this.duration;
      },
    };
  }
  return {
    startTime: startTimeOrOptions,
    duration,
    get endTime(): number {
      return this.startTime + this.duration;
    },
  };
}

export function overlayTimingEndTime(timing: OverlayTiming): number {
  return timing.startTime + timing.duration;
}

export function overlayTimingContains(timing: OverlayTiming, time: number): boolean {
  return time >= timing.startTime && time < timing.startTime + timing.duration;
}

export const OverlayTiming = Object.freeze({
  make: makeOverlayTiming,
  endTime: overlayTimingEndTime,
  contains: overlayTimingContains,
});

// MARK: - MosaicEffectStyle

export type MosaicEffectStyle = 'blur' | 'spotlight';

export const MosaicEffectStyleAllCases: readonly MosaicEffectStyle[] = Object.freeze([
  'blur',
  'spotlight',
]);

export function mosaicEffectStyleFromJSON(value: unknown): MosaicEffectStyle {
  return value === 'spotlight' ? 'spotlight' : 'blur';
}

// MARK: - MosaicTransitionStyle

export type MosaicTransitionStyle = 'none' | 'linear' | 'smooth';

export const MosaicTransitionStyleAllCases: readonly MosaicTransitionStyle[] = Object.freeze([
  'none',
  'linear',
  'smooth',
]);

// MARK: - MosaicClip

/// A timed redaction attached to the recorded screen's normalized source area.
export interface MosaicClip {
  id: string;
  timing: OverlayTiming;
  sourceRect: NormalizedOverlayRect;
  /// Normalized against the shorter side of the redaction rectangle.
  cornerRadius: number;
  style: MosaicEffectStyle;
  /// Product-facing 0...1 strength; renderers lower it to pixels.
  intensity: number;
  /// Black overlay outside a spotlight focus. Ignored by ordinary blur.
  spotlightDimming: number;
  transitionStyle: MosaicTransitionStyle;
  transitionInDuration: number;
  transitionOutDuration: number;
}

export function makeMosaicClip(options: {
  id?: string;
  timing: OverlayTiming;
  sourceRect?: NormalizedOverlayRect;
  cornerRadius?: number;
  style?: MosaicEffectStyle;
  intensity?: number;
  spotlightDimming?: number;
  transitionStyle?: MosaicTransitionStyle;
  transitionInDuration?: number;
  transitionOutDuration?: number;
}): MosaicClip {
  return {
    id: options.id ?? newUUID(),
    timing: options.timing,
    sourceRect: options.sourceRect ?? NormalizedOverlayRectCentered,
    cornerRadius: options.cornerRadius ?? 0.08,
    style: options.style ?? 'blur',
    intensity: options.intensity ?? 0.55,
    spotlightDimming: options.spotlightDimming ?? 0.22,
    transitionStyle: options.transitionStyle ?? 'none',
    transitionInDuration: options.transitionInDuration ?? 0.30,
    transitionOutDuration: options.transitionOutDuration ?? 0.30,
  };
}

export function mosaicClipFromJSON(json: any): MosaicClip {
  const style = mosaicEffectStyleFromJSON(json.style);
  return {
    id: json.id ?? newUUID(),
    timing: makeOverlayTiming(Number(json.timing?.startTime ?? 0), Number(json.timing?.duration ?? 3)),
    sourceRect: makeNormalizedOverlayRect(
      Number(json.sourceRect?.x ?? 0.35),
      Number(json.sourceRect?.y ?? 0.39),
      Number(json.sourceRect?.width ?? 0.30),
      Number(json.sourceRect?.height ?? 0.22)
    ),
    cornerRadius: Number(json.cornerRadius ?? 0.08),
    style,
    intensity: Number(json.intensity ?? 0.55),
    spotlightDimming: json.spotlightDimming != null ? Number(json.spotlightDimming) : 0.22,
    transitionStyle:
      json.transitionStyle != null
        ? (json.transitionStyle as MosaicTransitionStyle)
        : style === 'spotlight'
        ? 'smooth'
        : 'none',
    transitionInDuration: json.transitionInDuration != null ? Number(json.transitionInDuration) : 0.30,
    transitionOutDuration: json.transitionOutDuration != null ? Number(json.transitionOutDuration) : 0.30,
  };
}

// MARK: - StickerAnimationPreset

export type StickerAnimationPreset =
  | 'none'
  | 'fade'
  | 'pop'
  | 'slideLeft'
  | 'slideRight'
  | 'slideUp'
  | 'slideDown'
  | 'slideTopLeft'
  | 'slideTopRight'
  | 'slideBottomLeft'
  | 'slideBottomRight';

export const StickerAnimationPresetAllCases: readonly StickerAnimationPreset[] = Object.freeze([
  'none',
  'fade',
  'pop',
  'slideLeft',
  'slideRight',
  'slideUp',
  'slideDown',
  'slideTopLeft',
  'slideTopRight',
  'slideBottomLeft',
  'slideBottomRight',
]);

export function stickerAnimationPresetAutomaticExit(
  preset: StickerAnimationPreset
): StickerAnimationPreset {
  switch (preset) {
    case 'slideLeft':
      return 'slideRight';
    case 'slideRight':
      return 'slideLeft';
    case 'slideUp':
      return 'slideDown';
    case 'slideDown':
      return 'slideUp';
    case 'slideTopLeft':
      return 'slideBottomRight';
    case 'slideTopRight':
      return 'slideBottomLeft';
    case 'slideBottomLeft':
      return 'slideTopRight';
    case 'slideBottomRight':
      return 'slideTopLeft';
    case 'none':
    case 'fade':
    case 'pop':
      return preset;
  }
}

export const StickerAnimationPreset = Object.freeze({
  automaticExit: stickerAnimationPresetAutomaticExit,
});

// MARK: - StickerClip

// MARK: - MainTrackVisualStyle & VisualClipSound (shared with PostProductionModel & VisualTrackTransfer)

/// Presentation saved while an authored visual changes track roles.
export interface MainTrackVisualStyle {
  usesFrameStyle: boolean;
  screenAppearance: ScreenCardAppearance | null;
  sceneStyle: SegmentSceneStyle | null;
}

export function makeMainTrackVisualStyle(options: {
  usesFrameStyle?: boolean;
  screenAppearance?: ScreenCardAppearance | null;
  sceneStyle?: SegmentSceneStyle | null;
} = {}): MainTrackVisualStyle {
  return {
    usesFrameStyle: options.usesFrameStyle ?? false,
    screenAppearance: options.screenAppearance ? { ...options.screenAppearance } : null,
    sceneStyle: options.sceneStyle ? { ...options.sceneStyle } : null,
  };
}

export function mainTrackVisualStyleFromJSON(raw: unknown): MainTrackVisualStyle | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  return {
    usesFrameStyle: typeof c.usesFrameStyle === 'boolean' ? c.usesFrameStyle : false,
    screenAppearance:
      c.screenAppearance !== undefined && c.screenAppearance !== null
        ? screenCardAppearanceFromJSON(c.screenAppearance)
        : null,
    sceneStyle:
      c.sceneStyle !== undefined && c.sceneStyle !== null
        ? segmentSceneStyleFromJSON(c.sceneStyle)
        : null,
  };
}

export interface VisualClipSound {
  path: string;
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

export function makeVisualClipSound(options: {
  path: string;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
}): VisualClipSound {
  return {
    path: options.path,
    volume: options.volume ?? 1,
    fadeIn: options.fadeIn ?? 0,
    fadeOut: options.fadeOut ?? 0,
  };
}

export function visualClipSoundFromJSON(raw: unknown): VisualClipSound | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.path !== 'string') return null;
  return makeVisualClipSound({
    path: c.path,
    volume: typeof c.volume === 'number' ? c.volume : 1,
    fadeIn: typeof c.fadeIn === 'number' ? c.fadeIn : 0,
    fadeOut: typeof c.fadeOut === 'number' ? c.fadeOut : 0,
  });
}

// MARK: - StickerClip

/// A package-owned still image placed above the composed recording.
export interface StickerClip {
  mainTrackStyle: MainTrackVisualStyle | null;
  sourceStart: number;
  playbackRate: number;
  id: string;
  timing: OverlayTiming;
  relativePath: string;
  position: NormalizedPoint;
  /// Width relative to the output canvas. Height follows the image aspect.
  width: number;
  rotationDegrees: number;
  opacity: number;
  cornerRadius: number;
  borderWidth: number;
  borderColor: HexColor;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  animation: StickerAnimationPreset;
  /// Shared non-linear timing used by both entry and exit. The visual path
  /// remains independently selectable through `animation`/`exitAnimation`.
  animationCurve: ElementMotionCurve;
  /// `null` follows the complementary direction of `animation`.
  exitAnimation: StickerAnimationPreset | null;
  enterDuration: number;
  exitDuration: number;
  backdropBlur: number;
  /// Whether the sticker's backdrop blur also softens the independent
  /// camera layer. The recorded screen/background remain the default target.
  backdropBlurIncludesCamera: boolean;
  /// Temporarily reveal only the authored canvas background behind this
  /// sticker. The transition follows the sticker's own entrance/exit curve.
  hidesScreen: boolean;
  /// Temporarily suppress the camera while this sticker is visible.
  hidesCamera: boolean;
  layerIndex: number;
}

export function makeStickerClip(options: {
  mainTrackStyle?: MainTrackVisualStyle | null;
  sourceStart?: number;
  playbackRate?: number;
  id?: string;
  timing: OverlayTiming;
  relativePath: string;
  position?: NormalizedPoint;
  width?: number;
  rotationDegrees?: number;
  opacity?: number;
  cornerRadius?: number;
  borderWidth?: number;
  borderColor?: HexColor;
  shadowOpacity?: number;
  shadowRadius?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  animation?: StickerAnimationPreset;
  animationCurve?: ElementMotionCurve;
  exitAnimation?: StickerAnimationPreset | null;
  enterDuration?: number;
  exitDuration?: number;
  backdropBlur?: number;
  backdropBlurIncludesCamera?: boolean;
  hidesScreen?: boolean;
  hidesCamera?: boolean;
  layerIndex?: number;
}): StickerClip {
  return {
    mainTrackStyle: options.mainTrackStyle ?? null,
    sourceStart: options.sourceStart ?? 0,
    playbackRate: options.playbackRate ?? 1,
    id: options.id ?? newUUID(),
    timing: options.timing,
    relativePath: options.relativePath,
    position: options.position ?? makeNormalizedPoint(0.5, 0.5),
    width: options.width ?? 0.38,
    rotationDegrees: options.rotationDegrees ?? 0,
    opacity: options.opacity ?? 1,
    cornerRadius: options.cornerRadius ?? 18,
    borderWidth: options.borderWidth ?? 0,
    borderColor: options.borderColor ?? HexColorWhite,
    shadowOpacity: options.shadowOpacity ?? 0.24,
    shadowRadius: options.shadowRadius ?? 30,
    shadowOffsetX: options.shadowOffsetX ?? 0,
    shadowOffsetY: options.shadowOffsetY ?? 12,
    animation: options.animation ?? 'pop',
    animationCurve: options.animationCurve ?? 'swift',
    exitAnimation: options.exitAnimation ?? null,
    enterDuration: options.enterDuration ?? 0.45,
    exitDuration: options.exitDuration ?? 0.3,
    backdropBlur: options.backdropBlur ?? 20,
    backdropBlurIncludesCamera: options.backdropBlurIncludesCamera ?? false,
    hidesScreen: options.hidesScreen ?? false,
    hidesCamera: options.hidesCamera ?? false,
    layerIndex: options.layerIndex ?? 0,
  };
}

export function stickerClipFromJSON(json: any): StickerClip {
  return makeStickerClip({
    mainTrackStyle: mainTrackVisualStyleFromJSON(json.mainTrackStyle),
    sourceStart: json.sourceStart != null ? Number(json.sourceStart) : undefined,
    playbackRate: json.playbackRate != null ? Number(json.playbackRate) : undefined,
    id: json.id,
    timing: makeOverlayTiming(Number(json.timing?.startTime ?? 0), Number(json.timing?.duration ?? 3)),
    relativePath: String(json.relativePath ?? ''),
    position: makeNormalizedPoint(Number(json.position?.x ?? 0.5), Number(json.position?.y ?? 0.5)),
    width: json.width != null ? Number(json.width) : undefined,
    rotationDegrees: json.rotationDegrees != null ? Number(json.rotationDegrees) : undefined,
    opacity: json.opacity != null ? Number(json.opacity) : undefined,
    cornerRadius: json.cornerRadius != null ? Number(json.cornerRadius) : undefined,
    borderWidth: json.borderWidth != null ? Number(json.borderWidth) : undefined,
    borderColor: json.borderColor != null ? parseHexColorFlexible(json.borderColor) : undefined,
    shadowOpacity: json.shadowOpacity != null ? Number(json.shadowOpacity) : undefined,
    shadowRadius: json.shadowRadius != null ? Number(json.shadowRadius) : undefined,
    shadowOffsetX: json.shadowOffsetX != null ? Number(json.shadowOffsetX) : undefined,
    shadowOffsetY: json.shadowOffsetY != null ? Number(json.shadowOffsetY) : undefined,
    animation: json.animation as StickerAnimationPreset,
    animationCurve: (json.animationCurve as ElementMotionCurve) ?? 'swift',
    exitAnimation: (json.exitAnimation as StickerAnimationPreset) ?? null,
    enterDuration: json.enterDuration != null ? Number(json.enterDuration) : undefined,
    exitDuration: json.exitDuration != null ? Number(json.exitDuration) : undefined,
    backdropBlur: json.backdropBlur != null ? Number(json.backdropBlur) : undefined,
    backdropBlurIncludesCamera: Boolean(json.backdropBlurIncludesCamera ?? false),
    hidesScreen: Boolean(json.hidesScreen ?? false),
    hidesCamera: Boolean(json.hidesCamera ?? false),
    layerIndex: json.layerIndex != null ? Number(json.layerIndex) : undefined,
  });
}

// MARK: - AnimationPropertyValue, MotionElementEdit, AnimationClip

/// A value for one property a Rive file exposes through its view model.
/// Unknown/unset properties keep the file's own default.
export type AnimationPropertyValue =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'color'; value: HexColor };

export function animationPropertyValueFromJSON(raw: unknown): AnimationPropertyValue {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Expected AnimationPropertyValue object');
  }
  const c = raw as Record<string, any>;
  if (c.kind === 'string' && typeof c.value === 'string') {
    return { kind: 'string', value: c.value };
  }
  if (c.kind === 'number' && typeof c.value === 'number') {
    return { kind: 'number', value: c.value };
  }
  if (c.kind === 'boolean' && typeof c.value === 'boolean') {
    return { kind: 'boolean', value: c.value };
  }
  if (c.kind === 'color' && c.value !== undefined) {
    return { kind: 'color', value: parseHexColorFlexible(c.value) };
  }
  // Swift synthesized Codable format: { string: { _0: "..." } } etc.
  if (c.string && typeof c.string._0 === 'string') {
    return { kind: 'string', value: c.string._0 };
  }
  if (c.number && typeof c.number._0 === 'number') {
    return { kind: 'number', value: c.number._0 };
  }
  if (c.boolean && typeof c.boolean._0 === 'boolean') {
    return { kind: 'boolean', value: c.boolean._0 };
  }
  if (c.color && c.color._0 !== undefined) {
    return { kind: 'color', value: parseHexColorFlexible(c.color._0) };
  }
  throw new Error('Unsupported AnimationPropertyValue JSON');
}

export function animationPropertiesFromJSON(
  raw: unknown,
): Record<string, AnimationPropertyValue> {
  if (!raw || typeof raw !== 'object') return {};
  const result: Record<string, AnimationPropertyValue> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    result[k] = animationPropertyValueFromJSON(v);
  }
  return result;
}

/// EDT-073: the user's hands-on change to one element of an HTML motion —
/// moved (in the page's CSS px), hidden, or retexted. Kept on the clip, so
/// the design file and other uses of it are untouched.
export interface MotionElementEdit {
  dx: number;
  dy: number;
  hidden: boolean;
  text: string | null;
  /// EDT-077: 1 = the page's own size.
  scale: number;
  /// Text colour, as #RRGGBB.
  color: string | null;
  /// nil preserves the font authored by the motion page.
  fontFamily: string | null;
  fontWeight: number | null;
  /// Fill (background colour) of a box or shape, as #RRGGBB.
  fill: string | null;
  /// A picture the user put in place of an image element (absolute path).
  image: string | null;
  /// EDT-079: corner radius in page pixels; nil keeps the page's own.
  radius: number | null;
  /// Outline width in page pixels and its colour.
  strokeWidth: number | null;
  strokeColor: string | null;
  /// Degrees, clockwise.
  rotation: number;
  /// 0–1; 1 = the page's own.
  opacity: number;
}

export function makeMotionElementEdit(
  options: Partial<MotionElementEdit> = {},
): MotionElementEdit {
  const fontWeight =
    options.fontWeight !== undefined && options.fontWeight !== null
      ? clamp(toInt(options.fontWeight), 100, 900)
      : null;
  return {
    dx: options.dx ?? 0,
    dy: options.dy ?? 0,
    hidden: options.hidden ?? false,
    text: options.text ?? null,
    scale: options.scale ?? 1,
    color: options.color ?? null,
    fontFamily: options.fontFamily ?? null,
    fontWeight,
    fill: options.fill ?? null,
    image: options.image ?? null,
    radius: options.radius ?? null,
    strokeWidth: options.strokeWidth ?? null,
    strokeColor: options.strokeColor ?? null,
    rotation: options.rotation ?? 0,
    opacity: options.opacity ?? 1,
  };
}

export function motionElementEditIsEmpty(edit: MotionElementEdit): boolean {
  return (
    edit.dx === 0 &&
    edit.dy === 0 &&
    !edit.hidden &&
    edit.text === null &&
    Math.abs(edit.scale - 1) < 0.0001 &&
    edit.color === null &&
    edit.fill === null &&
    edit.image === null &&
    edit.fontFamily === null &&
    edit.fontWeight === null &&
    edit.radius === null &&
    edit.strokeWidth === null &&
    edit.strokeColor === null &&
    Math.abs(edit.rotation) < 0.0001 &&
    Math.abs(edit.opacity - 1) < 0.0001
  );
}

export function motionElementEditFromJSON(raw: unknown): MotionElementEdit {
  if (!raw || typeof raw !== 'object') return makeMotionElementEdit();
  const c = raw as Record<string, unknown>;
  return makeMotionElementEdit({
    dx: typeof c.dx === 'number' ? c.dx : 0,
    dy: typeof c.dy === 'number' ? c.dy : 0,
    hidden: typeof c.hidden === 'boolean' ? c.hidden : false,
    text: typeof c.text === 'string' ? c.text : null,
    scale: typeof c.scale === 'number' ? c.scale : 1,
    color: typeof c.color === 'string' ? c.color : null,
    fill: typeof c.fill === 'string' ? c.fill : null,
    image: typeof c.image === 'string' ? c.image : null,
    radius: typeof c.radius === 'number' ? c.radius : null,
    strokeWidth: typeof c.strokeWidth === 'number' ? c.strokeWidth : null,
    strokeColor: typeof c.strokeColor === 'string' ? c.strokeColor : null,
    rotation: typeof c.rotation === 'number' ? c.rotation : 0,
    opacity: typeof c.opacity === 'number' ? c.opacity : 1,
    fontFamily: typeof c.fontFamily === 'string' ? c.fontFamily : null,
    fontWeight: typeof c.fontWeight === 'number' ? c.fontWeight : null,
  });
}

export function motionElementEditsFromJSON(raw: unknown): Record<string, MotionElementEdit> {
  if (!raw || typeof raw !== 'object') return {};
  const result: Record<string, MotionElementEdit> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    result[k] = motionElementEditFromJSON(v);
  }
  return result;
}

/// An HTML motion graphic placed over the picture for a span of time. The
/// file is referenced where it lives (AI-generated files live in the project);
/// its playback time is the clip-local time, stepped at the project frame
/// rate so preview and export see identical frames.
export interface AnimationClip {
  mainTrackStyle: MainTrackVisualStyle | null;
  playbackRate: number;
  soundtrack: VisualClipSound | null;
  id: string;
  timing: OverlayTiming;
  /// Absolute path, or a path relative to the project package.
  sourcePath: string;
  artboard: string | null;
  stateMachine: string | null;
  position: NormalizedPoint;
  /// Width relative to the output canvas. Height follows the artboard aspect.
  width: number;
  opacity: number;
  properties: Record<string, AnimationPropertyValue>;
  layerIndex: number;
  /// Where in the animation this clip starts; a split's second half
  /// continues instead of restarting.
  timeOffset: number;
  /// Per-element edits by element key (EDT-073).
  elementEdits: Record<string, MotionElementEdit>;
}

export function makeAnimationClip(options: {
  id?: string;
  timing: OverlayTiming;
  sourcePath: string;
  artboard?: string | null;
  stateMachine?: string | null;
  position?: NormalizedPoint;
  width?: number;
  opacity?: number;
  properties?: Record<string, AnimationPropertyValue>;
  layerIndex?: number;
  timeOffset?: number;
  elementEdits?: Record<string, MotionElementEdit>;
  mainTrackStyle?: MainTrackVisualStyle | null;
  playbackRate?: number;
  soundtrack?: VisualClipSound | null;
}): AnimationClip {
  return {
    id: options.id ?? newUUID(),
    timing: options.timing,
    sourcePath: options.sourcePath,
    artboard: options.artboard ?? null,
    stateMachine: options.stateMachine ?? null,
    position: options.position ?? makeNormalizedPoint(0.5, 0.5),
    width: options.width ?? 0.5,
    opacity: options.opacity ?? 1,
    properties: options.properties ? { ...options.properties } : {},
    layerIndex: options.layerIndex ?? 0,
    timeOffset: options.timeOffset ?? 0,
    elementEdits: options.elementEdits ? { ...options.elementEdits } : {},
    mainTrackStyle: options.mainTrackStyle ?? null,
    playbackRate: options.playbackRate ?? 1,
    soundtrack: options.soundtrack ?? null,
  };
}

export function animationClipFromJSON(raw: unknown): AnimationClip {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Expected AnimationClip JSON object');
  }
  const c = raw as Record<string, any>;
  if (typeof c.id !== 'string' || typeof c.sourcePath !== 'string') {
    throw new Error('AnimationClip requires id and sourcePath');
  }
  if (!c.timing || typeof c.timing.startTime !== 'number') {
    throw new Error('AnimationClip requires timing');
  }
  if (!c.position || typeof c.position.x !== 'number' || typeof c.position.y !== 'number') {
    throw new Error('AnimationClip requires position');
  }
  if (typeof c.width !== 'number' || typeof c.opacity !== 'number') {
    throw new Error('AnimationClip requires width and opacity');
  }
  return makeAnimationClip({
    id: c.id,
    timing: makeOverlayTiming(
      c.timing.startTime,
      typeof c.timing.duration === 'number' ? c.timing.duration : 3,
    ),
    sourcePath: c.sourcePath,
    artboard: typeof c.artboard === 'string' ? c.artboard : null,
    stateMachine: typeof c.stateMachine === 'string' ? c.stateMachine : null,
    position: makeNormalizedPoint(c.position.x, c.position.y),
    width: c.width,
    opacity: c.opacity,
    properties: animationPropertiesFromJSON(c.properties),
    layerIndex: typeof c.layerIndex === 'number' ? c.layerIndex : 0,
    timeOffset: typeof c.timeOffset === 'number' ? c.timeOffset : 0,
    elementEdits: motionElementEditsFromJSON(c.elementEdits),
    mainTrackStyle: mainTrackVisualStyleFromJSON(c.mainTrackStyle),
    playbackRate: typeof c.playbackRate === 'number' ? c.playbackRate : 1,
    soundtrack: visualClipSoundFromJSON(c.soundtrack),
  });
}
