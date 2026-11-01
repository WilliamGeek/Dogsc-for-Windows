// Port of: F:\dogsc\Sources\RecorderCore\OutputFrameSchedule.swift
import { max } from './swift.ts';
import type { OutputFrameRate } from './CaptureConfiguration.ts';

/**
 * Computes exact IEEE-754 double precision ulp (unit in the last place).
 * Swift: `x.ulp`.
 */
export function ulp(x: number): number {
  if (!Number.isFinite(x)) return Number.NaN;
  const absX = Math.abs(x);
  if (absX === 0) return Number.MIN_VALUE;
  const buffer = new ArrayBuffer(8);
  const view = new Float64Array(buffer);
  const intView = new BigInt64Array(buffer);
  view[0] = absX;
  intView[0] += 1n;
  return view[0] - absX;
}

export interface OutputFrame {
  readonly index: number;
  readonly presentationTimeValue: number;
  readonly presentationTimescale: number;
  readonly presentationTimeSeconds: number;
}

export class OutputFrameScheduleError extends Error {
  readonly code: 'invalidDuration' | 'durationTooLong';

  constructor(code: 'invalidDuration' | 'durationTooLong') {
    super(`OutputFrameScheduleError: ${code}`);
    this.name = 'OutputFrameScheduleError';
    this.code = code;
  }
}

/**
 * The single source of truth for an exported video's frame count and PTS values.
 *
 * The schedule is end-exclusive: frame `n` exists exactly when
 * `0 <= n / frameRate < duration`. Presentation timestamps are derived from an
 * integer tick grid instead of accumulated floating-point frame durations.
 */
export interface OutputFrameSchedule {
  readonly duration: number;
  readonly frameRate: OutputFrameRate;
  readonly frameCount: number;
  readonly ticksPerFrame: number;
}

export const OUTPUT_FRAME_SCHEDULE_TIMESCALE = 90_000;

/**
 * Swift `init(duration:frameRate:) throws`
 */
export function makeOutputFrameSchedule(
  duration: number,
  frameRate: OutputFrameRate,
): OutputFrameSchedule {
  if (!(Number.isFinite(duration) && duration >= 0)) {
    throw new OutputFrameScheduleError('invalidDuration');
  }

  const timescale = OUTPUT_FRAME_SCHEDULE_TIMESCALE;
  const rate = Number(frameRate);
  if (timescale % rate !== 0) {
    throw new Error(`timescale ${timescale} must be a multiple of rate ${rate}`);
  }

  const ticksPerFrame = Math.trunc(timescale / rate);
  const scaledDuration = duration * rate;
  const maximumFrameCount = Math.floor(Number.MAX_SAFE_INTEGER / ticksPerFrame);

  if (!(Number.isFinite(scaledDuration) && scaledDuration <= maximumFrameCount)) {
    throw new OutputFrameScheduleError('durationTooLong');
  }

  // Values such as (1 / 90) * 90 are conceptually integral but can be a
  // handful of binary floating-point ulps away on a different platform or
  // after timeline arithmetic. Snap only that representation noise.
  const nearestInteger = Math.round(scaledDuration);
  const boundaryTolerance = max(ulp(scaledDuration) * 4, ulp(nearestInteger) * 4);
  const boundarySafeDuration =
    Math.abs(scaledDuration - nearestInteger) <= boundaryTolerance
      ? nearestInteger
      : scaledDuration;

  const frameCount = boundarySafeDuration > 0 ? Math.ceil(boundarySafeDuration) : 0;

  if (frameCount > 0) {
    const lastFrameIndex = frameCount - 1;
    if (lastFrameIndex > maximumFrameCount) {
      throw new OutputFrameScheduleError('durationTooLong');
    }
  }

  return Object.freeze({
    duration,
    frameRate,
    frameCount,
    ticksPerFrame,
  });
}

/**
 * Returns frame metadata for the given frame index, or null if out of range.
 * Swift: `frame(at:) -> Frame?`.
 */
export function outputFrameScheduleFrame(
  schedule: OutputFrameSchedule,
  index: number,
): OutputFrame | null {
  if (index < 0 || index >= schedule.frameCount) {
    return null;
  }
  const presentationTimeValue = index * schedule.ticksPerFrame;
  return Object.freeze({
    index,
    presentationTimeValue,
    presentationTimescale: OUTPUT_FRAME_SCHEDULE_TIMESCALE,
    presentationTimeSeconds: presentationTimeValue / OUTPUT_FRAME_SCHEDULE_TIMESCALE,
  });
}
