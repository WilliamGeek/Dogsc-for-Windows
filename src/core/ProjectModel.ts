// Port of: F:\dogsc\Sources\RecorderCore\ProjectModel.swift
import { clamp, max, min } from './swift.ts';
import type { ElementMotionCurve } from './ElementMotion.ts';
import { HexColorWhite, hexColorFromJSON, makeHexColor, type HexColor } from './HexColor.ts';
import {
  type CanvasCustomAspectRatio,
  makeCanvasCustomAspectRatio,
  canvasStyleResolvedFixedAspectRatio,
} from './CanvasCustomAspectRatio.ts';
import type { NormalizedPoint, ZoomEasingPreset } from './ZoomAnimation.ts';
import type { ScreenMotionCreationStyle } from './ScreenMotionCreationStyle.ts';
import { type CameraBeautySettings, makeCameraBeautySettings } from './CameraBeauty.ts';

// ---------------------------------------------------------------------------
// ProjectSchema & ProjectSchemaError
// ---------------------------------------------------------------------------
export class ProjectSchemaError extends Error {
  readonly code:
    | 'unsupportedLegacyVersion'
    | 'unsupportedFutureVersion'
    | 'refusingToEncodeUnsupportedVersion'
    | 'refusingToEncodeFutureVersion';
  readonly found: number;
  readonly expected?: number;
  readonly supportedRange?: [number, number];

  constructor(
    code:
      | 'unsupportedLegacyVersion'
      | 'unsupportedFutureVersion'
      | 'refusingToEncodeUnsupportedVersion'
      | 'refusingToEncodeFutureVersion',
    found: number,
    extra?: { expected?: number; supportedRange?: [number, number] },
  ) {
    let msg: string;
    switch (code) {
      case 'unsupportedLegacyVersion':
        msg = `项目版本 ${found} 过旧；当前应用最低支持版本 ${extra?.expected ?? 23}。`;
        break;
      case 'unsupportedFutureVersion':
        msg = `项目版本 ${found} 来自更新的应用；当前应用只支持到版本 ${extra?.expected ?? 28}，为避免损坏项目已停止打开。`;
        break;
      case 'refusingToEncodeUnsupportedVersion':
        msg = `拒绝写入项目版本 ${found}；可写入版本范围为 ${extra?.supportedRange?.[0] ?? 23}...${extra?.supportedRange?.[1] ?? 28}。`;
        break;
      case 'refusingToEncodeFutureVersion':
        msg = `拒绝用当前应用覆盖未来项目版本 ${found}；当前应用只支持到版本 ${extra?.expected ?? 28}。`;
        break;
    }
    super(msg);
    this.name = 'ProjectSchemaError';
    this.code = code;
    this.found = found;
    this.expected = extra?.expected;
    this.supportedRange = extra?.supportedRange;
  }
}

export const ProjectSchema = Object.freeze({
  minimumSupportedVersion: 23,
  // Version 28 adds independent recording sources and source-aware segments/markers.
  currentVersion: 28,

  validateForDecoding(version: number): void {
    if (version < ProjectSchema.minimumSupportedVersion) {
      throw new ProjectSchemaError('unsupportedLegacyVersion', version, {
        expected: ProjectSchema.minimumSupportedVersion,
      });
    }
    if (version > ProjectSchema.currentVersion) {
      throw new ProjectSchemaError('unsupportedFutureVersion', version, {
        expected: ProjectSchema.currentVersion,
      });
    }
  },

  validateForEncoding(version: number): void {
    if (version < ProjectSchema.minimumSupportedVersion) {
      throw new ProjectSchemaError('refusingToEncodeUnsupportedVersion', version, {
        supportedRange: [ProjectSchema.minimumSupportedVersion, ProjectSchema.currentVersion],
      });
    }
    if (version > ProjectSchema.currentVersion) {
      throw new ProjectSchemaError('refusingToEncodeFutureVersion', version, {
        expected: ProjectSchema.currentVersion,
      });
    }
  },
});

// ---------------------------------------------------------------------------
// CanvasAspectRatio
// ---------------------------------------------------------------------------
export type CanvasAspectRatio =
  | '适应'
  | '16:9'
  | '4:3'
  | '9:16'
  | '1:1'
  | '3:4'
  | '2.39:1'
  | '1:2.39'
  | '自定义';

export const CanvasAspectRatioAllCases: readonly CanvasAspectRatio[] = Object.freeze([
  '适应',
  '16:9',
  '4:3',
  '9:16',
  '1:1',
  '3:4',
  '2.39:1',
  '1:2.39',
  '自定义',
]);

