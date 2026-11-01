// Port of: F:\dogsc\Sources\RecorderCore\ProjectModel.swift (Part 1: lines 1-515)
import { clamp, max, min } from './swift.ts';
import type { ElementMotionCurve } from './ElementMotion.ts';

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
        msg = `项目版本 ${found} 来自更新的应用；当前应用只支持到版本 ${extra?.expected ?? 27}，为避免损坏项目已停止打开。`;
        break;
      case 'refusingToEncodeUnsupportedVersion':
        msg = `拒绝写入项目版本 ${found}；可写入版本范围为 ${extra?.supportedRange?.[0] ?? 23}...${extra?.supportedRange?.[1] ?? 27}。`;
        break;
      case 'refusingToEncodeFutureVersion':
        msg = `拒绝用当前应用覆盖未来项目版本 ${found}；当前应用只支持到版本 ${extra?.expected ?? 27}。`;
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
  currentVersion: 27,

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

export type DynamicBackgroundPreset = '赛博微流网格' | '星辉漫步点阵' | '极光流体星云';

export const DynamicBackgroundPresetAllCases: readonly DynamicBackgroundPreset[] = Object.freeze([
  '赛博微流网格',
  '星辉漫步点阵',
  '极光流体星云',
]);

export function dynamicBackgroundPresetDisplayName(preset: DynamicBackgroundPreset): string {
  switch (preset) {
    case '赛博微流网格':
      return '流金缓移网格';
    case '星辉漫步点阵':
      return '暖星漫步点阵';
    case '极光流体星云':
      return '蓝白流体云幕';
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
