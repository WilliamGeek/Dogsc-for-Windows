// Port of: F:\dogsc-v0.2.0\Sources\RecorderCore\VisualTrackTransfer.swift

import { min, max } from './swift.ts';
import {
  type AnimationClip,
  type MainTrackVisualStyle,
  type OverlayTiming,
  type StickerClip,
  type VisualClipSound,
  makeAnimationClip,
  makeMainTrackVisualStyle,
  makeOverlayTiming,
  makeStickerClip,
  makeVisualClipSound,
} from './OverlayTimeline.ts';
import {
  type InsertedMedia,
  type ProjectTimeline,
  type TransferableVisualClip,
  makeInsertedMedia,
  makeRecordingSegment,
  projectTimelineVisualLayer,
} from './ProjectTimeline.ts';
import { makeVideoClip, type VideoClip } from './PostProductionModel.ts';
import { type TimelineSourceDurationsInput, TimelineMap, toSourceDurationsMap } from './TimelineMap.ts';
import {
  insertPrimarySegments,
  removePrimarySegment,
  validate,
} from './ProjectTimelineEditing.ts';

export {
  type MainTrackVisualStyle,
  makeMainTrackVisualStyle,
  type VisualClipSound,
  makeVisualClipSound,
  type TransferableVisualClip,
};

// MARK: - TransferableVisualClip Helpers

export function transferableVisualClipID(clip: TransferableVisualClip): string {
  return clip.clip.id;
}

export function transferableVisualClipTiming(clip: TransferableVisualClip): OverlayTiming {
  return clip.clip.timing;
}

export function transferableVisualClipSourceStart(clip: TransferableVisualClip): number {
  switch (clip.kind) {
    case 'video':
      return clip.clip.sourceStart;
    case 'animation':
      return clip.clip.timeOffset;
    case 'sticker':
      return clip.clip.sourceStart;
  }
}

export function transferableVisualClipPlaybackRate(clip: TransferableVisualClip): number {
  return clip.clip.playbackRate;
}

export function transferableVisualClipMainTrackStyle(
  clip: TransferableVisualClip
): MainTrackVisualStyle | null {
  return clip.clip.mainTrackStyle;
}

export function findTransferableVisualClip(
  id: string,
  timeline: ProjectTimeline
): TransferableVisualClip | null {
  const video = timeline.videoClips.find(c => c.id === id);
  if (video) return { kind: 'video', clip: video };
  const animation = timeline.animationClips.find(c => c.id === id);
  if (animation) return { kind: 'animation', clip: animation };
  const sticker = timeline.stickerClips.find(c => c.id === id);
  if (sticker) return { kind: 'sticker', clip: sticker };
  return null;
}

// MARK: - VisualTrackTransferError

export type VisualTrackTransferErrorKind = 'unsupportedClip' | 'insufficientMainDuration';

export class VisualTrackTransferError extends Error {
  readonly kind: VisualTrackTransferErrorKind;

  constructor(kind: VisualTrackTransferErrorKind) {
    const message =
      kind === 'unsupportedClip'
        ? '该片段不支持在主轨与叠加轨之间移动。'
        : '主轨剩余时长不足以将此片段移入叠加轨。';
    super(message);
    this.name = 'VisualTrackTransferError';
    this.kind = kind;
  }
}

// MARK: - VisualTrackTransfer

/**
 * Source is removed before the insertion ripples the remaining tracks.
 * Media preparation (stand-in/image video) is owned by the host, not this edit.
 */
export function moveToMain(
  id: string,
  prepared: InsertedMedia,
  time: number,
  original: ProjectTimeline,
  sourceDurations: TimelineSourceDurationsInput
): ProjectTimeline {
  const clip = findTransferableVisualClip(id, original);
  if (!clip) {
    throw new VisualTrackTransferError('unsupportedClip');
  }

  const savedStyle = transferableVisualClipMainTrackStyle(clip);
  const usesFrameStyle = savedStyle?.usesFrameStyle ?? false;
  const screenAppearance = savedStyle?.screenAppearance ?? prepared.screenAppearance;

  let motionPath = prepared.motionPath;
  let properties = prepared.properties;
  let elementEdits = prepared.elementEdits;
  let soundPath = prepared.soundPath;
  let transferSound = prepared.transferSound;

  if (clip.kind === 'animation') {
    motionPath = clip.clip.sourcePath;
    properties = clip.clip.properties;
    elementEdits = clip.clip.elementEdits;
    soundPath = clip.clip.soundtrack?.path ?? null;
    transferSound = clip.clip.soundtrack;
  } else if (clip.kind === 'video') {
    transferSound = makeVisualClipSound({
      path: clip.clip.sourcePath,
      volume: clip.clip.volume,
    });
  }

  const media = makeInsertedMedia({
    path: prepared.path,
    fileDuration: prepared.fileDuration,
    name: prepared.name,
    usesFrameStyle,
    screenAppearance,
    sourceAspectRatio: prepared.sourceAspectRatio,
    motionPath,
    imagePath: prepared.imagePath,
    properties,
    soundPath,
    elementEdits,
    overlayOrigin: clip,
    transferSound,
  });

  const timeline: ProjectTimeline = {
    ...original,
    videoClips: original.videoClips.filter(c => c.id !== id),
    animationClips: original.animationClips.filter(c => c.id !== id),
    stickerClips: original.stickerClips.filter(c => c.id !== id),
  };

  const timing = transferableVisualClipTiming(clip);
  const playbackRate = transferableVisualClipPlaybackRate(clip);
  const segment = makeRecordingSegment({
    id,
    sourceStart: transferableVisualClipSourceStart(clip),
    sourceDuration: timing.duration * playbackRate,
    playbackRate,
    media,
    sceneStyle: savedStyle?.sceneStyle ?? null,
  });

  return insertPrimarySegments(timeline, [segment], time, sourceDurations);
}