// ---------------------------------------------------------------------------
// CanvasResolution
// ---------------------------------------------------------------------------
export type CanvasResolution = '原始素材' | '1080p' | '1440p' | '4K';

export const CanvasResolutionAllCases: readonly CanvasResolution[] = Object.freeze([
  '原始素材',
  '1080p',
  '1440p',
  '4K',
]);

export function canvasResolutionPresetEdges(
  res: CanvasResolution,
): { short: number; long: number } | null {
  switch (res) {
    case '原始素材':
      return null;
    case '1080p':
      return { short: 1080, long: 1920 };
    case '1440p':
      return { short: 1440, long: 2560 };
    case '4K':
      return { short: 2160, long: 3840 };
  }
}

// ---------------------------------------------------------------------------
// ScreenFrameStyle
// ---------------------------------------------------------------------------
export type ScreenFrameStyle =
  | 'none'
  | 'windowLight'
  | 'windowDark'
  | 'browserLight'
  | 'browserDark'
  | 'devicePhone'
  | 'deviceTablet'
  | 'devicePhonePortrait'
  | 'devicePhoneLandscape'
  | 'deviceTabletPortrait'
  | 'deviceTabletLandscape';

export const ScreenFrameStyleAllCases: readonly ScreenFrameStyle[] = Object.freeze([
  'none',
  'windowLight',
  'windowDark',
  'browserLight',
  'browserDark',
  'devicePhone',
  'deviceTablet',
]);

export function screenFrameStyleIsDeviceFrame(style: ScreenFrameStyle): boolean {
  switch (style) {
    case 'devicePhone':
    case 'deviceTablet':
    case 'devicePhonePortrait':
    case 'devicePhoneLandscape':
    case 'deviceTabletPortrait':
    case 'deviceTabletLandscape':
      return true;
    default:
      return false;
  }
}

export function screenFrameStyleIsBrowserFrame(style: ScreenFrameStyle): boolean {
  return style === 'browserLight' || style === 'browserDark';
}

export function screenFrameStyleIsWindowFrame(style: ScreenFrameStyle): boolean {
  return style === 'windowLight' || style === 'windowDark';
}

export function screenFrameStyleFromJSON(rawValue: string): ScreenFrameStyle {
  switch (rawValue) {
    case 'none':
      return 'none';
    case 'windowLight':
      return 'windowLight';
    case 'windowDark':
      return 'windowDark';
    case 'browserLight':
      return 'browserLight';
    case 'browserDark':
      return 'browserDark';
    case 'paperWhite':
    case 'graphite':
      return 'none';
    case 'devicePhone':
      return 'devicePhone';
    case 'deviceTablet':
      return 'deviceTablet';
    case 'devicePhonePortrait':
      return 'devicePhonePortrait';
    case 'devicePhoneLandscape':
      return 'devicePhoneLandscape';
    case 'deviceTabletPortrait':
      return 'deviceTabletPortrait';
    case 'deviceTabletLandscape':
      return 'deviceTabletLandscape';
    case 'cyberNeon':
    case 'titaniumBevel':
    case 'studioRim':
      return 'windowDark';
    case 'frostedGlass':
    case 'vintageMac':
    case 'galleryArt':
      return 'windowLight';
    default:
      throw new Error(`Unsupported screen frame style: ${rawValue}`);
  }
}

// ---------------------------------------------------------------------------
// OpeningSequence
// ---------------------------------------------------------------------------
export type OpeningSequencePreset = '聚拢' | '侧滑' | '轻 3D';
export const OpeningSequencePresetAllCases: readonly OpeningSequencePreset[] = Object.freeze([
  '聚拢',
  '侧滑',
  '轻 3D',
]);

export type OpeningSequenceElement = '屏幕' | '摄像头' | '贴图';
export const OpeningSequenceElementAllCases: readonly OpeningSequenceElement[] = Object.freeze([
  '屏幕',
  '摄像头',
  '贴图',
]);

export interface OpeningSequence {
  isEnabled: boolean;
  preset: OpeningSequencePreset;
  motionCurve: ElementMotionCurve;
  duration: number;
  stagger: number;
  includedElements: OpeningSequenceElement[];
  elementOrder: OpeningSequenceElement[];
}

export const OPENING_SEQUENCE_MINIMUM_ELEMENT_DURATION = 0.18;

