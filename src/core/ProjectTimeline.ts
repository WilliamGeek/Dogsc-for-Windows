// Port of: F:\dogsc\Sources\RecorderCore\ProjectTimeline.swift

import { min, max, newUUID } from './swift.ts';
import {
  type ZoomEasingPreset,
  type ZoomBezierCurve,
  type ZoomAnimationClip,
  ZoomBezierCurveCubic,
} from './ZoomAnimation.ts';
import { type ScreenMotionClip } from './ScreenMotion.ts';
import { type CameraMotionClip } from './CameraMotion.ts';
import { type MosaicClip, type StickerClip } from './OverlayTimeline.ts';

// MARK: - RecordingSegment

/// One retained portion of the original recording.
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
  readonly sourceEnd: number;
  readonly outputDuration: number;
}

export const RECORDING_SEGMENT_MINIMUM_PLAYBACK_RATE = 1;
export const RECORDING_SEGMENT_MAXIMUM_PLAYBACK_RATE = 100;

export function makeRecordingSegment(options: {
  id?: string;
  sourceStart: number;
  sourceDuration: number;
  playbackRate?: number;
}): RecordingSegment {
  const playbackRate = options.playbackRate ?? 1;
  return {
    id: options.id ?? newUUID(),
    sourceStart: options.sourceStart,
    sourceDuration: options.sourceDuration,
    playbackRate: Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1,
    get sourceEnd() {
      return this.sourceStart + this.sourceDuration;
    },
    get outputDuration() {
      return this.sourceDuration / this.playbackRate;
    },
  };
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
  sourceEnd: recordingSegmentSourceEnd,
  outputDuration: recordingSegmentOutputDuration,
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
}

export function makeProjectTimeline(options: {
  sourceSequence?: SourceSequence;
  primarySegmentAudioOverrides?: Record<string, PrimarySegmentAudioOverrides>;
  zoomClips?: ZoomAnimationClip[];
  screenMotionClips?: ScreenMotionClip[];
  cameraMotionClips?: CameraMotionClip[];
  mosaicClips?: MosaicClip[];
  stickerClips?: StickerClip[];
} = {}): ProjectTimeline {
  return {
    sourceSequence: options.sourceSequence ?? SourceSequenceFullRecording,
    primarySegmentAudioOverrides: options.primarySegmentAudioOverrides ?? {},
    zoomClips: options.zoomClips ? options.zoomClips.slice() : [],
    screenMotionClips: options.screenMotionClips ? options.screenMotionClips.slice() : [],
    cameraMotionClips: options.cameraMotionClips ? options.cameraMotionClips.slice() : [],
    mosaicClips: options.mosaicClips ? options.mosaicClips.slice() : [],
    stickerClips: options.stickerClips ? options.stickerClips.slice() : [],
  };
}
