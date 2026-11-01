// Port of: F:\dogsc\Sources\RecorderCore\StickerTransition.swift

import { min, max } from './swift.ts';
import { ElementMotionEvaluator, type ElementMotionCurve } from './ElementMotion.ts';
import {
  type StickerClip,
  type StickerAnimationPreset,
  stickerAnimationPresetAutomaticExit,
} from './OverlayTimeline.ts';

// MARK: - FrameStickerSceneLike

export interface FrameStickerSceneLike {
  hidesScreen: boolean;
  hidesCamera: boolean;
  transitionProgress: number;
  backdropBlur: number;
  backdropBlurIncludesCamera: boolean;
}

// MARK: - FrameStickerBackdropScene

/// Background treatment is independent of the two images' animation opacity.
/// Joined hidden-screen stickers must keep suppression at one throughout the
/// handoff, even while both images are translucent or travelling off-canvas.
export interface FrameStickerBackdropScene {
  screenSuppression: number;
  cameraSuppression: number;
  screenBlur: number;
  cameraBlur: number;
}

export function makeFrameStickerBackdropScene(options?: {
  screenSuppression?: number;
  cameraSuppression?: number;
  screenBlur?: number;
  cameraBlur?: number;
}): FrameStickerBackdropScene {
  return {
    screenSuppression: options?.screenSuppression ?? 0,
    cameraSuppression: options?.cameraSuppression ?? 0,
    screenBlur: options?.screenBlur ?? 0,
    cameraBlur: options?.cameraBlur ?? 0,
  };
}

export function frameStickerBackdropSceneFromClip(
  clip: StickerClip,
  visibility: number
): FrameStickerBackdropScene {
  return {
    screenSuppression: clip.hidesScreen ? visibility : 0,
    cameraSuppression: clip.hidesCamera ? visibility : 0,
    screenBlur: clip.hidesScreen ? 0 : max(clip.backdropBlur, 0) * visibility,
    cameraBlur: clip.backdropBlurIncludesCamera ? max(clip.backdropBlur, 0) * visibility : 0,
  };
}

export function frameStickerBackdropSceneFromStickers(
  stickers: readonly FrameStickerSceneLike[]
): FrameStickerBackdropScene {
  const result = makeFrameStickerBackdropScene();
  for (const sticker of stickers) {
    const treatment: FrameStickerBackdropScene = {
      screenSuppression: sticker.hidesScreen ? sticker.transitionProgress : 0,
      cameraSuppression: sticker.hidesCamera ? sticker.transitionProgress : 0,
      screenBlur: sticker.hidesScreen ? 0 : sticker.backdropBlur,
      cameraBlur: sticker.backdropBlurIncludesCamera ? sticker.backdropBlur : 0,
    };
    frameStickerBackdropSceneMerge(result, treatment);
  }
  return result;
}

export function frameStickerBackdropSceneMerge(
  target: FrameStickerBackdropScene,
  other: FrameStickerBackdropScene
): void {
  target.screenSuppression = max(target.screenSuppression, other.screenSuppression);
  target.cameraSuppression = max(target.cameraSuppression, other.cameraSuppression);
  target.screenBlur = max(target.screenBlur, other.screenBlur);
  target.cameraBlur = max(target.cameraBlur, other.cameraBlur);
}

export function frameStickerBackdropSceneInterpolated(
  from: FrameStickerBackdropScene,
  other: FrameStickerBackdropScene,
  progress: number
): FrameStickerBackdropScene {
  return {
    screenSuppression:
      from.screenSuppression + (other.screenSuppression - from.screenSuppression) * progress,
    cameraSuppression:
      from.cameraSuppression + (other.cameraSuppression - from.cameraSuppression) * progress,
    screenBlur: from.screenBlur + (other.screenBlur - from.screenBlur) * progress,
    cameraBlur: from.cameraBlur + (other.cameraBlur - from.cameraBlur) * progress,
  };
}

export function frameStickerBackdropSceneEquals(
  a: FrameStickerBackdropScene,
  b: FrameStickerBackdropScene
): boolean {
  return (
    a.screenSuppression === b.screenSuppression &&
    a.cameraSuppression === b.cameraSuppression &&
    a.screenBlur === b.screenBlur &&
    a.cameraBlur === b.cameraBlur
  );
}