function normalizeOpeningElements(
  elements: readonly OpeningSequenceElement[],
  appendingMissing: boolean,
): OpeningSequenceElement[] {
  const seen = new Set<OpeningSequenceElement>();
  const result: OpeningSequenceElement[] = [];
  for (const el of elements) {
    if (!seen.has(el)) {
      seen.add(el);
      result.push(el);
    }
  }
  if (appendingMissing) {
    for (const el of OpeningSequenceElementAllCases) {
      if (!seen.has(el)) {
        seen.add(el);
        result.push(el);
      }
    }
  }
  return result;
}

export function openingSequenceMaximumStagger(
  duration: number,
  elementCount: number,
): number {
  const gapCount = max(elementCount - 1, 0);
  if (gapCount <= 0) return 1.2;
  return min(1.2, max(duration - OPENING_SEQUENCE_MINIMUM_ELEMENT_DURATION, 0) / gapCount);
}

export function makeOpeningSequence(options: Partial<OpeningSequence> = {}): OpeningSequence {
  const isEnabled = options.isEnabled ?? false;
  const preset = options.preset ?? '轻 3D';
  const motionCurve = options.motionCurve ?? 'swift';
  const rawDuration = options.duration ?? 2.2;
  const duration = clamp(Number.isFinite(rawDuration) ? rawDuration : 2.2, 0.4, 8);

  const includedElements = normalizeOpeningElements(
    options.includedElements ?? OpeningSequenceElementAllCases,
    false,
  );
  const elementOrder = normalizeOpeningElements(
    options.elementOrder ?? ['屏幕', '摄像头', '贴图'],
    true,
  );

  const rawStagger = options.stagger ?? 0.16;
  const maxStagger = openingSequenceMaximumStagger(duration, includedElements.length);
  const stagger = clamp(Number.isFinite(rawStagger) ? rawStagger : 0.16, 0, maxStagger);

  return {
    isEnabled,
    preset,
    motionCurve,
    duration,
    stagger,
    includedElements,
    elementOrder,
  };
}

export function openingSequenceAvailableElements(
  seq: OpeningSequence,
  hasCamera: boolean,
  hasOpeningSticker: boolean,
): OpeningSequenceElement[] {
  return seq.elementOrder.filter((el) => {
    switch (el) {
      case '屏幕':
        return true;
      case '摄像头':
        return hasCamera;
      case '贴图':
        return hasOpeningSticker;
    }
  });
}

export function openingSequenceParticipatingElements(
  seq: OpeningSequence,
  hasCamera: boolean,
  hasOpeningSticker: boolean,
): OpeningSequenceElement[] {
  const included = new Set(seq.includedElements);
  return openingSequenceAvailableElements(seq, hasCamera, hasOpeningSticker).filter((el) =>
    included.has(el),
  );
}

// ---------------------------------------------------------------------------
// Background presets & BackgroundSource
// ---------------------------------------------------------------------------
export type BackgroundPatternPreset =
  | '黑曜石网格'
  | '工程白网格'
  | '暗夜星阵'
  | '建筑极简点'
  | '立体等角网';

export const BackgroundPatternPresetAllCases: readonly BackgroundPatternPreset[] = Object.freeze([
  '黑曜石网格',
  '工程白网格',
  '暗夜星阵',
  '建筑极简点',
  '立体等角网',
]);

export function backgroundPatternPresetDisplayName(preset: BackgroundPatternPreset): string {
  switch (preset) {
    case '黑曜石网格':
      return '深色网格';
    case '工程白网格':
      return '浅色网格';
    case '暗夜星阵':
      return '深色点阵';
    case '建筑极简点':
      return '浅色点阵';
    case '立体等角网':
      return '等角网格';
  }
}

export type DynamicBackgroundPreset = '赛博微流网格' | '星辉漫步点阵' | '极光流体星云';

export const DynamicBackgroundPresetAllCases: readonly DynamicBackgroundPreset[] = Object.freeze([
  '赛博微流网格',
  '星辉漫步点阵',
  '极光流体星云',
]);

export function dynamicBackgroundPresetDisplayName(preset: DynamicBackgroundPreset): string {
  switch (preset) {
    case '赛博微流网格':
      return '流动网格';
    case '星辉漫步点阵':
      return '流动点阵';
    case '极光流体星云':
      return '流体渐变';
  }
}

export function dynamicBackgroundPresetFromJSON(rawValue: string): DynamicBackgroundPreset {
  if (rawValue === '旋转十字星阵') {
    return '赛博微流网格';
  }
  if (
    rawValue === '赛博微流网格' ||
    rawValue === '星辉漫步点阵' ||
    rawValue === '极光流体星云'
  ) {
    return rawValue;
  }
  throw new Error(`Unsupported dynamic background preset: ${rawValue}`);
}

