// Port of: F:\dogsc-v0.2.0\Sources\RecorderCore\ProjectTimeline.swift
// & PostProductionModel.swift L111-209 (visual layer organization & programAudioClips).

import { min, max, newUUID } from './swift.ts';
import {
  type NormalizedCrop,
  makeNormalizedCrop,
  normalizedCropClamped,
} from './ProjectModel.ts';
import {
  type ZoomEasingPreset,
  type ZoomBezierCurve,
  type ZoomAnimationClip,
  ZoomBezierCurveCubic,
  makeZoomAnimationClip,
} from './ZoomAnimation.ts';
import { type ScreenMotionClip } from './ScreenMotion.ts';
import { type CameraMotionClip } from './CameraMotion.ts';
import {
  type AnimationClip,
  type AnimationPropertyValue,
  type MainTrackVisualStyle,
  type MosaicClip,
  type MotionElementEdit,
  type OverlayTiming,
  type StickerClip,
  type VisualClipSound,
  animationClipFromJSON,
  animationPropertiesFromJSON,
  mosaicClipFromJSON,
  motionElementEditsFromJSON,
  stickerClipFromJSON,
  visualClipSoundFromJSON,
} from './OverlayTimeline.ts';
import {
  type AudioClip,
  type MediaAsset,
  type SubtitleCue,
  type SubtitleStyle,
  type VideoClip,
  audioClipFromJSON,
  makeAudioClip,
  makeSubtitleStyle,
  mediaAssetFromJSON,
  subtitleCueFromJSON,
  subtitleStyleFromJSON,
  videoClipFromJSON,
} from './PostProductionModel.ts';
import {
  type ScreenCardAppearance,
  makeScreenCardAppearance,
  screenCardAppearanceFromJSON,
} from './ScreenCardAppearance.ts';
import {
  type SegmentSceneStyle,
  projectTimelineRecordingSegmentBoundaryAtOutputTime,
  segmentSceneStyleFromJSON,
} from './SegmentSceneStyle.ts';
import { RecordingSourcePrimaryID } from './RecordingSource.ts';

// MARK: - TransferableVisualClip

export type TransferableVisualClip =
  | { kind: 'video'; clip: VideoClip }
  | { kind: 'animation'; clip: AnimationClip }
  | { kind: 'sticker'; clip: StickerClip };

export function transferableVisualClipFromJSON(raw: unknown): TransferableVisualClip | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, any>;
  if (c.kind === 'video' && c.clip) {
    return { kind: 'video', clip: videoClipFromJSON(c.clip) };
  }
  if (c.kind === 'animation' && c.clip) {
    return { kind: 'animation', clip: animationClipFromJSON(c.clip) };
  }
  if (c.kind === 'sticker' && c.clip) {
    return { kind: 'sticker', clip: stickerClipFromJSON(c.clip) };
  }
  if (c.video && c.video._0) {
    return { kind: 'video', clip: videoClipFromJSON(c.video._0) };
  }
  if (c.animation && c.animation._0) {
    return { kind: 'animation', clip: animationClipFromJSON(c.animation._0) };
  }
  if (c.sticker && c.sticker._0) {
    return { kind: 'sticker', clip: stickerClipFromJSON(c.sticker._0) };
  }
  return null;
}

// MARK: - InsertedMedia

/// EDT-054: an outside video placed on the main track. Its segment's
/// `sourceStart/sourceDuration` are seconds in this file, not the recording.
/// Images retain their original file; a tiny video supplies AVFoundation's
/// timeline clock while the compositor draws the still or animated image.
export interface InsertedMedia {
  /// Project-relative when inside the package, otherwise absolute.
  path: string;
  fileDuration: number;
  name: string;
  /// EDT-067: false (default) fills the whole canvas, like a title card or
  /// black; true shows it inside the recording's frame — background,
  /// padding, corners and shadow — like the recording itself.
  usesFrameStyle: boolean;
  screenAppearance: ScreenCardAppearance | null;
  sourceAspectRatio: number | null;
  /// EDT-071: an HTML motion played live on the main track. `path` is then
  /// only a black stand-in that gives the span a video track; the picture
  /// is drawn from this page (with `properties`) in preview and export, so
  /// its text and colours stay editable.
  motionPath: string | null;
  imagePath: string | null;
  properties: Record<string, AnimationPropertyValue>;
  /// The clip's own soundtrack (an HTML motion's sound effects).
  soundPath: string | null;
  /// Per-element edits of the HTML motion (EDT-073).
  elementEdits: Record<string, MotionElementEdit>;
  overlayOrigin: TransferableVisualClip | null;
  transferSound: VisualClipSound | null;
  readonly hasEmbeddedAudio: boolean;
}

