// Port of: F:\dogsc\Sources\RecorderCore\FrameScene.swift

import { min, max } from './swift.ts';
import {
  type CompositionRect,
  type CompositionPoint,
  makeCompositionRect,
  makeCompositionPoint,
  compositionRectMidX,
  compositionRectMidY,
  CompositionSceneEvaluator,
  ScreenFrameGeometry,
  type ScreenSceneEvaluation,
} from './CompositionScene.ts';
import { ScreenProjection, type ProjectedScreenQuad } from './ScreenProjection.ts';
import {
  type HexColor,
  HexColorBlack,
  HexColorWhite,
  makeHexColor,
} from './HexColor.ts';
import {
  type CanvasStyle,
  type CameraStyle,
  type MotionStyle,
  type CursorStyle,
  type OpeningSequence,
  type OpeningSequenceElement,
  type ScreenFrameStyle,
  type BackgroundSource,
  type NormalizedCrop,
  normalizedCropClamped,
  type CursorAssetID,
  type CursorClickEffectStyle,
  openingSequenceParticipatingElements,
  openingSequenceMaximumStagger,
  OPENING_SEQUENCE_MINIMUM_ELEMENT_DURATION,
} from './ProjectModel.ts';
import { screenFrameStyleDefaults } from './ScreenFrameDefaults.ts';
import {
  type NormalizedPoint,
  makeNormalizedPoint,
  type ZoomAnimationClip,
  ZoomAnimationTrack,
} from './ZoomAnimation.ts';
import { CameraContentFill, type CameraContentFillLayout } from './CameraContentFill.ts';
import {
  CursorRenderGeometry,
  type CursorAssetMetrics,
  type CursorRenderLayout,
} from './CursorRenderGeometry.ts';
import {
  type PointerSample,
  type PointerTrackEvaluation,
  makePointerTrackEvaluation,
} from './PointerTrack.ts';
import {
  type NormalizedOverlayRect,
  normalizedOverlayRectClamped,
  type MosaicEffectStyle,
  type MosaicClip,
  type MosaicTransitionStyle,
  type StickerClip,
  type StickerAnimationPreset,
  overlayTimingContains,
  stickerAnimationPresetAutomaticExit,
} from './OverlayTimeline.ts';
import {
  StickerTransitionTrack,
  type FrameStickerBackdropScene,
  frameStickerBackdropSceneFromStickers,
} from './StickerTransition.ts';
import { FocusEffectEvaluator, type FrameFocusScene } from './FocusEffect.ts';
import { ElementMotionEvaluator } from './ElementMotion.ts';
import { ScreenMotionTrack, type ScreenMotionClip } from './ScreenMotion.ts';
import { CameraMotionTrack, type CameraMotionClip } from './CameraMotion.ts';

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

// MARK: - FrameSceneProjectLike & Helper Interfaces

export interface FrameSceneProjectLike {
  canvas: CanvasStyle;
  camera: CameraStyle;
  motion: MotionStyle;
  cursorStyle: CursorStyle;
  openingSequence: OpeningSequence;
  timeline: {
    screenMotionClips: readonly ScreenMotionClip[];
    cameraMotionClips: readonly CameraMotionClip[];
    stickerClips: readonly StickerClip[];
    mosaicClips: readonly MosaicClip[];
    zoomClips?: readonly ZoomAnimationClip[];
  };
  zoomAnimations: readonly ZoomAnimationClip[];
  media?: {
    camera?: any;
  } | null;
}

export interface ProjectPointerTrackLike {
  evaluation(
    time: number,
    motion: MotionStyle,
    style: CursorStyle,
    automaticEntry?: ZoomAnimationClip | null
  ): PointerTrackEvaluation;
  automaticEntryStartsAfterCut?(clip: ZoomAnimationClip): boolean;
  automaticCameraFocus?(
    at: number,
    clip: ZoomAnimationClip,
    motion: MotionStyle
  ): NormalizedPoint;
}

export interface TimelineMediaPlanLike {
  contains(options: { outputTime: number }): boolean;
}

// MARK: - Helper Types & Internal Functions

interface OpeningSample {
  opacity: number;
  scale: number;
  offset: CompositionPoint;
  rotationX: number;
  rotationY: number;
  perspective: number;
  remaining: number;
}

