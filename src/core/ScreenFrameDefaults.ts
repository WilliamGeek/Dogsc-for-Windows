// Port of: F:\dogsc\Sources\RecorderCore\ScreenFrameDefaults.swift
import { HexColorWhite, type HexColor } from './HexColor.ts';
import type { ScreenFrameStyle, CanvasStyle } from './ProjectModel.ts';

/**
 * Authored against the canonical 1080-point short edge. Selecting a different
 * style starts from its design, rather than carrying another frame's overrides.
 */
export interface ScreenFrameDefaults {
  readonly frameScale: number;
  readonly toolbarScale: number;
  readonly outerRadius: number;
  readonly contentRadius: number;
  readonly shadowStrength: number;
  readonly borderWidth: number;
  readonly borderColor: HexColor;
}

export function makeScreenFrameDefaults(
  outerRadius: number,
  contentRadius: number,
  options: Partial<ScreenFrameDefaults> = {},
): ScreenFrameDefaults {
  return Object.freeze({
    frameScale: options.frameScale ?? 1,
    toolbarScale: options.toolbarScale ?? 1,
    outerRadius,
    contentRadius,
    shadowStrength: options.shadowStrength ?? 0.24,
    borderWidth: options.borderWidth ?? 0,
    borderColor: options.borderColor ?? HexColorWhite,
  });
}

/**
 * Default visual measurements for a screen frame style.
 * Swift: `extension ScreenFrameStyle { var defaults: ScreenFrameDefaults }`.
 */
export function screenFrameStyleDefaults(style: ScreenFrameStyle): ScreenFrameDefaults {
  switch (style) {
    case 'none':
      return makeScreenFrameDefaults(24, 24, { shadowStrength: 0.28 });
    case 'windowLight':
      return makeScreenFrameDefaults(18, 0, { toolbarScale: 0.9, shadowStrength: 0.22 });
    case 'windowDark':
      return makeScreenFrameDefaults(18, 0, { toolbarScale: 0.9, shadowStrength: 0.3 });
    case 'browserLight':
      return makeScreenFrameDefaults(22, 0, { toolbarScale: 1.08, shadowStrength: 0.22 });
    case 'browserDark':
      return makeScreenFrameDefaults(22, 0, { toolbarScale: 1.08, shadowStrength: 0.3 });
    case 'devicePhone':
    case 'devicePhonePortrait':
    case 'devicePhoneLandscape':
      return makeScreenFrameDefaults(64, 40, { frameScale: 0.9, shadowStrength: 0.24 });
    case 'deviceTablet':
    case 'deviceTabletPortrait':
    case 'deviceTabletLandscape':
      return makeScreenFrameDefaults(48, 24, { shadowStrength: 0.24 });
  }
}

/**
 * Applies a screen frame preset's default dimensions and styling onto a canvas style.
 * Swift: `extension CanvasStyle { mutating func applyScreenFrameStyle(_ style: ScreenFrameStyle) }`.
 */
export function canvasStyleApplyingScreenFrameStyle(
  canvasStyle: CanvasStyle,
  style: ScreenFrameStyle,
): CanvasStyle {
  const preset = screenFrameStyleDefaults(style);
  return {
    ...canvasStyle,
    screenFrame: style,
    screenFrameScale: preset.frameScale,
    screenFrameToolbarScale: preset.toolbarScale,
    screenFrameOuterCornerRadius: preset.outerRadius,
    screenFrameContentCornerRadius: preset.contentRadius,
    cornerRadius: preset.contentRadius,
    borderWidth: preset.borderWidth,
    borderColor: preset.borderColor,
    shadowStrength: preset.shadowStrength,
  };
}
