// Port of: F:\dogsc\Sources\RecorderCore\PointerTrack.swift
import { clamp, max, min } from './swift.ts';
import { BoundedMemoizationCache } from './BoundedMemoizationCache.ts';
import { PointerEventTimelineOrdering } from './PointerEventTimelineOrdering.ts';
import {
  type NormalizedPoint,
  type PointerEventRecord,
  type PointerEventKind,
} from './ZoomAnimation.ts';
import {
  makeMotionStyle,
  makeCursorStyle,
  cursorClickEffectStyleDuration,
  type MotionStyle,
  type CursorStyle,
  type CursorAssetID,
} from './ProjectModel.ts';

// ---------------------------------------------------------------------------
// PointerClickPhase
// ---------------------------------------------------------------------------
export interface PointerClickPhase {
  progress: number;
  elapsed: number;
  duration: number;
  kind: PointerEventKind;
}

export function makePointerClickPhase(
  progress: number,
  elapsed: number,
  duration: number,
  kind: PointerEventKind,
): PointerClickPhase {
  return {
    progress: clamp(progress, 0, 1),
    elapsed,
    duration,
    kind,
  };
}

// ---------------------------------------------------------------------------
// PointerSample
// ---------------------------------------------------------------------------
export interface PointerSample {
  location: NormalizedPoint;
  isClicking: boolean;
  clickPhase: PointerClickPhase | null;
  rotationRadians: number;
  recordedCursorAssetID: CursorAssetID | null;
}

export function makePointerSample(
  location: NormalizedPoint,
  isClicking: boolean,
  clickPhase: PointerClickPhase | null = null,
  rotationRadians: number = 0,
  recordedCursorAssetID: CursorAssetID | null = null,
): PointerSample {
  return {
    location,
    isClicking,
    clickPhase,
    rotationRadians: Number.isFinite(rotationRadians) ? rotationRadians : 0,
    recordedCursorAssetID,
  };
}

// ---------------------------------------------------------------------------
// PointerTrackEvaluation
// ---------------------------------------------------------------------------
export interface PointerTrackEvaluation {
  position: NormalizedPoint | null;
  cursor: PointerSample | null;
}

export function makePointerTrackEvaluation(
  position: NormalizedPoint | null,
  cursor: PointerSample | null,
): PointerTrackEvaluation {
  return { position, cursor };
}

// ---------------------------------------------------------------------------
// Private internal structures for spring simulation
// ---------------------------------------------------------------------------
interface PointerSpringCacheKey {
  mass: number;
  stiffness: number;
  damping: number;
}

interface PointerSpringSample {
  time: number;
  location: NormalizedPoint;
}

// ---------------------------------------------------------------------------
// PointerTrack
// ---------------------------------------------------------------------------
export class PointerTrack {
  private static readonly maximumContinuousInputGap = 0.12;
  private static readonly maximumSlowMoveGap = 0.50;
  private static readonly maximumSlowMoveDistance = 0.03;
  private static readonly clickAnchorLeadDuration = 0.18;
  private static readonly clickAnchorTrailDuration = 0.18;
  private static readonly clickEffectDuration = 0.18;

  readonly events: readonly PointerEventRecord[];
  private readonly springCache: BoundedMemoizationCache<
    PointerSpringCacheKey,
    PointerSpringSample[]
  >;

  constructor(events: readonly PointerEventRecord[]) {
    this.events = PointerEventTimelineOrdering.normalized(events);
    this.springCache = new BoundedMemoizationCache<
      PointerSpringCacheKey,
      PointerSpringSample[]
    >(2);
  }

  get cachedSpringVariantCount(): number {
    return this.springCache.count;
  }

  prewarmCursorSpring(motion: MotionStyle): void {
    if (motion.cursor !== '平滑' || this.events.length === 0) return;
    const key = this.springCacheKey(motion);
    this.springCache.valueIfBuilt(key, () => {
      return this.makeSpringSamples(motion, () => false);
    });
  }