const OpeningSampleIdentity: OpeningSample = Object.freeze({
  opacity: 1,
  scale: 1,
  offset: Object.freeze(makeCompositionPoint(0, 0)),
  rotationX: 0,
  rotationY: 0,
  perspective: 0,
  remaining: 0,
});

function openingSample(
  element: OpeningSequenceElement,
  sequence: OpeningSequence,
  activeElements: readonly OpeningSequenceElement[],
  time: number,
  canvasWidth: number,
  canvasHeight: number
): OpeningSample {
  if (!sequence.isEnabled || time >= sequence.duration) {
    return OpeningSampleIdentity;
  }
  const index = activeElements.indexOf(element);
  if (index === -1) {
    return OpeningSampleIdentity;
  }

  const effectiveStagger = min(
    sequence.stagger,
    openingSequenceMaximumStagger(sequence.duration, activeElements.length)
  );
  const lastDelay = effectiveStagger * max(activeElements.length - 1, 0);
  const itemDuration = max(
    sequence.duration - lastDelay,
    OPENING_SEQUENCE_MINIMUM_ELEMENT_DURATION
  );
  const start = effectiveStagger * index;
  const linear = min(max((time - start) / itemDuration, 0), 1);
  const eased = ElementMotionEvaluator.progress(linear, sequence.motionCurve);
  const opacity = ElementMotionEvaluator.progress(
    min(linear * 1.65, 1),
    sequence.motionCurve
  );
  const remaining = 1 - eased;
  const rotationRemaining = Math.pow(1 - linear, 1.5);
  const overshoot = 1 + 1.35 * Math.pow(linear - 1, 3) + 0.35 * Math.pow(linear - 1, 2);

  let scaleStart = 0.8;
  let initialOffset = makeCompositionPoint(0, 0);
  let rotationX = 0;
  let rotationY = 0;
  let perspective = 0;

  switch (sequence.preset) {
    case '聚拢':
      switch (element) {
        case '屏幕':
          scaleStart = 0.72;
          initialOffset = makeCompositionPoint(-canvasWidth * 1.05, -canvasHeight * 0.62);
          break;
        case '摄像头':
          scaleStart = 0.58;
          initialOffset = makeCompositionPoint(canvasWidth * 1.12, canvasHeight * 0.72);
          break;
        case '贴图':
          scaleStart = 0.62;
          initialOffset = makeCompositionPoint(-canvasWidth * 1.3, -canvasHeight * 0.7);
          break;
      }
      break;

    case '侧滑':
      switch (element) {
        case '屏幕':
          scaleStart = 0.94;
          initialOffset = makeCompositionPoint(-canvasWidth * 1.12, 0);
          break;
        case '摄像头':
          scaleStart = 0.88;
          initialOffset = makeCompositionPoint(canvasWidth * 1.15, 0);
          break;
        case '贴图':
          scaleStart = 0.9;
          initialOffset = makeCompositionPoint(-canvasWidth * 1.35, 0);
          break;
      }
      break;

    case '轻 3D':
    default:
      switch (element) {
        case '屏幕':
          scaleStart = 0.8;
          initialOffset = makeCompositionPoint(-canvasWidth * 1.05, canvasHeight * 0.08);
          rotationX = 9 * rotationRemaining;
          rotationY = -22 * rotationRemaining;
          perspective = 0.72 * rotationRemaining;
          break;
        case '摄像头':
          scaleStart = 0.72;
          initialOffset = makeCompositionPoint(canvasWidth * 1.1, canvasHeight * 0.16);
          break;
        case '贴图':
          scaleStart = 0.76;
          initialOffset = makeCompositionPoint(-canvasWidth * 1.3, -canvasHeight * 0.12);
          break;
      }
      break;
  }

  const settledScale = min(max(overshoot, 0), 1.04);
  return {
    opacity,
    scale: scaleStart + (settledScale - scaleStart) * eased,
    offset: makeCompositionPoint(initialOffset.x * remaining, initialOffset.y * remaining),
    rotationX,
    rotationY,
    perspective,
    remaining,
  };
}

function openingRect(rect: CompositionRect, sample: OpeningSample): CompositionRect {
  const width = rect.width * sample.scale;
  const height = rect.height * sample.scale;
  return makeCompositionRect(
    compositionRectMidX(rect) - width / 2 + sample.offset.x,
    compositionRectMidY(rect) - height / 2 + sample.offset.y,
    width,
    height
  );
}

