// Port of: F:\dogsc\Sources\RecorderCore\CompositionScene.swift

import { min, max } from './swift.ts';
import { ScreenProjection, type ProjectedScreenQuad } from './ScreenProjection.ts';
import {
  type NormalizedPoint,
  type ZoomSample,
  ZoomViewportTransform,
  type ZoomAnimationClip,
  type ZoomAnimationTrack,
  ZoomInterpolator,
} from './ZoomAnimation.ts';
import {
  type CanvasStyle,
  type CameraStyle,
  type MotionStyle,
  type ScreenFrameStyle,
  normalizedCropClamped,
} from './ProjectModel.ts';
import {
  ScreenMotionTrack,
  makeScreenMotionState,
  makeScreenAnchorViewport,
  type ScreenMotionClip,
} from './ScreenMotion.ts';
import {
  CameraMotionTrack,
  makeCameraMotionStateFromBase,
  type CameraMotionClip,
  type CameraMotionSample,
} from './CameraMotion.ts';

// MARK: - CompositionRect & CompositionPoint

export interface CompositionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function makeCompositionRect(x: number, y: number, width: number, height: number): CompositionRect {
  return { x, y, width, height };
}

export function compositionRectMidX(rect: CompositionRect): number {
  return rect.x + rect.width / 2;
}

export function compositionRectMidY(rect: CompositionRect): number {
  return rect.y + rect.height / 2;
}

export interface CompositionPoint {
  x: number;
  y: number;
}

export function makeCompositionPoint(x: number, y: number): CompositionPoint {
  return { x, y };
}

// MARK: - ScreenSceneEvaluation

export interface ScreenSceneEvaluation {
  fittedRect: CompositionRect;
  baseRect: CompositionRect;
  finalRect: CompositionRect;
  manualScale: number;
  manualOffset: CompositionPoint;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  perspective: number;
  projectionAnchor: NormalizedPoint;
  baseCornerRadius: number;
  baseBorderWidth: number;
  finalCornerRadius: number;
  finalBorderWidth: number;
  zoom: ZoomSample;
  viewport: ZoomViewportTransform;
  readonly projectedQuad?: ProjectedScreenQuad;
}

export function screenSceneEvaluationProjectedQuad(evaluation: ScreenSceneEvaluation): ProjectedScreenQuad {
  // The authored 3D target selects a point inside the recorded screen.
  // Border/chrome travel with that screen, but must not move the pivot
  // away from the selected content merely because their insets differ.
  const anchor = makeCompositionPoint(
    evaluation.finalRect.x + evaluation.finalRect.width * evaluation.projectionAnchor.x,
    evaluation.finalRect.y + evaluation.finalRect.height * evaluation.projectionAnchor.y
  );
  return ScreenProjection.project(
    evaluation.finalRect,
    evaluation.rotationX,
    evaluation.rotationY,
    evaluation.rotationZ,
    evaluation.perspective,
    anchor
  );
}

export function makeScreenSceneEvaluation(
  init: Omit<ScreenSceneEvaluation, 'projectedQuad'>
): ScreenSceneEvaluation {
  return {
    ...init,
    get projectedQuad(): ProjectedScreenQuad {
      return screenSceneEvaluationProjectedQuad(this);
    },
  };
}

// MARK: - ScreenDecorationInsets

export interface ScreenDecorationInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function makeScreenDecorationInsets(
  top: number = 0,
  right: number = 0,
  bottom: number = 0,
  left: number = 0
): ScreenDecorationInsets {
  return {
    top: max(top, 0),
    right: max(right, 0),
    bottom: max(bottom, 0),
    left: max(left, 0),
  };
}

export const ScreenDecorationInsets = Object.freeze({
  zero: Object.freeze(makeScreenDecorationInsets(0, 0, 0, 0)),
  make: makeScreenDecorationInsets,
});

// MARK: - ScreenFrameGeometry