  sample(
    time: number,
    motion: MotionStyle = makeMotionStyle(),
    style: CursorStyle = makeCursorStyle(),
  ): PointerSample | null {
    return this.evaluation(time, motion, style).cursor;
  }

  samplePosition(
    time: number,
    motion: MotionStyle = makeMotionStyle(),
  ): NormalizedPoint | null {
    return this.evaluation(time, motion, makeCursorStyle()).position;
  }

  evaluation(
    time: number,
    motion: MotionStyle = makeMotionStyle(),
    style: CursorStyle = makeCursorStyle(),
  ): PointerTrackEvaluation {
    if (this.events.length === 0) {
      return { position: null, cursor: null };
    }
    const first = this.events[0];
    if (time < first.time) {
      return { position: null, cursor: null };
    }

    const upperIndex = this.firstIndexAfter(time);
    const lowerIndex = upperIndex > 0 ? upperIndex - 1 : 0;
    const lower = this.events[lowerIndex];
    const upper = upperIndex < this.events.length ? this.events[upperIndex] : null;

    let rawLocation: NormalizedPoint;
    if (motion.cursor === '平滑') {
      rawLocation = this.springLocation(time, motion) ?? lower.location;
    } else if (upper != null && upper.time > lower.time) {
      rawLocation = this.interpolatedLocation(lowerIndex, upperIndex, time, motion);
    } else {
      rawLocation = lower.location;
    }

    const cursorIsVisible =
      style.assetID !== 'hidden' &&
      (!style.hideWhenIdle || time - lower.time <= style.idleDelay);

    let clickPhase: PointerClickPhase | null = null;
    const effectDuration = cursorClickEffectStyleDuration(style.clickEffectStyle);
    if (cursorIsVisible && style.clickEffectStyle !== 'none' && effectDuration > 0) {
      const click = this.mostRecentClick(time - effectDuration, time);
      if (click != null) {
        const elapsed = max(time - click.time, 0);
        const progress = clamp(elapsed / effectDuration, 0, 1);
        clickPhase = {
          progress,
          elapsed,
          duration: effectDuration,
          kind: click.kind,
        };
      }
    }

    const clicking = clickPhase != null;
    const rotationRadians = this.cursorRotationRadians(
      time,
      rawLocation,
      motion,
      style.motionTiltStrength,
    );

    return {
      position: rawLocation,
      cursor: cursorIsVisible
        ? {
            location: rawLocation,
            isClicking: clicking,
            clickPhase,
            rotationRadians,
            recordedCursorAssetID: lower.cursorAssetID ?? null,
          }
        : null,
    };
  }

  private cursorRotationRadians(
    time: number,
    currentLocation: NormalizedPoint,
    motion: MotionStyle,
    strength: number,
  ): number {
    const boundedStrength = clamp(strength, 2, 4);

    let sampleWindow: number;
    let maximumDegrees: number;
    let previousVelocityWeight: number;
    let responseSpan: number;

    switch (motion.cursor) {
      case '平滑':
        sampleWindow = 0.08;
        maximumDegrees = 9;
        previousVelocityWeight = 0.38;
        responseSpan = 0.18;
        break;
      case '适中':
        sampleWindow = 0.065;
        maximumDegrees = 8;
        previousVelocityWeight = 0.24;
        responseSpan = 0.22;
        break;
      case '快速':
        sampleWindow = 0.05;
        maximumDegrees = 7;
        previousVelocityWeight = 0.12;
        responseSpan = 0.28;
        break;
      case '无':
        return 0;
    }

    const previous = this.resolvedLocation(time - sampleWindow, motion);
    const older = this.resolvedLocation(time - sampleWindow * 2, motion);
    if (previous == null || older == null) return 0;

    const recentVelocityX = (currentLocation.x - previous.x) / sampleWindow;
    const recentVelocityY = (currentLocation.y - previous.y) / sampleWindow;
    const previousVelocityX = (previous.x - older.x) / sampleWindow;
    const previousVelocityY = (previous.y - older.y) / sampleWindow;

    const retainedWeight = previousVelocityWeight;
    const velocityX =
      recentVelocityX * (1 - retainedWeight) + previousVelocityX * retainedWeight;
    const velocityY =
      recentVelocityY * (1 - retainedWeight) + previousVelocityY * retainedWeight;
    const speed = Math.hypot(velocityX, velocityY);

    const responseGain = max(boundedStrength, 0.25);
    const stationaryThreshold = 0.006 / responseGain;
    if (!Number.isFinite(speed) || speed <= stationaryThreshold) return 0;

    const inverseSpeed = 1 / max(speed, 0.000_001);
    const trailingTorque = clamp(
      ((velocityX - velocityY) * inverseSpeed) / Math.SQRT2,
      -1,
      1,
    );
    const response = clamp(
      (speed - stationaryThreshold) / (responseSpan / responseGain),
      0,
      1,
    );
    const smoothResponse = response * response * (3 - 2 * response);

    const lowerIdx = max(this.firstIndexAfter(time) - 1, 0);
    const elapsed = max(time - this.events[lowerIdx].time, 0);
    const idleDecay = clamp(1 - elapsed / 0.18, 0, 1);

    const amplitudeScale = 0.35 + 0.65 * boundedStrength;
    const degrees =
      -maximumDegrees *
      amplitudeScale *
      smoothResponse *
      trailingTorque *
      idleDecay;

    return (degrees * Math.PI) / 180;
  }