export type BackgroundSource =
  | { kind: 'pattern'; preset: BackgroundPatternPreset }
  | { kind: 'dynamicFlow'; preset: DynamicBackgroundPreset }
  | { kind: 'projectImage'; relativePath: string }
  | { kind: 'systemImage'; absolutePath: string }
  | { kind: 'projectVideo'; relativePath: string }
  | { kind: 'systemVideo'; absolutePath: string };

export const BackgroundSourceSafeFallback: BackgroundSource = Object.freeze({
  kind: 'pattern',
  preset: '黑曜石网格',
});

export function backgroundSourceIsImage(source: BackgroundSource): boolean {
  return source.kind === 'projectImage' || source.kind === 'systemImage';
}

export function backgroundSourceIsVideo(source: BackgroundSource): boolean {
  return source.kind === 'projectVideo' || source.kind === 'systemVideo';
}

export function backgroundSourceUsesWallpaperMedia(source: BackgroundSource): boolean {
  return backgroundSourceIsImage(source) || backgroundSourceIsVideo(source);
}

// ---------------------------------------------------------------------------
// CameraShape, ScreenMotionStyle, CursorMotionStyle, CursorAppearance
// ---------------------------------------------------------------------------
export type CameraShape = '方形' | '横向' | '纵向' | '原始比例' | '圆形';

export const CameraShapeAllCases: readonly CameraShape[] = Object.freeze([
  '方形',
  '横向',
  '纵向',
  '原始比例',
  '圆形',
]);

export function cameraShapeFromJSON(value: string): CameraShape {
  switch (value) {
    case '圆角矩形':
      return '横向';
    case '连续圆角':
      return '方形';
    case '方形':
    case '横向':
    case '纵向':
    case '原始比例':
    case '圆形':
      return value;
    default:
      return '方形';
  }
}

export type ScreenMotionStyle = '聚焦' | '平滑';
export const ScreenMotionStyleAllCases: readonly ScreenMotionStyle[] = Object.freeze([
  '聚焦',
  '平滑',
]);

export type CursorMotionStyle = '平滑' | '适中' | '快速' | '无';
export const CursorMotionStyleAllCases: readonly CursorMotionStyle[] = Object.freeze([
  '平滑',
  '适中',
  '快速',
  '无',
]);

export type CursorAppearance = '系统箭头' | '指向手势' | '十字准星' | '隐藏';
export const CursorAppearanceAllCases: readonly CursorAppearance[] = Object.freeze([
  '系统箭头',
  '指向手势',
  '十字准星',
  '隐藏',
]);

// ---------------------------------------------------------------------------
// CursorAssetID
// ---------------------------------------------------------------------------
export type CursorAssetID = string;

export const CursorAssetIDConstants = Object.freeze({
  systemArrow: 'system.arrow',
  automatic: 'system.automatic',
  systemPointingHand: 'system.pointing-hand',
  systemCrosshair: 'system.crosshair',
  systemIBeam: 'system.ibeam',
  systemOpenHand: 'system.open-hand',
  systemClosedHand: 'system.closed-hand',
  systemNotAllowed: 'system.not-allowed',
  touchDot: 'system.touch-dot',
  hidden: 'system.hidden',
  // Retired styles mapped to system arrow
  classicLavender: 'cursor.classic-lavender',
  violetGlass: 'cursor.violet-glass',
  graphiteIvory: 'cursor.graphite-ivory',
  creamCoral: 'cursor.cream-coral',
});

// ---------------------------------------------------------------------------
// CursorClickEffectStyle
// ---------------------------------------------------------------------------
export type CursorClickEffectStyle = 'ripple' | 'glow' | 'pulse' | 'burst' | 'none';

export const CursorClickEffectStyleAllCases: readonly CursorClickEffectStyle[] = Object.freeze([
  'ripple',
  'glow',
  'pulse',
  'burst',
  'none',
]);

export function cursorClickEffectStyleDisplayName(style: CursorClickEffectStyle): string {
  switch (style) {
    case 'ripple':
      return '涟漪扩散';
    case 'glow':
      return '柔和光晕';
    case 'pulse':
      return '弹性双环';
    case 'burst':
      return '聚焦微闪';
    case 'none':
      return '无效果';
  }
}

export function cursorClickEffectStyleDuration(style: CursorClickEffectStyle): number {
  switch (style) {
    case 'ripple':
      return 0.36;
    case 'glow':
      return 0.32;
    case 'pulse':
      return 0.38;
    case 'burst':
      return 0.22;
    case 'none':
      return 0.0;
  }
}

