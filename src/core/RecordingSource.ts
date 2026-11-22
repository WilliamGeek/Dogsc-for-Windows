// Port of: F:\dogsc-v0.2.0\Sources\RecorderCore\RecordingSource.swift
import { clamp, max, min, newUUID, toInt } from './swift.ts';
import {
  type CaptureConfiguration,
  type OutputFrameRate,
  makeCaptureConfiguration,
} from './CaptureConfiguration.ts';
import {
  type ProjectMediaReference,
  makeProjectMediaReference,
} from './MediaTimeline.ts';
import type {
  ProjectMediaManifest,
  RecorderProject,
} from './ProjectMediaModel.ts';
import type { ProjectTimeline, RecordingSegment } from './ProjectTimeline.ts';
import {
  type NormalizedCrop,
  NormalizedCropFull,
  makeNormalizedCrop,
  normalizedCropClamped,
} from './ProjectModel.ts';
import {
  type ScreenCardAppearance,
  makeScreenCardAppearance,
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
  /// Stable import-order palette slot; nil preserves projects saved before source colours.
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
  return {
    screen: makeProjectMediaReference(m.screen as Partial<ProjectMediaReference> & { relativePath: string }),
    camera: m.camera
      ? makeProjectMediaReference(m.camera as Partial<ProjectMediaReference> & { relativePath: string })
      : null,
    microphone: m.microphone
      ? makeProjectMediaReference(m.microphone as Partial<ProjectMediaReference> & { relativePath: string })
      : null,
    pointerEvents: m.pointerEvents
      ? makeProjectMediaReference(m.pointerEvents as Partial<ProjectMediaReference> & { relativePath: string })
      : null,
  };
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

function segmentResolvedSourceIDLocal(segment: RecordingSegment): string {
  return segment.media == null ? (segment.sourceID ?? RecordingSourcePrimaryID) : RecordingSourcePrimaryID;
}

/// The recording the programme opens on. The opening sequence animates
/// that recording's camera bubble in, so a camera belonging to some later
/// recording must not add a slot to its roster. Read this before any code
/// rebinds `media` to the frame's own source.
export function projectOpeningRecordingSourceID(project: RecorderProject): string {
  if (project.timeline.sourceSequence.kind !== 'edited') {
    return RecordingSourcePrimaryID;
  }
  const first = project.timeline.sourceSequence.segments[0];
  return first ? segmentResolvedSourceIDLocal(first) : RecordingSourcePrimaryID;
}

/// Whether the opening's own recording brings a camera, from the manifest
/// rather than from whatever happens to be decoded right now.
export function projectOpeningDeclaresCamera(project: RecorderProject): boolean {
  return projectSourceByID(project, projectOpeningRecordingSourceID(project))?.media.camera != null;
}

/// A view over the original fields, never a second persisted primary source.
export function projectSources(project: RecorderProject): RecordingSource[] {
  const additional = project.additionalSources ?? [];
  if (project.media == null) {
    return additional.slice();
  }
  const primary = makeRecordingSource({
    id: RecordingSourcePrimaryID,
    name: project.title,
    media: project.media,
    capture: project.capture,
    crop: project.canvas.crop,
    screenAppearance: makeScreenCardAppearance(project.canvas),
  });
  return [primary, ...additional];
}

/// An unknown source must never fall back to the primary recording's media.
export function projectSourceByID(
  project: RecorderProject,
  id: string,
): RecordingSource | null {
  if (id === RecordingSourcePrimaryID) {
    if (project.media == null) return null;
    return makeRecordingSource({
      id,
      name: project.title,
      media: project.media,
      capture: project.capture,
      crop: project.canvas.crop,
      screenAppearance: makeScreenCardAppearance(project.canvas),
    });
  }
  return (project.additionalSources ?? []).find((s) => s.id === id) ?? null;
}

/// Mutations name their recording explicitly. Unknown IDs never edit the
/// primary recording, and its legacy storage stays backwards compatible.
export function projectSetMediaForSource(
  project: RecorderProject,
  manifest: ProjectMediaManifest,
  sourceID: string,
): { project: RecorderProject; changed: boolean } {
  if (sourceID === RecordingSourcePrimaryID) {
    if (project.media == null) return { project, changed: false };
    return { project: { ...project, media: manifest }, changed: true };
  }
  const additional = project.additionalSources ?? [];
  const index = additional.findIndex((s) => s.id === sourceID);
  if (index < 0) return { project, changed: false };
  const nextAdditional = additional.slice();
  nextAdditional[index] = { ...nextAdditional[index], media: manifest };
  return {
    project: { ...project, additionalSources: nextAdditional },
    changed: true,
  };
}

/// Frame stepping and frame read-outs follow the recording that is
/// actually on screen; an imported 30 fps source keeps its own grid.
export function projectCaptureFrameRateForSource(
  project: RecorderProject,
  sourceID: string | null,
): OutputFrameRate {
  if (sourceID !== null) {
    const src = projectSourceByID(project, sourceID);
    if (src) return src.capture.captureFrameRate;
  }
  return project.capture.captureFrameRate;
}

export function projectSetCropForSource(
  project: RecorderProject,
  crop: NormalizedCrop,
  sourceID: string,
): { project: RecorderProject; changed: boolean } {
  if (sourceID === RecordingSourcePrimaryID) {
    return {
      project: {
        ...project,
        canvas: { ...project.canvas, crop: normalizedCropClamped(crop) },
      },
      changed: true,
    };
  }
  const additional = project.additionalSources ?? [];
  const index = additional.findIndex((s) => s.id === sourceID);
  if (index < 0) return { project, changed: false };
  const nextAdditional = additional.slice();
  nextAdditional[index] = {
    ...nextAdditional[index],
    crop: normalizedCropClamped(crop),
  };
  return {
    project: { ...project, additionalSources: nextAdditional },
    changed: true,
  };
}

export function projectTimelineSetSegmentCrop(
  timeline: ProjectTimeline,
  crop: NormalizedCrop | null,
  segmentID: string,
): { timeline: ProjectTimeline; changed: boolean } {
  if (timeline.sourceSequence.kind !== 'edited') {
    return { timeline, changed: false };
  }
  const segments = timeline.sourceSequence.segments;
  const index = segments.findIndex((s) => s.id === segmentID);
  if (index < 0 || segments[index].media != null) {
    return { timeline, changed: false };
  }
  const nextSegments = segments.slice();
  const prev = nextSegments[index];
  nextSegments[index] = Object.defineProperties(
    {
      ...prev,
      crop: crop ? normalizedCropClamped(crop) : null,
    },
    {
      sourceEnd: {
        enumerable: true,
        get() {
          return this.sourceStart + this.sourceDuration;
        },
      },
      outputDuration: {
        enumerable: true,
        get() {
          return this.sourceDuration / this.playbackRate;
        },
      },
      resolvedSourceID: {
        enumerable: true,
        get() {
          return segmentResolvedSourceIDLocal(this);
        },
      },
    },
  );
  return {
    timeline: {
      ...timeline,
      sourceSequence: { kind: 'edited', segments: nextSegments },
    },
    changed: true,
  };
}

/// Narrows the crop to one occurrence of a recording, or, with nil, puts
/// that occurrence back on its recording's own rectangle. An inserted clip
/// has no recording to deviate from, so it is refused.
export function projectSetSegmentCrop(
  project: RecorderProject,
  crop: NormalizedCrop | null,
  segmentID: string,
): { project: RecorderProject; changed: boolean } {
  const updated = projectTimelineSetSegmentCrop(project.timeline, crop, segmentID);
  if (!updated.changed) return { project, changed: false };
  return {
    project: { ...project, timeline: updated.timeline },
    changed: true,
  };
}

/// How many times one recording appears on the main track. A per-clip crop
/// is only a meaningful choice when there is more than one.
export function projectSegmentCountForSource(
  project: RecorderProject,
  sourceID: string,
): number {
  if (project.timeline.sourceSequence.kind !== 'edited') return 1;
  let count = 0;
  for (const segment of project.timeline.sourceSequence.segments) {
    if (segment.media == null && segmentResolvedSourceIDLocal(segment) === sourceID) {
      count += 1;
    }
  }
  return count;
}

export const RecordingSource = Object.freeze({
  primaryID: RecordingSourcePrimaryID,
  make: makeRecordingSource,
  fromJSON: recordingSourceFromJSON,
  openingRecordingSourceID: projectOpeningRecordingSourceID,
  openingDeclaresCamera: projectOpeningDeclaresCamera,
  sources: projectSources,
  source: projectSourceByID,
  setMedia: projectSetMediaForSource,
  captureFrameRate: projectCaptureFrameRateForSource,
  setCrop: projectSetCropForSource,
  setSegmentCrop: projectSetSegmentCrop,
  segmentCount: projectSegmentCountForSource,
});
