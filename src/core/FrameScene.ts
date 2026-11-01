// Port of: F:\dogsc\Sources\RecorderCore\FrameScene.swift
// STATUS: PARTIAL — L1–L540 (all frame data structures) ported in T6.3.
// L540–L1284 (FrameSceneEvaluator) will be appended in T6.4.

import { min, max } from './swift.ts';
import {
  type CompositionRect,
  type CompositionPoint,
} from './CompositionScene.ts';
import { type ProjectedScreenQuad } from './ScreenProjection.ts';
import {
  type HexColor,
  HexColorBlack,
  HexColorWhite,
} from './HexColor.ts';
import {
  type BackgroundSource,
  type NormalizedCrop,
  normalizedCropClamped,
  type CursorAssetID,
  type CursorClickEffectStyle,
} from './ProjectModel.ts';
import {
  type NormalizedPoint,
} from './ZoomAnimation.ts';
import { type CameraContentFillLayout } from './CameraContentFill.ts';
import {
  type CursorAssetMetrics,
  type CursorRenderLayout,
} from './CursorRenderGeometry.ts';
import { type PointerClickPhase } from './PointerTrack.ts';
import {
  type NormalizedOverlayRect,
  normalizedOverlayRectClamped,
  type MosaicEffectStyle,
} from './OverlayTimeline.ts';
import {
  type FrameStickerBackdropScene,
  frameStickerBackdropSceneFromStickers,
} from './StickerTransition.ts';
import { type FrameFocusScene } from './FocusEffect.ts';

// MARK: - CompositionSize

/// Backend-neutral size used by the immutable frame contract.
export interface CompositionSize {
  width: number;
  height: number;
}

export function makeCompositionSize(width: number, height: number): CompositionSize {
  return { width, height };
}

export function compositionSizeShortEdge(size: CompositionSize): number {
  return min(size.width, size.height);
}

export const CompositionSize = Object.freeze({
  make: makeCompositionSize,
  shortEdge: compositionSizeShortEdge,
});

// MARK: - FrameColorSpace & FrameColorContract

/// Explicit color intent for every preview and export frame. Render backends
/// may use different APIs, but they must not choose device-dependent defaults.
export type FrameColorSpace = 'linearSRGB' | 'sRGB';

export const FrameColorSpaceAllCases: readonly FrameColorSpace[] = Object.freeze([
  'linearSRGB',
  'sRGB',
]);

export interface FrameColorContract {
  workingSpace: FrameColorSpace;
  outputSpace: FrameColorSpace;
  isHDR: boolean;
}

export function makeFrameColorContract(options?: {
  workingSpace?: FrameColorSpace;
  outputSpace?: FrameColorSpace;
  isHDR?: boolean;
}): FrameColorContract {
  return {
    workingSpace: options?.workingSpace ?? 'linearSRGB',
    outputSpace: options?.outputSpace ?? 'sRGB',
    isHDR: options?.isHDR ?? false,
  };
}

/// Desktop SDR is captured through ScreenCaptureKit's explicit sRGB
/// conversion. Rec.709 and sRGB share the same primaries but not the same
/// transfer curve, so the transfer intent must not be collapsed to
/// "Rec.709" and later changed by metadata alone.
export const FrameColorContractSDRDesktop: FrameColorContract = Object.freeze(
  makeFrameColorContract()
);

export const FrameColorContract = Object.freeze({
  make: makeFrameColorContract,
  sdrDesktop: FrameColorContractSDRDesktop,
});

// MARK: - FrameShadow

export interface FrameShadow {
  color: HexColor;
  opacity: number;
  radius: number;
  /// Top-left-origin canvas coordinates; positive Y moves the shadow down.
  offset: CompositionPoint;
}