export function insertedMediaHasEmbeddedAudio(media: InsertedMedia): boolean {
  if (media.imagePath != null) return false;
  if (media.transferSound != null || media.soundPath != null) return true;
  return media.motionPath == null;
}

function sanitizeSourceAspectRatio(value: number | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  return null;
}

export function makeInsertedMedia(options: {
  path: string;
  fileDuration: number;
  name: string;
  usesFrameStyle?: boolean;
  motionPath?: string | null;
  properties?: Record<string, AnimationPropertyValue>;
  soundPath?: string | null;
  screenAppearance?: ScreenCardAppearance | null;
  sourceAspectRatio?: number | null;
  imagePath?: string | null;
  elementEdits?: Record<string, MotionElementEdit>;
  overlayOrigin?: TransferableVisualClip | null;
  transferSound?: VisualClipSound | null;
}): InsertedMedia {
  const screenAppearance =
    options.screenAppearance !== undefined
      ? options.screenAppearance
      : makeScreenCardAppearance();
  const obj: InsertedMedia = {
    path: options.path,
    fileDuration: options.fileDuration,
    name: options.name,
    usesFrameStyle: options.usesFrameStyle ?? false,
    screenAppearance,
    sourceAspectRatio: sanitizeSourceAspectRatio(options.sourceAspectRatio),
    motionPath: options.motionPath ?? null,
    imagePath: options.imagePath ?? null,
    properties: options.properties ? { ...options.properties } : {},
    soundPath: options.soundPath ?? null,
    elementEdits: options.elementEdits ? { ...options.elementEdits } : {},
    overlayOrigin: options.overlayOrigin ?? null,
    transferSound: options.transferSound ?? null,
    get hasEmbeddedAudio(): boolean {
      return insertedMediaHasEmbeddedAudio(this);
    },
  };
  return obj;
}

export function insertedMediaFromJSON(raw: unknown): InsertedMedia {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Expected InsertedMedia JSON object');
  }
  const c = raw as Record<string, unknown>;
  if (
    typeof c.path !== 'string' ||
    typeof c.fileDuration !== 'number' ||
    typeof c.name !== 'string'
  ) {
    throw new Error('InsertedMedia requires path, fileDuration and name');
  }
  return makeInsertedMedia({
    path: c.path,
    fileDuration: c.fileDuration,
    name: c.name,
    usesFrameStyle: typeof c.usesFrameStyle === 'boolean' ? c.usesFrameStyle : false,
    // Swift CodingKeys decodeIfPresent returns null when absent in legacy v27 JSON
    // so preserveLegacyScreenAppearances can freeze old projects cleanly.
    screenAppearance:
      c.screenAppearance !== undefined && c.screenAppearance !== null
        ? screenCardAppearanceFromJSON(c.screenAppearance)
        : null,
    sourceAspectRatio:
      typeof c.sourceAspectRatio === 'number' ? c.sourceAspectRatio : null,
    motionPath: typeof c.motionPath === 'string' ? c.motionPath : null,
    imagePath: typeof c.imagePath === 'string' ? c.imagePath : null,
    properties: animationPropertiesFromJSON(c.properties),
    soundPath: typeof c.soundPath === 'string' ? c.soundPath : null,
    elementEdits: motionElementEditsFromJSON(c.elementEdits),
    overlayOrigin: transferableVisualClipFromJSON(c.overlayOrigin),
    transferSound: visualClipSoundFromJSON(c.transferSound),
  });
}

// MARK: - RecordingSegment

/// One retained portion of the original recording, or an inserted video.
///
/// Segment order is output order. The lightweight editor deliberately does not
/// persist a second `outputStart`: it is derived by accumulating durations, so
/// a trim or ripple delete cannot leave two contradictory timeline positions.
export interface RecordingSegment {
  id: string;
  sourceStart: number;
  sourceDuration: number;
  /// Source seconds consumed by one output second. The editor exposes
  /// 1×...100× fast-forward; animation tracks remain on the output clock.
  playbackRate: number;
  /// Set when this segment plays an inserted video instead of the recording.
  media: InsertedMedia | null;
  /// nil retains the legacy primary recording. Ignored for inserted media.
  sourceID: string | null;
  sceneStyle: SegmentSceneStyle | null;
  /// This occurrence's own crop. nil — the default — follows the recording
  /// source, so one re-crop still reframes the whole recording. A value
  /// detaches this clip alone, which is how the same recording can drop a
  /// sidebar before a cut and keep it after. Ignored for inserted media,
  /// and deliberately not part of `sceneStyle`: restyling a clip must not
  /// reframe it, and dropping the style must not restore the old crop.
  crop: NormalizedCrop | null;
  readonly sourceEnd: number;
  readonly outputDuration: number;
  readonly resolvedSourceID: string;
}

