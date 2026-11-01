// Port of: F:\dogsc\Sources\RecorderCore\ExportSettings.swift
import type { OutputFrameRate } from './CaptureConfiguration.ts';
import type { CanvasResolution } from './ProjectModel.ts';

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
}

/** Swift `init(frameRate:resolution:)` */
export function makeExportSettings(
  frameRate: OutputFrameRate = 60 as OutputFrameRate,
  resolution: CanvasResolution = '原始素材' as CanvasResolution,
): ExportSettings {
  return {
    frameRate,
    resolution,
  };
}
