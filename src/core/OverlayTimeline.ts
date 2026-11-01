// Port of: F:\dogsc\Sources\RecorderCore\OverlayTimeline.swift

import { min, max, newUUID } from './swift.ts';
import { type HexColor, HexColorWhite, hexColorFromJSON } from './HexColor.ts';
import { type ElementMotionCurve } from './ElementMotion.ts';
import { type NormalizedPoint, makeNormalizedPoint } from './ZoomAnimation.ts';

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

/// A package-owned still image placed above the composed recording.
export interface StickerClip {
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
    shadowOpacity: options.shadowOpacity ?? 0.28,
    shadowRadius: options.shadowRadius ?? 24,
    shadowOffsetX: options.shadowOffsetX ?? 0,
    shadowOffsetY: options.shadowOffsetY ?? 10,
    animation: options.animation ?? 'pop',
    animationCurve: options.animationCurve ?? 'swift',
    exitAnimation: options.exitAnimation ?? null,
    enterDuration: options.enterDuration ?? 0.7,
    exitDuration: options.exitDuration ?? 0.22,
    backdropBlur: options.backdropBlur ?? 20,
    backdropBlurIncludesCamera: options.backdropBlurIncludesCamera ?? false,
    hidesScreen: options.hidesScreen ?? false,
    hidesCamera: options.hidesCamera ?? false,
    layerIndex: options.layerIndex ?? 0,
  };
}

export function stickerClipFromJSON(json: any): StickerClip {
  return makeStickerClip({
    id: json.id,
    timing: makeOverlayTiming(Number(json.timing?.startTime ?? 0), Number(json.timing?.duration ?? 3)),
    relativePath: String(json.relativePath ?? ''),
    position: makeNormalizedPoint(Number(json.position?.x ?? 0.5), Number(json.position?.y ?? 0.5)),
    width: json.width != null ? Number(json.width) : undefined,
    rotationDegrees: json.rotationDegrees != null ? Number(json.rotationDegrees) : undefined,
    opacity: json.opacity != null ? Number(json.opacity) : undefined,
    cornerRadius: json.cornerRadius != null ? Number(json.cornerRadius) : undefined,
    borderWidth: json.borderWidth != null ? Number(json.borderWidth) : undefined,
    borderColor: json.borderColor != null ? hexColorFromJSON(json.borderColor) : undefined,
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