export const RECORDING_SEGMENT_MINIMUM_PLAYBACK_RATE = 1;
export const RECORDING_SEGMENT_MAXIMUM_PLAYBACK_RATE = 100;

export function recordingSegmentResolvedSourceID(segment: RecordingSegment): string {
  return segment.media == null
    ? (segment.sourceID ?? RecordingSourcePrimaryID)
    : RecordingSourcePrimaryID;
}

export function makeRecordingSegment(options: {
  id?: string;
  sourceStart: number;
  sourceDuration: number;
  playbackRate?: number;
  media?: InsertedMedia | null;
  sourceID?: string | null;
  sceneStyle?: SegmentSceneStyle | null;
  crop?: NormalizedCrop | null;
}): RecordingSegment {
  const playbackRate = options.playbackRate ?? 1;
  return {
    id: options.id ?? newUUID(),
    sourceStart: options.sourceStart,
    sourceDuration: options.sourceDuration,
    playbackRate: Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1,
    media: options.media ?? null,
    sourceID: options.sourceID ?? null,
    sceneStyle: options.sceneStyle ?? null,
    crop: options.crop ? normalizedCropClamped(options.crop) : null,
    get sourceEnd() {
      return this.sourceStart + this.sourceDuration;
    },
    get outputDuration() {
      return this.sourceDuration / this.playbackRate;
    },
    get resolvedSourceID() {
      return this.media == null
        ? (this.sourceID ?? RecordingSourcePrimaryID)
        : RecordingSourcePrimaryID;
    },
  };
}

export function recordingSegmentFromJSON(raw: unknown): RecordingSegment {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Expected RecordingSegment JSON object');
  }
  const c = raw as Record<string, unknown>;
  if (
    typeof c.id !== 'string' ||
    typeof c.sourceStart !== 'number' ||
    typeof c.sourceDuration !== 'number'
  ) {
    throw new Error('RecordingSegment requires id, sourceStart, sourceDuration');
  }
  let crop: NormalizedCrop | null = null;
  if (c.crop && typeof c.crop === 'object') {
    const cr = c.crop as Record<string, unknown>;
    if (
      typeof cr.x === 'number' &&
      typeof cr.y === 'number' &&
      typeof cr.width === 'number' &&
      typeof cr.height === 'number'
    ) {
      crop = makeNormalizedCrop(cr.x, cr.y, cr.width, cr.height);
    }
  }
  return makeRecordingSegment({
    id: c.id,
    sourceStart: c.sourceStart,
    sourceDuration: c.sourceDuration,
    playbackRate: typeof c.playbackRate === 'number' ? c.playbackRate : 1,
    media: c.media != null ? insertedMediaFromJSON(c.media) : null,
    sourceID: typeof c.sourceID === 'string' ? c.sourceID : null,
    sceneStyle: c.sceneStyle != null ? segmentSceneStyleFromJSON(c.sceneStyle) : null,
    crop,
  });
}

export function recordingSegmentSourceEnd(segment: RecordingSegment): number {
  return segment.sourceStart + segment.sourceDuration;
}

export function recordingSegmentOutputDuration(segment: RecordingSegment): number {
  return segment.sourceDuration / segment.playbackRate;
}

export const RecordingSegment = Object.freeze({
  minimumPlaybackRate: RECORDING_SEGMENT_MINIMUM_PLAYBACK_RATE,
  maximumPlaybackRate: RECORDING_SEGMENT_MAXIMUM_PLAYBACK_RATE,
  make: makeRecordingSegment,
  fromJSON: recordingSegmentFromJSON,
  sourceEnd: recordingSegmentSourceEnd,
  outputDuration: recordingSegmentOutputDuration,
  resolvedSourceID: recordingSegmentResolvedSourceID,
});

// MARK: - SourceSequence

/// The persisted edit decision for the primary recording.
///
/// A newly recorded or legacy project remains `.fullRecording` until the user
/// performs the first destructive timeline edit. This lets migration stay pure:
/// decoding project JSON never needs to probe an AVAsset for its duration.
export type SourceSequence =
  | { kind: 'fullRecording' }
  | { kind: 'edited'; segments: readonly RecordingSegment[] };

export const SourceSequenceFullRecording: SourceSequence = Object.freeze({
  kind: 'fullRecording' as const,
});

export function makeSourceSequenceFullRecording(): SourceSequence {
  return SourceSequenceFullRecording;
}

export function makeSourceSequenceEdited(
  segments: readonly RecordingSegment[]
): SourceSequence {
  return {
    kind: 'edited',
    segments: segments.slice(),
  };
}

