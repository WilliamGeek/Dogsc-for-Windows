// Port of: F:\dogsc\Sources\RecorderCore\ProjectMediaModel.swift

import { min, max, newUUID } from './swift.ts';
import {
  type CaptureConfiguration,
  makeCaptureConfiguration,
} from './CaptureConfiguration.ts';
export {
  type CaptureConfiguration,
  makeCaptureConfiguration,
} from './CaptureConfiguration.ts';
import {
  type MediaSyncAnchor,
  makeMediaSyncAnchor,
  type ProjectMediaReference,
  makeProjectMediaReference,
} from './MediaTimeline.ts';
export {
  type MediaSyncAnchor,
  makeMediaSyncAnchor,
  type ProjectMediaReference,
  makeProjectMediaReference,
};

import {
  ProjectSchema,
  type CanvasStyle,
  makeCanvasStyle,
  type CameraStyle,
  makeCameraStyle,
  type AudioStyle,
  makeAudioStyle,
  type MotionStyle,
  makeMotionStyle,
  type OpeningSequence,
  makeOpeningSequence,
  type CursorStyle,
  makeCursorStyle,
} from './ProjectModel.ts';
import {
  type ExportSettings,
  exportSettingsFromJSON,
  makeExportSettings,
} from './ExportSettings.ts';
import { type RecordingMarker, makeRecordingMarker } from './RecordingMarker.ts';
import {
  type ProjectTimeline,
  makeProjectTimeline,
  projectTimelineFromJSON,
} from './ProjectTimeline.ts';
import {
  type RecordingSource,
  recordingSourceFromJSON,
} from './RecordingSource.ts';
import { projectPreserveLegacyScreenAppearances } from './ScreenCardAppearance.ts';
import {
  type ZoomAnimationClip,
  makeZoomAnimationClip,
  zoomAnimationClipFromJSON,
} from './ZoomAnimation.ts';

// MARK: - ProjectMediaManifest

/**
 * Complete media inventory for a recorded project.
 *
 * `screen` is structurally required once a manifest exists. A fresh project
 * that has not recorded anything uses `RecorderProject.media == null`; this
 * avoids partial manifests containing only orphan camera or audio files.
 */
export interface ProjectMediaManifest {
  screen: ProjectMediaReference;
  camera: ProjectMediaReference | null;
  microphone: ProjectMediaReference | null;
  pointerEvents: ProjectMediaReference | null;
}

export function makeProjectMediaManifest(options: {
  screen: ProjectMediaReference;
  camera?: ProjectMediaReference | null;
  microphone?: ProjectMediaReference | null;
  pointerEvents?: ProjectMediaReference | null;
}): ProjectMediaManifest {
  return {
    screen: options.screen,
    camera: options.camera ?? null,
    microphone: options.microphone ?? null,
    pointerEvents: options.pointerEvents ?? null,
  };
}

// MARK: - RecorderProject

export interface RecorderProject {
  version: number;
  title: string;
  createdAt: Date;
  capture: CaptureConfiguration;
  canvas: CanvasStyle;
  camera: CameraStyle;
  audio: AudioStyle;
  motion: MotionStyle;
  openingSequence: OpeningSequence;
  cursorStyle: CursorStyle;
  exportSettings: ExportSettings;
  timeline: ProjectTimeline;
  media: ProjectMediaManifest | null;
  additionalSources: RecordingSource[];
  recordingMarkers: RecordingMarker[];
  zoomAnimations: ZoomAnimationClip[];
  /** Preserves unrecognized top-level JSON fields across decode/encode roundtrips. */
  _unknownFields?: Record<string, unknown>;
}

export function makeRecorderProject(options?: {
  version?: number;
  title?: string;
  createdAt?: Date;
  capture?: CaptureConfiguration;
  canvas?: CanvasStyle;
  camera?: CameraStyle;
  audio?: AudioStyle;
  motion?: MotionStyle;
  openingSequence?: OpeningSequence;
  cursorStyle?: CursorStyle;
  exportSettings?: ExportSettings;
  zoomAnimations?: ZoomAnimationClip[];
  timeline?: ProjectTimeline;
  media?: ProjectMediaManifest | null;
  additionalSources?: RecordingSource[];
  recordingMarkers?: RecordingMarker[];
  _unknownFields?: Record<string, unknown>;
}): RecorderProject {
  const version = options?.version ?? ProjectSchema.currentVersion;
  const title = options?.title ?? '未命名录制';
  const createdAt = options?.createdAt ?? new Date();
  const capture = options?.capture ?? makeCaptureConfiguration();
  const canvas = options?.canvas ?? makeCanvasStyle();
  const camera = options?.camera ?? makeCameraStyle();
  const audio = options?.audio ?? makeAudioStyle();
  const motion = options?.motion ?? makeMotionStyle();
  const openingSequence = options?.openingSequence ?? makeOpeningSequence();
  const cursorStyle = options?.cursorStyle ?? makeCursorStyle();
  const exportSettings = options?.exportSettings ?? makeExportSettings();
  const zoomAnimations = options?.zoomAnimations ?? [];
  const timeline =
    options?.timeline ?? makeProjectTimeline({ zoomClips: zoomAnimations });
  const media = options?.media ?? null;
  const additionalSources = options?.additionalSources ? options.additionalSources.slice() : [];
  const recordingMarkers = options?.recordingMarkers ?? [];

  const project: RecorderProject = {
    version,
    title,
    createdAt,
    capture,
    canvas,
    camera,
    audio,
    motion,
    openingSequence,
    cursorStyle,
    exportSettings,
    timeline,
    media,
    additionalSources,
    recordingMarkers,
    get zoomAnimations() {
      return this.timeline.zoomClips as ZoomAnimationClip[];
    },
    set zoomAnimations(val: ZoomAnimationClip[]) {
      this.timeline = {
        ...this.timeline,
        zoomClips: val,
      };
    },
  };
  if (options?._unknownFields && Object.keys(options._unknownFields).length > 0) {
    project._unknownFields = { ...options._unknownFields };
  }
  return project;
}