export const FrameStickerBackdropScene = Object.freeze({
  make: makeFrameStickerBackdropScene,
  fromClip: frameStickerBackdropSceneFromClip,
  fromStickers: frameStickerBackdropSceneFromStickers,
  merge: frameStickerBackdropSceneMerge,
  interpolated: frameStickerBackdropSceneInterpolated,
  equals: frameStickerBackdropSceneEquals,
});

// MARK: - StickerTransitionTrack

interface Entry {
  readonly clip: StickerClip;
  readonly enterDuration: number;
  readonly exitDuration: number;
  entryJoin: number | null;
  exitJoin: number | null;
  readonly joinEnterDuration: number;
  readonly joinExitDuration: number;
}

interface Endpoint {
  readonly time: number;
  readonly index: number;
  readonly isStart: boolean;
}

interface Join {
  readonly start: number;
  readonly end: number;
  readonly outgoingBackdrop: FrameStickerBackdropScene;
  readonly incomingBackdrop: FrameStickerBackdropScene;
  readonly curve: ElementMotionCurve;
}

function joinContains(join: Join, time: number): boolean {
  return time >= join.start && time < join.end;
}

function joinProgress(join: Join, time: number): number {
  if (join.end <= join.start) {
    return time >= join.end ? 1 : 0;
  }
  return min(max((time - join.start) / (join.end - join.start), 0), 1);
}

interface BackdropBridge {
  readonly start: number;
  readonly end: number;
  readonly treatment: FrameStickerBackdropScene;
}

function bridgeContains(bridge: BackdropBridge, time: number): boolean {
  return time >= bridge.start && time < bridge.end;
}

export interface StickerTransitionSample {
  readonly clip: StickerClip;
  readonly visibility: number;
  readonly preset: StickerAnimationPreset;
  readonly progress: number;
}

/// Prepared once per sticker edit, then shared by paused preview, playback and
/// export. Only numerical endpoint noise counts as adjacency, never a frame-
/// sized gap. Crossing stickers keep their individual motion, but bridge any
/// backdrop treatment both request. Authored timings and layers stay unchanged.
export class StickerTransitionTrack {
  public static readonly endpointTolerance = 0.0000001;

  private readonly entries: Entry[];
  private readonly joins: Join[] = [];
  private readonly backdropBridges: BackdropBridge[] = [];