export function moveToOverlay(
  id: string,
  requestedTime: number,
  layer: number | null,
  original: ProjectTimeline,
  sourceDurations: TimelineSourceDurationsInput,
  defaultTransition: number = 0.7
): ProjectTimeline {
  const durations = toSourceDurationsMap(sourceDurations);
  const map = new TimelineMap(original.sourceSequence, durations);
  const segment = map.segments.find(s => s.id === id);
  if (!segment || !segment.media) {
    throw new VisualTrackTransferError('unsupportedClip');
  }
  const media = segment.media;

  let timeline = removePrimarySegment(original, id, durations, defaultTransition);
  const remaining = map.outputDuration - segment.outputDuration;
  if (!(segment.outputDuration <= remaining + 0.000_001)) {
    throw new VisualTrackTransferError('insufficientMainDuration');
  }

  const timing = makeOverlayTiming(
    min(max(requestedTime, 0), max(remaining - segment.outputDuration, 0)),
    segment.outputDuration
  );
  const targetLayer = layer ?? projectTimelineVisualLayer(timeline, timing);
  const style = makeMainTrackVisualStyle({
    usesFrameStyle: media.usesFrameStyle,
    screenAppearance: media.screenAppearance,
    sceneStyle: segment.sceneStyle,
  });

  const overrides = original.primarySegmentAudioOverrides[id];
  let volume = overrides?.systemVolume ?? media.transferSound?.volume ?? 1;
  if (overrides?.isSystemMuted === true) {
    volume = 0;
  }

  const stickerOrigin: StickerClip | null =
    media.overlayOrigin?.kind === 'sticker'
      ? media.overlayOrigin.clip
      : media.imagePath != null
        ? makeStickerClip({
            id,
            timing,
            relativePath: media.imagePath,
            width: 1,
            cornerRadius: 0,
            shadowOpacity: 0,
            animation: 'none',
            enterDuration: 0,
            exitDuration: 0,
            backdropBlur: 0,
          })
        : null;

  if (media.motionPath != null) {
    const baseClip: AnimationClip =
      media.overlayOrigin?.kind === 'animation'
        ? media.overlayOrigin.clip
        : makeAnimationClip({ id, timing, sourcePath: media.motionPath, width: 1 });
    const nextClip: AnimationClip = {
      ...baseClip,
      id,
      timing,
      sourcePath: media.motionPath,
      timeOffset: segment.sourceStart,
      playbackRate: segment.playbackRate,
      properties: { ...media.properties },
      elementEdits: { ...media.elementEdits },
      layerIndex: targetLayer,
      mainTrackStyle: style,
      soundtrack:
        media.soundPath != null
          ? makeVisualClipSound({
              path: media.soundPath,
              volume,
              fadeIn: media.transferSound?.fadeIn ?? 0,
              fadeOut: media.transferSound?.fadeOut ?? 0,
            })
          : baseClip.soundtrack,
    };
    timeline = {
      ...timeline,
      animationClips: [...timeline.animationClips, nextClip],
    };
  } else if (stickerOrigin) {
    const nextSticker: StickerClip = {
      ...stickerOrigin,
      relativePath: media.imagePath ?? stickerOrigin.relativePath,
      id,
      timing,
      layerIndex: targetLayer,
      mainTrackStyle: style,
      sourceStart: segment.sourceStart,
      playbackRate: segment.playbackRate,
    };
    timeline = {
      ...timeline,
      stickerClips: [...timeline.stickerClips, nextSticker],
    };
  } else {
    const baseVideo: VideoClip =
      media.overlayOrigin?.kind === 'video'
        ? media.overlayOrigin.clip
        : makeVideoClip({
            id,
            timing,
            sourcePath: media.path,
            aspect: 1 / max(media.sourceAspectRatio ?? 16.0 / 9.0, 0.001),
          });
    const nextVideo: VideoClip = {
      ...baseVideo,
      id,
      timing,
      sourcePath: media.path,
      sourceStart: segment.sourceStart,
      playbackRate: segment.playbackRate,
      volume,
      layerIndex: targetLayer,
      mainTrackStyle: style,
    };
    timeline = {
      ...timeline,
      videoClips: [...timeline.videoClips, nextVideo],
    };
  }

  validate(timeline, durations);
  return timeline;
}

export const VisualTrackTransfer = Object.freeze({
  find: findTransferableVisualClip,
  moveToMain,
  moveToOverlay,
});
