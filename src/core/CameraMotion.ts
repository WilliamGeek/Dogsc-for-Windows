// Port of: F:\dogsc\Sources\RecorderCore\CameraMotion.swift
import { clamp, max, min, newUUID } from './swift.ts';
import {
  type NormalizedPoint,
  ZoomInterpolator,
  ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE,
} from './ZoomAnimation.ts';
import {
  makeMotionStyle,
  type MotionStyle,
  type CameraShape,
  type CameraStyle,
} from './ProjectModel.ts';
import { TimelineTrackOrdering } from './TimelineTrackOrdering.ts';
import type { TransitionTiming } from './FocusEffect.ts';

// ---------------------------------------------------------------------------
// CameraLayoutMode
// ---------------------------------------------------------------------------
export type CameraLayoutMode =
  | { kind: 'shape'; shape: CameraShape }
  | { kind: 'fullscreen' };

export function makeCameraLayoutModeShape(shape: CameraShape): CameraLayoutMode {
  return { kind: 'shape', shape };
}

export const CameraLayoutModeFullscreen: CameraLayoutMode = Object.freeze({
  kind: 'fullscreen',
});

// ---------------------------------------------------------------------------
// CameraMotionState
// ---------------------------------------------------------------------------
export interface CameraMotionState {
  layout: CameraLayoutMode;
  position: NormalizedPoint;
  size: number;
  roundness: number;
  opacity: number;
}

export function makeCameraMotionState(
  options: Partial<CameraMotionState> = {},
): CameraMotionState {
  return {
    layout: options.layout ?? { kind: 'shape', shape: 'square' },
    position: options.position ?? { x: 0.86, y: 0.82 },
    size: options.size ?? 0.35,
    roundness: options.roundness ?? 0.5,
    opacity: options.opacity ?? 1,
  };
}

/**
 * Resolves a static `CameraStyle` into the base `CameraMotionState`.
 * `opacity` is always 1 because visibility is controlled by `CameraStyle.isHidden`.
 */
export function makeCameraMotionStateFromBase(style: CameraStyle): CameraMotionState {
  return makeCameraMotionState({
    layout: makeCameraLayoutModeShape(style.shape),
    position: style.position,
    size: style.size,
    roundness: style.roundness,
    opacity: 1,
  });
}

// ---------------------------------------------------------------------------
// CameraMotionClip
// ---------------------------------------------------------------------------
export interface CameraMotionClip {
  id: string;
  timing: TransitionTiming;
  target: CameraMotionState;
  groupID?: string | null;
}

export function makeCameraMotionClip(options: {
  id?: string;
  timing: TransitionTiming;
  target: CameraMotionState;
  groupID?: string | null;
}): CameraMotionClip {
  return {
    id: options.id ?? newUUID(),
    timing: options.timing,
    target: options.target,
    groupID: options.groupID ?? null,
  };
}

// ---------------------------------------------------------------------------
// CameraMotionSample
// ---------------------------------------------------------------------------
/**
 * Continuous camera values consumed by geometry evaluation.
 * Swift: `CameraMotionSample`.
 */
export interface CameraMotionSample {
  position: NormalizedPoint;
  size: number;
  aspectRatio: number;
  cornerFraction: number;
  fullscreenProgress: number;
  opacity: number;
}

export function makeCameraMotionSample(options: {
  position: NormalizedPoint;
  size: number;
  aspectRatio: number;
  cornerFraction: number;
  fullscreenProgress: number;
  opacity: number;
}): CameraMotionSample {
  return {
    position: options.position,
    size: options.size,
    aspectRatio: options.aspectRatio,
    cornerFraction: options.cornerFraction,
    fullscreenProgress: options.fullscreenProgress,
    opacity: options.opacity,
  };
}

// ---------------------------------------------------------------------------
// CameraMotionTrack
// ---------------------------------------------------------------------------
export class CameraMotionTrack {
  readonly clips: readonly CameraMotionClip[];
  private readonly usesIndexedEvaluation: boolean;

  constructor(clips: readonly CameraMotionClip[]) {
    if (TimelineTrackOrdering.cameraMotionClipsNeedRepair(clips)) {
      this.clips = clips.slice().sort((lhs, rhs) => {
        if (lhs.timing.startTime === rhs.timing.startTime) {
          return lhs.id < rhs.id ? -1 : lhs.id > rhs.id ? 1 : 0;
        }
        return lhs.timing.startTime - rhs.timing.startTime;
      });
    } else {
      this.clips = clips.slice();
    }

    const timingsAreValid = this.clips.every(
      (c) =>
        Number.isFinite(c.timing.startTime) &&
        Number.isFinite(c.timing.duration) &&
        c.timing.duration > 0,
    );

    let sequenceIsNonoverlapping = true;
    for (let i = 0; i < this.clips.length - 1; i++) {
      const previous = this.clips[i];
      const next = this.clips[i + 1];
      const prevEnd = previous.timing.startTime + previous.timing.duration;
      const prevEffectEnd = prevEnd + previous.timing.returnDuration;
      const gap = next.timing.startTime - prevEnd;
      const touches = gap <= ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE;
      const clears = next.timing.startTime >= prevEffectEnd - 0.000_1;
      if (!(next.timing.startTime >= prevEnd - 0.000_1 && (touches || clears))) {
        sequenceIsNonoverlapping = false;
        break;
      }
    }

    this.usesIndexedEvaluation = timingsAreValid && sequenceIsNonoverlapping;
  }