// MARK: - JSON Serialization & Deserialization

const KNOWN_PROJECT_KEYS = new Set<string>([
  'version',
  'title',
  'createdAt',
  'capture',
  'canvas',
  'camera',
  'audio',
  'motion',
  'openingSequence',
  'cursorStyle',
  'exportSettings',
  'timeline',
  'media',
  'additionalSources',
  'recordingMarkers',
  'zoomAnimations',
  'screenRecordingRelativePath',
  'cameraRecordingRelativePath',
  'microphoneRecordingRelativePath',
  'pointerEventsRelativePath',
  'cameraStartOffset',
  'microphoneStartOffset',
  'pointerStartOffset',
]);

export function encodeRecorderProject(project: RecorderProject): string {
  ProjectSchema.validateForEncoding(project.version);
  const payload: Record<string, unknown> = {
    ...(project._unknownFields ?? {}),
    version: ProjectSchema.currentVersion,
    title: project.title,
    createdAt: project.createdAt.toISOString(),
    capture: project.capture,
    canvas: project.canvas,
    camera: project.camera,
    audio: project.audio,
    motion: project.motion,
    openingSequence: project.openingSequence,
    cursorStyle: project.cursorStyle,
    exportSettings: project.exportSettings,
    timeline: project.timeline,
    media: project.media,
  };
  // Keep legacy single-recording payloads unchanged apart from the schema.
  if (project.additionalSources && project.additionalSources.length > 0) {
    payload.additionalSources = project.additionalSources;
  }
  payload.recordingMarkers = project.recordingMarkers;
  return JSON.stringify(payload);
}

/**
 * Normalizes legacy English capture values from older project JSON before
 * makeCaptureConfiguration applies defaults and clamps.
 */
function normalizeCaptureForDecoding(raw: Record<string, any>): Partial<CaptureConfiguration> {
  const sourceMap: Record<string, string> = {
    display: '整块屏幕',
    window: '单个窗口',
    area: '自选区域',
    device: 'iOS 设备',
  };
  const codecMap: Record<string, string> = {
    hevc: 'HEVC',
    h264: 'H.264',
    proRes422: 'ProRes 422',
  };
  const resolutionMap: Record<string, string> = {
    native: '原始分辨率',
    uhd: '最高 4K',
    fullHD: '最高 1080p',
  };
  const audioScopeMap: Record<string, string> = {
    all: '全部系统声音',
    selectedApplication: '所选窗口 App',
  };

  const normalized: Record<string, any> = { ...raw };
  if (typeof raw.source === 'string' && sourceMap[raw.source]) {
    normalized.source = sourceMap[raw.source];
  }
  if (typeof raw.captureCodec === 'string' && codecMap[raw.captureCodec]) {
    normalized.captureCodec = codecMap[raw.captureCodec];
  }
  if (
    typeof raw.captureResolutionLimit === 'string' &&
    resolutionMap[raw.captureResolutionLimit]
  ) {
    normalized.captureResolutionLimit = resolutionMap[raw.captureResolutionLimit];
  }
  if (typeof raw.systemAudioScope === 'string' && audioScopeMap[raw.systemAudioScope]) {
    normalized.systemAudioScope = audioScopeMap[raw.systemAudioScope];
  }
  if (raw.captureFrameRate !== undefined) {
    const rate = Number(raw.captureFrameRate);
    if (rate === 30 || rate === 60 || rate === 90 || rate === 120) {
      normalized.captureFrameRate = rate;
    }
  }

  return normalized as Partial<CaptureConfiguration>;
}