export const SourceSequence = Object.freeze({
  fullRecording: SourceSequenceFullRecording,
  edited: makeSourceSequenceEdited,
});

// MARK: - TransitionTiming

/// Timing shared by typed scene transitions. The clip interval is enter/hold:
/// the target eases in over `leadInDuration` at the start, then HOLDS until
/// `endTime`. After it ends, its target state remains active until another
/// clip changes it — unless `returnDuration` is nonzero, in which case a clip
/// that does NOT touch its successor eases back to the base state over that
/// window first (zoom-style enter/hold/return). Touching clips always chain.
export interface TransitionTiming {
  startTime: number;
  /// 整段时长（进入过渡 + 保持）；在时间线上拖动两端改变的就是它。
  duration: number;
  readonly endTime: number;
  readonly effectEndTime: number;
  readonly leadInEndTime: number;
  readonly requestedLeadInDuration: number;
  requestedReturnDuration(defaultTransition?: number): number;
  preserveTransitionIntent(defaultTransition?: number): void;
  /// 进入过渡时长（速度：慢/标准/快调整的就是它）；0 = 直接跳变。
  /// 超过 duration 时按 duration 截断（整段都是过渡，无保持）。
  leadInDuration: number;
  /// 保留素材在剪切接点前的进入相位；起点被删除时从新接点重新进入。
  /// 0 = 从头开始，1 = 进入过渡已经完成。
  leadInProgressOffset: number;
  easing: ZoomEasingPreset;
  customCurve: ZoomBezierCurve;
  /// 结尾自动回到基础状态的过渡时长；0 = 保持目标状态（旧项目语义）。
  returnDuration: number;
  /// 剪切跨过回落起点时保留的回落相位；0 = 从目标开始回落，1 = 已回到基础状态。
  returnProgressOffset: number;
  /// Authored durations survive ripple fitting and temporary adjacency.
  preferredLeadInDuration: number | null;
  preferredReturnDuration: number | null;
}

export function makeTransitionTiming(options: {
  startTime: number;
  duration?: number;
  leadInDuration?: number | null;
  easing?: ZoomEasingPreset;
  customCurve?: ZoomBezierCurve;
  returnDuration?: number;
  leadInProgressOffset?: number;
  returnProgressOffset?: number;
  preferredLeadInDuration?: number | null;
  preferredReturnDuration?: number | null;
}): TransitionTiming {
  const duration = options.duration ?? 0.7;
  const leadIn = options.leadInDuration ?? duration;
  return {
    startTime: options.startTime,
    duration,
    get endTime(): number {
      return this.startTime + this.duration;
    },
    get effectEndTime(): number {
      return this.endTime + this.returnDuration;
    },
    get leadInEndTime(): number {
      return this.startTime + min(this.leadInDuration, this.duration);
    },
    get requestedLeadInDuration(): number {
      return this.preferredLeadInDuration ?? this.leadInDuration;
    },
    requestedReturnDuration(defaultTransition: number = 0.7): number {
      return (
        this.preferredReturnDuration ??
        (this.returnDuration > 0.0001 ? this.returnDuration : max(defaultTransition, 0))
      );
    },
    preserveTransitionIntent(defaultTransition: number = 0.7): void {
      if (this.preferredLeadInDuration == null) {
        this.preferredLeadInDuration = this.leadInDuration;
      }
      if (this.preferredReturnDuration == null) {
        this.preferredReturnDuration = this.requestedReturnDuration(defaultTransition);
      }
    },
    leadInDuration: min(max(leadIn, 0), 5),
    leadInProgressOffset: min(max(options.leadInProgressOffset ?? 0, 0), 1),
    easing: options.easing ?? '三次方缓动',
    customCurve: options.customCurve ?? ZoomBezierCurveCubic,
    returnDuration: min(max(options.returnDuration ?? 0, 0), 5),
    returnProgressOffset: min(max(options.returnProgressOffset ?? 0, 0), 1),
    preferredLeadInDuration: options.preferredLeadInDuration ?? null,
    preferredReturnDuration: options.preferredReturnDuration ?? null,
  };
}

export function transitionTimingEndTime(timing: TransitionTiming): number {
  return timing.startTime + timing.duration;
}

export function transitionTimingLeadInEndTime(timing: TransitionTiming): number {
  return timing.startTime + min(timing.leadInDuration, timing.duration);
}

export function transitionTimingEffectEndTime(timing: TransitionTiming): number {
  return transitionTimingEndTime(timing) + timing.returnDuration;
}

export function transitionTimingRequestedLeadInDuration(timing: TransitionTiming): number {
  return timing.preferredLeadInDuration ?? timing.leadInDuration;
}