// ---------------------------------------------------------------------------
// CursorStyle
// ---------------------------------------------------------------------------
function parseHexColorOption(value: unknown): HexColor | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return hexColorFromJSON(value);
  if (typeof value === 'object' && typeof (value as { rgb24?: unknown }).rgb24 === 'number') {
    return makeHexColor((value as { rgb24: number }).rgb24);
  }
  throw new Error('Expected #RRGGBB string or HexColor object');
}

export interface CursorStyle {
  assetID: CursorAssetID;
  size: number;
  hideWhenIdle: boolean;
  idleDelay: number;
  clickEffectStyle: CursorClickEffectStyle;
  clickColor: HexColor | null;
  clickOpacity: number;
  clickScale: number;
  motionTiltStrength: number;
  pressesOnClick: boolean;
}

export function makeCursorStyle(options: Partial<CursorStyle> = {}): CursorStyle {
  const rawAssetID = options.assetID ?? CursorAssetIDConstants.automatic;
  const assetID = rawAssetID.trim().length === 0 ? CursorAssetIDConstants.systemArrow : rawAssetID;
  const rawSize = options.size ?? 1.25;
  const size = clamp(Number.isFinite(rawSize) ? rawSize : 1.25, 0.25, 6);
  const hideWhenIdle = options.hideWhenIdle ?? false;
  const rawIdleDelay = options.idleDelay ?? 1.2;
  const idleDelay = clamp(Number.isFinite(rawIdleDelay) ? rawIdleDelay : 1.2, 0.2, 8);
  const clickEffectStyle = options.clickEffectStyle ?? 'ripple';
  const clickColor = parseHexColorOption(options.clickColor);
  const rawClickOpacity = options.clickOpacity ?? 0.8;
  const clickOpacity = clamp(Number.isFinite(rawClickOpacity) ? rawClickOpacity : 0.8, 0.05, 1.0);
  const rawClickScale = options.clickScale ?? 1.0;
  const clickScale = clamp(Number.isFinite(rawClickScale) ? rawClickScale : 1.0, 0.4, 3.0);
  const rawMotionTilt = options.motionTiltStrength ?? 2.0;
  const motionTiltStrength = clamp(Number.isFinite(rawMotionTilt) ? rawMotionTilt : 2.0, 2, 4);
  const pressesOnClick = options.pressesOnClick ?? true;

  return {
    assetID,
    size,
    hideWhenIdle,
    idleDelay,
    clickEffectStyle,
    clickColor,
    clickOpacity,
    clickScale,
    motionTiltStrength,
    pressesOnClick,
  };
}

export function cursorStyleShowsClickEffect(style: CursorStyle): boolean {
  return style.clickEffectStyle !== 'none';
}

export function cursorStyleSetShowsClickEffect(
  style: CursorStyle,
  showsClickEffect: boolean,
): CursorStyle {
  if (!showsClickEffect) {
    return { ...style, clickEffectStyle: 'none' };
  } else if (style.clickEffectStyle === 'none') {
    return { ...style, clickEffectStyle: 'ripple' };
  }
  return style;
}

export function cursorStyleAssetIDForAppearance(appearance: CursorAppearance): CursorAssetID {
  switch (appearance) {
    case '系统箭头':
      return CursorAssetIDConstants.systemArrow;
    case '指向手势':
      return CursorAssetIDConstants.systemPointingHand;
    case '十字准星':
      return CursorAssetIDConstants.systemCrosshair;
    case '隐藏':
      return CursorAssetIDConstants.hidden;
  }
}

export function cursorStyleAppearance(style: CursorStyle): CursorAppearance {
  switch (style.assetID) {
    case CursorAssetIDConstants.systemPointingHand:
      return '指向手势';
    case CursorAssetIDConstants.systemCrosshair:
      return '十字准星';
    case CursorAssetIDConstants.hidden:
      return '隐藏';
    default:
      return '系统箭头';
  }
}

// ---------------------------------------------------------------------------
// NormalizedCrop
// ---------------------------------------------------------------------------
export interface NormalizedCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function makeNormalizedCrop(
  x: number = 0,
  y: number = 0,
  width: number = 1,
  height: number = 1,
): NormalizedCrop {
  return { x, y, width, height };
}

export const NormalizedCropFull: NormalizedCrop = Object.freeze(makeNormalizedCrop(0, 0, 1, 1));