export function decodeRecorderProject(json: string | Record<string, any>): RecorderProject {
  const container = typeof json === 'string' ? JSON.parse(json) : json;
  const decodedVersion = container.version ?? 1;
  ProjectSchema.validateForDecoding(decodedVersion);

  const unknownFields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(container)) {
    if (!KNOWN_PROJECT_KEYS.has(k)) {
      unknownFields[k] = v;
    }
  }

  const markerIDs = new Set<string>();
  const recordingMarkers: RecordingMarker[] = Array.isArray(container.recordingMarkers)
    ? container.recordingMarkers
        .filter((m: any) => {
          if (
            !m ||
            !Number.isFinite(m.sourceTime) ||
            m.sourceTime < 0 ||
            !Number.isFinite(m.number) ||
            m.number <= 0 ||
            markerIDs.has(m.id)
          ) {
            return false;
          }
          markerIDs.add(m.id);
          return true;
        })
        .map((m: any) =>
          makeRecordingMarker({
            id: m.id,
            sourceTime: m.sourceTime,
            number: m.number,
            sourceID: typeof m.sourceID === 'string' ? m.sourceID : null,
          })
        )
    : [];

  const title = container.title ?? '未命名录制';
  const createdAt = container.createdAt ? new Date(container.createdAt) : new Date();
  const capture = container.capture
    ? makeCaptureConfiguration(normalizeCaptureForDecoding(container.capture))
    : makeCaptureConfiguration();
  const canvas = container.canvas ? makeCanvasStyle(container.canvas) : makeCanvasStyle();
  const camera = container.camera ? makeCameraStyle(container.camera) : makeCameraStyle();
  const audio = container.audio ? makeAudioStyle(container.audio) : makeAudioStyle();
  const motion = container.motion ? makeMotionStyle(container.motion) : makeMotionStyle();
  const openingSequence = container.openingSequence
    ? makeOpeningSequence(container.openingSequence)
    : makeOpeningSequence();
  const cursorStyle = container.cursorStyle
    ? makeCursorStyle(container.cursorStyle)
    : makeCursorStyle();

  let exportSettings: ExportSettings;
  if (decodedVersion >= 5 && container.exportSettings) {
    let settings = exportSettingsFromJSON(container.exportSettings);
    if (decodedVersion < 7 && (settings.resolution as string) === 'fullHD') {
      settings = makeExportSettings({ ...settings, resolution: '原始素材' });
    }
    exportSettings = settings;
  } else {
    exportSettings = makeExportSettings();
  }

  let timeline: ProjectTimeline;
  if (decodedVersion >= 4 && container.timeline) {
    timeline = projectTimelineFromJSON(container.timeline);
  } else {
    const decodedAnimations: ZoomAnimationClip[] = Array.isArray(container.zoomAnimations)
      ? container.zoomAnimations.map((a: any) => zoomAnimationClipFromJSON(a))
      : [];
    timeline = makeProjectTimeline({ zoomClips: decodedAnimations });
  }

  let media: ProjectMediaManifest | null = null;
  if (decodedVersion >= 3) {
    if (container.media && container.media.screen) {
      media = makeProjectMediaManifest({
        screen: makeProjectMediaReference(container.media.screen),
        camera: container.media.camera ? makeProjectMediaReference(container.media.camera) : null,
        microphone: container.media.microphone
          ? makeProjectMediaReference(container.media.microphone)
          : null,
        pointerEvents: container.media.pointerEvents
          ? makeProjectMediaReference(container.media.pointerEvents)
          : null,
      });
    }
  } else {
    const screenPath = container.screenRecordingRelativePath;
    if (screenPath && typeof screenPath === 'string' && screenPath.length > 0) {
      const cameraPath = container.cameraRecordingRelativePath;
      const microphonePath = container.microphoneRecordingRelativePath;
      const pointerPath = container.pointerEventsRelativePath;
      const cameraOffset = container.cameraStartOffset ?? 0;
      const microphoneOffset = container.microphoneStartOffset ?? 0;
      const pointerOffset = container.pointerStartOffset ?? 0;

      media = makeProjectMediaManifest({
        screen: makeProjectMediaReference({ relativePath: screenPath }),
        camera:
          cameraPath && cameraPath.length > 0
            ? makeProjectMediaReference({ relativePath: cameraPath, startOffset: cameraOffset })
            : null,
        microphone:
          microphonePath && microphonePath.length > 0
            ? makeProjectMediaReference({
                relativePath: microphonePath,
                startOffset: microphoneOffset,
              })
            : null,
        pointerEvents:
          pointerPath && pointerPath.length > 0
            ? makeProjectMediaReference({
                relativePath: pointerPath,
                startOffset: pointerOffset,
              })
            : null,
      });
    }
  }

  const additionalSources: RecordingSource[] = Array.isArray(container.additionalSources)
    ? container.additionalSources.map(recordingSourceFromJSON)
    : [];

  let project = makeRecorderProject({
    version: ProjectSchema.currentVersion,
    title,
    createdAt,
    capture,
    canvas,
    camera,
    audio,
    motion,
    openingSequence,
    cursorStyle,
    exportSettings,
    timeline,
    media,
    additionalSources,
    recordingMarkers,
    _unknownFields: unknownFields,
  });

  if (decodedVersion < 28) {
    project = projectPreserveLegacyScreenAppearances(project);
  }
  return project;
}