export function makeFrameShadow(options: {
  color?: HexColor;
  opacity: number;
  radius: number;
  offset: CompositionPoint;
}): FrameShadow {
  return {
    color: options.color ?? HexColorBlack,
    opacity: min(max(options.opacity, 0), 1),
    radius: max(options.radius, 0),
    offset: options.offset,
  };
}

// MARK: - FrameBackgroundScene

export interface FrameBackgroundScene {
  source: BackgroundSource;
  /// Blur radius in output-canvas pixels.
  blurRadius: number;
  patternScale: number;
  patternOpacity: number;
}

export function makeFrameBackgroundScene(options: {
  source: BackgroundSource;
  blurRadius: number;
  patternScale?: number;
  patternOpacity?: number;
}): FrameBackgroundScene {
  return {
    source: options.source,
    blurRadius: max(options.blurRadius, 0),
    patternScale: max(options.patternScale ?? 1.0, 0.1),
    patternOpacity: min(max(options.patternOpacity ?? 1.0, 0), 1),
  };
}

// MARK: - FrameScreenChromeKind & FrameScreenChromeScene

export type FrameScreenChromeKind =
  | 'window'
  | 'browser'
  | 'devicePhonePortrait'
  | 'devicePhoneLandscape'
  | 'deviceTabletPortrait'
  | 'deviceTabletLandscape';

export function frameScreenChromeKindIsDevice(kind: FrameScreenChromeKind): boolean {
  switch (kind) {
    case 'window':
    case 'browser':
      return false;
    case 'devicePhonePortrait':
    case 'devicePhoneLandscape':
    case 'deviceTabletPortrait':
    case 'deviceTabletLandscape':
      return true;
  }
}

export function frameScreenChromeKindIsPhone(kind: FrameScreenChromeKind): boolean {
  return kind === 'devicePhonePortrait' || kind === 'devicePhoneLandscape';
}

export function frameScreenChromeKindIsPortrait(kind: FrameScreenChromeKind): boolean {
  return kind === 'devicePhonePortrait' || kind === 'deviceTabletPortrait';
}

export const FrameScreenChromeKind = Object.freeze({
  isDevice: frameScreenChromeKindIsDevice,
  isPhone: frameScreenChromeKindIsPhone,
  isPortrait: frameScreenChromeKindIsPortrait,
});

/// Fully evaluated vector chrome. Geometry is expressed in the same top-left
/// canvas coordinates as the screen, so the single renderer can draw it before
/// applying the screen's 3D projection.
export interface FrameScreenChromeScene {
  kind: FrameScreenChromeKind;
  outerRect: CompositionRect;
  toolbarRect: CompositionRect;
  contentRect: CompositionRect;
  outerCornerRadius: number;
  contentCornerRadius: number;
  surfaceColor: HexColor;
  toolbarColor: HexColor;
  separatorColor: HexColor;
  fieldColor: HexColor;
  glyphColor: HexColor;
  title: string;
  browserAddress: string;
}

export function makeFrameScreenChromeScene(options: {
  kind: FrameScreenChromeKind;
  outerRect: CompositionRect;
  toolbarRect: CompositionRect;
  contentRect: CompositionRect;
  outerCornerRadius: number;
  contentCornerRadius?: number;
  surfaceColor: HexColor;
  toolbarColor: HexColor;
  separatorColor: HexColor;
  fieldColor: HexColor;
  glyphColor: HexColor;
  title?: string;
  browserAddress?: string;
}): FrameScreenChromeScene {
  return {
    kind: options.kind,
    outerRect: options.outerRect,
    toolbarRect: options.toolbarRect,
    contentRect: options.contentRect,
    outerCornerRadius: max(options.outerCornerRadius, 0),
    contentCornerRadius: max(options.contentCornerRadius ?? 0, 0),
    surfaceColor: options.surfaceColor,
    toolbarColor: options.toolbarColor,
    separatorColor: options.separatorColor,
    fieldColor: options.fieldColor,
    glyphColor: options.glyphColor,
    title: (options.title ?? '').slice(0, 120),
    browserAddress: (options.browserAddress ?? '').slice(0, 240),
  };
}