  private resolvedLocation(
    time: number,
    motion: MotionStyle,
  ): NormalizedPoint | null {
    if (this.events.length === 0 || time < this.events[0].time) return null;
    const upperIndex = this.firstIndexAfter(time);
    const lowerIndex = upperIndex > 0 ? upperIndex - 1 : 0;
    const lower = this.events[lowerIndex];

    if (motion.cursor === '平滑') {
      return this.springLocation(time, motion) ?? lower.location;
    }
    if (upperIndex < this.events.length && this.events[upperIndex].time > lower.time) {
      return this.interpolatedLocation(lowerIndex, upperIndex, time, motion);
    }
    return lower.location;
  }

  private springLocation(
    time: number,
    motion: MotionStyle,
  ): NormalizedPoint | null {
    const key = this.springCacheKey(motion);
    const samples = this.springCache.value(key, () => {
      return this.makeSpringSamples(motion, () => false) ?? [];
    });
    if (samples.length === 0) return null;
    if (time <= samples[0].time) return samples[0].location;
    const last = samples[samples.length - 1];
    if (time >= last.time) return last.location;

    let lower = 0;
    let upper = samples.length;
    while (lower < upper) {
      const middle = lower + Math.floor((upper - lower) / 2);
      if (samples[middle].time <= time) {
        lower = middle + 1;
      } else {
        upper = middle;
      }
    }
    const upperIndex = min(lower, samples.length - 1);
    const lowerIndex = max(upperIndex - 1, 0);
    const a = samples[lowerIndex];
    const b = samples[upperIndex];
    const duration = max(b.time - a.time, Number.MIN_VALUE);
    const progress = clamp((time - a.time) / duration, 0, 1);

    return {
      x: a.location.x + (b.location.x - a.location.x) * progress,
      y: a.location.y + (b.location.y - a.location.y) * progress,
    };
  }

  private springCacheKey(motion: MotionStyle): PointerSpringCacheKey {
    return {
      mass: motion.cursorSpringMass,
      stiffness: motion.cursorSpringStiffness,
      damping: motion.cursorSpringDamping,
    };
  }

