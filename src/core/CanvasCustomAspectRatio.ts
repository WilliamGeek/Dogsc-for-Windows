// Port of: F:\dogsc\Sources\RecorderCore\CanvasCustomAspectRatio.swift
import { clamp } from './swift.ts';
import type { CanvasStyle } from './ProjectModel.ts';

export interface CanvasCustomAspectRatio {
  width: number;
  height: number;
}

/** Swift `init(width:height:)` */
export function makeCanvasCustomAspectRatio(
  width: number = 16,
  height: number = 9,
): CanvasCustomAspectRatio {
  return { width, height };
}

/** Swift computed property `value`. */
export function canvasCustomAspectRatioValue(aspect: CanvasCustomAspectRatio): number {
  if (
    !(
      Number.isFinite(aspect.width) &&
      Number.isFinite(aspect.height) &&
      aspect.width > 0 &&
      aspect.height > 0
    )
  ) {
    return 16 / 9;
  }
  return clamp(aspect.width / aspect.height, 0.1, 10);
}

/**
 * Resolves the fixed aspect ratio number for a CanvasStyle.
 * Swift: `extension CanvasStyle { var resolvedFixedAspectRatio: Double? }`.
 */
export function canvasStyleResolvedFixedAspectRatio(style: CanvasStyle): number | null {
  switch (style.aspectRatio) {
    case '适应':
      return null;
    case '16:9':
      return 16 / 9;
    case '9:16':
      return 9 / 16;
    case '4:3':
      return 4 / 3;
    case '3:4':
      return 3 / 4;
    case '2.39:1':
      return 2.39;
    case '1:2.39':
      return 1 / 2.39;
    case '1:1':
      return 1;
    case '自定义':
      return canvasCustomAspectRatioValue(style.customAspectRatio);
    default:
      return null;
  }
}