// MARK: - FrameScreenDecoration

/// Decorations are deliberately evaluated into `FrameScene`. The renderer
/// never reads `CanvasStyle` or chooses a visual preset on its own.
export type FrameScreenDecoration =
  | { kind: 'none' }
  | { kind: 'chrome'; chrome: FrameScreenChromeScene };

export function frameScreenDecorationProjectionRect(
  decoration: FrameScreenDecoration
): CompositionRect | null {
  switch (decoration.kind) {
    case 'none':
      return null;
    case 'chrome':
      return decoration.chrome.outerRect;
  }
}

export const FrameScreenDecoration = Object.freeze({
  none: Object.freeze({ kind: 'none' as const }),
  chrome: (chrome: FrameScreenChromeScene): FrameScreenDecoration => ({ kind: 'chrome', chrome }),
  projectionRect: frameScreenDecorationProjectionRect,
});

// MARK: - FrameMosaicScene

export interface FrameMosaicScene {
  sourceRect: NormalizedOverlayRect;
  cornerRadius: number;
  style: MosaicEffectStyle;
  intensity: number;
  spotlightDimming: number;
  /// Eased visibility shared by blur or spotlight dimming during interval edges.
  transitionProgress: number;
}

export function makeFrameMosaicScene(options: {
  sourceRect: NormalizedOverlayRect;
  cornerRadius: number;
  style: MosaicEffectStyle;
  intensity: number;
  spotlightDimming?: number;
  transitionProgress?: number;
}): FrameMosaicScene {
  return {
    sourceRect: normalizedOverlayRectClamped(options.sourceRect),
    cornerRadius: min(
      max(Number.isFinite(options.cornerRadius) ? options.cornerRadius : 0, 0),
      0.5
    ),
    style: options.style,
    intensity: min(max(Number.isFinite(options.intensity) ? options.intensity : 0.5, 0), 1),
    spotlightDimming: min(
      max(
        Number.isFinite(options.spotlightDimming)
          ? options.spotlightDimming!
          : 0.22,
        0
      ),
      0.75
    ),
    transitionProgress: min(
      max(
        Number.isFinite(options.transitionProgress)
          ? options.transitionProgress!
          : 1,
        0
      ),
      1
    ),
  };
}

// MARK: - FrameScreenScene

export interface FrameScreenScene {
  sourceCrop: NormalizedCrop;
  fittedRect: CompositionRect;
  baseRect: CompositionRect;
  finalRect: CompositionRect;
  projectedQuad: ProjectedScreenQuad;
  cornerRadius: number;
  borderWidth: number;
  borderColor: HexColor;
  borderOpacity: number;
  shadow: FrameShadow | null;
  decoration: FrameScreenDecoration;
  mosaics: FrameMosaicScene[];
  focusEffect: FrameFocusScene | null;
  opacity: number;
  readonly projectionRect?: CompositionRect;
}

export function frameScreenSceneProjectionRect(scene: FrameScreenScene): CompositionRect {
  return frameScreenDecorationProjectionRect(scene.decoration) ?? scene.finalRect;
}