  makeSpringSamples(
    motion: MotionStyle,
    cancellationCheck: () => boolean,
  ): PointerSpringSample[] | null {
    if (this.events.length === 0) return [];
    const first = this.events[0];
    const last = this.events[this.events.length - 1];
    const interval = 1.0 / 240.0;
    const mass = max(motion.cursorSpringMass, 0.01);
    const stiffness = max(motion.cursorSpringStiffness, 0.01);
    const damping = max(motion.cursorSpringDamping, 0.01);
    const settleDuration = max(0.65, 6 * Math.sqrt(mass / stiffness));
    const endTime = max(last.time, first.time) + settleDuration;
    const jitterThreshold = 0.000_35;
    const jitterThresholdSquared = jitterThreshold * jitterThreshold;

    let position = first.location;
    let velocityX = 0.0;
    let velocityY = 0.0;
    let stableTarget = first.location;
    let eventIndex = 1;
    let sampleTime = first.time;
    const result: PointerSpringSample[] = [{ time: sampleTime, location: position }];
    let iteration = 0;

    while (sampleTime < endTime) {
      if ((iteration & 1023) === 0 && cancellationCheck()) return null;
      const nextTime = min(sampleTime + interval, endTime);
      while (eventIndex < this.events.length && this.events[eventIndex].time <= nextTime) {
        eventIndex += 1;
      }
      const lowerIndex = max(eventIndex - 1, 0);
      let target: NormalizedPoint;
      if (eventIndex < this.events.length) {
        const lowerEvent = this.events[lowerIndex];
        const upperEvent = this.events[eventIndex];
        const duration = max(upperEvent.time - lowerEvent.time, Number.MIN_VALUE);
        if (PointerTrack.isContinuousMovement(lowerEvent, upperEvent)) {
          const progress = clamp((nextTime - lowerEvent.time) / duration, 0, 1);
          target = {
            x: lowerEvent.location.x + (upperEvent.location.x - lowerEvent.location.x) * progress,
            y: lowerEvent.location.y + (upperEvent.location.y - lowerEvent.location.y) * progress,
          };
        } else {
          target = lowerEvent.location;
        }
      } else {
        target = last.location;
      }

      const targetDeltaX = target.x - stableTarget.x;
      const targetDeltaY = target.y - stableTarget.y;
      if (targetDeltaX * targetDeltaX + targetDeltaY * targetDeltaY >= jitterThresholdSquared) {
        stableTarget = target;
      }

      const deltaTime = max(nextTime - sampleTime, 0);
      const accelerationX =
        (stiffness * (stableTarget.x - position.x) - damping * velocityX) / mass;
      const accelerationY =
        (stiffness * (stableTarget.y - position.y) - damping * velocityY) / mass;
      velocityX += accelerationX * deltaTime;
      velocityY += accelerationY * deltaTime;
      position = {
        x: clamp(position.x + velocityX * deltaTime, 0, 1),
        y: clamp(position.y + velocityY * deltaTime, 0, 1),
      };
      sampleTime = nextTime;
      result.push({ time: sampleTime, location: position });
      iteration += 1;
    }

    return this.anchoringClicks(result, cancellationCheck);
  }