export function transitionTimingRequestedReturnDuration(
  timing: TransitionTiming,
  defaultTransition: number = 0.7
): number {
  return (
    timing.preferredReturnDuration ??
    (timing.returnDuration > 0.0001 ? timing.returnDuration : max(defaultTransition, 0))
  );
}

export function transitionTimingPreserveTransitionIntent(
  timing: TransitionTiming,
  defaultTransition: number = 0.7
): TransitionTiming {
  return {
    ...timing,
    preferredLeadInDuration: timing.preferredLeadInDuration ?? timing.leadInDuration,
    preferredReturnDuration:
      timing.preferredReturnDuration ??
      transitionTimingRequestedReturnDuration(timing, defaultTransition),
  };
}

export const TransitionTiming = Object.freeze({
  make: makeTransitionTiming,
  endTime: transitionTimingEndTime,
  leadInEndTime: transitionTimingLeadInEndTime,
  effectEndTime: transitionTimingEffectEndTime,
  requestedLeadInDuration: transitionTimingRequestedLeadInDuration,
  requestedReturnDuration: transitionTimingRequestedReturnDuration,
  preserveTransitionIntent: transitionTimingPreserveTransitionIntent,
});

// MARK: - PrimarySegmentAudioOverrides

/// Optional per-source overrides owned by one primary segment.
///
/// Missing values deliberately inherit the project-wide audio setting. This
/// keeps the familiar System Sound / Microphone controls as the default while
/// allowing a selected clip to diverge only for the source the user edits.
export interface PrimarySegmentAudioOverrides {
  systemVolume: number | null;
  microphoneVolume: number | null;
  isSystemMuted: boolean | null;
  isMicrophoneMuted: boolean | null;
}

export function makePrimarySegmentAudioOverrides(options: {
  systemVolume?: number | null;
  microphoneVolume?: number | null;
  isSystemMuted?: boolean | null;
  isMicrophoneMuted?: boolean | null;
} = {}): PrimarySegmentAudioOverrides {
  return {
    systemVolume:
      options.systemVolume != null ? min(max(options.systemVolume, 0), 1) : null,
    microphoneVolume:
      options.microphoneVolume != null ? min(max(options.microphoneVolume, 0), 1) : null,
    isSystemMuted: options.isSystemMuted ?? null,
    isMicrophoneMuted: options.isMicrophoneMuted ?? null,
  };
}

export function primarySegmentAudioOverridesIsEmpty(
  overrides: PrimarySegmentAudioOverrides
): boolean {
  return (
    overrides.systemVolume == null &&
    overrides.microphoneVolume == null &&
    overrides.isSystemMuted == null &&
    overrides.isMicrophoneMuted == null
  );
}

export const PrimarySegmentAudioOverrides = Object.freeze({
  make: makePrimarySegmentAudioOverrides,
  isEmpty: primarySegmentAudioOverridesIsEmpty,
});

// MARK: - ProjectTimeline

/// The single persisted owner of every time-varying project edit.
export interface ProjectTimeline {
  sourceSequence: SourceSequence;
  primarySegmentAudioOverrides: Record<string, PrimarySegmentAudioOverrides>;
  zoomClips: ZoomAnimationClip[];
  screenMotionClips: ScreenMotionClip[];
  cameraMotionClips: CameraMotionClip[];
  mosaicClips: MosaicClip[];
  stickerClips: StickerClip[];
  animationClips: AnimationClip[];
  audioClips: AudioClip[];
  videoClips: VideoClip[];
  subtitleCues: SubtitleCue[];
  subtitleStyle: SubtitleStyle;
  /// Project media bin (EDT-054); files are referenced, not copied.
  mediaAssets: MediaAsset[];
}

export function makeProjectTimeline(options: {
  sourceSequence?: SourceSequence;
  primarySegmentAudioOverrides?: Record<string, PrimarySegmentAudioOverrides>;
  zoomClips?: ZoomAnimationClip[];
  screenMotionClips?: ScreenMotionClip[];
  cameraMotionClips?: CameraMotionClip[];
  mosaicClips?: MosaicClip[];
  stickerClips?: StickerClip[];
  animationClips?: AnimationClip[];
  audioClips?: AudioClip[];
  videoClips?: VideoClip[];
  subtitleCues?: SubtitleCue[];
  subtitleStyle?: SubtitleStyle;
  mediaAssets?: MediaAsset[];
} = {}): ProjectTimeline {
  return {
    sourceSequence: options.sourceSequence ?? SourceSequenceFullRecording,
    primarySegmentAudioOverrides: options.primarySegmentAudioOverrides ?? {},
    zoomClips: options.zoomClips ? options.zoomClips.slice() : [],
    screenMotionClips: options.screenMotionClips ? options.screenMotionClips.slice() : [],
    cameraMotionClips: options.cameraMotionClips ? options.cameraMotionClips.slice() : [],
    mosaicClips: options.mosaicClips ? options.mosaicClips.slice() : [],
    stickerClips: options.stickerClips ? options.stickerClips.slice() : [],
    animationClips: options.animationClips ? options.animationClips.slice() : [],
    audioClips: options.audioClips ? options.audioClips.slice() : [],
    videoClips: options.videoClips ? options.videoClips.slice() : [],
    subtitleCues: options.subtitleCues ? options.subtitleCues.slice() : [],
    subtitleStyle: options.subtitleStyle ?? makeSubtitleStyle(),
    mediaAssets: options.mediaAssets ? options.mediaAssets.slice() : [],
  };
}

