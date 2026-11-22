// Port of: F:\dogsc-v0.2.0\Sources\RecorderCore\ScreenCardAppearance.swift (L1-86 core model)
// Note: RecorderProject multi-source extensions (L88-287) are deferred to T13.5 when
// RecorderProject.additionalSources and RecordingSegment.sceneStyle/crop/media land.

import {
  type HexColor,
  hexColorFromJSON,
  makeHexColor,
} from './HexColor.ts';
import {
  type CanvasStyle,
  type ScreenFrameStyle,
  makeCanvasStyle,
  screenFrameStyleFromJSON,
} from './ProjectModel.ts';

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

export const ScreenCardAppearance = Object.freeze({
  make: makeScreenCardAppearance,
  fromCanvas: screenCardAppearanceFromCanvas,
  applyToCanvas: screenCardAppearanceApplyToCanvas,
  fromJSON: screenCardAppearanceFromJSON,
});