  private anchoringClicks(
    baseSamples: readonly PointerSpringSample[],
    cancellationCheck: () => boolean,
  ): PointerSpringSample[] | null {
    const clicks = this.events.filter(
      (e) => e.kind === 'leftClick' || e.kind === 'rightClick',
    );
    if (baseSamples.length === 0 || clicks.length === 0) {
      return baseSamples.slice();
    }

    const inserted = this.insertingClickSamples(baseSamples, clicks, cancellationCheck);
    if (inserted == null) return null;
    const samples = inserted;

    for (let clickIndex = 0; clickIndex < clicks.length; clickIndex++) {
      if (cancellationCheck()) return null;
      const click = clicks[clickIndex];
      const anchorIndex = this.exactSampleIndex(click.time, samples);
      if (anchorIndex == null) continue;

      const previousClickTime = clickIndex > 0 ? clicks[clickIndex - 1].time : null;
      const nextClickTime =
        clickIndex + 1 < clicks.length ? clicks[clickIndex + 1].time : null;

      const supportStart = max(
        samples[0].time,
        max(
          click.time - PointerTrack.clickAnchorLeadDuration,
          previousClickTime != null ? (previousClickTime + click.time) * 0.5 : -Infinity,
        ),
      );
      const supportEnd = min(
        samples[samples.length - 1].time,
        min(
          click.time + PointerTrack.clickAnchorTrailDuration,
          nextClickTime != null ? (click.time + nextClickTime) * 0.5 : Infinity,
        ),
      );
      const current = samples[anchorIndex].location;
      const correctionX = click.location.x - current.x;
      const correctionY = click.location.y - current.y;

      const supportStartIndex = this.firstSampleIndexAtOrAfter(supportStart, samples);
      const supportEndIndex = this.firstSampleIndexAfter(supportEnd, samples);

      for (let index = supportStartIndex; index < supportEndIndex; index++) {
        const sampleTime = samples[index].time;
        let weight: number;
        if (sampleTime <= click.time) {
          const duration = click.time - supportStart;
          const progress = duration > 0 ? (sampleTime - supportStart) / duration : 1;
          weight = PointerTrack.smootherStep(progress);
        } else {
          const duration = supportEnd - click.time;
          const progress = duration > 0 ? (sampleTime - click.time) / duration : 1;
          weight = 1 - PointerTrack.smootherStep(progress);
        }
        samples[index] = {
          time: sampleTime,
          location: {
            x: clamp(samples[index].location.x + correctionX * weight, 0, 1),
            y: clamp(samples[index].location.y + correctionY * weight, 0, 1),
          },
        };
      }
      samples[anchorIndex] = {
        time: click.time,
        location: click.location,
      };
    }
    return samples;
  }

  private insertingClickSamples(
    baseSamples: readonly PointerSpringSample[],
    clicks: readonly PointerEventRecord[],
    cancellationCheck: () => boolean,
  ): PointerSpringSample[] | null {
    if (baseSamples.length <= 1) return baseSamples.slice();
    const result: PointerSpringSample[] = [];
    let baseIndex = 0;
    const lastSampleTime = baseSamples[baseSamples.length - 1].time;

    for (let clickIndex = 0; clickIndex < clicks.length; clickIndex++) {
      if ((clickIndex & 255) === 0 && cancellationCheck()) return null;
      const click = clicks[clickIndex];
      if (click.time < baseSamples[0].time || click.time > lastSampleTime) {
        continue;
      }
      while (baseIndex < baseSamples.length && baseSamples[baseIndex].time < click.time - 0.000_000_1) {
        result.push(baseSamples[baseIndex]);
        baseIndex += 1;
      }
      if (
        baseIndex < baseSamples.length &&
        Math.abs(baseSamples[baseIndex].time - click.time) <= 0.000_000_1
      ) {
        const lastAdded = result.length > 0 ? result[result.length - 1] : null;
        if (lastAdded == null || lastAdded.time !== click.time) {
          result.push({ time: click.time, location: baseSamples[baseIndex].location });
        }
        baseIndex += 1;
        continue;
      }
      const before = result.length > 0 ? result[result.length - 1] : null;
      if (before == null || baseIndex >= baseSamples.length) continue;
      if (Math.abs(before.time - click.time) <= 0.000_000_1) {
        continue;
      }
      const after = baseSamples[baseIndex];
      const duration = max(after.time - before.time, Number.MIN_VALUE);
      const progress = clamp((click.time - before.time) / duration, 0, 1);
      result.push({
        time: click.time,
        location: {
          x: before.location.x + (after.location.x - before.location.x) * progress,
          y: before.location.y + (after.location.y - before.location.y) * progress,
        },
      });
    }

    while (baseIndex < baseSamples.length) {
      result.push(baseSamples[baseIndex]);
      baseIndex += 1;
    }
    return result;
  }

  private exactSampleIndex(
    time: number,
    samples: readonly PointerSpringSample[],
  ): number | null {
    let lower = 0;
    let upper = samples.length;
    while (lower < upper) {
      const middle = lower + Math.floor((upper - lower) / 2);
      if (samples[middle].time < time) {
        lower = middle + 1;
      } else {
        upper = middle;
      }
    }
    if (lower < samples.length && Math.abs(samples[lower].time - time) <= 0.000_000_1) {
      return lower;
    }
    if (lower > 0 && Math.abs(samples[lower - 1].time - time) <= 0.000_000_1) {
      return lower - 1;
    }
    return null;
  }