  constructor(clips: readonly StickerClip[]) {
    const validClips = clips
      .filter(
        (c) =>
          Number.isFinite(c.timing.startTime) &&
          Number.isFinite(c.timing.duration) &&
          c.timing.duration > 0
      )
      .slice()
      .sort((a, b) => {
        if (a.layerIndex === b.layerIndex) {
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        }
        return a.layerIndex - b.layerIndex;
      });

    this.entries = validClips.map((clip) => {
      const enter = max(clip.enterDuration, 0);
      const exit = max(clip.exitDuration, 0);
      const total = enter + exit;
      const scale = total > clip.timing.duration && total > 0 ? clip.timing.duration / total : 1;
      const enterDuration = enter * scale;
      const exitDuration = exit * scale;
      const exitPreset = clip.exitAnimation ?? stickerAnimationPresetAutomaticExit(clip.animation);
      const joinEnterDuration = clip.animation === 'none' ? 0 : enterDuration;
      const joinExitDuration = exitPreset === 'none' ? 0 : exitDuration;
      return {
        clip,
        enterDuration,
        exitDuration,
        entryJoin: null,
        exitJoin: null,
        joinEnterDuration,
        joinExitDuration,
      };
    });

    const endpoints: Endpoint[] = [];
    for (let index = 0; index < this.entries.length; index++) {
      const clip = this.entries[index].clip;
      endpoints.push({ time: clip.timing.startTime, index, isStart: true });
      endpoints.push({ time: clip.timing.startTime + clip.timing.duration, index, isStart: false });
    }
    endpoints.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));

    let cursor = 0;
    while (cursor < endpoints.length) {
      const boundary = endpoints[cursor].time;
      const outgoing: number[] = [];
      const incoming: number[] = [];
      do {
        const endpoint = endpoints[cursor];
        if (endpoint.isStart) {
          incoming.push(endpoint.index);
        } else {
          outgoing.push(endpoint.index);
        }
        cursor += 1;
      } while (
        cursor < endpoints.length &&
        endpoints[cursor].time - boundary <= StickerTransitionTrack.endpointTolerance
      );

      // A very short sticker must not connect its own start and end.
      const shared = new Set(outgoing.filter((x) => incoming.includes(x)));
      const cleanOutgoing = outgoing.filter((x) => !shared.has(x));
      const cleanIncoming = incoming.filter((x) => !shared.has(x));

      if (cleanOutgoing.length === 0 || cleanIncoming.length === 0) {
        continue;
      }

      // Each side stays inside every participant's allocated transition
      // budget. This also prevents adjacent handoffs from overlapping on
      // a short middle sticker or a group of simultaneous layers.
      let before = cleanOutgoing.reduce((acc, idx) => Math.min(acc, this.entries[idx].joinExitDuration), Infinity);
      if (!Number.isFinite(before)) before = 0;
      let after = cleanIncoming.reduce((acc, idx) => Math.min(acc, this.entries[idx].joinEnterDuration), Infinity);
      if (!Number.isFinite(after)) after = 0;

      let outgoingBackdrop = makeFrameStickerBackdropScene();
      let incomingBackdrop = makeFrameStickerBackdropScene();
      for (const index of cleanOutgoing) {
        frameStickerBackdropSceneMerge(
          outgoingBackdrop,
          frameStickerBackdropSceneFromClip(this.entries[index].clip, 1)
        );
      }
      for (const index of cleanIncoming) {
        frameStickerBackdropSceneMerge(
          incomingBackdrop,
          frameStickerBackdropSceneFromClip(this.entries[index].clip, 1)
        );
      }

      const joinIndex = this.joins.length;
      const outgoingEndTimes = cleanOutgoing.map(
        (idx) => this.entries[idx].clip.timing.startTime + this.entries[idx].clip.timing.duration
      );
      const incomingStartTimes = cleanIncoming.map((idx) => this.entries[idx].clip.timing.startTime);

      const startTimeMin = outgoingEndTimes.length > 0 ? Math.min(...outgoingEndTimes) : boundary;
      const startTimeMax = incomingStartTimes.length > 0 ? Math.max(...incomingStartTimes) : boundary;

      const maxIncomingIdx = Math.max(...cleanIncoming);
      const incomingCurve = this.entries[maxIncomingIdx].clip.animationCurve;

      this.joins.push({
        start: startTimeMin - before,
        end: startTimeMax + after,
        outgoingBackdrop,
        incomingBackdrop,
        curve: incomingCurve,
      });

      for (const index of cleanOutgoing) {
        this.entries[index].exitJoin = joinIndex;
      }
      for (const index of cleanIncoming) {
        this.entries[index].entryJoin = joinIndex;
      }
    }

    // A short overlap can leave both stickers inside their independent
    // fades, so max(visibility) alone briefly reveals the recording. Keep
    // only their shared treatment at full strength from the outgoing
    // exit's start until the incoming entry settles.
    const ordered = this.entries
      .map((_, i) => i)
      .sort((a, b) => {
        const lhs = this.entries[a].clip.timing;
        const rhs = this.entries[b].clip.timing;
        if (lhs.startTime === rhs.startTime) {
          const lhsEnd = lhs.startTime + lhs.duration;
          const rhsEnd = rhs.startTime + rhs.duration;
          return lhsEnd < rhsEnd ? -1 : lhsEnd > rhsEnd ? 1 : 0;
        }
        return lhs.startTime < rhs.startTime ? -1 : 1;
      });

    for (let offset = 0; offset < ordered.length; offset++) {
      const outgoingIndex = ordered[offset];
      const outgoing = this.entries[outgoingIndex];
      const outgoingEnd = outgoing.clip.timing.startTime + outgoing.clip.timing.duration;
      for (let next = offset + 1; next < ordered.length; next++) {
        const incomingIndex = ordered[next];
        const incoming = this.entries[incomingIndex];
        if (
          incoming.clip.timing.startTime >=
          outgoingEnd - StickerTransitionTrack.endpointTolerance
        ) {
          break;
        }
        const incomingEnd = incoming.clip.timing.startTime + incoming.clip.timing.duration;
        if (incomingEnd <= outgoingEnd) {
          continue;
        }
        const start = outgoingEnd - outgoing.joinExitDuration;
        const end = incoming.clip.timing.startTime + incoming.joinEnterDuration;
        if (end <= start) {
          continue;
        }
        const from = frameStickerBackdropSceneFromClip(outgoing.clip, 1);
        const to = frameStickerBackdropSceneFromClip(incoming.clip, 1);
        const treatment: FrameStickerBackdropScene = {
          screenSuppression: min(from.screenSuppression, to.screenSuppression),
          cameraSuppression: min(from.cameraSuppression, to.cameraSuppression),
          screenBlur: min(from.screenBlur, to.screenBlur),
          cameraBlur: min(from.cameraBlur, to.cameraBlur),
        };
        if (!frameStickerBackdropSceneEquals(treatment, makeFrameStickerBackdropScene())) {
          this.backdropBridges.push({ start, end, treatment });
        }
      }
    }
  }

  public hasJoinedEntry(id: string): boolean {
    return this.entries.some((e) => e.clip.id === id && e.entryJoin != null);
  }

  public sample(
    time: number,
    suppressesInitialEntry: boolean = false
  ): {
    stickers: StickerTransitionSample[];
    backdrop: FrameStickerBackdropScene;
  } {
    let backdrop = makeFrameStickerBackdropScene();
    for (const bridge of this.backdropBridges) {
      if (bridgeContains(bridge, time)) {
        frameStickerBackdropSceneMerge(backdrop, bridge.treatment);
      }
    }
    for (const join of this.joins) {
      if (joinContains(join, time)) {
        const progress = joinProgress(join, time);
        const curvedProgress = ElementMotionEvaluator.progress(progress, join.curve);
        frameStickerBackdropSceneMerge(
          backdrop,
          frameStickerBackdropSceneInterpolated(
            join.outgoingBackdrop,
            join.incomingBackdrop,
            curvedProgress
          )
        );
      }
    }

    const stickers: StickerTransitionSample[] = [];
    for (const entry of this.entries) {
      const clip = entry.clip;
      const clipEnd = clip.timing.startTime + clip.timing.duration;
      const entryJoin = entry.entryJoin != null ? this.joins[entry.entryJoin] : null;
      const exitJoin = entry.exitJoin != null ? this.joins[entry.exitJoin] : null;
      const joinedEntryIsActive = entryJoin != null && joinContains(entryJoin, time);
      const joinedExitIsActive = exitJoin != null && joinContains(exitJoin, time);
      const timingContains = time >= clip.timing.startTime && time < clipEnd;

      if (!timingContains && !joinedEntryIsActive && !joinedExitIsActive) {
        continue;
      }

      const localTime = max(time - clip.timing.startTime, 0);
      const remaining = max(clipEnd - time, 0);
      const suppressesEntry = suppressesInitialEntry && clip.timing.startTime <= 0.0001;

      let linearEnter: number;
      if (entryJoin != null) {
        linearEnter = joinProgress(entryJoin, time);
      } else if (suppressesEntry) {
        linearEnter = 1;
      } else if (entry.enterDuration > 0) {
        linearEnter = min(localTime / entry.enterDuration, 1);
      } else {
        linearEnter = 1;
      }

      let linearExit: number;
      if (exitJoin != null) {
        linearExit = 1 - joinProgress(exitJoin, time);
      } else if (entry.exitDuration > 0) {
        linearExit = min(remaining / entry.exitDuration, 1);
      } else {
        linearExit = 1;
      }

      const enterProgress = ElementMotionEvaluator.progress(linearEnter, clip.animationCurve);
      const exitProgress = ElementMotionEvaluator.progress(linearExit, clip.animationCurve);
      const exitPreset = clip.exitAnimation ?? stickerAnimationPresetAutomaticExit(clip.animation);

      const visibility = min(
        clip.animation === 'none' ? 1 : enterProgress,
        exitPreset === 'none' ? 1 : exitProgress
      );

      const isExiting =
        exitJoin != null
          ? time >= exitJoin.start
          : entry.exitDuration > 0 && remaining < entry.exitDuration;

      if (!joinedEntryIsActive && !joinedExitIsActive) {
        frameStickerBackdropSceneMerge(
          backdrop,
          frameStickerBackdropSceneFromClip(clip, visibility)
        );
      }

      stickers.push({
        clip,
        visibility,
        preset: isExiting ? exitPreset : clip.animation,
        progress: isExiting ? exitProgress : enterProgress,
      });
    }

    return { stickers, backdrop };
  }
}