function decodeSourceSequence(raw: unknown): SourceSequence {
  if (!raw || typeof raw !== 'object') return SourceSequenceFullRecording;
  const s = raw as Record<string, unknown>;
  if (s.kind === 'edited' && Array.isArray(s.segments)) {
    return makeSourceSequenceEdited(s.segments.map(recordingSegmentFromJSON));
  }
  if (s.edited && typeof s.edited === 'object' && Array.isArray((s.edited as any)._0)) {
    return makeSourceSequenceEdited((s.edited as any)._0.map(recordingSegmentFromJSON));
  }
  return SourceSequenceFullRecording;
}

export function projectTimelineFromJSON(raw: unknown): ProjectTimeline {
  if (!raw || typeof raw !== 'object') return makeProjectTimeline();
  const c = raw as Record<string, unknown>;
  const sourceSequence = decodeSourceSequence(c.sourceSequence);
  const rawOverrides =
    c.primarySegmentAudioOverrides && typeof c.primarySegmentAudioOverrides === 'object'
      ? (c.primarySegmentAudioOverrides as Record<string, Record<string, any>>)
      : {};
  const primarySegmentAudioOverrides: Record<string, PrimarySegmentAudioOverrides> = {};
  for (const [k, v] of Object.entries(rawOverrides)) {
    if (v && typeof v === 'object') {
      primarySegmentAudioOverrides[k] = makePrimarySegmentAudioOverrides(v);
    }
  }
  return makeProjectTimeline({
    sourceSequence,
    primarySegmentAudioOverrides,
    zoomClips: Array.isArray(c.zoomClips)
      ? c.zoomClips.map((z: any) => makeZoomAnimationClip(z))
      : [],
    screenMotionClips: Array.isArray(c.screenMotionClips)
      ? (c.screenMotionClips as ScreenMotionClip[])
      : [],
    cameraMotionClips: Array.isArray(c.cameraMotionClips)
      ? (c.cameraMotionClips as CameraMotionClip[])
      : [],
    mosaicClips: Array.isArray(c.mosaicClips) ? c.mosaicClips.map(mosaicClipFromJSON) : [],
    stickerClips: Array.isArray(c.stickerClips)
      ? c.stickerClips.map(stickerClipFromJSON)
      : [],
    animationClips: Array.isArray(c.animationClips)
      ? c.animationClips.map(animationClipFromJSON)
      : [],
    audioClips: Array.isArray(c.audioClips) ? c.audioClips.map(audioClipFromJSON) : [],
    videoClips: Array.isArray(c.videoClips) ? c.videoClips.map(videoClipFromJSON) : [],
    subtitleCues: Array.isArray(c.subtitleCues)
      ? c.subtitleCues.map(subtitleCueFromJSON)
      : [],
    subtitleStyle: c.subtitleStyle != null ? subtitleStyleFromJSON(c.subtitleStyle) : makeSubtitleStyle(),
    mediaAssets: Array.isArray(c.mediaAssets) ? c.mediaAssets.map(mediaAssetFromJSON) : [],
  });
}

// MARK: - ProjectTimeline Queries (ProjectTimeline.swift L452-480)

export function projectTimelineContainsInsertedMedia(
  timeline: ProjectTimeline,
  atOutputTime: number,
): boolean {
  return projectTimelineInsertedMedia(timeline, atOutputTime) !== null;
}

export function projectTimelineInsertedMedia(
  timeline: ProjectTimeline,
  atOutputTime: number,
): InsertedMedia | null {
  return projectTimelineInsertedPlayback(timeline, atOutputTime)?.media ?? null;
}

export function projectTimelineInsertedPlayback(
  timeline: ProjectTimeline,
  atOutputTime: number,
): { media: InsertedMedia; localTime: number; playbackRate: number } | null {
  const boundary = projectTimelineRecordingSegmentBoundaryAtOutputTime(timeline, atOutputTime);
  const seg = boundary.segment as RecordingSegment | null;
  if (!seg || !seg.media) return null;
  const elapsed = min(max(atOutputTime - boundary.start, 0), seg.outputDuration);
  return {
    media: seg.media,
    localTime: seg.sourceStart + elapsed * seg.playbackRate,
    playbackRate: seg.playbackRate,
  };
}

