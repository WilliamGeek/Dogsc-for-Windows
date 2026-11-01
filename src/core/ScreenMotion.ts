// Port of: F:\dogsc\Sources\RecorderCore\ScreenMotion.swift
import { clamp, max, min, newUUID } from './swift.ts';
import type { CompositionPoint } from './CompositionScene.ts';
import {
  type NormalizedPoint,
  ZoomInterpolator,
  ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE,
} from './ZoomAnimation.ts';
import { makeMotionStyle, type MotionStyle } from './ProjectModel.ts';
import type { FocusEffect } from './FocusEffect.ts';
import { TimelineTrackOrdering } from './TimelineTrackOrdering.ts';
import type { TransitionTiming } from './FocusEffect.ts';

// ---------------------------------------------------------------------------
// ScreenMotionState
// ---------------------------------------------------------------------------
/**
 * Time-varying presentation of the recorded screen card. Crop, frame chrome,
 * border and shadow remain base appearance; this state owns spatial motion.
 * Swift: `ScreenMotionState`.
 */
export interface ScreenMotionState {
  position: NormalizedPoint;
  scale: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  perspective: number;
}

export function makeScreenMotionState(options: Partial<ScreenMotionState> = {}): ScreenMotionState {
  return {
    position: options.position ?? { x: 0.5, y: 0.5 },
    scale: options.scale ?? 1,
    rotationX: options.rotationX ?? 0,
    rotationY: options.rotationY ?? 0,
    rotationZ: options.rotationZ ?? 0,
    perspective: options.perspective ?? 0.65,
  };
}

// ---------------------------------------------------------------------------
// ScreenMotionClip
// ---------------------------------------------------------------------------
export interface ScreenMotionClip {
  id: string;
  timing: TransitionTiming;
  target: ScreenMotionState;
  groupID?: string | null;
  focusEffect?: FocusEffect | null;
}

export function makeScreenMotionClip(options: {
  id?: string;
  timing: TransitionTiming;
  target: ScreenMotionState;
  groupID?: string | null;
  focusEffect?: FocusEffect | null;
}): ScreenMotionClip {
  return {
    id: options.id ?? newUUID(),
    timing: options.timing,
    target: options.target,
    groupID: options.groupID ?? null,
    focusEffect: options.focusEffect ?? null,
  };
}

// ---------------------------------------------------------------------------
// ScreenAnchorViewport
// ---------------------------------------------------------------------------
/**
 * Anchor space: the canvas and fitted card dimensions needed for direct
 * rect-space linear interpolation.
 * Swift: `ScreenAnchorViewport`.
 */
export interface ScreenAnchorViewport {
  canvasWidth: number;
  canvasHeight: number;
  fittedWidth: number;
  fittedHeight: number;
  borderWidthAtScaleOne: number;
  decorationTopAtScaleOne: number;
  decorationRightAtScaleOne: number;
  decorationBottomAtScaleOne: number;
  decorationLeftAtScaleOne: number;
}

export function makeScreenAnchorViewport(options: {
  canvasWidth: number;
  canvasHeight: number;
  fittedWidth: number;
  fittedHeight: number;
  borderWidthAtScaleOne?: number;
  decorationTopAtScaleOne?: number;
  decorationRightAtScaleOne?: number;
  decorationBottomAtScaleOne?: number;
  decorationLeftAtScaleOne?: number;
}): ScreenAnchorViewport {
  return {
    canvasWidth: options.canvasWidth,
    canvasHeight: options.canvasHeight,
    fittedWidth: options.fittedWidth,
    fittedHeight: options.fittedHeight,
    borderWidthAtScaleOne: options.borderWidthAtScaleOne ?? 0,
    decorationTopAtScaleOne: options.decorationTopAtScaleOne ?? 0,
    decorationRightAtScaleOne: options.decorationRightAtScaleOne ?? 0,
    decorationBottomAtScaleOne: options.decorationBottomAtScaleOne ?? 0,
    decorationLeftAtScaleOne: options.decorationLeftAtScaleOne ?? 0,
  };
}

// ---------------------------------------------------------------------------
// ScreenMotionSample
// ---------------------------------------------------------------------------
export interface ScreenMotionSample {
  state: ScreenMotionState;
  manualOffset: CompositionPoint | null;
  projectionAnchor: NormalizedPoint;
}