export function makeFrameScreenScene(options: {
  sourceCrop: NormalizedCrop;
  fittedRect: CompositionRect;
  baseRect: CompositionRect;
  finalRect: CompositionRect;
  projectedQuad: ProjectedScreenQuad;
  cornerRadius: number;
  borderWidth: number;
  borderColor: HexColor;
  borderOpacity: number;
  shadow: FrameShadow | null;
  decoration?: FrameScreenDecoration;
  mosaics?: FrameMosaicScene[];
  focusEffect?: FrameFocusScene | null;
  opacity?: number;
}): FrameScreenScene {
  return {
    sourceCrop: normalizedCropClamped(options.sourceCrop),
    fittedRect: options.fittedRect,
    baseRect: options.baseRect,
    finalRect: options.finalRect,
    projectedQuad: options.projectedQuad,
    cornerRadius: max(options.cornerRadius, 0),
    borderWidth: max(options.borderWidth, 0),
    borderColor: options.borderColor,
    borderOpacity: min(max(options.borderOpacity, 0), 1),
    shadow: options.shadow,
    decoration: options.decoration ?? FrameScreenDecoration.none,
    mosaics: options.mosaics ? options.mosaics.slice() : [],
    focusEffect: options.focusEffect ?? null,
    opacity: min(max(options.opacity ?? 1, 0), 1),
    get projectionRect(): CompositionRect {
      return frameScreenSceneProjectionRect(this);
    },
  };
}

// MARK: - FrameCameraScene

export interface FrameCameraScene {
  rect: CompositionRect;
  contentFill: CameraContentFillLayout | null;
  cornerRadius: number;
  borderWidth: number;
  borderColor: HexColor;
  shadow: FrameShadow | null;
  opacity: number;
  isMirrored: boolean;
}

export function makeFrameCameraScene(options: {
  rect: CompositionRect;
  contentFill: CameraContentFillLayout | null;
  cornerRadius: number;
  borderWidth: number;
  borderColor?: HexColor;
  shadow: FrameShadow | null;
  opacity: number;
  isMirrored: boolean;
}): FrameCameraScene {
  return {
    rect: options.rect,
    contentFill: options.contentFill,
    cornerRadius: max(options.cornerRadius, 0),
    borderWidth: max(options.borderWidth, 0),
    borderColor: options.borderColor ?? HexColorWhite,
    shadow: options.shadow,
    opacity: min(max(options.opacity, 0), 1),
    isMirrored: options.isMirrored,
  };
}

// MARK: - FrameCursorAttachment & FrameCursorScene

export type FrameCursorAttachment = 'screen';

export const FrameCursorAttachmentAllCases: readonly FrameCursorAttachment[] = Object.freeze([
  'screen',
]);

export interface FrameCursorScene {
  assetID: CursorAssetID;
  metrics: CursorAssetMetrics;
  /// Position inside the cropped screen before screen projection.
  normalizedScreenPosition: NormalizedPoint;
  /// Canonical 2D layout. It also supplies local size/hotspot metrics when a
  /// backend attaches the cursor to a projected screen texture.
  layout: CursorRenderLayout;
  isClicking: boolean;
  clickPhase: PointerClickPhase | null;
  clickStyle: CursorClickEffectStyle;
  clickColor: HexColor | null;
  clickOpacity: number;
  clickScale: number;
  rotationRadians: number;
  shadow: FrameShadow | null;
  attachment: FrameCursorAttachment;
  readonly effectiveClickColor?: HexColor;
}

export function frameCursorSceneEffectiveClickColor(scene: FrameCursorScene): HexColor {
  return scene.clickColor ?? scene.metrics.clickColor;
}

export function makeFrameCursorScene(options: {
  assetID: CursorAssetID;
  metrics: CursorAssetMetrics;
  normalizedScreenPosition: NormalizedPoint;
  layout: CursorRenderLayout;
  isClicking: boolean;
  clickPhase?: PointerClickPhase | null;
  clickStyle?: CursorClickEffectStyle;
  clickColor?: HexColor | null;
  clickOpacity?: number;
  clickScale?: number;
  rotationRadians?: number;
  shadow: FrameShadow | null;
  attachment?: FrameCursorAttachment;
}): FrameCursorScene {
  return {
    assetID: options.assetID,
    metrics: options.metrics,
    normalizedScreenPosition: options.normalizedScreenPosition,
    layout: options.layout,
    isClicking: options.isClicking,
    clickPhase: options.clickPhase ?? null,
    clickStyle: options.clickStyle ?? 'ripple',
    clickColor: options.clickColor ?? null,
    clickOpacity: min(max(options.clickOpacity ?? 0.8, 0.05), 1.0),
    clickScale: min(max(options.clickScale ?? 1.0, 0.4), 3.0),
    rotationRadians: Number.isFinite(options.rotationRadians) ? options.rotationRadians! : 0,
    shadow: options.shadow,
    attachment: options.attachment ?? 'screen',
    get effectiveClickColor(): HexColor {
      return frameCursorSceneEffectiveClickColor(this);
    },
  };
}