/// Sound-effect audio clips placed on the audio lanes that overlap a
/// main-track segment (for example, an AI-generated `sound.create` effect
/// paired with a `html.create(placement: "main")` title card).
export function projectTimelineAssociatedEffectAudioClips(
  timeline: ProjectTimeline,
  start: number,
  end: number,
): AudioClip[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return [];
  const maxShortDuration = max((end - start) * 3, 15);
  return timeline.audioClips.filter((clip) => {
    const overlap = min(clip.timing.endTime, end) - max(clip.timing.startTime, start);
    if (!(overlap > 0.02)) return false;
    return clip.kind === 'effect' || clip.timing.duration <= maxShortDuration;
  });
}

// MARK: - Visual Layers & Audio Lanes (PostProductionModel.swift L111-209)

/// Pictures, motion graphics and overlay videos share one stacking order;
/// a newly added item goes on a new layer above everything.
export function projectTimelineNextVisualLayer(timeline: ProjectTimeline): number {
  const layers = [
    ...timeline.stickerClips.map((c) => c.layerIndex),
    ...timeline.animationClips.map((c) => c.layerIndex),
    ...timeline.videoClips.map((c) => c.layerIndex),
  ];
  if (layers.length === 0) return 0;
  let best = layers[0];
  for (let i = 1; i < layers.length; i++) {
    best = max(best, layers[i]);
  }
  return best + 1;
}

/// The track a new picture/motion/video clip should go on: the lowest
/// layer that is free for its whole span and in front of everything it
/// overlaps. A new track opens only when it overlaps the top one.
export function projectTimelineVisualLayer(
  timeline: ProjectTimeline,
  timing: OverlayTiming,
  excludingId: string | null = null,
): number {
  const spans: Array<{ layerIndex: number; timing: OverlayTiming }> = [
    ...timeline.stickerClips
      .filter((c) => c.id !== excludingId)
      .map((c) => ({ layerIndex: c.layerIndex, timing: c.timing })),
    ...timeline.animationClips
      .filter((c) => c.id !== excludingId)
      .map((c) => ({ layerIndex: c.layerIndex, timing: c.timing })),
    ...timeline.videoClips
      .filter((c) => c.id !== excludingId)
      .map((c) => ({ layerIndex: c.layerIndex, timing: c.timing })),
  ];
  if (spans.length === 0) return 0;
  let lowest = spans[0].layerIndex;
  for (let i = 1; i < spans.length; i++) {
    lowest = min(lowest, spans[i].layerIndex);
  }
  const overlapping = spans
    .filter(
      (s) =>
        s.timing.startTime < timing.endTime - 0.000_001 &&
        s.timing.endTime > timing.startTime + 0.000_001,
    )
    .map((s) => s.layerIndex);
  if (overlapping.length === 0) return lowest;
  let top = overlapping[0];
  for (let i = 1; i < overlapping.length; i++) {
    top = max(top, overlapping[i]);
  }
  return top + 1;
}

/// Renumbers visual layers to 0…n, keeping their order.
export function projectTimelineCompactVisualLayers(timeline: ProjectTimeline): ProjectTimeline {
  const order = Array.from(
    new Set([
      ...timeline.stickerClips.map((c) => c.layerIndex),
      ...timeline.animationClips.map((c) => c.layerIndex),
      ...timeline.videoClips.map((c) => c.layerIndex),
    ]),
  ).sort((a, b) => a - b);
  const rank = new Map<number, number>();
  order.forEach((layer, idx) => rank.set(layer, idx));
  return {
    ...timeline,
    stickerClips: timeline.stickerClips.map((c) => ({
      ...c,
      layerIndex: rank.get(c.layerIndex) ?? 0,
    })),
    animationClips: timeline.animationClips.map((c) => ({
      ...c,
      layerIndex: rank.get(c.layerIndex) ?? 0,
    })),
    videoClips: timeline.videoClips.map((c) => ({
      ...c,
      layerIndex: rank.get(c.layerIndex) ?? 0,
    })),
  };
}