function smootherStep(value: number): number {
  const x = min(max(value, 0), 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

function overlayEffectProgress(
  timing: { startTime: number; duration: number },
  style: MosaicTransitionStyle,
  enterDuration: number,
  exitDuration: number,
  time: number
): number {
  if (timing.duration <= 0) return 0;
  if (style === 'none') return 1;
  const elapsed = max(time - timing.startTime, 0);
  const remaining = max(timing.startTime + timing.duration - time, 0);
  const linearEnter = enterDuration > 0 ? min(max(elapsed / enterDuration, 0), 1) : 1;
  const linearExit = exitDuration > 0 ? min(max(remaining / exitDuration, 0), 1) : 1;
  let enter: number;
  let exit: number;
  switch (style) {
    case 'none':
      return 1;
    case 'linear':
      enter = linearEnter;
      exit = linearExit;
      break;
    case 'smooth':
      enter = smootherStep(linearEnter);
      exit = smootherStep(linearExit);
      break;
  }
  return min(enter, exit);
}

function screenDecoration(
  style: ScreenFrameStyle,
  frameScale: number,
  toolbarScale: number,
  outerCornerRadius: number | null | undefined,
  contentCornerRadius: number | null | undefined,
  title: string,
  browserAddress: string,
  geometry: ScreenSceneEvaluation,
  styleScale: number,
  groupScale: number = 1
): FrameScreenDecoration {
  if (style === 'none') {
    return FrameScreenDecoration.none;
  }
  const authoredFrameScale = min(max(frameScale, 0.6), 1.6);
  const motionScale = max(geometry.manualScale * geometry.viewport.scale * groupScale, 0.0001);
  const scale = max(styleScale * motionScale * authoredFrameScale, 0.0001);
  const authoredInsets = ScreenFrameGeometry.decorationInsetsAtScaleOne(
    style,
    frameScale,
    toolbarScale,
    geometry.fittedRect.width,
    geometry.fittedRect.height,
    styleScale
  );
  const topInset = authoredInsets.top * motionScale;
  const rightInset = authoredInsets.right * motionScale;
  const bottomInset = authoredInsets.bottom * motionScale;
  const leftInset = authoredInsets.left * motionScale;
  const outerRect = makeCompositionRect(
    geometry.finalRect.x - leftInset,
    geometry.finalRect.y - topInset,
    geometry.finalRect.width + leftInset + rightInset,
    geometry.finalRect.height + topInset + bottomInset
  );
  const toolbarRect = makeCompositionRect(
    outerRect.x,
    outerRect.y,
    outerRect.width,
    topInset + min(2 * scale, topInset * 0.08)
  );
  const isDark =
    style === 'windowDark' ||
    style === 'browserDark' ||
    style === 'devicePhone' ||
    style === 'deviceTablet' ||
    style === 'devicePhonePortrait' ||
    style === 'devicePhoneLandscape' ||
    style === 'deviceTabletPortrait' ||
    style === 'deviceTabletLandscape';

  let kind: FrameScreenChromeKind;
  switch (style) {
    case 'browserLight':
    case 'browserDark':
      kind = 'browser';
      break;
    case 'devicePhone':
      kind =
        geometry.finalRect.width >= geometry.finalRect.height
          ? 'devicePhoneLandscape'
          : 'devicePhonePortrait';
      break;
    case 'deviceTablet':
      kind =
        geometry.finalRect.width >= geometry.finalRect.height
          ? 'deviceTabletLandscape'
          : 'deviceTabletPortrait';
      break;
    case 'devicePhonePortrait':
    case 'devicePhoneLandscape':
    case 'deviceTabletPortrait':
    case 'deviceTabletLandscape':
      kind = style;
      break;
    case 'windowLight':
    case 'windowDark':
    default:
      kind = 'window';
      break;
  }

  const isDevice = frameScreenChromeKindIsDevice(kind);
  const isPhone = frameScreenChromeKindIsPhone(kind);
  const defaults = screenFrameStyleDefaults(style);

  const fallbackOuterRadius = isDevice
    ? (min(outerRect.width, outerRect.height) * (isPhone ? 0.11 : 0.065)) / max(scale, 0.0001)
    : defaults.outerRadius;
  const authoredOuterRadius = min(max(outerCornerRadius ?? fallbackOuterRadius, 0), 160);
  const resolvedOuterCornerRadius = min(
    authoredOuterRadius * scale,
    min(outerRect.width, outerRect.height) / 2
  );

  const fallbackContentRadius = isDevice
    ? max(resolvedOuterCornerRadius - min(topInset, leftInset), 0) / max(scale, 0.0001)
    : defaults.contentRadius;
  const authoredContentRadius = min(max(contentCornerRadius ?? fallbackContentRadius, 0), 160);
  const resolvedContentCornerRadius = min(
    authoredContentRadius * scale,
    min(geometry.finalRect.width, geometry.finalRect.height) / 2
  );

  return FrameScreenDecoration.chrome(
    makeFrameScreenChromeScene({
      kind,
      outerRect,
      toolbarRect,
      contentRect: geometry.finalRect,
      outerCornerRadius: resolvedOuterCornerRadius,
      contentCornerRadius: resolvedContentCornerRadius,
      surfaceColor: isDark ? makeHexColor(0x222327) : makeHexColor(0xecedf0),
      toolbarColor: isDark ? makeHexColor(0x313238) : makeHexColor(0xf4f4f6),
      separatorColor: isDark ? makeHexColor(0x4b4d55) : makeHexColor(0xc9cace),
      fieldColor: isDark ? makeHexColor(0x1b1c20) : makeHexColor(0xffffff),
      glyphColor: isDark ? makeHexColor(0xa9abb3) : makeHexColor(0x7a7c84),
      title,
      browserAddress,
    })
  );
}

function cursorScene(
  sample: PointerSample | null | undefined,
  project: FrameSceneProjectLike,
  metrics: CursorAssetMetrics | null | undefined,
  metricsByAssetID: Record<string, CursorAssetMetrics> | undefined,
  screen: FrameScreenScene,
  canvasSize: CompositionSize
): FrameCursorScene | null {
  if (!sample) return null;
  const assetID =
    project.cursorStyle.assetID === 'automatic'
      ? (sample.recordedCursorAssetID ?? 'systemArrow')
      : project.cursorStyle.assetID;
  const resolvedMetrics = (metricsByAssetID && metricsByAssetID[assetID]) ?? metrics;
  if (!resolvedMetrics) return null;

  const crop = screen.sourceCrop;
  const local = makeNormalizedPoint(
    (sample.location.x - crop.x) / crop.width,
    (sample.location.y - crop.y) / crop.height
  );
  if (local.x < 0 || local.x > 1 || local.y < 0 || local.y > 1) return null;

  const point = makeCompositionPoint(
    screen.finalRect.x + local.x * screen.finalRect.width,
    screen.finalRect.y + local.y * screen.finalRect.height
  );
  const layout = CursorRenderGeometry.layout(
    point,
    compositionSizeShortEdge(canvasSize),
    project.cursorStyle.size,
    resolvedMetrics
  );
  if (!layout) return null;

  const clickHeight = layout.clickEffectHeight ?? layout.size.height;
  return makeFrameCursorScene({
    assetID,
    metrics: resolvedMetrics,
    normalizedScreenPosition: local,
    layout,
    isClicking: sample.isClicking,
    clickPhase: sample.clickPhase,
    clickStyle: project.cursorStyle.clickEffectStyle,
    clickColor: project.cursorStyle.clickColor,
    clickOpacity: project.cursorStyle.clickOpacity,
    clickScale: project.cursorStyle.clickScale,
    rotationRadians: sample.rotationRadians,
    shadow: makeFrameShadow({
      opacity: 0.42,
      radius: max((clickHeight * 1.5) / 44, 0.5),
      offset: makeCompositionPoint(0, max(clickHeight / 44, 0.5)),
    }),
  });
}

function stickerAnimationTransform(
  preset: StickerAnimationPreset,
  progress: number,
  position: NormalizedPoint,
  width: number
): { scale: number; offset: NormalizedPoint } {
  const p = min(max(progress, 0), 1);
  const travel = 1 - p;
  const halfExtent = max(width, 0.02) / 2;
  const outsideLeading = min(-0.85, -halfExtent - 0.06);
  const outsideTrailing = max(1.85, 1 + halfExtent + 0.06);
  const left = outsideLeading - position.x;
  const right = outsideTrailing - position.x;
  const top = outsideLeading - position.y;
  const bottom = outsideTrailing - position.y;
  let offset = makeNormalizedPoint(0, 0);
  let scale = 1.0;
  switch (preset) {
    case 'none':
    case 'fade':
      break;
    case 'pop':
      scale = 0.72 + p * 0.28;
      break;
    case 'slideLeft':
      offset = makeNormalizedPoint(left * travel, 0);
      break;
    case 'slideRight':
      offset = makeNormalizedPoint(right * travel, 0);
      break;
    case 'slideUp':
      offset = makeNormalizedPoint(0, top * travel);
      break;
    case 'slideDown':
      offset = makeNormalizedPoint(0, bottom * travel);
      break;
    case 'slideTopLeft':
      offset = makeNormalizedPoint(left * travel, top * travel);
      break;
    case 'slideTopRight':
      offset = makeNormalizedPoint(right * travel, top * travel);
      break;
    case 'slideBottomLeft':
      offset = makeNormalizedPoint(left * travel, bottom * travel);
      break;
    case 'slideBottomRight':
      offset = makeNormalizedPoint(right * travel, bottom * travel);
      break;
  }
  return { scale, offset };
}

function stickerScenes(
  track: StickerTransitionTrack,
  time: number,
  suppressesInitialEntry: boolean = false
): { stickers: FrameStickerScene[]; backdrop: FrameStickerBackdropScene } {
  const sample = track.sample(time, suppressesInitialEntry);
  const stickers: FrameStickerScene[] = sample.stickers.map((s) => {
    const clip = s.clip;
    const visibility = s.visibility;
    const transform = stickerAnimationTransform(s.preset, s.progress, clip.position, clip.width);
    return makeFrameStickerScene({
      id: clip.id,
      relativePath: clip.relativePath,
      position: clip.position,
      width: min(max(clip.width, 0.02), 2),
      rotationRadians: (clip.rotationDegrees * Math.PI) / 180,
      opacity: min(max(clip.opacity, 0), 1) * visibility,
      scale: transform.scale,
      offset: transform.offset,
      cornerRadius: max(clip.cornerRadius, 0),
      borderWidth: max(clip.borderWidth, 0),
      borderColor: clip.borderColor,
      shadowOpacity: min(max(clip.shadowOpacity, 0), 1),
      shadowRadius: max(clip.shadowRadius, 0),
      shadowOffset: makeCompositionPoint(clip.shadowOffsetX, clip.shadowOffsetY),
      backdropBlur: max(clip.backdropBlur, 0) * visibility,
      backdropBlurIncludesCamera: clip.backdropBlurIncludesCamera,
      hidesScreen: clip.hidesScreen,
      hidesCamera: clip.hidesCamera,
      transitionProgress: visibility,
      layerIndex: clip.layerIndex,
    });
  });
  return { stickers, backdrop: sample.backdrop };
}

// MARK: - FrameSceneEvaluator

export const FrameSceneEvaluator = Object.freeze({
  refreshingCursor(
    plan: FrameRenderPlan,
    presentationTime: number,
    project: FrameSceneProjectLike,
    pointerTrack: ProjectPointerTrackLike | null = null,
    cursorMetrics: CursorAssetMetrics | null = null,
    cursorMetricsByAssetID: Record<string, CursorAssetMetrics> = {},
    zoomTrack: ZoomAnimationTrack | null = null
  ): FrameRenderPlan {
    const time = Number.isFinite(presentationTime)
      ? min(max(presentationTime, 0), plan.outputDuration)
      : 0;
    const resolvedZoomTrack =
      zoomTrack != null
        ? zoomTrack
        : new ZoomAnimationTrack(project.zoomAnimations, plan.outputDuration);
    const activeClip = resolvedZoomTrack.activeClip(time);
    const activeAutomaticClip = activeClip && activeClip.origin === 'automatic' ? activeClip : null;
    const pointer = pointerTrack?.evaluation(time, project.motion, project.cursorStyle, activeAutomaticClip);
    const newCursor = cursorScene(
      pointer?.cursor ?? null,
      project,
      cursorMetrics,
      cursorMetricsByAssetID,
      plan.scene.screen,
      plan.scene.canvasSize
    );

    const newLayerOrder = plan.scene.layerOrder.filter((role) => role !== 'cursor');
    if (newCursor != null) {
      const screenIndex = newLayerOrder.indexOf('screen');
      if (screenIndex !== -1) {
        newLayerOrder.splice(screenIndex + 1, 0, 'cursor');
      }
    }

    const newScene: FrameScene = {
      ...plan.scene,
      cursor: newCursor,
      layerOrder: newLayerOrder,
    };

    return makeFrameRenderPlan({
      presentationTime: time,
      outputDuration: plan.outputDuration,
      frameRate: plan.frameRate,
      scene: newScene,
    });
  },

  renderPlan(
    project: FrameSceneProjectLike,
    presentationTime: number,
    outputDuration: number,
    frameRate: number,
    canvasSize: CompositionSize,
    sourceAspectRatio: number,
    cameraSourceSize: CompositionSize | null = null,
    pointerTrack: ProjectPointerTrackLike | null = null,
    cursorMetrics: CursorAssetMetrics | null = null,
    cursorMetricsByAssetID: Record<string, CursorAssetMetrics> = {},
    zoomTrack: ZoomAnimationTrack | null = null,
    screenMotionTrack: ScreenMotionTrack | null = null,
    cameraMotionTrack: CameraMotionTrack | null = null,
    stickerTrack: StickerTransitionTrack | null = null,
    cameraTimeline: TimelineMediaPlanLike | null = null,
    color: FrameColorContract = FrameColorContractSDRDesktop
  ): FrameRenderPlan {
    const safeDuration = Number.isFinite(outputDuration) ? max(outputDuration, 0) : 0;
    const safeTime = Number.isFinite(presentationTime)
      ? min(max(presentationTime, 0), safeDuration)
      : 0;
    const cameraIsAvailable = cameraTimeline?.contains({ outputTime: safeTime }) ?? true;
    const current = FrameSceneEvaluator.scene(
      project,
      safeTime,
      safeDuration,
      canvasSize,
      sourceAspectRatio,
      cameraIsAvailable ? cameraSourceSize : null,
      pointerTrack,
      null, // pointerEvaluation
      cursorMetrics,
      cursorMetricsByAssetID,
      zoomTrack,
      screenMotionTrack,
      cameraMotionTrack,
      stickerTrack,
      color
    );
    return makeFrameRenderPlan({
      presentationTime: safeTime,
      outputDuration: safeDuration,
      frameRate: max(frameRate, 1),
      scene: current,
    });
  },

  scene(
    project: FrameSceneProjectLike,
    time: number,
    outputDuration: number | null = null,
    canvasSize: CompositionSize,
    sourceAspectRatio: number,
    cameraSourceSize: CompositionSize | null = null,
    pointerTrack: ProjectPointerTrackLike | null = null,
    pointerEvaluation: PointerTrackEvaluation | null = null,
    cursorMetrics: CursorAssetMetrics | null = null,
    cursorMetricsByAssetID: Record<string, CursorAssetMetrics> = {},
    zoomTrack: ZoomAnimationTrack | null = null,
    screenMotionTrack: ScreenMotionTrack | null = null,
    cameraMotionTrack: CameraMotionTrack | null = null,
    stickerTrack: StickerTransitionTrack | null = null,
    color: FrameColorContract = FrameColorContractSDRDesktop
  ): FrameScene {
    const width = max(canvasSize.width, 2);
    const height = max(canvasSize.height, 2);
    const sampleTime = Number.isFinite(time) ? max(time, 0) : 0;

    const resolvedZoomTrack =
      zoomTrack != null
        ? zoomTrack.bounded(outputDuration ?? null)
        : new ZoomAnimationTrack(project.zoomAnimations, outputDuration ?? null);
    const resolvedScreenTrack =
      screenMotionTrack ?? new ScreenMotionTrack(project.timeline.screenMotionClips);

    const activeZoomClip = resolvedZoomTrack.activeClip(sampleTime);
    const activeAutomaticClip =
      activeZoomClip && activeZoomClip.origin === 'automatic' ? activeZoomClip : null;

    const reanchorsAtCut = activeAutomaticClip
      ? (pointerTrack?.automaticEntryStartsAfterCut?.(activeAutomaticClip) ?? false)
      : false;

    const pointer =
      (reanchorsAtCut ? null : pointerEvaluation) ??
      pointerTrack?.evaluation(
        sampleTime,
        project.motion,
        project.cursorStyle,
        activeAutomaticClip
      ) ??
      makePointerTrackEvaluation({ position: null, cursor: null });

    const automaticCameraPosition = activeAutomaticClip
      ? pointerTrack?.automaticCameraFocus
        ? pointerTrack.automaticCameraFocus(sampleTime, activeAutomaticClip, project.motion)
        : activeAutomaticClip.focus
      : null;

    let inheritedAutomaticCameraPosition: NormalizedPoint | null = null;
    if (activeZoomClip) {
      const previous = resolvedZoomTrack.adjacentPreviousClip(activeZoomClip);
      if (previous && previous.origin === 'automatic') {
        inheritedAutomaticCameraPosition = pointerTrack?.automaticCameraFocus
          ? pointerTrack.automaticCameraFocus(previous.endTime, previous, project.motion)
          : previous.focus;
      }
    }

    const cameraAspect = cameraSourceSize
      ? max(cameraSourceSize.width, 1) / max(cameraSourceSize.height, 1)
      : null;

    const styleScale = CompositionSceneEvaluator.canonicalStyleScale(width, height);
    const geometry = CompositionSceneEvaluator.evaluate(
      project,
      sampleTime,
      width,
      height,
      sourceAspectRatio,
      cameraAspect,
      styleScale,
      automaticCameraPosition,
      inheritedAutomaticCameraPosition,
      reanchorsAtCut,
      resolvedZoomTrack,
      resolvedScreenTrack,
      cameraMotionTrack
    );

    const hasOpeningSticker = project.timeline.stickerClips.some(
      (clip) =>
        clip.timing.startTime <= 0.0001 &&
        clip.timing.startTime + clip.timing.duration > 0.0001
    );
    const hasOpeningCamera = Boolean(
      (project.media?.camera != null || cameraSourceSize != null) && !project.camera.isHidden
    );

    const availableOpeningElements = openingSequenceParticipatingElements(
      project.openingSequence,
      hasOpeningCamera,
      hasOpeningSticker
    );

    const screenOpening = openingSample(
      '屏幕',
      project.openingSequence,
      availableOpeningElements,
      sampleTime,
      width,
      height
    );

    const screenGeometry = { ...geometry.screen };
    screenGeometry.finalRect = openingRect(screenGeometry.finalRect, screenOpening);
    screenGeometry.finalCornerRadius *= screenOpening.scale;
    screenGeometry.finalBorderWidth *= screenOpening.scale;
    screenGeometry.rotationX += screenOpening.rotationX;
    screenGeometry.rotationY += screenOpening.rotationY;
    screenGeometry.perspective = min(
      max(screenGeometry.perspective + screenOpening.perspective, 0),
      2
    );

    const screenShadow: FrameShadow | null =
      project.canvas.shadowStrength > 0
        ? makeFrameShadow({
            color: HexColorBlack,
            opacity: project.canvas.shadowStrength,
            radius:
              22 *
              styleScale *
              screenGeometry.manualScale *
              screenGeometry.viewport.scale *
              screenOpening.scale,
            offset: makeCompositionPoint(
              0,
              12 *
                styleScale *
                screenGeometry.manualScale *
                screenGeometry.viewport.scale *
                screenOpening.scale
            ),
          })
        : null;

    const decoration = screenDecoration(
      project.canvas.screenFrame,
      project.canvas.screenFrameScale,
      project.canvas.screenFrameToolbarScale,
      project.canvas.screenFrameOuterCornerRadius,
      project.canvas.screenFrameContentCornerRadius,
      project.canvas.screenFrameTitle,
      project.canvas.screenFrameBrowserAddress,
      screenGeometry,
      styleScale,
      screenOpening.scale
    );

    const projectionRect = frameScreenDecorationProjectionRect(decoration) ?? screenGeometry.finalRect;
    const projectionAnchor = makeCompositionPoint(
      screenGeometry.finalRect.x +
        screenGeometry.finalRect.width * screenGeometry.projectionAnchor.x,
      screenGeometry.finalRect.y +
        screenGeometry.finalRect.height * screenGeometry.projectionAnchor.y
    );
    const projectedQuad = ScreenProjection.project(
      projectionRect,
      screenGeometry.rotationX,
      screenGeometry.rotationY,
      screenGeometry.rotationZ,
      screenGeometry.perspective,
      projectionAnchor
    );

    const activeMosaics: FrameMosaicScene[] = [];
    for (const clip of project.timeline.mosaicClips) {
      if (overlayTimingContains(clip.timing, sampleTime)) {
        activeMosaics.push(
          makeFrameMosaicScene({
            sourceRect: clip.sourceRect,
            cornerRadius: clip.cornerRadius,
            style: clip.style,
            intensity: clip.intensity,
            spotlightDimming: clip.spotlightDimming,
            transitionProgress: overlayEffectProgress(
              clip.timing,
              clip.transitionStyle,
              clip.transitionInDuration,
              clip.transitionOutDuration,
              sampleTime
            ),
          })
        );
      }
    }

    const screen = makeFrameScreenScene({
      sourceCrop: project.canvas.crop,
      fittedRect: screenGeometry.fittedRect,
      baseRect: screenGeometry.baseRect,
      finalRect: screenGeometry.finalRect,
      projectedQuad,
      cornerRadius: screenGeometry.finalCornerRadius,
      borderWidth: screenGeometry.finalBorderWidth,
      borderColor: project.canvas.borderColor,
      borderOpacity: project.canvas.insetOpacity,
      shadow: screenShadow,
      decoration,
      mosaics: activeMosaics,
      focusEffect: FocusEffectEvaluator.scene(
        activeZoomClip,
        resolvedScreenTrack.activeClip(sampleTime),
        geometry.screen.zoom.focus,
        project.canvas.crop,
        pointer.position,
        sampleTime,
        project.motion
      ),
      opacity: screenOpening.opacity,
    });

    let camera: FrameCameraScene | null = null;
    if (geometry.camera != null) {
      const evaluation = geometry.camera;
      const opening = openingSample(
        '摄像头',
        project.openingSequence,
        availableOpeningElements,
        sampleTime,
        width,
        height
      );
      const openingCameraRect = openingRect(evaluation.rect, opening);
      let contentFill: CameraContentFillLayout | null = null;
      if (cameraSourceSize != null) {
        const visualFocus = project.camera.contentPosition;
        contentFill = CameraContentFill.layout(
          cameraSourceSize.width,
          cameraSourceSize.height,
          openingCameraRect,
          makeNormalizedPoint(
            project.camera.isMirrored ? 1 - visualFocus.x : visualFocus.x,
            visualFocus.y
          ),
          project.camera.contentScale
        );
      }
      camera = makeFrameCameraScene({
        rect: openingCameraRect,
        contentFill,
        cornerRadius: evaluation.cornerRadius * opening.scale,
        borderWidth: evaluation.borderWidth * opening.scale,
        borderColor: HexColorWhite,
        shadow:
          project.camera.shadowStrength > 0
            ? makeFrameShadow({
                color: HexColorBlack,
                opacity: project.camera.shadowStrength,
                radius: 14 * styleScale,
                offset: makeCompositionPoint(0, 8 * styleScale),
              })
            : null,
        opacity: project.camera.isHidden ? 0 : evaluation.opacity * opening.opacity,
        isMirrored: project.camera.isMirrored,
      });
    }

    const cursor = cursorScene(
      pointer.cursor,
      project,
      cursorMetrics,
      cursorMetricsByAssetID,
      screen,
      makeCompositionSize(width, height)
    );

    const stickerSample = stickerScenes(
      stickerTrack ?? new StickerTransitionTrack(project.timeline.stickerClips),
      sampleTime,
      project.openingSequence.isEnabled &&
        project.openingSequence.includedElements.includes('贴图')
    );
    const stickerOpening = openingSample(
      '贴图',
      project.openingSequence,
      availableOpeningElements,
      sampleTime,
      width,
      height
    );
    const stickers = stickerSample.stickers.map((s) => ({
      ...s,
      offset: makeNormalizedPoint(
        s.offset.x + stickerOpening.offset.x / width,
        s.offset.y + stickerOpening.offset.y / height
      ),
      scale: s.scale * stickerOpening.scale,
      opacity: s.opacity * stickerOpening.opacity,
    }));

    const order: FrameLayerRole[] = ['background', 'screen'];
    if (cursor != null) {
      order.push('cursor');
    }
    if (
      screen.focusEffect != null ||
      activeMosaics.some((m) => m.style === 'spotlight')
    ) {
      order.push('spotlight');
    }
    if (camera != null && (camera.opacity ?? 0) > 0) {
      order.push('camera');
    }
    if (stickers.length > 0) {
      order.push('stickers');
    }

    return makeFrameScene({
      time: sampleTime,
      canvasSize: makeCompositionSize(width, height),
      color,
      background: makeFrameBackgroundScene({
        source: project.canvas.backgroundSource,
        blurRadius: project.canvas.backgroundBlur * styleScale,
        patternScale: project.canvas.patternScale,
        patternOpacity: project.canvas.patternOpacity,
      }),
      screen,
      camera,
      cursor,
      stickers,
      stickerBackdrop: stickerSample.backdrop,
      layerOrder: order,
    });
  },
});
