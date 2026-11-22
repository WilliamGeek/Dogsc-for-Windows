// Port of: F:\dogsc-v0.2.0\Sources\RecorderCore\ExportSettings.swift
import { max } from './swift.ts';
import type { OutputFrameRate } from './CaptureConfiguration.ts';
import {
  type CanvasDimensions,
  type CanvasResolution,
  makeCanvasDimensions,
} from './ProjectModel.ts';

export type ExportVideoCodec = 'h264' | 'hevc';

export const ExportVideoCodecAllCases: readonly ExportVideoCodec[] = Object.freeze([
  'h264',
  'hevc',
]);

export function exportVideoCodecDisplayName(codec: ExportVideoCodec): string {
  switch (codec) {
    case 'h264':
      return 'H.264';
    case 'hevc':
      return 'HEVC';
  }
}

export type ExportQuality = 'compact' | 'high' | 'maximum';

export const ExportQualityAllCases: readonly ExportQuality[] = Object.freeze([
  'compact',
  'high',
  'maximum',
]);

export function exportQualityDisplayName(quality: ExportQuality): string {
  switch (quality) {
    case 'compact':
      return '体积优先';
    case 'high':
      return '高质量';
    case 'maximum':
      return '极致';
  }
}

export function exportQualityDetail(quality: ExportQuality): string {
  switch (quality) {
    case 'compact':
      return '文件更小，适合快速分享';
    case 'high':
      return '兼顾画质和文件大小';
    case 'maximum':
      return '保留更多细节，文件更大';
  }
}

/**
 * Persisted output choices for one project.
 *
 * Capture configuration and canvas styling intentionally do not own these
 * values: changing an export preset must not rewrite how footage was captured
 * or introduce a second output-resolution authority in the visual model.
 */
export interface ExportSettings {
  frameRate: OutputFrameRate;
  resolution: CanvasResolution;
  /// Optional for compatibility with projects saved before codec selection.
  videoCodec: ExportVideoCodec | null;
  quality: ExportQuality;
}

/** Swift `init(frameRate:resolution:videoCodec:quality:)` (also supports options object). */
export function makeExportSettings(
  frameRateOrOptions:
    | OutputFrameRate
    | Partial<ExportSettings> = 60 as OutputFrameRate,
  resolution: CanvasResolution = '原始素材' as CanvasResolution,
  videoCodec: ExportVideoCodec | null = 'h264',
  quality: ExportQuality = 'high',
): ExportSettings {
  if (typeof frameRateOrOptions === 'object' && frameRateOrOptions !== null) {
    return {
      frameRate: (frameRateOrOptions.frameRate ?? 60) as OutputFrameRate,
      resolution: (frameRateOrOptions.resolution ?? '原始素材') as CanvasResolution,
      videoCodec:
        frameRateOrOptions.videoCodec !== undefined
          ? frameRateOrOptions.videoCodec
          : 'h264',
      quality: frameRateOrOptions.quality ?? 'high',
    };
  }
  return {
    frameRate: frameRateOrOptions,
    resolution,
    videoCodec,
    quality,
  };
}

export function exportSettingsFromJSON(raw: unknown): ExportSettings {
  if (!raw || typeof raw !== 'object') {
    return makeExportSettings();
  }
  const c = raw as Record<string, unknown>;
  const frameRate =
    typeof c.frameRate === 'number'
      ? (c.frameRate as OutputFrameRate)
      : (60 as OutputFrameRate);
  const resolution =
    typeof c.resolution === 'string'
      ? (c.resolution as CanvasResolution)
      : ('原始素材' as CanvasResolution);
  const videoCodec: ExportVideoCodec | null =
    c.videoCodec === 'h264' || c.videoCodec === 'hevc' ? c.videoCodec : null;
  const quality: ExportQuality =
    c.quality === 'compact' || c.quality === 'high' || c.quality === 'maximum'
      ? c.quality
      : 'high';
  return {
    frameRate,
    resolution,
    videoCodec,
    quality,
  };
}

export function exportSettingsResolvedVideoCodec(
  settings: ExportSettings,
  _requested?: CanvasDimensions,
): ExportVideoCodec {
  return settings.videoCodec ?? 'h264';
}

/// Adapt the rendered output, never the canvas or the recorded sources.
/// Switching back to HEVC therefore restores the requested native pixels.
export function exportSettingsOutputDimensions(
  settings: ExportSettings,
  requested: CanvasDimensions,
): CanvasDimensions {
  const longest = max(requested.width, requested.height);
  if (exportSettingsResolvedVideoCodec(settings, requested) !== 'h264' || !(longest > 4_096)) {
    return requested;
  }
  const scale = 4_096.0 / longest;
  const even = (edge: number): number => max(2, Math.round((edge * scale) / 2) * 2);
  return makeCanvasDimensions(even(requested.width), even(requested.height));
}

export const ExportSettings = Object.freeze({
  make: makeExportSettings,
  fromJSON: exportSettingsFromJSON,
  resolvedVideoCodec: exportSettingsResolvedVideoCodec,
  outputDimensions: exportSettingsOutputDimensions,
});
