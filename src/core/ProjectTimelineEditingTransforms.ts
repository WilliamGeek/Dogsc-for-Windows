// Port of: F:\dogsc\Sources\RecorderCore\ProjectTimelineEditingTransforms.swift

import { min, max, clamp } from './swift.ts';
import {
  type ProjectTimeline,
  type SourceSequence,
  type RecordingSegment,
  type TransitionTiming,
  type PrimarySegmentAudioOverrides,
  primarySegmentAudioOverridesIsEmpty,
  makeRecordingSegment,
  makeTransitionTiming,
} from './ProjectTimeline.ts';
import { type ResolvedRecordingSegment, TimelineMap } from './TimelineMap.ts';
import {
  type ZoomAnimationClip,
  makeZoomAnimationClip,
  type ZoomBezierCurve,
  type NormalizedPoint,
  ZoomInterpolator,
  ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE,
} from './ZoomAnimation.ts';
import { type ScreenMotionClip } from './ScreenMotion.ts';
import { type CameraMotionClip } from './CameraMotion.ts';
import {
  type MosaicClip,
  type StickerClip,
  type OverlayTiming,
  type NormalizedOverlayRect,
  makeOverlayTiming,
  normalizedOverlayRectClamped,
} from './OverlayTimeline.ts';
import { zoomSequenceIsValid } from './ProjectTimelineRetime.ts';

// MARK: - Constants

export const PROJECT_TIMELINE_EDITING_EPSILON = 1.0 / 120_000.0;
const epsilon = PROJECT_TIMELINE_EDITING_EPSILON;

// MARK: - Trim Edge & Tracks

export type RecordingSegmentTrimEdge = 'left' | 'right';

export type ProjectTimelineTrack =
  | 'primaryRecording'
  | 'zoom'
  | 'screenMotion'
  | 'cameraMotion'
  | 'mosaic'
  | 'sticker';

export function projectTimelineTrackUserFacingName(track: ProjectTimelineTrack): string {
  switch (track) {
    case 'primaryRecording':
      return '主片段';
    case 'zoom':
      return '缩放';
    case 'screenMotion':
      return '屏幕 3D';
    case 'cameraMotion':
      return '摄像运动';
    case 'mosaic':
      return '打码';
    case 'sticker':
      return '贴图';
  }
}

// MARK: - ProjectTimelineEditingError

export type ProjectTimelineEditingErrorKind =
  | 'invalidSourceSequence'
  | 'segmentNotFound'
  | 'splitOutsideSegment'
  | 'duplicateSegmentID'
  | 'trimOutsideSegment'
  | 'cannotRemoveFinalSegment'
  | 'restoreJunctionNotFound'
  | 'noRestorableSourceGap'
  | 'noRestorableLeadingSourceGap'
  | 'noRestorableTrailingSourceGap'
  | 'cannotMergeDeletedGap'
  | 'cannotMergeDifferentPlaybackRates'
  | 'cannotMergeDifferentAudioOverrides'
  | 'invalidPrimarySegmentAudioOverrides'
  | 'duplicateClipID'
  | 'missingClip'
  | 'mismatchedClipID'
  | 'invalidClip'
  | 'overlappingClips';

export class ProjectTimelineEditingError extends Error {
  readonly kind: ProjectTimelineEditingErrorKind;
  readonly segmentID?: string;
  readonly clipID?: string;
  readonly firstID?: string;
  readonly secondID?: string;
  readonly expectedID?: string;
  readonly actualID?: string;
  readonly track?: ProjectTimelineTrack;

  constructor(
    kind: ProjectTimelineEditingErrorKind,
    options: {
      segmentID?: string;
      clipID?: string;
      firstID?: string;
      secondID?: string;
      expectedID?: string;
      actualID?: string;
      track?: ProjectTimelineTrack;
    } = {}
  ) {
    let message = kind;
    switch (kind) {
      case 'invalidSourceSequence':
        message = '主录屏片段必须有效、不重复使用源素材且至少保留一段。';
        break;
      case 'segmentNotFound':
        message = '找不到要编辑的主片段。';
        break;
      case 'splitOutsideSegment':
        message = '拆分点必须位于主录屏片段内部。';
        break;
      case 'duplicateSegmentID':
        message = '主片段数据重复，无法继续编辑。';
        break;
      case 'trimOutsideSegment':
        message = '裁切点必须位于当前片段内部，且不能裁成空片段。';
        break;
      case 'cannotRemoveFinalSegment':
        message = '项目必须至少保留一个主录屏片段。';
        break;
      case 'restoreJunctionNotFound':
        message = '找不到要还原的相邻剪切点。';
        break;
      case 'noRestorableSourceGap':
        message = '该剪切点没有可还原的源素材。';
        break;
      case 'noRestorableLeadingSourceGap':
        message = '开头没有可还原的源素材。';
        break;
      case 'noRestorableTrailingSourceGap':
        message = '结尾没有可还原的源素材。';
        break;
      case 'cannotMergeDeletedGap':
        message = '该剪切点包含已删除素材，应先还原而不是直接合并。';
        break;
      case 'cannotMergeDifferentPlaybackRates':
        message = '相邻片段速度不同，无法直接合并。';
        break;
      case 'cannotMergeDifferentAudioOverrides':
        message = '相邻片段的声音设置不同，无法直接合并。';
        break;
      case 'invalidPrimarySegmentAudioOverrides':
        message = '当前片段的声音设置无效。';
        break;
      case 'duplicateClipID':
        message = `${projectTimelineTrackUserFacingName(options.track ?? 'zoom')}轨道中存在重复片段。`;
        break;
      case 'missingClip':
        message = `${projectTimelineTrackUserFacingName(options.track ?? 'zoom')}轨道中找不到要编辑的片段。`;
        break;
      case 'mismatchedClipID':
        message = `${projectTimelineTrackUserFacingName(options.track ?? 'zoom')}轨道中的片段已发生变化，请重新选择后再试。`;
        break;
      case 'invalidClip':
        message = `${projectTimelineTrackUserFacingName(options.track ?? 'zoom')}轨道中存在无效片段。`;
        break;
      case 'overlappingClips':
        message = `${projectTimelineTrackUserFacingName(options.track ?? 'zoom')}轨道中的片段发生重叠。`;
        break;
    }
    super(message);
    this.name = 'ProjectTimelineEditingError';
    this.kind = kind;
    this.segmentID = options.segmentID;
    this.clipID = options.clipID;
    this.firstID = options.firstID;
    this.secondID = options.secondID;
    this.expectedID = options.expectedID;
    this.actualID = options.actualID;
    this.track = options.track;
  }
}

// MARK: - OutputDeletion

export interface OutputDeletion {
  readonly start: number;
  readonly end: number;
  readonly duration: number;
  map(time: number): number;
  overlapDuration(otherStart: number, otherEnd: number): number;
}

export function makeOutputDeletion(start: number, end: number): OutputDeletion {
  return {
    start,
    end,
    get duration(): number {
      return this.end - this.start;
    },
    map(time: number): number {
      if (time <= this.start) return time;
      if (time >= this.end) return time - this.duration;
      return this.start;
    },
    overlapDuration(otherStart: number, otherEnd: number): number {
      return max(0, min(this.end, otherEnd) - max(this.start, otherStart));
    },
  };
}

