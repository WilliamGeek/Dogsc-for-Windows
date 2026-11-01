import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeOutputFrameSchedule,
  outputFrameScheduleFrame,
  OutputFrameScheduleError,
  ulp,
  OUTPUT_FRAME_SCHEDULE_TIMESCALE,
} from '../../src/core/OutputFrameSchedule.ts';

test('ulp helper exact double-precision tests', () => {
  assert.equal(ulp(1.0), Number.EPSILON);
  assert.equal(ulp(0.0), Number.MIN_VALUE);
  assert.ok(ulp(2.0) > ulp(1.0));
  assert.ok(Number.isNaN(ulp(Number.NaN)));
});

test('OutputFrameSchedule frame count and PTS at 60fps', () => {
  const schedule = makeOutputFrameSchedule(1.0, 60 as any);
  assert.equal(schedule.frameCount, 60);
  assert.equal(schedule.ticksPerFrame, 1500); // 90,000 / 60

  // Frame 0 at t=0
  const f0 = outputFrameScheduleFrame(schedule, 0)!;
  assert.equal(f0.index, 0);
  assert.equal(f0.presentationTimeValue, 0);
  assert.equal(f0.presentationTimescale, OUTPUT_FRAME_SCHEDULE_TIMESCALE);
  assert.equal(f0.presentationTimeSeconds, 0);

  // Frame n at n / 60
  for (let n = 0; n < 60; n++) {
    const f = outputFrameScheduleFrame(schedule, n)!;
    assert.equal(f.index, n);
    assert.equal(f.presentationTimeValue, n * 1500);
    assert.ok(Math.abs(f.presentationTimeSeconds - n / 60) < 1e-12);
  }

  // End-exclusive boundary: frame 60 is out of bounds
  assert.equal(outputFrameScheduleFrame(schedule, 60), null);
  assert.equal(outputFrameScheduleFrame(schedule, -1), null);
});

test('OutputFrameSchedule ticksPerFrame for standard frame rates', () => {
  assert.equal(makeOutputFrameSchedule(1.0, 30 as any).ticksPerFrame, 3000);
  assert.equal(makeOutputFrameSchedule(1.0, 60 as any).ticksPerFrame, 1500);
  assert.equal(makeOutputFrameSchedule(1.0, 90 as any).ticksPerFrame, 1000);
  assert.equal(makeOutputFrameSchedule(1.0, 120 as any).ticksPerFrame, 750);
});

test('OutputFrameSchedule boundary durations and representation noise', () => {
  // Zero duration
  const zeroSchedule = makeOutputFrameSchedule(0, 60 as any);
  assert.equal(zeroSchedule.frameCount, 0);
  assert.equal(outputFrameScheduleFrame(zeroSchedule, 0), null);

  // Exactly one frame duration (1/60s), floating-point noise snapped
  const oneFrameSchedule = makeOutputFrameSchedule(1.0 / 60.0, 60 as any);
  assert.equal(oneFrameSchedule.frameCount, 1);
  assert.ok(outputFrameScheduleFrame(oneFrameSchedule, 0) !== null);
  assert.equal(outputFrameScheduleFrame(oneFrameSchedule, 1), null);

  // 0.5s duration at 60fps = 30 frames
  const halfSec = makeOutputFrameSchedule(0.5, 60 as any);
  assert.equal(halfSec.frameCount, 30);
});

test('OutputFrameSchedule rejects invalid or excessive durations', () => {
  assert.throws(
    () => makeOutputFrameSchedule(-1.0, 60 as any),
    (err: any) => err instanceof OutputFrameScheduleError && err.code === 'invalidDuration',
  );
  assert.throws(
    () => makeOutputFrameSchedule(Number.NaN, 60 as any),
    (err: any) => err instanceof OutputFrameScheduleError && err.code === 'invalidDuration',
  );
  assert.throws(
    () => makeOutputFrameSchedule(Number.POSITIVE_INFINITY, 60 as any),
    (err: any) => err instanceof OutputFrameScheduleError && err.code === 'invalidDuration',
  );
  assert.throws(
    () => makeOutputFrameSchedule(1e20, 60 as any),
    (err: any) => err instanceof OutputFrameScheduleError && err.code === 'durationTooLong',
  );
});