export function makeScreenMotionSample(
  state: ScreenMotionState,
  manualOffset: CompositionPoint | null,
  projectionAnchor: NormalizedPoint | null = null,
): ScreenMotionSample {
  return {
    state,
    manualOffset,
    projectionAnchor: projectionAnchor ?? state.position,
  };
}

type ScreenMotionFraming = 'placement' | 'focus';

// ---------------------------------------------------------------------------
// ScreenMotionTrack
// ---------------------------------------------------------------------------
export class ScreenMotionTrack {
  readonly clips: readonly ScreenMotionClip[];
  private readonly usesIndexedEvaluation: boolean;

  constructor(clips: readonly ScreenMotionClip[]) {
    if (TimelineTrackOrdering.screenMotionClipsNeedRepair(clips)) {
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

  activeClip(time: number): ScreenMotionClip | null {
    if (!Number.isFinite(time)) return null;
    const index = this.lastStartedClipIndex(time);
    if (index == null) return null;
    const clip = this.clips[index];
    const prevEnd = clip.timing.startTime + clip.timing.duration;
    const effectEnd = prevEnd + clip.timing.returnDuration;
    return clip.timing.returnDuration > 0 && time >= effectEnd ? null : clip;
  }

  sample(
    time: number,
    base: ScreenMotionState = makeScreenMotionState(),
    motion: MotionStyle = makeMotionStyle(),
    anchorViewport: ScreenAnchorViewport | null = null,
  ): ScreenMotionState {
    return this.sampleLayout(time, base, motion, anchorViewport).state;
  }

  sampleLayout(
    time: number,
    base: ScreenMotionState = makeScreenMotionState(),
    motion: MotionStyle = makeMotionStyle(),
    anchorViewport: ScreenAnchorViewport | null = null,
  ): ScreenMotionSample {
    if (!this.usesIndexedEvaluation || !Number.isFinite(time)) {
      return this.sampleLayoutByScanning(time, base, motion, anchorViewport);
    }
    const index = this.lastStartedClipIndex(time);
    if (index == null) {
      return ScreenMotionTrack.layoutSample(base, anchorViewport, 'placement');
    }

    const clip = this.clips[index];
    const clipEndTime = clip.timing.startTime + clip.timing.duration;

    if (time < clipEndTime) {
      let inherited: ScreenMotionState;
      let inheritedFraming: ScreenMotionFraming;
      if (index > 0) {
        const previous = this.clips[index - 1];
        const prevEndTime = previous.timing.startTime + previous.timing.duration;
        const touches =
          Math.abs(prevEndTime - clip.timing.startTime) <=
          ZOOM_INTERPOLATOR_ADJACENCY_TOLERANCE;
        if (!touches && previous.timing.returnDuration > 0.000_1) {
          inherited = base;
          inheritedFraming = 'placement';
        } else {
          inherited = previous.target;
          inheritedFraming = 'focus';
        }
      } else {
        inherited = base;
        inheritedFraming = 'placement';
      }

      const leadIn = min(clip.timing.leadInDuration, clip.timing.duration);
      if (!(leadIn > 0.000_1)) {
        return ScreenMotionTrack.layoutSample(clip.target, anchorViewport, 'focus');
      }

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

      return ScreenMotionTrack.interpolateLayout(
        inherited,
        clip.target,
        progress,
        anchorViewport,
        inheritedFraming,
        'focus',
        inheritedFraming === 'focus' ? inherited.position : null,
        clip.target.position,
      );
    }

    if (this.touchesNextClip(index)) {
      return ScreenMotionTrack.layoutSample(clip.target, anchorViewport, 'focus');
    }

    const falling = this.returnFalloff(index, base, time, motion, anchorViewport);
    if (falling != null) {
      return falling;
    }

    return clip.timing.returnDuration > 0.000_1
      ? ScreenMotionTrack.layoutSample(base, anchorViewport, 'placement')
      : ScreenMotionTrack.layoutSample(clip.target, anchorViewport, 'focus');
  }

  private sampleLayoutByScanning(
    time: number,
    base: ScreenMotionState,
    motion: MotionStyle,
    anchorViewport: ScreenAnchorViewport | null,
  ): ScreenMotionSample {
    let inherited = base;
    let inheritedFraming: ScreenMotionFraming = 'placement';
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
            base,
            time,
            motion,
            anchorViewport,
          );
          if (falling != null) return falling;
        }
        return ScreenMotionTrack.layoutSample(inherited, anchorViewport, inheritedFraming);
      }

