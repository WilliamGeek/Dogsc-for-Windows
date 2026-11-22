// Port of: F:\dogsc-v0.2.0\Sources\RecorderCore\CameraBeauty.swift
import { clamp } from './swift.ts';

export interface CameraBeautySettings {
  smoothing: number;
  whitening: number;
}

function clampStrength(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0;
}

export function makeCameraBeautySettings(
  options: Partial<CameraBeautySettings> = {},
): CameraBeautySettings {
  return {
    smoothing: clampStrength(options.smoothing ?? 0),
    whitening: clampStrength(options.whitening ?? 0),
  };
}

export function cameraBeautyIsEnabled(settings: CameraBeautySettings): boolean {
  return settings.smoothing > 0 || settings.whitening > 0;
}

export function cameraBeautySettingsFromJSON(raw: unknown): CameraBeautySettings {
  if (!raw || typeof raw !== 'object') {
    return makeCameraBeautySettings();
  }
  const obj = raw as Record<string, unknown>;
  return makeCameraBeautySettings({
    smoothing: typeof obj.smoothing === 'number' ? obj.smoothing : 0,
    whitening: typeof obj.whitening === 'number' ? obj.whitening : 0,
  });
}

export function cameraBeautySettingsEquals(
  lhs: CameraBeautySettings,
  rhs: CameraBeautySettings,
): boolean {
  return lhs.smoothing === rhs.smoothing && lhs.whitening === rhs.whitening;
}

export const CameraBeautySettings = Object.freeze({
  make: makeCameraBeautySettings,
  isEnabled: cameraBeautyIsEnabled,
  fromJSON: cameraBeautySettingsFromJSON,
  equals: cameraBeautySettingsEquals,
});