// MARK: - FrameStickerScene

export interface FrameStickerScene {
  id: string;
  relativePath: string;
  position: NormalizedPoint;
  width: number;
  rotationRadians: number;
  opacity: number;
  scale: number;
  offset: NormalizedPoint;
  cornerRadius: number;
  borderWidth: number;
  borderColor: HexColor;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: CompositionPoint;
  backdropBlur: number;
  backdropBlurIncludesCamera: boolean;
  hidesScreen: boolean;
  hidesCamera: boolean;
  /// Entrance/exit visibility before the user's authored sticker opacity is
  /// applied. Joined background treatment lives separately in the frame
  /// backdrop so two partially visible images cannot expose the recording.
  transitionProgress: number;
  layerIndex: number;
}

export function makeFrameStickerScene(init: FrameStickerScene): FrameStickerScene {
  return { ...init };
}

// MARK: - FrameLayerRole

export type FrameLayerRole =
  | 'background'
  | 'screen'
  | 'cursor'
  | 'spotlight'
  | 'camera'
  | 'stickers';

export const FrameLayerRoleAllCases: readonly FrameLayerRole[] = Object.freeze([
  'background',
  'screen',
  'cursor',
  'spotlight',
  'camera',
  'stickers',
]);

// MARK: - FrameScene

/// Complete immutable interpretation of one project time. A renderer may read
/// media frames and this value, but must never read `RecorderProject` directly.
export interface FrameScene {
  time: number;
  canvasSize: CompositionSize;
  color: FrameColorContract;
  background: FrameBackgroundScene;
  screen: FrameScreenScene;
  camera: FrameCameraScene | null;
  cursor: FrameCursorScene | null;
  stickers: FrameStickerScene[];
  stickerBackdrop: FrameStickerBackdropScene;
  layerOrder: FrameLayerRole[];
}

export function makeFrameScene(options: {
  time: number;
  canvasSize: CompositionSize;
  color: FrameColorContract;
  background: FrameBackgroundScene;
  screen: FrameScreenScene;
  camera: FrameCameraScene | null;
  cursor: FrameCursorScene | null;
  stickers?: FrameStickerScene[];
  stickerBackdrop?: FrameStickerBackdropScene | null;
  layerOrder: FrameLayerRole[];
}): FrameScene {
  const stickers = options.stickers ? options.stickers.slice() : [];
  const stickerBackdrop =
    options.stickerBackdrop ?? frameStickerBackdropSceneFromStickers(stickers);
  return {
    time: options.time,
    canvasSize: options.canvasSize,
    color: options.color,
    background: options.background,
    screen: options.screen,
    camera: options.camera,
    cursor: options.cursor,
    stickers,
    stickerBackdrop,
    layerOrder: options.layerOrder.slice(),
  };
}

// MARK: - FrameRenderPlan

/// One output-frame request. Preview and export consume one identical scene.
export interface FrameRenderPlan {
  presentationTime: number;
  outputDuration: number;
  frameRate: number;
  scene: FrameScene;
}

export function makeFrameRenderPlan(options: {
  presentationTime: number;
  outputDuration: number;
  frameRate: number;
  scene: FrameScene;
}): FrameRenderPlan {
  return {
    presentationTime: options.presentationTime,
    outputDuration: options.outputDuration,
    frameRate: options.frameRate,
    scene: options.scene,
  };
}