  sample(
    time: number,
    base: CameraMotionState = makeCameraMotionState(),
    cameraAspectRatio: number = 1.0,
    canvasAspectRatio: number = 16 / 9,
    motion: MotionStyle = makeMotionStyle(),
    baseSample: CameraMotionSample | null = null,
  ): CameraMotionSample {
    const resolvedBase =
      baseSample ??
      CameraMotionTrack.resolve(
        base,
        cameraAspectRatio,
        canvasAspectRatio,
      );

    if (!this.usesIndexedEvaluation || !Number.isFinite(time)) {
      return this.sampleByScanning(
        time,
        resolvedBase,
        cameraAspectRatio,
        canvasAspectRatio,
        motion,
      );
    }

    const index = this.lastStartedClipIndex(time);
    if (index == null) {
      return resolvedBase;
    }

    const clip = this.clips[index];
    const target = CameraMotionTrack.resolve(
      clip.target,
      cameraAspectRatio,
      canvasAspectRatio,
    );
    const clipEndTime = clip.timing.startTime + clip.timing.duration;

    if (time < clipEndTime) {
      let inherited: CameraMotionSample;
      if (index > 0) {
        const previous = this.clips[index - 1];
        const prevEndTime = previous.timing.startTime + previous.timing.duration;
        const touches =
          Math.abs(prevEndTime - clip.timing.startTime) <=
          ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE;
        inherited =
          !touches && previous.timing.returnDuration > 0.000_1
            ? resolvedBase
            : CameraMotionTrack.resolve(
                previous.target,
                cameraAspectRatio,
                canvasAspectRatio,
              );
      } else {
        inherited = resolvedBase;
      }

      const leadIn = min(clip.timing.leadInDuration, clip.timing.duration);
      if (!(leadIn > 0.000_1)) return target;

      const local = min((time - clip.timing.startTime) / leadIn, 1);
      const linear =
        clip.timing.leadInProgressOffset +
        (1 - clip.timing.leadInProgressOffset) * local;
      const progress = ZoomInterpolator.easedProgress(
        linear,
        clip.timing.easing,
        clip.timing.customCurve,
        motion,
      );

      return CameraMotionTrack.transitionSample(inherited, target, progress);
    }

    if (this.touchesNextClip(index)) {
      return target;
    }

    const falling = this.returnFalloff(
      index,
      resolvedBase,
      time,
      cameraAspectRatio,
      canvasAspectRatio,
      motion,
    );
    if (falling != null) {
      return falling;
    }

    return clip.timing.returnDuration > 0.000_1 ? resolvedBase : target;
  }

  private sampleByScanning(
    time: number,
    resolvedBase: CameraMotionSample,
    cameraAspectRatio: number,
    canvasAspectRatio: number,
    motion: MotionStyle,
  ): CameraMotionSample {
    let inherited = resolvedBase;
    let previousIndex: number | null = null;

    for (let index = 0; index < this.clips.length; index++) {
      const clip = this.clips[index];
      if (
        !Number.isFinite(clip.timing.startTime) ||
        !Number.isFinite(clip.timing.duration) ||
        !(clip.timing.duration > 0)
      ) {
        continue;
      }

      const clipEndTime = clip.timing.startTime + clip.timing.duration;
      if (time < clip.timing.startTime) {
        if (previousIndex != null) {
          const falling = this.returnFalloff(
            previousIndex,
            resolvedBase,
            time,
            cameraAspectRatio,
            canvasAspectRatio,
            motion,
          );
          if (falling != null) return falling;
        }
        return inherited;
      }

      const target = CameraMotionTrack.resolve(
        clip.target,
        cameraAspectRatio,
        canvasAspectRatio,
      );

      if (time < clipEndTime) {
        const leadIn = min(clip.timing.leadInDuration, clip.timing.duration);
        if (!(leadIn > 0.000_1)) return target;

        const local = min((time - clip.timing.startTime) / leadIn, 1);
        const linear =
          clip.timing.leadInProgressOffset +
          (1 - clip.timing.leadInProgressOffset) * local;
        const progress = ZoomInterpolator.easedProgress(
          linear,
          clip.timing.easing,
          clip.timing.customCurve,
          motion,
        );
        return CameraMotionTrack.transitionSample(inherited, target, progress);
      }

      inherited =
        !this.touchesNextClip(index) && clip.timing.returnDuration > 0.000_1
          ? resolvedBase
          : target;
      previousIndex = index;
    }

    if (previousIndex != null) {
      const falling = this.returnFalloff(
        previousIndex,
        resolvedBase,
        time,
        cameraAspectRatio,
        canvasAspectRatio,
        motion,
      );
      if (falling != null) return falling;
      return this.clips[previousIndex].timing.returnDuration > 0.000_1
        ? resolvedBase
        : inherited;
    }

    return inherited;
  }

