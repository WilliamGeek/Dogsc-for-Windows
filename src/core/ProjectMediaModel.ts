// Port of: F:\dogsc\Sources\RecorderCore\ProjectMediaModel.swift

import { min, max, newUUID } from './swift.ts';
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
import { type ExportSettings, makeExportSettings } from './ExportSettings.ts';
import { type RecordingMarker, makeRecordingMarker } from './RecordingMarker.ts';
import {
  type ProjectTimeline,
  makeProjectTimeline,
} from './ProjectTimeline.ts';
import {
  type ZoomAnimationClip,
  makeZoomAnimationClip,
} from './ZoomAnimation.ts';

// MARK: - CaptureConfiguration forward interface (full implementation in CaptureConfiguration.ts)

export interface CaptureConfiguration {
  source?: string;
  displayID?: number | null;
  displayName?: string | null;
  windowID?: number | null;
  windowName?: string | null;
  selectedApplicationBundleIdentifier?: string | null;
  selectedApplicationName?: string | null;
  area?: any;
  deviceID?: string | null;
  deviceName?: string | null;
  captureFrameRate?: any;
  captureResolutionLimit?: any;
  captureCodec?: any;
  hidesDesktopFiles?: boolean;
  hidesDock?: boolean;
  recordsSystemAudio?: boolean;
  systemAudioScope?: any;
  recordsMicrophone?: boolean;
  microphoneDeviceID?: string | null;
  microphoneDeviceName?: string | null;
  recordsCamera?: boolean;
  cameraDeviceID?: string | null;
  cameraDeviceName?: string | null;
  cameraCaptureResolution?: any;
}

export function makeCaptureConfiguration(
  options?: Partial<CaptureConfiguration>
): CaptureConfiguration {
  return {
    source: options?.source ?? 'display',
    displayID: options?.displayID ?? null,
    displayName: options?.displayName ?? null,
    windowID: options?.windowID ?? null,
    windowName: options?.windowName ?? null,
    selectedApplicationBundleIdentifier:
      options?.selectedApplicationBundleIdentifier ?? null,
    selectedApplicationName: options?.selectedApplicationName ?? null,
    area: options?.area ?? null,
    deviceID: options?.deviceID ?? null,
    deviceName: options?.deviceName ?? null,
    captureFrameRate: options?.captureFrameRate ?? 60,
    captureResolutionLimit: options?.captureResolutionLimit ?? 'native',
    captureCodec: options?.captureCodec ?? 'hevc',
    hidesDesktopFiles: options?.hidesDesktopFiles ?? false,
    hidesDock: options?.hidesDock ?? false,
    recordsSystemAudio: options?.recordsSystemAudio ?? true,
    systemAudioScope: options?.systemAudioScope ?? 'all',
    recordsMicrophone: options?.recordsMicrophone ?? false,
    microphoneDeviceID: options?.microphoneDeviceID ?? null,
    microphoneDeviceName: options?.microphoneDeviceName ?? null,
    recordsCamera: options?.recordsCamera ?? false,
    cameraDeviceID: options?.cameraDeviceID ?? null,
    cameraDeviceName: options?.cameraDeviceName ?? null,
    cameraCaptureResolution: options?.cameraCaptureResolution ?? null,
  };
}

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
  recordingMarkers: RecordingMarker[];
  zoomAnimations: ZoomAnimationClip[];
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
  recordingMarkers?: RecordingMarker[];
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
  const recordingMarkers = options?.recordingMarkers ?? [];

  return {
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
}

// MARK: - JSON Serialization & Deserialization

export function encodeRecorderProject(project: RecorderProject): string {
  ProjectSchema.validateForEncoding(project.version);
  return JSON.stringify({
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
    recordingMarkers: project.recordingMarkers,
  });
}

export function decodeRecorderProject(json: string | Record<string, any>): RecorderProject {
  const container = typeof json === 'string' ? JSON.parse(json) : json;
  const decodedVersion = container.version ?? 1;
  ProjectSchema.validateForDecoding(decodedVersion);

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
          })
        )
    : [];

  const title = container.title ?? '未命名录制';
  const createdAt = container.createdAt ? new Date(container.createdAt) : new Date();
  const capture = container.capture ? makeCaptureConfiguration(container.capture) : makeCaptureConfiguration();
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
    let settings = makeExportSettings(container.exportSettings);
    if (decodedVersion < 7 && settings.resolution === 'fullHD') {
      settings = makeExportSettings({ ...settings, resolution: 'source' });
    }
    exportSettings = settings;
  } else {
    exportSettings = makeExportSettings();
  }

  let timeline: ProjectTimeline;
  if (decodedVersion >= 4 && container.timeline) {
    timeline = makeProjectTimeline(container.timeline);
  } else {
    const decodedAnimations: ZoomAnimationClip[] = Array.isArray(container.zoomAnimations)
      ? container.zoomAnimations.map((a: any) => makeZoomAnimationClip(a))
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

  return makeRecorderProject({
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
    recordingMarkers,
  });
}