      if (time < clipEndTime) {
        const leadIn = min(clip.timing.leadInDuration, clip.timing.duration);
        if (!(leadIn > 0.000_1)) {
          return ScreenMotionTrack.layoutSample(clip.target, anchorViewport, 'focus');
        }
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
        return ScreenMotionTrack.interpolateLayout(
          inherited,
          clip.target,
          progress,
          anchorViewport,
          inheritedFraming,
          'focus',
          inheritedFraming === 'focus' ? inherited.position : null,
          clip.target.position,
        );
      }

      const touchesNext = this.touchesNextClip(index);
      if (!touchesNext && clip.timing.returnDuration > 0.000_1) {
        inherited = base;
        inheritedFraming = 'placement';
      } else {
        inherited = clip.target;
        inheritedFraming = 'focus';
      }
      previousIndex = index;
    }

    if (previousIndex != null) {
      const falling = this.returnFalloff(
        previousIndex,
        base,
        time,
        motion,
        anchorViewport,
      );
      if (falling != null) return falling;
      return this.clips[previousIndex].timing.returnDuration > 0.000_1
        ? ScreenMotionTrack.layoutSample(base, anchorViewport, 'placement')
        : ScreenMotionTrack.layoutSample(inherited, anchorViewport, inheritedFraming);
    }

    return ScreenMotionTrack.layoutSample(inherited, anchorViewport, inheritedFraming);
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
    base: ScreenMotionState,
    time: number,
    motion: MotionStyle,
    anchorViewport: ScreenAnchorViewport | null = null,
  ): ScreenMotionSample | null {
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

    return ScreenMotionTrack.interpolateLayout(
      clip.target,
      base,
      progress,
      anchorViewport,
      'focus',
      'placement',
      null,
      clip.target.position,
    );
  }

  private static interpolateLayout(
    from: ScreenMotionState,
    to: ScreenMotionState,
    progress: number,
    anchorViewport: ScreenAnchorViewport | null = null,
    fromFraming: ScreenMotionFraming,
    toFraming: ScreenMotionFraming,
    inheritedProjectionAnchor: NormalizedPoint | null = null,
    projectionAnchor: NormalizedPoint,
  ): ScreenMotionSample {
    const t = clamp(progress, 0, 1);
    let position: NormalizedPoint;

    if (anchorViewport != null) {
      const viewport = anchorViewport;
      const scaledW0 = from.scale * viewport.fittedWidth;
      const scaledW1 = to.scale * viewport.fittedWidth;
      const scaledW = ScreenMotionTrack.mix(scaledW0, scaledW1, t);
      const ux = ScreenMotionTrack.mix(
        from.position.x * (viewport.canvasWidth - scaledW0),
        to.position.x * (viewport.canvasWidth - scaledW1),
        t,
      );
      const scaledH0 = from.scale * viewport.fittedHeight;
      const scaledH1 = to.scale * viewport.fittedHeight;
      const scaledH = ScreenMotionTrack.mix(scaledH0, scaledH1, t);
      const uy = ScreenMotionTrack.mix(
        from.position.y * (viewport.canvasHeight - scaledH0),
        to.position.y * (viewport.canvasHeight - scaledH1),
        t,
      );
      const denomX = viewport.canvasWidth - scaledW;
      const denomY = viewport.canvasHeight - scaledH;

      position = {
        x:
          Math.abs(denomX) > 0.001
            ? ux / denomX
            : ScreenMotionTrack.mix(from.position.x, to.position.x, t),
        y:
          Math.abs(denomY) > 0.001
            ? uy / denomY
            : ScreenMotionTrack.mix(from.position.y, to.position.y, t),
      };
    } else {
      position = {
        x: ScreenMotionTrack.mix(from.position.x, to.position.x, t),
        y: ScreenMotionTrack.mix(from.position.y, to.position.y, t),
      };
    }

    const state: ScreenMotionState = {
      position,
      scale: ScreenMotionTrack.mix(from.scale, to.scale, t),
      rotationX: ScreenMotionTrack.mixAngle(from.rotationX, to.rotationX, t),
      rotationY: ScreenMotionTrack.mixAngle(from.rotationY, to.rotationY, t),
      rotationZ: ScreenMotionTrack.mixAngle(from.rotationZ, to.rotationZ, t),
      perspective: ScreenMotionTrack.mix(from.perspective, to.perspective, t),
    };

    let manualOffset: CompositionPoint | null = null;
    if (anchorViewport != null) {
      const fromOffset = ScreenMotionTrack.directOffset(from, anchorViewport, fromFraming);
      const toOffset = ScreenMotionTrack.directOffset(to, anchorViewport, toFraming);
      manualOffset = {
        x: ScreenMotionTrack.mix(fromOffset.x, toOffset.x, t),
        y: ScreenMotionTrack.mix(fromOffset.y, toOffset.y, t),
      };
    }

    const resolvedAnchor =
      inheritedProjectionAnchor != null
        ? {
            x: ScreenMotionTrack.mix(inheritedProjectionAnchor.x, projectionAnchor.x, t),
            y: ScreenMotionTrack.mix(inheritedProjectionAnchor.y, projectionAnchor.y, t),
          }
        : projectionAnchor;

    return {
      state,
      manualOffset,
      projectionAnchor: resolvedAnchor,
    };
  }

  private static layoutSample(
    state: ScreenMotionState,
    viewport: ScreenAnchorViewport | null,
    framing: ScreenMotionFraming,
  ): ScreenMotionSample {
    return {
      state,
      manualOffset:
        viewport != null
          ? ScreenMotionTrack.directOffset(state, viewport, framing)
          : null,
      projectionAnchor: state.position,
    };
  }

  private static directOffset(
    state: ScreenMotionState,
    viewport: ScreenAnchorViewport,
    framing: ScreenMotionFraming,
  ): CompositionPoint {
    const cardScale = state.scale;
    const contentWidth = viewport.fittedWidth * cardScale;
    const contentHeight = viewport.fittedHeight * cardScale;
    const border = viewport.borderWidthAtScaleOne * cardScale;
    const left = border + viewport.decorationLeftAtScaleOne * cardScale;
    const right = border + viewport.decorationRightAtScaleOne * cardScale;
    const top = border + viewport.decorationTopAtScaleOne * cardScale;
    const bottom = border + viewport.decorationBottomAtScaleOne * cardScale;
    const decoratedWidth = contentWidth + left + right;
    const decoratedHeight = contentHeight + top + bottom;
    let contentCenterX: number;
    let contentCenterY: number;

    switch (framing) {
      case 'placement':
        contentCenterX =
          state.position.x * (viewport.canvasWidth - decoratedWidth) +
          contentWidth / 2 +
          left;
        contentCenterY =
          state.position.y * (viewport.canvasHeight - decoratedHeight) +
          contentHeight / 2 +
          top;
        break;

      case 'focus': {
        const focusX = clamp(state.position.x, 0, 1);
        const focusY = clamp(state.position.y, 0, 1);
        const recenter = clamp((cardScale - 1) / 2, 0, 1) * 0.62;
        const boundedX = left + focusX * max(viewport.canvasWidth - left - right, 0);
        const boundedY = top + focusY * max(viewport.canvasHeight - top - bottom, 0);
        const targetX = ScreenMotionTrack.mix(
          boundedX,
          (viewport.canvasWidth + left - right) / 2,
          recenter,
        );
        const targetY = ScreenMotionTrack.mix(
          boundedY,
          (viewport.canvasHeight + top - bottom) / 2,
          recenter,
        );
        contentCenterX = targetX + (0.5 - focusX) * contentWidth;
        contentCenterY = targetY + (0.5 - focusY) * contentHeight;
        break;
      }
    }

    return {
      x: contentCenterX - viewport.canvasWidth / 2,
      y: contentCenterY - viewport.canvasHeight / 2,
    };
  }

  private static mix(from: number, to: number, progress: number): number {
    return from + (to - from) * progress;
  }

  private static mixAngle(from: number, to: number, progress: number): number {
    let delta = (to - from) % 360;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    return from + delta * progress;
  }
}
