// Port of: F:\dogsc\Sources\RecorderCore\CameraContentFill.swift
import { clamp, max, min } from './swift.ts';
import {
  type CompositionRect,
  type CompositionPoint,
} from './CompositionScene.ts';
import type { NormalizedPoint } from './ZoomAnimation.ts';

export const CAMERA_CONTENT_FILL_EDGE_OVERSCAN_SCALE = 1.01;

export interface CameraContentFillLayout {
  readonly source: CompositionRect;
  readonly target: CompositionRect;
  /** The source-sized rectangle after authored aspect-fill and overscan. */
  readonly destination: CompositionRect;
  /** The authored portion of the source that remains visible through target. */
  readonly visibleSource: CompositionRect;
  readonly scale: number;
}

export function cameraContentFillLayoutMirrorAxisX(layout: CameraContentFillLayout): number {
  return layout.target.x + layout.target.width / 2;
}

export function cameraContentFillLayoutDestinationPoint(
  layout: CameraContentFillLayout,
  point: CompositionPoint,
  mirroredHorizontally: boolean,
): CompositionPoint {
  const sourceX = mirroredHorizontally
    ? layout.source.x + layout.source.width - (point.x - layout.source.x)
    : point.x;
  return {
    x: layout.destination.x + (sourceX - layout.source.x) * layout.scale,
    y: layout.destination.y + (point.y - layout.source.y) * layout.scale,
  };
}

/**
 * The single geometry contract for placing camera pixels inside an authored
 * camera shape. The shape itself is applied later as a mask; this contract
 * deliberately describes the rectangular content aperture behind that mask.
 * Swift: `CameraContentFill`.
 */
export const CameraContentFill = Object.freeze({
  edgeOverscanScale: CAMERA_CONTENT_FILL_EDGE_OVERSCAN_SCALE,

  layout(
    sourceWidth: number,
    sourceHeight: number,
    target: CompositionRect,
    focus: NormalizedPoint = { x: 0.5, y: 0.5 },
    contentScale: number = 1,
  ): CameraContentFillLayout | null {
    if (
      !Number.isFinite(sourceWidth) ||
      !Number.isFinite(sourceHeight) ||
      !Number.isFinite(target.x) ||
      !Number.isFinite(target.y) ||
      !Number.isFinite(target.width) ||
      !Number.isFinite(target.height) ||
      sourceWidth <= 0 ||
      sourceHeight <= 0 ||
      target.width <= 0 ||
      target.height <= 0
    ) {
      return null;
    }

    const rawZoom = Number.isFinite(contentScale) ? contentScale : 1;
    const sourceZoom = clamp(rawZoom, 1, 4);
    const scale =
      max(target.width / sourceWidth, target.height / sourceHeight) *
      CAMERA_CONTENT_FILL_EDGE_OVERSCAN_SCALE *
      sourceZoom;

    const destinationWidth = sourceWidth * scale;
    const destinationHeight = sourceHeight * scale;
    const visibleSourceWidth = target.width / scale;
    const visibleSourceHeight = target.height / scale;
    const focusX = clamp(Number.isFinite(focus.x) ? focus.x : 0.5, 0, 1);
    const focusY = clamp(Number.isFinite(focus.y) ? focus.y : 0.5, 0, 1);

    const visibleSource: CompositionRect = {
      x: (sourceWidth - visibleSourceWidth) * focusX,
      y: (sourceHeight - visibleSourceHeight) * focusY,
      width: visibleSourceWidth,
      height: visibleSourceHeight,
    };

    const destination: CompositionRect = {
      x: target.x - visibleSource.x * scale,
      y: target.y - visibleSource.y * scale,
      width: destinationWidth,
      height: destinationHeight,
    };

    return {
      source: { x: 0, y: 0, width: sourceWidth, height: sourceHeight },
      target,
      destination,
      visibleSource,
      scale,
    };
  },
  mirrorAxisX: cameraContentFillLayoutMirrorAxisX,
  destinationPoint: cameraContentFillLayoutDestinationPoint,
});