// MARK: - CompactMap Helper

function compactMap<T, R>(array: readonly T[], transform: (item: T) => R | null | undefined): R[] {
  const result: R[] = [];
  for (const item of array) {
    const mapped = transform(item);
    if (mapped != null) {
      result.push(mapped);
    }
  }
  return result;
}

// MARK: - Sorting & Comparators

export function zoomOrder(lhs: ZoomAnimationClip, rhs: ZoomAnimationClip): boolean {
  return lhs.startTime === rhs.startTime ? lhs.id < rhs.id : lhs.startTime < rhs.startTime;
}

export function zoomCompare(lhs: ZoomAnimationClip, rhs: ZoomAnimationClip): number {
  if (lhs.startTime !== rhs.startTime) return lhs.startTime - rhs.startTime;
  return lhs.id < rhs.id ? -1 : lhs.id > rhs.id ? 1 : 0;
}

export function sortZoom(clips: ZoomAnimationClip[]): void {
  clips.sort(zoomCompare);
}

export function screenMotionOrder(lhs: ScreenMotionClip, rhs: ScreenMotionClip): boolean {
  return lhs.timing.startTime === rhs.timing.startTime
    ? lhs.id < rhs.id
    : lhs.timing.startTime < rhs.timing.startTime;
}

export function screenMotionCompare(lhs: ScreenMotionClip, rhs: ScreenMotionClip): number {
  if (lhs.timing.startTime !== rhs.timing.startTime) {
    return lhs.timing.startTime - rhs.timing.startTime;
  }
  return lhs.id < rhs.id ? -1 : lhs.id > rhs.id ? 1 : 0;
}

export function sortScreenMotion(clips: ScreenMotionClip[]): void {
  clips.sort(screenMotionCompare);
}

export function cameraMotionOrder(lhs: CameraMotionClip, rhs: CameraMotionClip): boolean {
  return lhs.timing.startTime === rhs.timing.startTime
    ? lhs.id < rhs.id
    : lhs.timing.startTime < rhs.timing.startTime;
}

export function cameraMotionCompare(lhs: CameraMotionClip, rhs: CameraMotionClip): number {
  if (lhs.timing.startTime !== rhs.timing.startTime) {
    return lhs.timing.startTime - rhs.timing.startTime;
  }
  return lhs.id < rhs.id ? -1 : lhs.id > rhs.id ? 1 : 0;
}

export function sortCameraMotion(clips: CameraMotionClip[]): void {
  clips.sort(cameraMotionCompare);
}

export function authoredSegment(segment: ResolvedRecordingSegment): RecordingSegment {
  return makeRecordingSegment({
    id: segment.id,
    sourceStart: segment.sourceStart,
    sourceDuration: segment.sourceDuration,
    playbackRate: segment.playbackRate,
  });
}

// MARK: - Validation Primitives

export function validOverlayTiming(timing: OverlayTiming): boolean {
  return (
    Number.isFinite(timing.startTime) &&
    timing.startTime >= 0 &&
    Number.isFinite(timing.duration) &&
    timing.duration > 0 &&
    Number.isFinite(timing.endTime)
  );
}

export function validTransitionTiming(timing: TransitionTiming): boolean {
  return (
    Number.isFinite(timing.startTime) &&
    timing.startTime >= 0 &&
    Number.isFinite(timing.duration) &&
    timing.duration > 0 &&
    Number.isFinite(timing.endTime) &&
    Number.isFinite(timing.leadInProgressOffset) &&
    Number.isFinite(timing.returnProgressOffset) &&
    timing.leadInProgressOffset >= 0 &&
    timing.leadInProgressOffset <= 1 &&
    timing.returnProgressOffset >= 0 &&
    timing.returnProgressOffset <= 1 &&
    Number.isFinite(timing.leadInDuration) &&
    timing.leadInDuration >= 0 &&
    timing.leadInDuration <= 5 &&
    Number.isFinite(timing.returnDuration) &&
    timing.returnDuration >= 0 &&
    timing.returnDuration <= 5 &&
    (timing.preferredLeadInDuration == null ||
      (Number.isFinite(timing.preferredLeadInDuration) &&
        timing.preferredLeadInDuration >= 0 &&
        timing.preferredLeadInDuration <= 5)) &&
    (timing.preferredReturnDuration == null ||
      (Number.isFinite(timing.preferredReturnDuration) &&
        timing.preferredReturnDuration >= 0 &&
        timing.preferredReturnDuration <= 5)) &&
    validZoomBezierCurve(timing.customCurve)
  );
}

export function validZoomBezierCurve(curve: ZoomBezierCurve): boolean {
  return (
    Number.isFinite(curve.x1) &&
    Number.isFinite(curve.y1) &&
    Number.isFinite(curve.x2) &&
    Number.isFinite(curve.y2)
  );
}

export function validNormalizedPoint(point: NormalizedPoint): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.x <= 1 &&
    point.y >= 0 &&
    point.y <= 1
  );
}

export function primarySegmentIDs(sequence: SourceSequence): Set<string> {
  switch (sequence.kind) {
    case 'fullRecording':
      return new Set([TimelineMap.fullRecordingSegmentID]);
    case 'edited':
      return new Set(sequence.segments.map(s => s.id));
  }
}

export function prunedPrimarySegmentAudioOverrides(
  overrides: Record<string, PrimarySegmentAudioOverrides>,
  sourceSequence: SourceSequence
): Record<string, PrimarySegmentAudioOverrides> {
  const validIDs = primarySegmentIDs(sourceSequence);
  const result: Record<string, PrimarySegmentAudioOverrides> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (validIDs.has(key) && !primarySegmentAudioOverridesIsEmpty(value)) {
      result[key] = value;
    }
  }
  return result;
}

export function validatePrimarySegmentAudioOverrides(
  overrides: Record<string, PrimarySegmentAudioOverrides>,
  sourceSequence: SourceSequence
): void {
  const validIDs = primarySegmentIDs(sourceSequence);
  for (const [id, value] of Object.entries(overrides)) {
    const volumes: number[] = [];
    if (value.systemVolume != null) volumes.push(value.systemVolume);
    if (value.microphoneVolume != null) volumes.push(value.microphoneVolume);
    const validVolumes = volumes.every(v => Number.isFinite(v) && v >= 0 && v <= 1);
    if (!validIDs.has(id) || primarySegmentAudioOverridesIsEmpty(value) || !validVolumes) {
      throw new ProjectTimelineEditingError('invalidPrimarySegmentAudioOverrides', {
        segmentID: id,
      });
    }
  }
}