export function normalizedCropLeft(crop: NormalizedCrop): number {
  return crop.x;
}
export function normalizedCropTop(crop: NormalizedCrop): number {
  return crop.y;
}
export function normalizedCropRight(crop: NormalizedCrop): number {
  return 1 - crop.x - crop.width;
}
export function normalizedCropBottom(crop: NormalizedCrop): number {
  return 1 - crop.y - crop.height;
}

export function normalizedCropClamped(
  crop: NormalizedCrop,
  minimumSize: number = 0.02,
): NormalizedCrop {
  const minimum = clamp(Number.isFinite(minimumSize) ? minimumSize : 0.02, 0.001, 1);
  const safeX = clamp(crop.x, 0, 1 - minimum);
  const safeY = clamp(crop.y, 0, 1 - minimum);
  return {
    x: safeX,
    y: safeY,
    width: clamp(crop.width, minimum, 1 - safeX),
    height: clamp(crop.height, minimum, 1 - safeY),
  };
}

export function normalizedCropFromEdges(
  left: number,
  right: number,
  top: number,
  bottom: number,
  minimumSize: number = 0.02,
): NormalizedCrop {
  const minimum = clamp(Number.isFinite(minimumSize) ? minimumSize : 0.02, 0.001, 1);
  const safeLeft = clamp(left, 0, 1 - minimum);
  const safeTop = clamp(top, 0, 1 - minimum);
  const safeRight = clamp(right, 0, 1 - safeLeft - minimum);
  const safeBottom = clamp(bottom, 0, 1 - safeTop - minimum);
  return {
    x: safeLeft,
    y: safeTop,
    width: 1 - safeLeft - safeRight,
    height: 1 - safeTop - safeBottom,
  };
}

// ---------------------------------------------------------------------------
// CanvasDimensions & CanvasStyle
// ---------------------------------------------------------------------------
export interface CanvasDimensions {
  width: number;
  height: number;
}

export function makeCanvasDimensions(width: number, height: number): CanvasDimensions {
  return { width: Math.trunc(width), height: Math.trunc(height) };
}

export interface CanvasStyle {
  aspectRatio: CanvasAspectRatio;
  customAspectRatio: CanvasCustomAspectRatio;
  backgroundSource: BackgroundSource;
  padding: number;
  contentScale: number;
  contentPosition: NormalizedPoint;
  crop: NormalizedCrop;
  cornerRadius: number;
  borderWidth: number;
  borderColor: HexColor;
  shadowStrength: number;
  backgroundBlur: number;
  insetOpacity: number;
  screenFrame: ScreenFrameStyle;
  screenFrameScale: number;
  screenFrameToolbarScale: number;
  screenFrameOuterCornerRadius: number | null;
  screenFrameContentCornerRadius: number | null;
  screenFrameTitle: string;
  screenFrameBrowserAddress: string;
  patternScale: number;
  patternOpacity: number;
}

export function makeCanvasStyle(options: Partial<CanvasStyle> = {}): CanvasStyle {
  const aspectRatio = options.aspectRatio ?? '适应';
  const customAspectRatio = options.customAspectRatio ?? makeCanvasCustomAspectRatio();
  const backgroundSource = options.backgroundSource ?? BackgroundSourceSafeFallback;
  const padding = options.padding ?? 100;
  const contentScale = options.contentScale ?? 1;
  const contentPosition = options.contentPosition ?? { x: 0.5, y: 0.5 };
  const crop = normalizedCropClamped(options.crop ?? NormalizedCropFull);
  const cornerRadius = options.cornerRadius ?? 24;
  const borderWidth = options.borderWidth ?? 0;
  const borderColor = parseHexColorOption(options.borderColor) ?? HexColorWhite;
  const shadowStrength = options.shadowStrength ?? 0.28;
  const backgroundBlur = options.backgroundBlur ?? 0;
  const insetOpacity = options.insetOpacity ?? 0.125;
  const screenFrame = options.screenFrame ?? 'none';
  const rawFrameScale = options.screenFrameScale ?? 1;
  const screenFrameScale = clamp(rawFrameScale, 0.6, 1.6);
  const rawToolbarScale = options.screenFrameToolbarScale ?? 1;
  const screenFrameToolbarScale = clamp(rawToolbarScale, 0.65, 1.6);
  const screenFrameOuterCornerRadius =
    options.screenFrameOuterCornerRadius !== undefined &&
    options.screenFrameOuterCornerRadius !== null
      ? clamp(options.screenFrameOuterCornerRadius, 0, 160)
      : null;
  const screenFrameContentCornerRadius =
    options.screenFrameContentCornerRadius !== undefined &&
    options.screenFrameContentCornerRadius !== null
      ? clamp(options.screenFrameContentCornerRadius, 0, 160)
      : null;
  const screenFrameTitle = (options.screenFrameTitle ?? '').slice(0, 120);
  const screenFrameBrowserAddress = (options.screenFrameBrowserAddress ?? '').slice(0, 240);
  const rawPatternScale = options.patternScale ?? 1;
  const patternScale = clamp(rawPatternScale, 0.4, 6.0);
  const rawPatternOpacity = options.patternOpacity ?? 1;
  const patternOpacity = clamp(rawPatternOpacity, 0.0, 1.0);

  return {
    aspectRatio,
    customAspectRatio,
    backgroundSource,
    padding,
    contentScale,
    contentPosition,
    crop,
    cornerRadius,
    borderWidth,
    borderColor,
    shadowStrength,
    backgroundBlur,
    insetOpacity,
    screenFrame,
    screenFrameScale,
    screenFrameToolbarScale,
    screenFrameOuterCornerRadius,
    screenFrameContentCornerRadius,
    screenFrameTitle,
    screenFrameBrowserAddress,
    patternScale,
    patternOpacity,
  };
}

