// Port of: F:\dogsc-v0.2.0\Sources\RecorderCore\RecordingSource.swift (L1-56 core model)
// Note: RecorderProject multi-source extensions (L58-154) are wired in T13.5 when
// RecorderProject.additionalSources and RecordingSegment.sourceID/crop land.

import { max, newUUID, toInt } from './swift.ts';
import {
  type CaptureConfiguration,
  makeCaptureConfiguration,
} from './CaptureConfiguration.ts';
import {
  type ProjectMediaManifest,
  makeProjectMediaManifest,
  makeProjectMediaReference,
} from './ProjectMediaModel.ts';
import {
  type NormalizedCrop,
  NormalizedCropFull,
  makeNormalizedCrop,
  normalizedCropClamped,
} from './ProjectModel.ts';
import {
  type ScreenCardAppearance,
  screenCardAppearanceFromJSON,
} from './ScreenCardAppearance.ts';

export const RecordingSourcePrimaryID = '00000000-0000-0000-0000-000000000001';

/// One recording's independent media clocks and source geometry. The primary
/// recording remains in the legacy project fields; imported recordings live
/// in `additionalSources`. Neither is an inserted, flattened video.
export interface RecordingSource {
  id: string;
  name: string;
  media: ProjectMediaManifest;
  capture: CaptureConfiguration;
  cameraContentCrop: NormalizedCrop | null;
  crop: NormalizedCrop;
  /// Stable import-order palette slot; null preserves projects saved before source colours.
  colorIndex: number | null;
  screenAppearance: ScreenCardAppearance | null;
}

export function makeRecordingSource(options: {
  id?: string;
  name: string;
  media: ProjectMediaManifest;
  capture?: CaptureConfiguration;
  cameraContentCrop?: NormalizedCrop | null;
  crop?: NormalizedCrop;
  colorIndex?: number | null;
  screenAppearance?: ScreenCardAppearance | null;
}): RecordingSource {
  const colorIndex =
    options.colorIndex !== undefined && options.colorIndex !== null
      ? max(toInt(options.colorIndex), 0)
      : null;
  return {
    id: options.id ?? newUUID(),
    name: options.name,
    media: options.media,
    capture: options.capture ?? makeCaptureConfiguration(),
    cameraContentCrop: options.cameraContentCrop
      ? normalizedCropClamped(options.cameraContentCrop)
      : null,
    crop: normalizedCropClamped(options.crop ?? NormalizedCropFull),
    colorIndex,
    screenAppearance: options.screenAppearance ? { ...options.screenAppearance } : null,
  };
}

function decodeCrop(raw: unknown): NormalizedCrop | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.x !== 'number' ||
    typeof r.y !== 'number' ||
    typeof r.width !== 'number' ||
    typeof r.height !== 'number'
  ) {
    return null;
  }
  return makeNormalizedCrop(r.x, r.y, r.width, r.height);
}

function decodeMediaManifest(raw: unknown): ProjectMediaManifest {
  if (!raw || typeof raw !== 'object') {
    throw new Error('RecordingSource requires media manifest');
  }
  const m = raw as Record<string, unknown>;
  if (!m.screen || typeof m.screen !== 'object') {
    throw new Error('RecordingSource media manifest requires screen reference');
  }
  return makeProjectMediaManifest({
    screen: makeProjectMediaReference(m.screen as Parameters<typeof makeProjectMediaReference>[0]),
    camera: m.camera
      ? makeProjectMediaReference(m.camera as Parameters<typeof makeProjectMediaReference>[0])
      : null,
    microphone: m.microphone
      ? makeProjectMediaReference(m.microphone as Parameters<typeof makeProjectMediaReference>[0])
      : null,
    pointerEvents: m.pointerEvents
      ? makeProjectMediaReference(m.pointerEvents as Parameters<typeof makeProjectMediaReference>[0])
      : null,
  });
}

export function recordingSourceFromJSON(raw: unknown): RecordingSource {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Expected RecordingSource JSON object');
  }
  const c = raw as Record<string, unknown>;
  if (typeof c.id !== 'string' || c.id.length === 0) {
    throw new Error('RecordingSource requires string id');
  }
  const media = decodeMediaManifest(c.media);
  const capture =
    c.capture && typeof c.capture === 'object'
      ? makeCaptureConfiguration(c.capture as Partial<CaptureConfiguration>)
      : makeCaptureConfiguration();
  const cameraContentCrop = decodeCrop(c.cameraContentCrop);
  const crop = decodeCrop(c.crop) ?? NormalizedCropFull;
  const colorIndex = typeof c.colorIndex === 'number' ? c.colorIndex : null;
  const screenAppearance =
    c.screenAppearance !== undefined && c.screenAppearance !== null
      ? screenCardAppearanceFromJSON(c.screenAppearance)
      : null;

  return makeRecordingSource({
    id: c.id,
    name: typeof c.name === 'string' ? c.name : '',
    media,
    capture,
    cameraContentCrop,
    crop,
    colorIndex,
    screenAppearance,
  });
}

export const RecordingSource = Object.freeze({
  primaryID: RecordingSourcePrimaryID,
  make: makeRecordingSource,
  fromJSON: recordingSourceFromJSON,
});