export function validateSourceSequence(sequence: SourceSequence): void {
  if (sequence.kind !== 'edited') return;
  const segments = sequence.segments;
  if (segments.length === 0) {
    throw new ProjectTimelineEditingError('invalidSourceSequence');
  }
  const identifiers = new Set<string>();
  for (const segment of segments) {
    if (identifiers.has(segment.id)) {
      throw new ProjectTimelineEditingError('duplicateSegmentID', { segmentID: segment.id });
    }
    identifiers.add(segment.id);
    if (
      !Number.isFinite(segment.sourceStart) ||
      !Number.isFinite(segment.sourceDuration) ||
      !Number.isFinite(segment.playbackRate) ||
      segment.sourceStart < 0 ||
      segment.sourceDuration <= 0 ||
      segment.playbackRate <= 0 ||
      !Number.isFinite(segment.sourceEnd)
    ) {
      throw new ProjectTimelineEditingError('invalidSourceSequence');
    }
  }
  for (const current of segments) {
    if (
      segments.some(
        other =>
          other.id !== current.id &&
          current.sourceStart < other.sourceEnd - epsilon &&
          current.sourceEnd > other.sourceStart + epsilon
      )
    ) {
      throw new ProjectTimelineEditingError('invalidSourceSequence');
    }
  }
}

export function validateZoomClips(clips: readonly ZoomAnimationClip[]): void {
  const identifiers = new Set<string>();
  let previous: ZoomAnimationClip | null = null;
  const sorted = clips.slice();
  sortZoom(sorted);

  for (const clip of sorted) {
    if (identifiers.has(clip.id)) {
      throw new ProjectTimelineEditingError('duplicateClipID', { track: 'zoom', clipID: clip.id });
    }
    identifiers.add(clip.id);

    const validExit =
      Number.isFinite(clip.exitDuration) && clip.exitDuration >= 0 && clip.exitDuration <= 5;
    const validEnter =
      Number.isFinite(clip.enterDuration) && clip.enterDuration >= 0 && clip.enterDuration <= 5;
    const validPrefEnter =
      clip.preferredEnterDuration == null ||
      (Number.isFinite(clip.preferredEnterDuration) &&
        clip.preferredEnterDuration >= 0 &&
        clip.preferredEnterDuration <= 5);
    const validPrefExit =
      clip.preferredExitDuration == null ||
      (Number.isFinite(clip.preferredExitDuration) &&
        clip.preferredExitDuration >= 0 &&
        clip.preferredExitDuration <= 5);

    if (
      !Number.isFinite(clip.startTime) ||
      !Number.isFinite(clip.endTime) ||
      clip.startTime < 0 ||
      clip.endTime < clip.startTime ||
      !Number.isFinite(clip.scale) ||
      clip.scale < 1 ||
      !validNormalizedPoint(clip.focus) ||
      !validEnter ||
      !validExit ||
      !Number.isFinite(clip.enterProgressOffset) ||
      !Number.isFinite(clip.exitProgressOffset) ||
      clip.enterProgressOffset < 0 ||
      clip.enterProgressOffset > 1 ||
      clip.exitProgressOffset < 0 ||
      clip.exitProgressOffset > 1 ||
      !validPrefEnter ||
      !validPrefExit ||
      !validZoomBezierCurve(clip.customCurve) ||
      (clip.focusEffect != null && !clip.focusEffect.isValid)
    ) {
      throw new ProjectTimelineEditingError('invalidClip', { track: 'zoom', clipID: clip.id });
    }

    if (previous && !zoomSequenceIsValid(previous, clip)) {
      throw new ProjectTimelineEditingError('overlappingClips', {
        track: 'zoom',
        firstID: previous.id,
        secondID: clip.id,
      });
    }
    previous = clip;
  }
}

export function validateScreenMotionClips(clips: readonly ScreenMotionClip[]): void {
  const identifiers = new Set<string>();
  let previous: ScreenMotionClip | null = null;
  const sorted = clips.slice();
  sortScreenMotion(sorted);

  for (const clip of sorted) {
    if (identifiers.has(clip.id)) {
      throw new ProjectTimelineEditingError('duplicateClipID', {
        track: 'screenMotion',
        clipID: clip.id,
      });
    }
    identifiers.add(clip.id);
    const target = clip.target;

    if (
      !validTransitionTiming(clip.timing) ||
      !validNormalizedPoint(target.position) ||
      !Number.isFinite(target.scale) ||
      target.scale <= 0 ||
      !Number.isFinite(target.rotationX) ||
      !Number.isFinite(target.rotationY) ||
      !Number.isFinite(target.rotationZ) ||
      !Number.isFinite(target.perspective) ||
      target.perspective < 0 ||
      (clip.focusEffect != null && !clip.focusEffect.isValid)
    ) {
      throw new ProjectTimelineEditingError('invalidClip', {
        track: 'screenMotion',
        clipID: clip.id,
      });
    }

    if (previous) {
      const gap = clip.timing.startTime - previous.timing.endTime;
      const touches = gap <= ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE;
      const clears = clip.timing.startTime >= previous.timing.effectEndTime - epsilon;
      if (clip.timing.startTime < previous.timing.endTime - epsilon || (!touches && !clears)) {
        throw new ProjectTimelineEditingError('overlappingClips', {
          track: 'screenMotion',
          firstID: previous.id,
          secondID: clip.id,
        });
      }
    }
    previous = clip;
  }
}

export function validateCameraMotionClips(clips: readonly CameraMotionClip[]): void {
  const identifiers = new Set<string>();
  let previous: CameraMotionClip | null = null;
  const sorted = clips.slice();
  sortCameraMotion(sorted);

  for (const clip of sorted) {
    if (identifiers.has(clip.id)) {
      throw new ProjectTimelineEditingError('duplicateClipID', {
        track: 'cameraMotion',
        clipID: clip.id,
      });
    }
    identifiers.add(clip.id);
    const target = clip.target;

    if (
      !validTransitionTiming(clip.timing) ||
      !validNormalizedPoint(target.position) ||
      !Number.isFinite(target.size) ||
      target.size <= 0 ||
      !Number.isFinite(target.roundness) ||
      target.roundness < 0 ||
      target.roundness > 1 ||
      !Number.isFinite(target.opacity) ||
      target.opacity < 0 ||
      target.opacity > 1
    ) {
      throw new ProjectTimelineEditingError('invalidClip', {
        track: 'cameraMotion',
        clipID: clip.id,
      });
    }

    if (previous) {
      const gap = clip.timing.startTime - previous.timing.endTime;
      const touches = gap <= ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE;
      const clears = clip.timing.startTime >= previous.timing.effectEndTime - epsilon;
      if (clip.timing.startTime < previous.timing.endTime - epsilon || (!touches && !clears)) {
        throw new ProjectTimelineEditingError('overlappingClips', {
          track: 'cameraMotion',
          firstID: previous.id,
          secondID: clip.id,
        });
      }
    }
    previous = clip;
  }
}