  private lastStartedClipIndex(time: number): number | null {
    let lower = 0;
    let upper = this.clips.length;
    while (lower < upper) {
      const middle = lower + Math.floor((upper - lower) / 2);
      if (this.clips[middle].timing.startTime <= time) {
        lower = middle + 1;
      } else {
        upper = middle;
      }
    }
    return lower > 0 ? lower - 1 : null;
  }

  private touchesNextClip(index: number): boolean {
    if (index + 1 >= this.clips.length) return false;
    const current = this.clips[index];
    const next = this.clips[index + 1];
    const currentEndTime = current.timing.startTime + current.timing.duration;
    return (
      Math.abs(next.timing.startTime - currentEndTime) <=
      ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE
    );
  }

  private returnFalloff(
    index: number,
    base: CameraMotionSample,
    time: number,
    cameraAspectRatio: number,
    canvasAspectRatio: number,
    motion: MotionStyle,
  ): CameraMotionSample | null {
    const clip = this.clips[index];
    if (clip.timing.returnDuration <= 0.000_1) return null;
    if (this.touchesNextClip(index)) return null;

    const clipEndTime = clip.timing.startTime + clip.timing.duration;
    if (time > clipEndTime + clip.timing.returnDuration) return null;

    const local = clamp((time - clipEndTime) / clip.timing.returnDuration, 0, 1);
    const linear =
      clip.timing.returnProgressOffset +
      (1 - clip.timing.returnProgressOffset) * local;
    const progress = ZoomInterpolator.easedProgress(
      linear,
      clip.timing.easing,
      clip.timing.customCurve,
      motion,
    );
    const target = CameraMotionTrack.resolve(
      clip.target,
      cameraAspectRatio,
      canvasAspectRatio,
    );
    return CameraMotionTrack.transitionSample(target, base, progress);
  }

  static transitionSample(
    inherited: CameraMotionSample,
    target: CameraMotionSample,
    progress: number,
  ): CameraMotionSample {
    const hiddenTarget = target.opacity < 0.01;
    const hiddenSource = inherited.opacity < 0.01;
    const t = clamp(progress, 0, 1);

    if (hiddenTarget) {
      return {
        ...inherited,
        opacity: CameraMotionTrack.mix(inherited.opacity, 0, t),
      };
    }
    if (hiddenSource) {
      return {
        ...target,
        opacity: CameraMotionTrack.mix(0, target.opacity, t),
      };
    }
    return CameraMotionTrack.interpolate(inherited, target, progress);
  }

  static resolve(
    state: CameraMotionState,
    cameraAspectRatio: number,
    canvasAspectRatio: number,
  ): CameraMotionSample {
    let aspect: number;
    let cornerFraction: number;
    let fullscreen: number;

    switch (state.layout.kind) {
      case 'shape': {
        fullscreen = 0;
        switch (state.layout.shape) {
          case 'square':
            aspect = 1;
            cornerFraction = 0.5 * state.roundness;
            break;
          case 'circle':
            aspect = 1;
            cornerFraction = 0.5;
            break;
          case 'horizontal':
            aspect = 1.5;
            cornerFraction = 0.5 * state.roundness;
            break;
          case 'vertical':
            aspect = 0.72;
            cornerFraction = 0.5 * state.roundness;
            break;
          case 'original':
            aspect = max(cameraAspectRatio, 0.01);
            cornerFraction = 0.5 * state.roundness;
            break;
        }
        break;
      }
      case 'fullscreen':
        aspect = max(canvasAspectRatio, 0.01);
        cornerFraction = 0;
        fullscreen = 1;
        break;
    }

    return {
      position: state.position,
      size: state.size,
      aspectRatio: aspect,
      cornerFraction,
      fullscreenProgress: fullscreen,
      opacity: state.opacity,
    };
  }

  private static interpolate(
    from: CameraMotionSample,
    to: CameraMotionSample,
    progress: number,
  ): CameraMotionSample {
    const t = clamp(progress, 0, 1);
    return {
      position: {
        x: CameraMotionTrack.mix(from.position.x, to.position.x, t),
        y: CameraMotionTrack.mix(from.position.y, to.position.y, t),
      },
      size: CameraMotionTrack.mix(from.size, to.size, t),
      aspectRatio: CameraMotionTrack.mix(from.aspectRatio, to.aspectRatio, t),
      cornerFraction: CameraMotionTrack.mix(from.cornerFraction, to.cornerFraction, t),
      fullscreenProgress: CameraMotionTrack.mix(
        from.fullscreenProgress,
        to.fullscreenProgress,
        t,
      ),
      opacity: CameraMotionTrack.mix(from.opacity, to.opacity, t),
    };
  }

  private static mix(from: number, to: number, progress: number): number {
    return from + (to - from) * progress;
  }
}