/// Shared screen-frame measurements used before motion layout and again while
/// lowering the final vector chrome. Keeping this formula in one place makes
/// the motion anchor account for the exact same toolbar the renderer draws.
export const ScreenFrameGeometry = Object.freeze({
  decorationInsetsAtScaleOne(
    style: ScreenFrameStyle,
    frameScale: number,
    toolbarScale: number = 1,
    fittedWidth: number,
    fittedHeight: number,
    styleScale: number
  ): ScreenDecorationInsets {
    if (style === 'none') {
      return ScreenDecorationInsets.zero;
    }
    const safeStyleScale = max(styleScale, 0.0001);
    const authoredFrameScale = min(max(frameScale, 0.6), 1.6);
    const authoredToolbarScale = min(max(toolbarScale, 0.65), 1.6);
    const visualScale = safeStyleScale * authoredFrameScale;
    switch (style) {
      case 'none':
        return ScreenDecorationInsets.zero;
      case 'windowLight':
      case 'windowDark':
      case 'browserLight':
      case 'browserDark': {
        const idealHeight = 46 * visualScale * authoredToolbarScale;
        return makeScreenDecorationInsets(
          min(
            max(idealHeight, 4 * safeStyleScale),
            max(max(fittedHeight, 0) * 0.25, 4 * safeStyleScale)
          )
        );
      }
      case 'devicePhone':
      case 'devicePhonePortrait':
      case 'devicePhoneLandscape': {
        const shortEdge = max(min(fittedWidth, fittedHeight), 1);
        const bezel = min(max(shortEdge * 0.036 * authoredFrameScale, 2 * safeStyleScale), shortEdge * 0.08);
        return makeScreenDecorationInsets(bezel, bezel, bezel, bezel);
      }
      case 'deviceTablet':
      case 'deviceTabletPortrait':
      case 'deviceTabletLandscape': {
        const shortEdge = max(min(fittedWidth, fittedHeight), 1);
        const bezel = min(max(shortEdge * 0.046 * authoredFrameScale, 2 * safeStyleScale), shortEdge * 0.09);
        return makeScreenDecorationInsets(bezel, bezel, bezel, bezel);
      }
    }
  },
});

// MARK: - CameraSceneEvaluation

export interface CameraSceneEvaluation {
  rect: CompositionRect;
  cornerRadius: number;
  borderWidth: number;
  zoomScale: number;
  opacity: number;
  fullscreenProgress: number;
}

export function makeCameraSceneEvaluation(init: CameraSceneEvaluation): CameraSceneEvaluation {
  return { ...init };
}

// MARK: - CompositionSceneEvaluation

export interface CompositionSceneEvaluation {
  screen: ScreenSceneEvaluation;
  camera: CameraSceneEvaluation | null;
}

export function makeCompositionSceneEvaluation(
  screen: ScreenSceneEvaluation,
  camera: CameraSceneEvaluation | null = null
): CompositionSceneEvaluation {
  return { screen, camera };
}

// MARK: - MotionTrackCacheStore

/// Lock-protected exact-match cache for sorted motion tracks. The evaluator
/// may run concurrently on preview and export threads; a bounded linear scan
/// (≤4 entries) over Equatable clip arrays is far cheaper than re-sorting the
/// tracks for every motion-blur sample.
export class MotionTrackCacheStore {
  private screenEntries: Array<{ keyJson: string; track: ScreenMotionTrack }> = [];
  private cameraEntries: Array<{ keyJson: string; track: CameraMotionTrack }> = [];

  screenTrack(clips: readonly ScreenMotionClip[]): ScreenMotionTrack {
    const keyJson = JSON.stringify(clips);
    const entry = this.screenEntries.find((e) => e.keyJson === keyJson);
    if (entry !== undefined) {
      return entry.track;
    }
    const track = new ScreenMotionTrack(clips);
    this.screenEntries.unshift({ keyJson, track });
    if (this.screenEntries.length > 4) {
      this.screenEntries.pop();
    }
    return track;
  }

  cameraTrack(clips: readonly CameraMotionClip[]): CameraMotionTrack {
    const keyJson = JSON.stringify(clips);
    const entry = this.cameraEntries.find((e) => e.keyJson === keyJson);
    if (entry !== undefined) {
      return entry.track;
    }
    const track = new CameraMotionTrack(clips);
    this.cameraEntries.unshift({ keyJson, track });
    if (this.cameraEntries.length > 4) {
      this.cameraEntries.pop();
    }
    return track;
  }
}

// MARK: - CompositionSceneEvaluator

export interface CompositionProjectLike {
  canvas: CanvasStyle;
  camera: CameraStyle;
  motion: MotionStyle;
  timeline: {
    screenMotionClips: readonly ScreenMotionClip[];
    cameraMotionClips: readonly CameraMotionClip[];
    zoomClips?: readonly ZoomAnimationClip[];
  };
  zoomAnimations: readonly ZoomAnimationClip[];
}