export function validateMosaicClips(clips: readonly MosaicClip[]): void {
  const identifiers = new Set<string>();
  for (const clip of clips) {
    if (identifiers.has(clip.id)) {
      throw new ProjectTimelineEditingError('duplicateClipID', {
        track: 'mosaic',
        clipID: clip.id,
      });
    }
    identifiers.add(clip.id);

    const rect = clip.sourceRect;
    const clamped = normalizedOverlayRectClamped(rect);
    const isClamped =
      rect.x === clamped.x &&
      rect.y === clamped.y &&
      rect.width === clamped.width &&
      rect.height === clamped.height;

    if (
      !validOverlayTiming(clip.timing) ||
      !isClamped ||
      !Number.isFinite(clip.cornerRadius) ||
      clip.cornerRadius < 0 ||
      clip.cornerRadius > 0.5 ||
      !Number.isFinite(clip.intensity) ||
      clip.intensity < 0 ||
      clip.intensity > 1 ||
      !Number.isFinite(clip.spotlightDimming) ||
      clip.spotlightDimming < 0 ||
      clip.spotlightDimming > 0.75 ||
      !Number.isFinite(clip.transitionInDuration) ||
      clip.transitionInDuration < 0 ||
      clip.transitionInDuration > 5 ||
      !Number.isFinite(clip.transitionOutDuration) ||
      clip.transitionOutDuration < 0 ||
      clip.transitionOutDuration > 5
    ) {
      throw new ProjectTimelineEditingError('invalidClip', {
        track: 'mosaic',
        clipID: clip.id,
      });
    }
  }
}

export function validateStickerClips(clips: readonly StickerClip[]): void {
  const identifiers = new Set<string>();
  for (const clip of clips) {
    if (identifiers.has(clip.id)) {
      throw new ProjectTimelineEditingError('duplicateClipID', {
        track: 'sticker',
        clipID: clip.id,
      });
    }
    identifiers.add(clip.id);

    const components = clip.relativePath.split('/');
    if (
      !validOverlayTiming(clip.timing) ||
      clip.relativePath.length === 0 ||
      clip.relativePath.startsWith('/') ||
      components.includes('..') ||
      !validNormalizedPoint(clip.position) ||
      !Number.isFinite(clip.width) ||
      clip.width < 0.02 ||
      clip.width > 1.5 ||
      !Number.isFinite(clip.rotationDegrees) ||
      clip.rotationDegrees < -1080 ||
      clip.rotationDegrees > 1080 ||
      !Number.isFinite(clip.opacity) ||
      clip.opacity < 0 ||
      clip.opacity > 1 ||
      !Number.isFinite(clip.cornerRadius) ||
      clip.cornerRadius < 0 ||
      clip.cornerRadius > 500 ||
      !Number.isFinite(clip.borderWidth) ||
      clip.borderWidth < 0 ||
      clip.borderWidth > 60 ||
      !Number.isFinite(clip.shadowOpacity) ||
      clip.shadowOpacity < 0 ||
      clip.shadowOpacity > 1 ||
      !Number.isFinite(clip.shadowRadius) ||
      clip.shadowRadius < 0 ||
      clip.shadowRadius > 160 ||
      !Number.isFinite(clip.shadowOffsetX) ||
      !Number.isFinite(clip.shadowOffsetY) ||
      !Number.isFinite(clip.enterDuration) ||
      clip.enterDuration < 0 ||
      clip.enterDuration > 5 ||
      !Number.isFinite(clip.exitDuration) ||
      clip.exitDuration < 0 ||
      clip.exitDuration > 5 ||
      !Number.isFinite(clip.backdropBlur) ||
      clip.backdropBlur < 0 ||
      clip.backdropBlur > 96
    ) {
      throw new ProjectTimelineEditingError('invalidClip', {
        track: 'sticker',
        clipID: clip.id,
      });
    }
  }
}

export function validateProjectTimeline(timeline: ProjectTimeline): void {
  validateSourceSequence(timeline.sourceSequence);
  validatePrimarySegmentAudioOverrides(
    timeline.primarySegmentAudioOverrides,
    timeline.sourceSequence
  );
  validateZoomClips(timeline.zoomClips);
  validateScreenMotionClips(timeline.screenMotionClips);
  validateCameraMotionClips(timeline.cameraMotionClips);
  validateMosaicClips(timeline.mosaicClips);
  validateStickerClips(timeline.stickerClips);
}

export function validateProjectTimelineWithSourceDuration(
  timeline: ProjectTimeline,
  fullSourceDuration: number
): void {
  new TimelineMap({
    sourceSequence: timeline.sourceSequence,
    fullSourceDuration,
  });
  validateProjectTimeline(timeline);
}

// MARK: - Inserting Overloads

export function insertingZoom(
  clip: ZoomAnimationClip,
  insertionTime: number,
  duration: number
): ZoomAnimationClip {
  let startTime = clip.startTime;
  let endTime = clip.endTime;
  if (clip.startTime >= insertionTime - epsilon) {
    startTime += duration;
    endTime += duration;
  } else if (clip.endTime > insertionTime + epsilon) {
    // The restored content lies inside an existing hold interval. Keep
    // the downstream edge attached to the same original material.
    endTime += duration;
  }
  return makeZoomAnimationClip({
    ...clip,
    startTime,
    endTime,
  });
}

export function insertingTransitionTiming(
  timing: TransitionTiming,
  insertionTime: number,
  duration: number
): TransitionTiming {
  let startTime = timing.startTime;
  let dur = timing.duration;
  if (timing.startTime >= insertionTime - epsilon) {
    startTime += duration;
  } else if (timing.endTime > insertionTime + epsilon) {
    dur += duration;
  }
  return makeTransitionTiming({
    ...timing,
    startTime,
    duration: dur,
  });
}

export function insertingScreenMotion(
  clip: ScreenMotionClip,
  insertionTime: number,
  duration: number
): ScreenMotionClip {
  return {
    ...clip,
    timing: insertingTransitionTiming(clip.timing, insertionTime, duration),
  };
}

export function insertingCameraMotion(
  clip: CameraMotionClip,
  insertionTime: number,
  duration: number
): CameraMotionClip {
  return {
    ...clip,
    timing: insertingTransitionTiming(clip.timing, insertionTime, duration),
  };
}

export function insertingOverlayTiming(
  timing: OverlayTiming,
  insertionTime: number,
  duration: number
): OverlayTiming {
  let startTime = timing.startTime;
  let dur = timing.duration;
  if (timing.startTime >= insertionTime - epsilon) {
    startTime += duration;
  } else if (timing.endTime > insertionTime + epsilon) {
    dur += duration;
  }
  return makeOverlayTiming({
    startTime,
    duration: dur,
  });
}

export function insertingMosaic(
  clip: MosaicClip,
  insertionTime: number,
  duration: number
): MosaicClip {
  return {
    ...clip,
    timing: insertingOverlayTiming(clip.timing, insertionTime, duration),
  };
}

export function insertingSticker(
  clip: StickerClip,
  insertionTime: number,
  duration: number
): StickerClip {
  return {
    ...clip,
    timing: insertingOverlayTiming(clip.timing, insertionTime, duration),
  };
}

// MARK: - Ripple Overloads