function evenDouble(value: number): number {
  return max(Math.round(value / 2) * 2, 2);
}

function evenInt(value: number): number {
  return max(value - (value % 2), 2);
}

function canvasStyleSourcePixelDimensions(
  style: CanvasStyle,
  sourcePixelSize?: CanvasDimensions | null,
): CanvasDimensions {
  const source = sourcePixelSize ?? { width: 1920, height: 1080 };
  const crop = normalizedCropClamped(style.crop);
  const croppedWidth = max(source.width * crop.width, 2);
  const croppedHeight = max(source.height * crop.height, 2);

  if (style.aspectRatio === '适应') {
    return {
      width: evenDouble(croppedWidth),
      height: evenDouble(croppedHeight),
    };
  }

  const targetRatio =
    canvasStyleResolvedFixedAspectRatio(style) ?? croppedWidth / croppedHeight;

  if (croppedWidth / croppedHeight >= targetRatio) {
    return {
      width: evenDouble(croppedHeight * targetRatio),
      height: evenDouble(croppedHeight),
    };
  }
  return {
    width: evenDouble(croppedWidth),
    height: evenDouble(croppedWidth / targetRatio),
  };
}

export function canvasStylePixelDimensions(
  style: CanvasStyle,
  resolution: CanvasResolution,
  sourceAspectRatio?: number | null,
  sourcePixelSize?: CanvasDimensions | null,
): CanvasDimensions {
  if (resolution === '原始素材') {
    return canvasStyleSourcePixelDimensions(style, sourcePixelSize);
  }
  const preset = canvasResolutionPresetEdges(resolution);
  if (preset === null) {
    return canvasStyleSourcePixelDimensions(style, sourcePixelSize);
  }
  const shortEdge = preset.short;
  switch (style.aspectRatio) {
    case '适应': {
      const ratio = clamp(sourceAspectRatio ?? 16.0 / 9.0, 0.2, 5);
      const longEdge = preset.long;
      if (ratio >= 1) {
        return {
          width: evenInt(longEdge),
          height: evenDouble(longEdge / ratio),
        };
      }
      return {
        width: evenDouble(longEdge * ratio),
        height: evenInt(longEdge),
      };
    }
    case '16:9':
      return {
        width: Math.trunc((shortEdge * 16) / 9),
        height: shortEdge,
      };
    case '4:3':
      return {
        width: Math.trunc((shortEdge * 4) / 3),
        height: shortEdge,
      };
    case '9:16':
      return {
        width: shortEdge,
        height: Math.trunc((shortEdge * 16) / 9),
      };
    case '1:1':
      return {
        width: shortEdge,
        height: shortEdge,
      };
    case '3:4':
      return {
        width: shortEdge,
        height: Math.trunc((shortEdge * 4) / 3),
      };
    case '2.39:1':
    case '1:2.39':
    case '自定义': {
      const ratio = canvasStyleResolvedFixedAspectRatio(style) ?? 1;
      const long = preset.long;
      return ratio >= 1
        ? { width: evenDouble(long), height: evenDouble(long / ratio) }
        : { width: evenDouble(long * ratio), height: evenDouble(long) };
    }
  }
}

// ---------------------------------------------------------------------------
// AudioStyle
// ---------------------------------------------------------------------------
export interface AudioStyle {
  isSystemMuted: boolean;
  isMicrophoneMuted: boolean;
  systemVolume: number;
  microphoneVolume: number;
}