  private firstSampleIndexAtOrAfter(
    time: number,
    samples: readonly PointerSpringSample[],
  ): number {
    let lower = 0;
    let upper = samples.length;
    while (lower < upper) {
      const middle = lower + Math.floor((upper - lower) / 2);
      if (samples[middle].time < time) {
        lower = middle + 1;
      } else {
        upper = middle;
      }
    }
    return lower;
  }

  private firstSampleIndexAfter(
    time: number,
    samples: readonly PointerSpringSample[],
  ): number {
    let lower = 0;
    let upper = samples.length;
    while (lower < upper) {
      const middle = lower + Math.floor((upper - lower) / 2);
      if (samples[middle].time <= time) {
        lower = middle + 1;
      } else {
        upper = middle;
      }
    }
    return lower;
  }

  static smootherStep(value: number): number {
    const t = clamp(value, 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private interpolatedLocation(
    lowerIndex: number,
    upperIndex: number,
    time: number,
    motion: MotionStyle,
  ): NormalizedPoint {
    const lower = this.events[lowerIndex];
    const upper = this.events[upperIndex];
    const duration = upper.time - lower.time;
    if (!(duration > 0)) return lower.location;
    if (!PointerTrack.isContinuousMovement(lower, upper)) {
      return lower.location;
    }
    const progress = clamp((time - lower.time) / duration, 0, 1);
    if (motion.cursor === '无') {
      return {
        x: lower.location.x + (upper.location.x - lower.location.x) * progress,
        y: lower.location.y + (upper.location.y - lower.location.y) * progress,
      };
    }

    let tangentScale: number;
    switch (motion.cursor) {
      case '平滑': {
        const mass = max(motion.cursorSpringMass, 0.01);
        const stiffness = max(motion.cursorSpringStiffness, 0.01);
        const damping = max(motion.cursorSpringDamping, 0.01);
        const naturalFrequency = Math.sqrt(stiffness / mass);
        const decayRate = damping / (2 * mass);
        const responsiveness = naturalFrequency / (naturalFrequency + decayRate);
        tangentScale = clamp(0.25 + 1.1 * responsiveness, 0.25, 1.2);
        break;
      }
      case '适中':
        tangentScale = 0.78;
        break;
      case '快速':
      case '无':
        tangentScale = 1.0;
        break;
    }

    const lowerTangent = this.tangent(lowerIndex);
    const upperTangent = this.tangent(upperIndex);
    const t2 = progress * progress;
    const t3 = t2 * progress;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + progress;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    return {
      x: clamp(
        h00 * lower.location.x +
          h10 * duration * lowerTangent.x * tangentScale +
          h01 * upper.location.x +
          h11 * duration * upperTangent.x * tangentScale,
        0,
        1,
      ),
      y: clamp(
        h00 * lower.location.y +
          h10 * duration * lowerTangent.y * tangentScale +
          h01 * upper.location.y +
          h11 * duration * upperTangent.y * tangentScale,
        0,
        1,
      ),
    };
  }

  private tangent(index: number): NormalizedPoint {
    const current = this.events[index];
    let previous = index - 1;
    while (previous >= 0 && this.events[previous].time >= current.time) {
      previous -= 1;
    }
    let next = index + 1;
    while (next < this.events.length && this.events[next].time <= current.time) {
      next += 1;
    }
    if (previous >= 0 && next < this.events.length) {
      return this.monotoneTangent(this.events[previous], current, this.events[next]);
    }
    if (next < this.events.length) {
      const duration = this.events[next].time - current.time;
      if (!(duration > 0)) return { x: 0, y: 0 };
      return {
        x: (this.events[next].location.x - current.location.x) / duration,
        y: (this.events[next].location.y - current.location.y) / duration,
      };
    }
    if (previous >= 0) {
      const duration = current.time - this.events[previous].time;
      if (!(duration > 0)) return { x: 0, y: 0 };
      return {
        x: (current.location.x - this.events[previous].location.x) / duration,
        y: (current.location.y - this.events[previous].location.y) / duration,
      };
    }
    return { x: 0, y: 0 };
  }

  static isContinuousMovement(
    lower: PointerEventRecord,
    upper: PointerEventRecord,
  ): boolean {
    const duration = upper.time - lower.time;
    if (!(duration > 0)) return false;
    if (duration <= PointerTrack.maximumContinuousInputGap) return true;
    if (duration > PointerTrack.maximumSlowMoveGap) return false;
    const deltaX = upper.location.x - lower.location.x;
    const deltaY = upper.location.y - lower.location.y;
    return (
      deltaX * deltaX + deltaY * deltaY <=
      PointerTrack.maximumSlowMoveDistance * PointerTrack.maximumSlowMoveDistance
    );
  }

  private monotoneTangent(
    previous: PointerEventRecord,
    current: PointerEventRecord,
    next: PointerEventRecord,
  ): NormalizedPoint {
    const previousDuration = current.time - previous.time;
    const nextDuration = next.time - current.time;
    if (!(previousDuration > 0 && nextDuration > 0)) {
      return { x: 0, y: 0 };
    }

    const calcAxis = (prevVal: number, val: number, nextVal: number): number => {
      const prevSlope = (val - prevVal) / previousDuration;
      const nextSlope = (nextVal - val) / nextDuration;
      if (!Number.isFinite(prevSlope) || !Number.isFinite(nextSlope) || prevSlope * nextSlope <= 0) {
        return 0;
      }
      const firstWeight = 2 * nextDuration + previousDuration;
      const secondWeight = nextDuration + 2 * previousDuration;
      const denominator = firstWeight / prevSlope + secondWeight / nextSlope;
      if (!Number.isFinite(denominator) || Math.abs(denominator) <= Number.MIN_VALUE) {
        return 0;
      }
      return (firstWeight + secondWeight) / denominator;
    };

    return {
      x: calcAxis(previous.location.x, current.location.x, next.location.x),
      y: calcAxis(previous.location.y, current.location.y, next.location.y),
    };
  }

  private firstIndexAfter(time: number): number {
    let lower = 0;
    let upper = this.events.length;
    while (lower < upper) {
      const middle = lower + Math.floor((upper - lower) / 2);
      if (this.events[middle].time <= time) {
        lower = middle + 1;
      } else {
        upper = middle;
      }
    }
    return lower;
  }

  private firstIndexAtOrAfter(time: number): number {
    let lower = 0;
    let upper = this.events.length;
    while (lower < upper) {
      const middle = lower + Math.floor((upper - lower) / 2);
      if (this.events[middle].time < time) {
        lower = middle + 1;
      } else {
        upper = middle;
      }
    }
    return lower;
  }

  eventsRange(start: number, end: number): readonly PointerEventRecord[] {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      return [];
    }
    const lower = this.firstIndexAtOrAfter(start);
    const upper = this.firstIndexAfter(end);
    return this.events.slice(lower, upper);
  }

  private mostRecentClick(start: number, end: number): PointerEventRecord | null {
    let index = this.firstIndexAtOrAfter(start);
    let latest: PointerEventRecord | null = null;
    while (index < this.events.length && this.events[index].time <= end) {
      const ev = this.events[index];
      if (ev.kind === 'leftClick' || ev.kind === 'rightClick') {
        latest = ev;
      }
      index += 1;
    }
    return latest;
  }
}

// ---------------------------------------------------------------------------
// PointerInterpolator
// ---------------------------------------------------------------------------
export const PointerInterpolator = Object.freeze({
  sample(
    events: readonly PointerEventRecord[],
    time: number,
    motion: MotionStyle = makeMotionStyle(),
    style: CursorStyle = makeCursorStyle(),
  ): PointerSample | null {
    return new PointerTrack(events).sample(time, motion, style);
  },
});