export function rippleOverlayTiming(
  timing: OverlayTiming,
  deletion: OutputDeletion,
  deletesOutputTail: boolean
): OverlayTiming | null {
  if (timing.endTime <= deletion.start + epsilon) return timing;
  if (deletesOutputTail) {
    if (timing.startTime >= deletion.start - epsilon) return null;
    return makeOverlayTiming({
      startTime: timing.startTime,
      duration: max(deletion.start - timing.startTime, 0),
    });
  }
  if (timing.startTime >= deletion.end - epsilon) {
    return makeOverlayTiming({
      startTime: timing.startTime - deletion.duration,
      duration: timing.duration,
    });
  }
  if (
    timing.startTime >= deletion.start - epsilon &&
    timing.endTime <= deletion.end + epsilon
  ) {
    return null;
  }
  const start = deletion.map(timing.startTime);
  const end = deletion.map(timing.endTime);
  if (end - start <= epsilon) return null;
  return makeOverlayTiming({
    startTime: start,
    duration: end - start,
  });
}

export function rippleMosaic(
  clip: MosaicClip,
  deletion: OutputDeletion,
  deletesOutputTail: boolean
): MosaicClip | null {
  const timing = rippleOverlayTiming(clip.timing, deletion, deletesOutputTail);
  if (!timing) return null;
  return {
    ...clip,
    timing,
  };
}

export function rippleSticker(
  clip: StickerClip,
  deletion: OutputDeletion,
  deletesOutputTail: boolean
): StickerClip | null {
  const timing = rippleOverlayTiming(clip.timing, deletion, deletesOutputTail);
  if (!timing) return null;
  return {
    ...clip,
    timing,
  };
}

export function continuedPhaseOffset(
  originalOffset: number,
  phaseStart: number,
  phaseDuration: number,
  deletion: OutputDeletion
): number {
  const safeOffset = min(max(originalOffset, 0), 1);
  if (
    !(phaseDuration > epsilon) ||
    !(phaseStart >= deletion.start - epsilon) ||
    !(phaseStart < deletion.end - epsilon)
  ) {
    return safeOffset;
  }
  const elapsed = min(max((deletion.start - phaseStart) / phaseDuration, 0), 1);
  return safeOffset + (1 - safeOffset) * elapsed;
}

export function rippleZoom(
  clip: ZoomAnimationClip,
  deletion: OutputDeletion,
  deletesOutputTail: boolean
): ZoomAnimationClip | null {
  clip.preserveTransitionIntent();
  if (clip.effectEndTime <= deletion.start + epsilon) {
    return clip;
  }
  if (deletesOutputTail) {
    return clip.startTime >= deletion.start - epsilon ? null : clip;
  }
  if (clip.startTime >= deletion.end - epsilon) {
    return makeZoomAnimationClip({
      ...clip,
      startTime: clip.startTime - deletion.duration,
      endTime: clip.endTime - deletion.duration,
    });
  }
  if (
    clip.startTime >= deletion.start - epsilon &&
    clip.endTime <= deletion.end + epsilon
  ) {
    return null;
  }

  const oldEnterEnd = min(clip.startTime + clip.enterDuration, clip.endTime);
  const newStart = deletion.map(clip.startTime);
  const newEnd = deletion.map(clip.endTime);
  const newEnterEnd = deletion.map(oldEnterEnd);
  const newEffectEnd = deletion.map(clip.effectEndTime);
  if (newEnd - newStart <= epsilon) return null;

  const mappedEnter = max(0, min(newEnterEnd - newStart, newEnd - newStart));
  const enterProgressOffset = continuedPhaseOffset(
    clip.enterProgressOffset,
    clip.startTime,
    min(clip.enterDuration, clip.duration),
    deletion
  );
  const mappedExit = max(0, newEffectEnd - newEnd);
  const exitProgressOffset = continuedPhaseOffset(
    clip.exitProgressOffset,
    clip.endTime,
    clip.exitDuration,
    deletion
  );

  return makeZoomAnimationClip({
    ...clip,
    startTime: newStart,
    endTime: newEnd,
    enterDuration: mappedEnter,
    enterProgressOffset,
    exitDuration: mappedExit,
    exitProgressOffset,
  });
}

export function rippleTransitionTiming(
  timing: TransitionTiming,
  deletion: OutputDeletion,
  deletesOutputTail: boolean
): TransitionTiming | null {
  timing.preserveTransitionIntent();
  if (timing.effectEndTime <= deletion.start + epsilon) {
    return timing;
  }
  if (
    timing.startTime >= deletion.start - epsilon &&
    timing.endTime <= deletion.end + epsilon
  ) {
    return null;
  }
  if (deletesOutputTail) {
    return timing.startTime >= deletion.start - epsilon ? null : timing;
  }
  if (timing.startTime >= deletion.end - epsilon) {
    return makeTransitionTiming({
      ...timing,
      startTime: timing.startTime - deletion.duration,
    });
  }

  const oldLeadInEnd = timing.leadInEndTime;
  const newStart = deletion.map(timing.startTime);
  const newEnd = deletion.map(timing.endTime);
  if (newEnd - newStart <= epsilon) return null;
  const newLeadInEnd = deletion.map(oldLeadInEnd);
  const newEffectEnd = deletion.map(timing.effectEndTime);

  const duration = newEnd - newStart;
  const mappedLeadIn = max(0, min(newLeadInEnd - newStart, duration));
  const leadInProgressOffset = continuedPhaseOffset(
    timing.leadInProgressOffset,
    timing.startTime,
    min(timing.leadInDuration, timing.duration),
    deletion
  );
  const mappedReturn = max(0, newEffectEnd - newEnd);
  const returnProgressOffset = continuedPhaseOffset(
    timing.returnProgressOffset,
    timing.endTime,
    timing.returnDuration,
    deletion
  );

  return makeTransitionTiming({
    ...timing,
    startTime: newStart,
    duration,
    leadInDuration: mappedLeadIn,
    leadInProgressOffset,
    returnDuration: mappedReturn,
    returnProgressOffset,
  });
}

export function rippleScreenMotion(
  clip: ScreenMotionClip,
  deletion: OutputDeletion,
  deletesOutputTail: boolean
): ScreenMotionClip | null {
  const timing = rippleTransitionTiming(clip.timing, deletion, deletesOutputTail);
  if (!timing) return null;
  return {
    ...clip,
    timing,
  };
}

export function rippleCameraMotion(
  clip: CameraMotionClip,
  deletion: OutputDeletion,
  deletesOutputTail: boolean
): CameraMotionClip | null {
  const timing = rippleTransitionTiming(clip.timing, deletion, deletesOutputTail);
  if (!timing) return null;
  return {
    ...clip,
    timing,
  };
}

// MARK: - Restoring Entries & Returns After Ripple

export function restoredEntryAfterRipple(
  startTime: number,
  entryDuration: number,
  requestedDuration: number,
  progressOffset: number,
  retainedDuration: number,
  deletion: OutputDeletion
): { duration: number; progressOffset: number } | null {
  if (
    !(entryDuration > epsilon) ||
    !(startTime < deletion.end - epsilon) ||
    !(startTime + entryDuration > deletion.start + epsilon)
  ) {
    return null;
  }
  return {
    duration: min(requestedDuration, retainedDuration),
    progressOffset: startTime >= deletion.start - epsilon ? 0 : progressOffset,
  };
}