export function makeAudioStyle(options: Partial<AudioStyle> = {}): AudioStyle {
  const isSystemMuted = options.isSystemMuted ?? false;
  const isMicrophoneMuted = options.isMicrophoneMuted ?? false;
  const rawSystemVolume = options.systemVolume ?? 0.82;
  const systemVolume = clamp(Number.isFinite(rawSystemVolume) ? rawSystemVolume : 0.82, 0, 1);
  const rawMicrophoneVolume = options.microphoneVolume ?? 0.9;
  const microphoneVolume = clamp(
    Number.isFinite(rawMicrophoneVolume) ? rawMicrophoneVolume : 0.9,
    0,
    1,
  );
  return {
    isSystemMuted,
    isMicrophoneMuted,
    systemVolume,
    microphoneVolume,
  };
}

// ---------------------------------------------------------------------------
// CameraStyle
// ---------------------------------------------------------------------------
export interface CameraStyle {
  shape: CameraShape;
  position: NormalizedPoint;
  size: number;
  borderWidth: number;
  shadowStrength: number;
  roundness: number;
  isMirrored: boolean;
  isHidden: boolean;
  scaleDuringZoom: number;
  contentPosition: NormalizedPoint;
  contentScale: number;
  beauty: CameraBeautySettings;
}

export function makeCameraStyle(options: Partial<CameraStyle> = {}): CameraStyle {
  const shape = options.shape ?? '方形';
  const position = options.position ?? { x: 0.96, y: 0.47 };
  const size = options.size ?? 0.29;
  const borderWidth = options.borderWidth ?? 3;
  const shadowStrength = options.shadowStrength ?? 0.25;
  const roundness = options.roundness ?? 0.5;
  const isMirrored = options.isMirrored ?? true;
  const isHidden = options.isHidden ?? false;
  const scaleDuringZoom = options.scaleDuringZoom ?? 0.7;
  const contentPosition = options.contentPosition ?? { x: 0.5, y: 0.5 };
  const contentScale = options.contentScale ?? 1;
  const beauty = options.beauty
    ? makeCameraBeautySettings(options.beauty)
    : makeCameraBeautySettings();

  return {
    shape,
    position,
    size,
    borderWidth,
    shadowStrength,
    roundness,
    isMirrored,
    isHidden,
    scaleDuringZoom,
    contentPosition,
    contentScale,
    beauty,
  };
}

// ---------------------------------------------------------------------------
// MotionStyle
// ---------------------------------------------------------------------------
export interface MotionStyle {
  screen: ScreenMotionStyle;
  cursor: CursorMotionStyle;
  screenSpringMass: number;
  screenSpringStiffness: number;
  screenSpringDamping: number;
  cursorSpringMass: number;
  cursorSpringStiffness: number;
  cursorSpringDamping: number;
  defaultZoomEasing: ZoomEasingPreset;
  defaultZoomTransitionDuration: number;
  defaultZoomScale: number | null;
  defaultScreenMotion: ScreenMotionCreationStyle | null;
}

export function makeMotionStyle(options: Partial<MotionStyle> = {}): MotionStyle {
  const screen = options.screen ?? '聚焦';
  const cursor = options.cursor ?? '平滑';
  const screenSpringMass = options.screenSpringMass ?? 2.4;
  const screenSpringStiffness = options.screenSpringStiffness ?? 210;
  const screenSpringDamping = options.screenSpringDamping ?? 42;
  const cursorSpringMass = options.cursorSpringMass ?? 2.8;
  const cursorSpringStiffness = options.cursorSpringStiffness ?? 450;
  const cursorSpringDamping = options.cursorSpringDamping ?? 66;
  const defaultZoomEasing = options.defaultZoomEasing ?? ('弹簧' as ZoomEasingPreset);
  const rawDuration = options.defaultZoomTransitionDuration ?? 0.7;
  const defaultZoomTransitionDuration = clamp(
    Number.isFinite(rawDuration) ? rawDuration : 0.7,
    0,
    5,
  );
  const defaultZoomScale = options.defaultZoomScale ?? null;
  const defaultScreenMotion = options.defaultScreenMotion ?? null;

  return {
    screen,
    cursor,
    screenSpringMass,
    screenSpringStiffness,
    screenSpringDamping,
    cursorSpringMass,
    cursorSpringStiffness,
    cursorSpringDamping,
    defaultZoomEasing,
    defaultZoomTransitionDuration,
    defaultZoomScale,
    defaultScreenMotion,
  };
}