/// Reuse visual gaps while preserving front/back order wherever clips
/// overlap. Audio lanes are independent of this operation.
export function projectTimelineOrganizeVisualLayers(timeline: ProjectTimeline): ProjectTimeline {
  type VisualItem = {
    layer: number;
    rank: number;
    id: string;
    start: number;
    end: number;
    kind: 'video' | 'sticker' | 'animation';
    index: number;
  };
  const visual: VisualItem[] = [
    ...timeline.stickerClips.map((c, index) => ({
      layer: c.layerIndex,
      rank: 1,
      id: c.id,
      start: c.timing.startTime,
      end: c.timing.endTime,
      kind: 'sticker' as const,
      index,
    })),
    ...timeline.animationClips.map((c, index) => ({
      layer: c.layerIndex,
      rank: 2,
      id: c.id,
      start: c.timing.startTime,
      end: c.timing.endTime,
      kind: 'animation' as const,
      index,
    })),
    ...timeline.videoClips.map((c, index) => ({
      layer: c.layerIndex,
      rank: 0,
      id: c.id,
      start: c.timing.startTime,
      end: c.timing.endTime,
      kind: 'video' as const,
      index,
    })),
  ];
  visual.sort((a, b) => {
    if (a.layer !== b.layer) return a.layer - b.layer;
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const stickers = timeline.stickerClips.map((c) => ({ ...c }));
  const animations = timeline.animationClips.map((c) => ({ ...c }));
  const videos = timeline.videoClips.map((c) => ({ ...c }));
  const placed: Array<{ start: number; end: number; layer: number }> = [];

  for (const item of visual) {
    let below: number | null = null;
    for (const p of placed) {
      if (p.start < item.end - 0.000_001 && p.end > item.start + 0.000_001) {
        below = below === null ? p.layer : max(below, p.layer);
      }
    }
    const layer = below !== null ? below + 1 : 0;
    placed.push({ start: item.start, end: item.end, layer });
    switch (item.kind) {
      case 'sticker':
        stickers[item.index].layerIndex = layer;
        break;
      case 'animation':
        animations[item.index].layerIndex = layer;
        break;
      case 'video':
        videos[item.index].layerIndex = layer;
        break;
    }
  }

  return {
    ...timeline,
    stickerClips: stickers,
    animationClips: animations,
    videoClips: videos,
  };
}

/// 整理轨道: visual clips reuse gaps without changing their stacking
/// order; audio packs into free rows (music before effects).
export function projectTimelineOrganizeTracks(timeline: ProjectTimeline): ProjectTimeline {
  const reorganized = projectTimelineOrganizeVisualLayers(timeline);
  const rows: Array<Array<{ start: number; end: number }>> = [];
  const audioClips = reorganized.audioClips.map((c) => ({ ...c }));

  const pack = (indices: number[], from: number): number => {
    let used = from;
    const sorted = indices
      .slice()
      .sort((a, b) => audioClips[a].timing.startTime - audioClips[b].timing.startTime);
    for (const i of sorted) {
      const timing = audioClips[i].timing;
      let lane = from;
      while (
        lane < rows.length &&
        rows[lane].some(
          (r) => r.start < timing.endTime - 0.000_001 && r.end > timing.startTime + 0.000_001,
        )
      ) {
        lane += 1;
      }
      while (rows.length <= lane) rows.push([]);
      rows[lane].push({ start: timing.startTime, end: timing.endTime });
      audioClips[i].lane = lane;
      used = max(used, lane + 1);
    }
    return used;
  };

  const music: number[] = [];
  const effects: number[] = [];
  for (let i = 0; i < audioClips.length; i++) {
    if (audioClips[i].kind === 'music') music.push(i);
    else effects.push(i);
  }
  const next = pack(music, 0);
  pack(effects, music.length === 0 ? 0 : next);

  return {
    ...reorganized,
    audioClips,
  };
}

/// Common program-audio inputs. Includes overlay videos even at
/// 0% volume and muted audio clips. Preview and export render the same
/// stable track structure into their shared program audio.
export function projectTimelineProgramAudioClips(timeline: ProjectTimeline): AudioClip[] {
  const fromVideos = timeline.videoClips.map((v) =>
    makeAudioClip({
      id: v.id,
      timing: v.timing,
      sourcePath: v.sourcePath,
      sourceStart: v.sourceStart,
      volume: v.volume,
      fadeIn: 0,
      fadeOut: 0,
      kind: 'effect',
      playbackRate: v.playbackRate,
    }),
  );
  const fromAnimations: AudioClip[] = [];
  for (const clip of timeline.animationClips) {
    if (!clip.soundtrack) continue;
    fromAnimations.push(
      makeAudioClip({
        id: clip.id,
        timing: clip.timing,
        sourcePath: clip.soundtrack.path,
        sourceStart: clip.timeOffset,
        volume: clip.soundtrack.volume,
        fadeIn: clip.soundtrack.fadeIn,
        fadeOut: clip.soundtrack.fadeOut,
        kind: 'effect',
        playbackRate: clip.playbackRate,
      }),
    );
  }
  return [...timeline.audioClips, ...fromVideos, ...fromAnimations];
}