export function restoredZoomLeadInsAtRippleJunction(
  original: readonly ZoomAnimationClip[],
  mapped: readonly ZoomAnimationClip[],
  deletion: OutputDeletion
): ZoomAnimationClip[] {
  const result: ZoomAnimationClip[] = [];
  for (const clip of mapped) {
    const old = original.find(o => o.id === clip.id);
    if (!old) {
      result.push(clip);
      continue;
    }
    const entry = restoredEntryAfterRipple(
      old.startTime,
      min(old.enterDuration, old.duration),
      old.requestedEnterDuration,
      old.enterProgressOffset,
      clip.duration,
      deletion
    );
    if (!entry) {
      result.push(clip);
      continue;
    }
    result.push(
      makeZoomAnimationClip({
        ...clip,
        enterDuration: entry.duration,
        enterProgressOffset: entry.progressOffset,
      })
    );
  }
  return result;
}

export function restoringEntryAfterRipple(
  original: TransitionTiming,
  mapped: TransitionTiming,
  deletion: OutputDeletion
): TransitionTiming {
  const entry = restoredEntryAfterRipple(
    original.startTime,
    min(original.leadInDuration, original.duration),
    original.requestedLeadInDuration,
    original.leadInProgressOffset,
    mapped.duration,
    deletion
  );
  if (!entry) return mapped;
  return makeTransitionTiming({
    ...mapped,
    leadInDuration: entry.duration,
    leadInProgressOffset: entry.progressOffset,
  });
}

export function restoredScreenLeadInsAtRippleJunction(
  original: readonly ScreenMotionClip[],
  mapped: readonly ScreenMotionClip[],
  deletion: OutputDeletion
): ScreenMotionClip[] {
  return mapped.map(clip => {
    const old = original.find(o => o.id === clip.id);
    if (!old) return clip;
    return {
      ...clip,
      timing: restoringEntryAfterRipple(old.timing, clip.timing, deletion),
    };
  });
}

export function restoredCameraLeadInsAtRippleJunction(
  original: readonly CameraMotionClip[],
  mapped: readonly CameraMotionClip[],
  deletion: OutputDeletion
): CameraMotionClip[] {
  return mapped.map(clip => {
    const old = original.find(o => o.id === clip.id);
    if (!old) return clip;
    return {
      ...clip,
      timing: restoringEntryAfterRipple(old.timing, clip.timing, deletion),
    };
  });
}

export function restoredZoomReturnsAtRippleJunction(
  original: readonly ZoomAnimationClip[],
  mapped: readonly ZoomAnimationClip[],
  deletion: OutputDeletion,
  defaultTransition: number
): ZoomAnimationClip[] {
  const result = mapped.slice();
  sortZoom(result);

  for (let index = 0; index < result.length; index++) {
    const old = original.find(o => o.id === result[index].id);
    if (!old) continue;
    const requested = old.requestedExitDuration(defaultTransition);
    const next = index + 1 < result.length ? result[index + 1] : null;
    const gap = next ? max(next.startTime - result[index].endTime, 0) : null;
    const touchesNext = gap != null ? gap <= ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE : false;

    let preferredExitDuration = requested;
    if (touchesNext) {
      result[index] = makeZoomAnimationClip({
        ...result[index],
        preferredExitDuration,
      });
      continue;
    }

    const exitDuration = min(requested, gap ?? requested);
    const exitProgressOffset =
      old.endTime >= deletion.start - epsilon && old.endTime < deletion.end - epsilon
        ? 0
        : old.exitProgressOffset;
    const finalExitOffset = old.exitDuration <= epsilon ? 0 : exitProgressOffset;

    result[index] = makeZoomAnimationClip({
      ...result[index],
      preferredExitDuration,
      exitDuration,
      exitProgressOffset: finalExitOffset,
    });
  }
  return result;
}

export function restoredScreenReturnsAtRippleJunction(
  original: readonly ScreenMotionClip[],
  mapped: readonly ScreenMotionClip[],
  deletion: OutputDeletion,
  defaultTransition: number
): ScreenMotionClip[] {
  const originals = new Map(original.map(c => [c.id, c]));
  const oldOrdered = original.slice();
  sortScreenMotion(oldOrdered);
  const result = mapped.slice();
  sortScreenMotion(result);

  for (let index = 0; index < result.length; index++) {
    const old = originals.get(result[index].id);
    if (!old) continue;
    const oldIndex = oldOrdered.findIndex(o => o.id === old.id);
    const touchedOldSuccessor =
      oldIndex >= 0 &&
      oldIndex + 1 < oldOrdered.length &&
      Math.abs(oldOrdered[oldIndex + 1].timing.startTime - old.timing.endTime) <=
        ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE;

    if (
      old.timing.returnDuration <= epsilon &&
      old.timing.preferredReturnDuration == null &&
      !touchedOldSuccessor
    ) {
      result[index] = {
        ...result[index],
        timing: makeTransitionTiming({
          ...result[index].timing,
          preferredReturnDuration: 0,
        }),
      };
      continue;
    }

    const requested = old.timing.requestedReturnDuration(defaultTransition);
    const gap: number | null =
      index + 1 < result.length
        ? max(result[index + 1].timing.startTime - result[index].timing.endTime, 0)
        : null;

    if (gap != null && gap <= ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE) {
      result[index] = {
        ...result[index],
        timing: makeTransitionTiming({
          ...result[index].timing,
          preferredReturnDuration: requested,
        }),
      };
      continue;
    }

    const returnDuration = min(requested, gap ?? requested);
    const returnProgressOffset =
      old.timing.endTime >= deletion.start - epsilon && old.timing.endTime < deletion.end - epsilon
        ? 0
        : old.timing.returnProgressOffset;
    const finalReturnOffset = old.timing.returnDuration <= epsilon ? 0 : returnProgressOffset;

    result[index] = {
      ...result[index],
      timing: makeTransitionTiming({
        ...result[index].timing,
        preferredReturnDuration: requested,
        returnDuration,
        returnProgressOffset: finalReturnOffset,
      }),
    };
  }
  return result;
}