const motionTrackCache = new MotionTrackCacheStore();

function canonicalStyleScale(canvasWidth: number, canvasHeight: number): number {
  return max(min(canvasWidth, canvasHeight), 1) / 1080;
}

function mix(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function aspectFit(
  aspectRatio: number,
  width: number,
  height: number
): { width: number; height: number } {
  const safeAspect = max(aspectRatio, 0.01);
  if (width / max(height, 1) > safeAspect) {
    return { width: height * safeAspect, height };
  }
  return { width, height: width / safeAspect };
}

/**
 * Distance kept between a docked camera and the canvas edge along one axis:
 * 3.5% of the short side plus the border, shrinking to zero when the camera
 * leaves no room for it.
 */
export function cameraEdgeInset(
  canvas: number,
  camera: number,
  base: number,
  style: CameraStyle,
  styleScale: number = 1
): number {
  const scale = max(styleScale, 0.0001);
  const border = min(max(style.borderWidth, 0), 18) * scale;
  const wanted = base * 0.035 + border;
  return min(wanted, max((canvas - camera) / 2, 0));
}

function evaluateCameraWithSample(
  style: CameraStyle,
  sample: CameraMotionSample,
  screenZoomScale: number,
  canvasWidth: number,
  canvasHeight: number,
  styleScale: number = 1
): CameraSceneEvaluation {
  const width = max(canvasWidth, 2);
  const height = max(canvasHeight, 2);
  const base = min(width, height);
  const zoomProgress = min(max((screenZoomScale - 1) / 0.565, 0), 1);
  const zoomScale = 1 + (style.scaleDuringZoom - 1) * zoomProgress;
  const preferredCameraHeight = min(
    max(base * sample.size * zoomScale, 72 * max(styleScale, 0.0001)),
    base * 1.2
  );
  const preferredCameraWidth = preferredCameraHeight * max(sample.aspectRatio, 0.01);
  const fitScale = min(
    1,
    (width * 1.2) / max(preferredCameraWidth, 0.0001),
    (height * 1.2) / max(preferredCameraHeight, 0.0001)
  );
  const cameraWidth = preferredCameraWidth * fitScale;
  const cameraHeight = preferredCameraHeight * fitScale;
  const positionX = min(max(sample.position.x, 0), 1);
  const positionY = min(max(sample.position.y, 0), 1);
  const insetX = cameraEdgeInset(width, cameraWidth, base, style, styleScale);
  const insetY = cameraEdgeInset(height, cameraHeight, base, style, styleScale);
  const shapedRect = makeCompositionRect(
    insetX + positionX * (width - cameraWidth - insetX * 2),
    insetY + positionY * (height - cameraHeight - insetY * 2),
    cameraWidth,
    cameraHeight
  );
  const fullscreenProgress = min(max(sample.fullscreenProgress, 0), 1);
  const rect = makeCompositionRect(
    mix(shapedRect.x, 0, fullscreenProgress),
    mix(shapedRect.y, 0, fullscreenProgress),
    mix(shapedRect.width, width, fullscreenProgress),
    mix(shapedRect.height, height, fullscreenProgress)
  );
  const radius = min(rect.width, rect.height) * min(max(sample.cornerFraction, 0), 0.5);
  return {
    rect,
    cornerRadius: radius,
    borderWidth:
      min(max(style.borderWidth, 0), 18) *
      max(styleScale, 0.0001) *
      (1 - fullscreenProgress),
    zoomScale,
    opacity: min(max(sample.opacity, 0), 1),
    fullscreenProgress,
  };
}

function evaluateCameraWithAspect(
  style: CameraStyle,
  cameraAspectRatio: number,
  screenZoomScale: number,
  canvasWidth: number,
  canvasHeight: number,
  styleScale: number = 1
): CameraSceneEvaluation {
  const base = makeCameraMotionStateFromBase(style);
  const sample = new CameraMotionTrack([]).sample(
    0,
    base,
    cameraAspectRatio,
    max(canvasWidth, 2) / max(canvasHeight, 2)
  );
  return evaluateCameraWithSample(
    style,
    sample,
    screenZoomScale,
    canvasWidth,
    canvasHeight,
    styleScale
  );
}

function evaluateCamera(
  style: CameraStyle,
  aspectRatioOrMotion: number | CameraMotionSample,
  screenZoomScale: number,
  canvasWidth: number,
  canvasHeight: number,
  styleScale: number = 1
): CameraSceneEvaluation {
  if (typeof aspectRatioOrMotion === 'number') {
    return evaluateCameraWithAspect(
      style,
      aspectRatioOrMotion,
      screenZoomScale,
      canvasWidth,
      canvasHeight,
      styleScale
    );
  }
  return evaluateCameraWithSample(
    style,
    aspectRatioOrMotion,
    screenZoomScale,
    canvasWidth,
    canvasHeight,
    styleScale
  );
}

function evaluate(
  project: CompositionProjectLike,
  time: number,
  canvasWidth: number,
  canvasHeight: number,
  sourceAspectRatio: number,
  cameraAspectRatio: number | null = null,
  styleScale: number = 1,
  automaticZoomFocus: NormalizedPoint | null = null,
  inheritedAutomaticZoomFocus: NormalizedPoint | null = null,
  reanchorAutomaticEntry: boolean = false,
  zoomTrack: ZoomAnimationTrack | null = null,
  screenMotionTrack: ScreenMotionTrack | null = null,
  cameraMotionTrack: CameraMotionTrack | null = null,
  cameraMotionBase: CameraMotionSample | null = null
): CompositionSceneEvaluation {
  const width = max(canvasWidth, 2);
  const height = max(canvasHeight, 2);
  const scale = max(styleScale, 0.0001);
  const crop = normalizedCropClamped(project.canvas.crop);
  const croppedAspect = max((sourceAspectRatio * crop.width) / crop.height, 0.01);
  const maximumPadding = min(width, height) * 0.42;
  const padding = min(max(project.canvas.padding * scale, 0), maximumPadding);
  const availableWidth = max(width - padding * 2, 2);
  const availableHeight = max(height - padding * 2, 2);
  const fittedSize = aspectFit(croppedAspect, availableWidth, availableHeight);
  const fittedRect = makeCompositionRect(
    (width - fittedSize.width) / 2,
    (height - fittedSize.height) / 2,
    fittedSize.width,
    fittedSize.height
  );

  const sampleTime = Number.isFinite(time) ? max(time, 0) : 0;
  const baseScreenMotion = makeScreenMotionState(
    project.canvas.contentPosition,
    project.canvas.contentScale
  );
  const borderWidthAtScaleOne = min(max(project.canvas.borderWidth, 0), 60) * scale;
  const decorationInsetsAtScaleOne = ScreenFrameGeometry.decorationInsetsAtScaleOne(
    project.canvas.screenFrame,
    project.canvas.screenFrameScale,
    project.canvas.screenFrameToolbarScale,
    fittedRect.width,
    fittedRect.height,
    scale
  );
  const resolvedScreenMotionTrack =
    screenMotionTrack ?? motionTrackCache.screenTrack(project.timeline.screenMotionClips);
  const screenMotionSample = resolvedScreenMotionTrack.sampleLayout(
    sampleTime,
    baseScreenMotion,
    project.motion,
    makeScreenAnchorViewport({
      canvasWidth: width,
      canvasHeight: height,
      fittedWidth: fittedRect.width,
      fittedHeight: fittedRect.height,
      borderWidthAtScaleOne,
      decorationTopAtScaleOne: decorationInsetsAtScaleOne.top,
      decorationRightAtScaleOne: decorationInsetsAtScaleOne.right,
      decorationBottomAtScaleOne: decorationInsetsAtScaleOne.bottom,
      decorationLeftAtScaleOne: decorationInsetsAtScaleOne.left,
    })
  );
  const screenMotion = screenMotionSample.state;
  const manualScale = min(max(screenMotion.scale, 0.2), 4);
  const positionX = Number.isFinite(screenMotion.position.x) ? screenMotion.position.x : 0.5;
  const positionY = Number.isFinite(screenMotion.position.y) ? screenMotion.position.y : 0.5;
  const scaledWidth = fittedRect.width * manualScale;
  const scaledHeight = fittedRect.height * manualScale;
  const baseBorderWidth = borderWidthAtScaleOne * manualScale;
  const decoratedWidth = scaledWidth + baseBorderWidth * 2;
  const decoratedHeight = scaledHeight + baseBorderWidth * 2;
  const offsetX = screenMotionSample.manualOffset?.x ?? (positionX - 0.5) * (width - decoratedWidth);
  const offsetY = screenMotionSample.manualOffset?.y ?? (positionY - 0.5) * (height - decoratedHeight);
  const baseRect = makeCompositionRect(
    compositionRectMidX(fittedRect) - (fittedRect.width * manualScale) / 2 + offsetX,
    compositionRectMidY(fittedRect) - (fittedRect.height * manualScale) / 2 + offsetY,
    fittedRect.width * manualScale,
    fittedRect.height * manualScale
  );

  const zoom =
    zoomTrack?.sample(
      sampleTime,
      project.motion,
      automaticZoomFocus,
      inheritedAutomaticZoomFocus,
      reanchorAutomaticEntry
    ) ??
    ZoomInterpolator.sample(
      project.zoomAnimations,
      sampleTime,
      project.motion,
      automaticZoomFocus,
      inheritedAutomaticZoomFocus,
      reanchorAutomaticEntry
    );

  const coverageTolerance = max(width, height) * 0.000000001;
  const keepsCanvasCovered =
    project.canvas.screenFrame === 'none' &&
    resolvedScreenMotionTrack.activeClip(sampleTime) === null &&
    baseRect.x <= coverageTolerance &&
    baseRect.y <= coverageTolerance &&
    baseRect.x + baseRect.width >= width - coverageTolerance &&
    baseRect.y + baseRect.height >= height - coverageTolerance;

  const visibleRect = keepsCanvasCovered
    ? makeCompositionRect(
        -baseRect.x / baseRect.width,
        -baseRect.y / baseRect.height,
        width / baseRect.width,
        height / baseRect.height
      )
    : null;

  const viewport = ZoomViewportTransform.make(zoom, crop, visibleRect);
  const decorationGrowth = (manualScale * (viewport.scale - 1)) / 2;
  const finalRect = makeCompositionRect(
    compositionRectMidX(baseRect) -
      (baseRect.width * viewport.scale) / 2 +
      viewport.translation.x * baseRect.width +
      (decorationInsetsAtScaleOne.left - decorationInsetsAtScaleOne.right) * decorationGrowth,
    compositionRectMidY(baseRect) -
      (baseRect.height * viewport.scale) / 2 +
      viewport.translation.y * baseRect.height +
      (decorationInsetsAtScaleOne.top - decorationInsetsAtScaleOne.bottom) * decorationGrowth,
    baseRect.width * viewport.scale,
    baseRect.height * viewport.scale
  );

  const screen: ScreenSceneEvaluation = makeScreenSceneEvaluation({
    fittedRect,
    baseRect,
    finalRect,
    manualScale,
    manualOffset: makeCompositionPoint(offsetX, offsetY),
    rotationX: min(max(screenMotion.rotationX, -89), 89),
    rotationY: min(max(screenMotion.rotationY, -89), 89),
    rotationZ: screenMotion.rotationZ,
    perspective: min(max(screenMotion.perspective, 0), 2),
    projectionAnchor: screenMotionSample.projectionAnchor,
    baseCornerRadius: max(project.canvas.cornerRadius, 0) * scale * manualScale,
    baseBorderWidth,
    finalCornerRadius: keepsCanvasCovered
      ? 0
      : max(project.canvas.cornerRadius, 0) * scale * manualScale * viewport.scale,
    finalBorderWidth: baseBorderWidth * viewport.scale,
    zoom,
    viewport,
  });

  let camera: CameraSceneEvaluation | null = null;
  if (cameraAspectRatio !== null) {
    const baseCameraMotion = makeCameraMotionStateFromBase(project.camera);
    const cameraMotion = (
      cameraMotionTrack ?? motionTrackCache.cameraTrack(project.timeline.cameraMotionClips)
    ).sample(
      sampleTime,
      baseCameraMotion,
      cameraAspectRatio,
      width / height,
      project.motion,
      cameraMotionBase
    );
    camera = evaluateCameraWithSample(
      project.camera,
      cameraMotion,
      zoom.scale,
      width,
      height,
      scale
    );
  }

  return makeCompositionSceneEvaluation(screen, camera);
}

export const CompositionSceneEvaluator = Object.freeze({
  canonicalStyleScale,
  cameraEdgeInset,
  evaluate,
  evaluateCamera,
  aspectFit,
  mix,
});