export function restoredCameraReturnsAtRippleJunction(
  original: readonly CameraMotionClip[],
  mapped: readonly CameraMotionClip[],
  deletion: OutputDeletion,
  defaultTransition: number
): CameraMotionClip[] {
  const originals = new Map(original.map(c => [c.id, c]));
  const oldOrdered = original.slice();
  sortCameraMotion(oldOrdered);
  const result = mapped.slice();
  sortCameraMotion(result);

  for (let index = 0; index < result.length; index++) {
    const old = originals.get(result[index].id);
    if (!old) continue;
    const oldIndex = oldOrdered.findIndex(o => o.id === old.id);
    const touchedOldSuccessor =
      oldIndex >= 0 &&
      oldIndex + 1 < oldOrdered.length &&
      Math.abs(oldOrdered[oldIndex + 1].timing.startTime - old.timing.endTime) <=
        ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE;

    if (
      old.timing.returnDuration <= epsilon &&
      old.timing.preferredReturnDuration == null &&
      !touchedOldSuccessor
    ) {
      result[index] = {
        ...result[index],
        timing: makeTransitionTiming({
          ...result[index].timing,
          preferredReturnDuration: 0,
        }),
      };
      continue;
    }

    const requested = old.timing.requestedReturnDuration(defaultTransition);
    const gap: number | null =
      index + 1 < result.length
        ? max(result[index + 1].timing.startTime - result[index].timing.endTime, 0)
        : null;

    if (gap != null && gap <= ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE) {
      result[index] = {
        ...result[index],
        timing: makeTransitionTiming({
          ...result[index].timing,
          preferredReturnDuration: requested,
        }),
      };
      continue;
    }

    const returnDuration = min(requested, gap ?? requested);
    const returnProgressOffset =
      old.timing.endTime >= deletion.start - epsilon && old.timing.endTime < deletion.end - epsilon
        ? 0
        : old.timing.returnProgressOffset;
    const finalReturnOffset = old.timing.returnDuration <= epsilon ? 0 : returnProgressOffset;

    result[index] = {
      ...result[index],
      timing: makeTransitionTiming({
        ...result[index].timing,
        preferredReturnDuration: requested,
        returnDuration,
        returnProgressOffset: finalReturnOffset,
      }),
    };
  }
  return result;
}

// MARK: - Reordering Offsets & Remapped Clips

export function reorderedOutputOffset(
  oldOutputTime: number,
  oldMap: TimelineMap,
  newStarts: ReadonlyMap<string, number> | Record<string, number>
): number {
  const probe = min(max(oldOutputTime, 0), max(oldMap.outputDuration - epsilon, 0));
  const owner = oldMap.segmentAtOutputTime(probe);
  if (!owner) return 0;
  const newStart =
    newStarts instanceof Map ? newStarts.get(owner.id) : (newStarts as Record<string, number>)[owner.id];
  if (newStart == null) return 0;
  return newStart - owner.outputStart;
}

export function remappedZoomClips(
  clips: readonly ZoomAnimationClip[],
  oldMap: TimelineMap,
  newStarts: ReadonlyMap<string, number> | Record<string, number>,
  outputDuration: number
): ZoomAnimationClip[] {
  const translated = compactMap(clips, clip => {
    const delta = reorderedOutputOffset(clip.startTime, oldMap, newStarts);
    clip.preserveTransitionIntent();
    const startTime = min(max(clip.startTime + delta, 0), outputDuration);
    const endTime = min(max(clip.endTime + delta, startTime), outputDuration);
    const dur = max(endTime - startTime, 0);
    const enterDuration = min(clip.enterDuration, dur);
    const exitDuration = min(clip.exitDuration, max(outputDuration - endTime, 0));
    if (dur <= epsilon) return null;
    return makeZoomAnimationClip({
      ...clip,
      startTime,
      endTime,
      enterDuration,
      exitDuration,
    });
  });
  sortZoom(translated);

  const normalized: ZoomAnimationClip[] = [];
  for (const clip of translated) {
    if (normalized.length > 0) {
      let previous = normalized.pop()!;
      if (previous.endTime > clip.startTime) {
        const endTime = max(clip.startTime, previous.startTime);
        const dur = max(endTime - previous.startTime, 0);
        previous = makeZoomAnimationClip({
          ...previous,
          endTime,
          enterDuration: min(previous.enterDuration, dur),
        });
      }
      if (previous.duration > epsilon) {
        const gap = max(clip.startTime - previous.endTime, 0);
        if (gap > ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE) {
          previous = makeZoomAnimationClip({
            ...previous,
            exitDuration: min(previous.exitDuration, gap),
          });
        }
        normalized.push(previous);
      }
    }
    normalized.push(clip);
  }
  return normalized;
}

export function normalizedScreenMotionSequence(
  clips: readonly ScreenMotionClip[]
): ScreenMotionClip[] {
  const normalized: ScreenMotionClip[] = [];
  for (const clip of clips) {
    if (normalized.length > 0) {
      let previous = normalized.pop()!;
      if (previous.timing.endTime > clip.timing.startTime) {
        const dur = max(clip.timing.startTime - previous.timing.startTime, 0);
        previous = {
          ...previous,
          timing: makeTransitionTiming({
            ...previous.timing,
            duration: dur,
            leadInDuration: min(previous.timing.leadInDuration, dur),
          }),
        };
      }
      if (previous.timing.duration > epsilon) {
        const gap = max(clip.timing.startTime - previous.timing.endTime, 0);
        if (gap > ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE) {
          previous = {
            ...previous,
            timing: makeTransitionTiming({
              ...previous.timing,
              returnDuration: min(previous.timing.returnDuration, gap),
            }),
          };
        }
        normalized.push(previous);
      }
    }
    normalized.push(clip);
  }
  return normalized;
}

export function remappedScreenMotionClips(
  clips: readonly ScreenMotionClip[],
  oldMap: TimelineMap,
  newStarts: ReadonlyMap<string, number> | Record<string, number>,
  outputDuration: number
): ScreenMotionClip[] {
  const translated = compactMap(clips, clip => {
    const delta = reorderedOutputOffset(clip.timing.startTime, oldMap, newStarts);
    const startTime = min(max(clip.timing.startTime + delta, 0), outputDuration);
    const duration = min(clip.timing.duration, max(outputDuration - startTime, 0));
    const leadInDuration = min(clip.timing.leadInDuration, duration);
    const returnDuration = min(clip.timing.returnDuration, max(outputDuration - (startTime + duration), 0));
    if (duration <= epsilon) return null;
    return {
      ...clip,
      timing: makeTransitionTiming({
        ...clip.timing,
        startTime,
        duration,
        leadInDuration,
        returnDuration,
      }),
    };
  });
  sortScreenMotion(translated);
  return normalizedScreenMotionSequence(translated);
}

export function normalizedCameraMotionSequence(
  clips: readonly CameraMotionClip[]
): CameraMotionClip[] {
  const normalized: CameraMotionClip[] = [];
  for (const clip of clips) {
    if (normalized.length > 0) {
      let previous = normalized.pop()!;
      if (previous.timing.endTime > clip.timing.startTime) {
        const dur = max(clip.timing.startTime - previous.timing.startTime, 0);
        previous = {
          ...previous,
          timing: makeTransitionTiming({
            ...previous.timing,
            duration: dur,
            leadInDuration: min(previous.timing.leadInDuration, dur),
          }),
        };
      }
      if (previous.timing.duration > epsilon) {
        const gap = max(clip.timing.startTime - previous.timing.endTime, 0);
        if (gap > ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE) {
          previous = {
            ...previous,
            timing: makeTransitionTiming({
              ...previous.timing,
              returnDuration: min(previous.timing.returnDuration, gap),
            }),
          };
        }
        normalized.push(previous);
      }
    }
    normalized.push(clip);
  }
  return normalized;
}

export function remappedCameraMotionClips(
  clips: readonly CameraMotionClip[],
  oldMap: TimelineMap,
  newStarts: ReadonlyMap<string, number> | Record<string, number>,
  outputDuration: number
): CameraMotionClip[] {
  const translated = compactMap(clips, clip => {
    const delta = reorderedOutputOffset(clip.timing.startTime, oldMap, newStarts);
    const startTime = min(max(clip.timing.startTime + delta, 0), outputDuration);
    const duration = min(clip.timing.duration, max(outputDuration - startTime, 0));
    const leadInDuration = min(clip.timing.leadInDuration, duration);
    const returnDuration = min(clip.timing.returnDuration, max(outputDuration - (startTime + duration), 0));
    if (duration <= epsilon) return null;
    return {
      ...clip,
      timing: makeTransitionTiming({
        ...clip.timing,
        startTime,
        duration,
        leadInDuration,
        returnDuration,
      }),
    };
  });
  sortCameraMotion(translated);
  return normalizedCameraMotionSequence(translated);
}

export function remappedMosaicClips(
  clips: readonly MosaicClip[],
  oldMap: TimelineMap,
  newStarts: ReadonlyMap<string, number> | Record<string, number>,
  outputDuration: number
): MosaicClip[] {
  return compactMap(clips, clip => {
    const delta = reorderedOutputOffset(clip.timing.startTime, oldMap, newStarts);
    const startTime = min(max(clip.timing.startTime + delta, 0), outputDuration);
    const duration = min(clip.timing.duration, max(outputDuration - startTime, 0));
    if (duration <= epsilon) return null;
    return {
      ...clip,
      timing: makeOverlayTiming({
        startTime,
        duration,
      }),
    };
  }).sort((a, b) =>
    a.timing.startTime === b.timing.startTime
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : a.timing.startTime - b.timing.startTime
  );
}

export function remappedStickerClips(
  clips: readonly StickerClip[],
  oldMap: TimelineMap,
  newStarts: ReadonlyMap<string, number> | Record<string, number>,
  outputDuration: number
): StickerClip[] {
  return compactMap(clips, clip => {
    const delta = reorderedOutputOffset(clip.timing.startTime, oldMap, newStarts);
    const startTime = min(max(clip.timing.startTime + delta, 0), outputDuration);
    const duration = min(clip.timing.duration, max(outputDuration - startTime, 0));
    if (duration <= epsilon) return null;
    return {
      ...clip,
      timing: makeOverlayTiming({
        startTime,
        duration,
      }),
    };
  }).sort((a, b) => {
    if (a.layerIndex !== b.layerIndex) return a.layerIndex - b.layerIndex;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// MARK: - Ripple Main

export function rippleTimeline(
  timeline: ProjectTimeline,
  replacingSourceSequenceWith: SourceSequence,
  deleting: OutputDeletion,
  deletesOutputTail: boolean,
  fullSourceDuration: number,
  defaultTransitionDuration: number = 0.7
): ProjectTimeline {
  const sourceSequence = replacingSourceSequenceWith;
  const primarySegmentAudioOverrides = prunedPrimarySegmentAudioOverrides(
    timeline.primarySegmentAudioOverrides,
    sourceSequence
  );

  let zoomClips = compactMap(timeline.zoomClips, c =>
    rippleZoom(c, deleting, deletesOutputTail)
  );
  let screenMotionClips = compactMap(timeline.screenMotionClips, c =>
    rippleScreenMotion(c, deleting, deletesOutputTail)
  );
  let cameraMotionClips = compactMap(timeline.cameraMotionClips, c =>
    rippleCameraMotion(c, deleting, deletesOutputTail)
  );
  const mosaicClips = compactMap(timeline.mosaicClips, c =>
    rippleMosaic(c, deleting, deletesOutputTail)
  );
  const stickerClips = compactMap(timeline.stickerClips, c =>
    rippleSticker(c, deleting, deletesOutputTail)
  );

  sortZoom(zoomClips);
  sortScreenMotion(screenMotionClips);
  sortCameraMotion(cameraMotionClips);

  if (!deletesOutputTail) {
    zoomClips = restoredZoomLeadInsAtRippleJunction(
      timeline.zoomClips,
      zoomClips,
      deleting
    );
    screenMotionClips = restoredScreenLeadInsAtRippleJunction(
      timeline.screenMotionClips,
      screenMotionClips,
      deleting
    );
    cameraMotionClips = restoredCameraLeadInsAtRippleJunction(
      timeline.cameraMotionClips,
      cameraMotionClips,
      deleting
    );

    zoomClips = restoredZoomReturnsAtRippleJunction(
      timeline.zoomClips,
      zoomClips,
      deleting,
      defaultTransitionDuration
    );
    screenMotionClips = restoredScreenReturnsAtRippleJunction(
      timeline.screenMotionClips,
      screenMotionClips,
      deleting,
      defaultTransitionDuration
    );
    cameraMotionClips = restoredCameraReturnsAtRippleJunction(
      timeline.cameraMotionClips,
      cameraMotionClips,
      deleting,
      defaultTransitionDuration
    );
  }

  const result: ProjectTimeline = {
    sourceSequence,
    primarySegmentAudioOverrides,
    zoomClips,
    screenMotionClips,
    cameraMotionClips,
    mosaicClips,
    stickerClips,
  };

  validateProjectTimelineWithSourceDuration(result, fullSourceDuration);
  return result;
}

// MARK: - Namespace Export

export const ProjectTimelineEditingTransforms = Object.freeze({
  epsilon: PROJECT_TIMELINE_EDITING_EPSILON,
  ripple: rippleTimeline,
  insertingZoom,
  insertingScreenMotion,
  insertingCameraMotion,
  insertingTransitionTiming,
  insertingOverlayTiming,
  insertingMosaic,
  insertingSticker,
  rippleOverlayTiming,
  rippleMosaic,
  rippleSticker,
  rippleZoom,
  rippleScreenMotion,
  rippleCameraMotion,
  rippleTransitionTiming,
  continuedPhaseOffset,
  restoredZoomLeadInsAtRippleJunction,
  restoredScreenLeadInsAtRippleJunction,
  restoredCameraLeadInsAtRippleJunction,
  restoredEntryAfterRipple,
  restoringEntryAfterRipple,
  restoredZoomReturnsAtRippleJunction,
  restoredScreenReturnsAtRippleJunction,
  restoredCameraReturnsAtRippleJunction,
  reorderedOutputOffset,
  remappedZoomClips,
  remappedScreenMotionClips,
  remappedCameraMotionClips,
  remappedMosaicClips,
  remappedStickerClips,
  normalizedScreenMotionSequence,
  normalizedCameraMotionSequence,
  validateSourceSequence,
  primarySegmentIDs,
  prunedPrimarySegmentAudioOverrides,
  validatePrimarySegmentAudioOverrides,
  validateZoomClips,
  validateScreenMotionClips,
  validateCameraMotionClips,
  validateMosaicClips,
  validateStickerClips,
  validOverlayTiming,
  validTransitionTiming,
  validZoomBezierCurve,
  validNormalizedPoint,
  authoredSegment,
  sortZoom,
  sortScreenMotion,
  sortCameraMotion,
  zoomOrder,
  screenMotionOrder,
  cameraMotionOrder,
  validate: validateProjectTimeline,
  validateWithSourceDuration: validateProjectTimelineWithSourceDuration,
});
