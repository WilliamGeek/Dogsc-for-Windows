import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TimelineTrackOrdering } from '../../src/core/TimelineTrackOrdering.ts';
import type { ZoomAnimationClip } from '../../src/core/ZoomAnimation.ts';
import type { ScreenMotionClip } from '../../src/core/ScreenMotion.ts';

const makeMockZoomClip = (id: string, startTime: number, endTime: number): ZoomAnimationClip =>
  ({ id, startTime, endTime }) as unknown as ZoomAnimationClip;

test('zoomAnimationsNeedRepair validates duration and monotonic order', () => {
  assert.equal(TimelineTrackOrdering.zoomAnimationsNeedRepair([]), false);

  // Single valid animation
  assert.equal(
    TimelineTrackOrdering.zoomAnimationsNeedRepair([makeMockZoomClip('A', 0, 1)]),
    false,
  );

  // Zero / negative duration (< 0.001) needs repair
  assert.equal(
    TimelineTrackOrdering.zoomAnimationsNeedRepair([makeMockZoomClip('A', 1, 1.0005)]),
    true,
  );

  // Monotonically ordered
  assert.equal(
    TimelineTrackOrdering.zoomAnimationsNeedRepair([
      makeMockZoomClip('A', 0, 1),
      makeMockZoomClip('B', 1, 2),
    ]),
    false,
  );

  // Out of order by startTime
  assert.equal(
    TimelineTrackOrdering.zoomAnimationsNeedRepair([
      makeMockZoomClip('A', 2, 3),
      makeMockZoomClip('B', 1, 2),
    ]),
    true,
  );

  // Same startTime: tie-break by ID
  assert.equal(
    TimelineTrackOrdering.zoomAnimationsNeedRepair([
      makeMockZoomClip('ID-1', 1, 2),
      makeMockZoomClip('ID-2', 1, 2),
    ]),
    false,
  );
  assert.equal(
    TimelineTrackOrdering.zoomAnimationsNeedRepair([
      makeMockZoomClip('ID-2', 1, 2),
      makeMockZoomClip('ID-1', 1, 2),
    ]),
    true,
  );
});

test('screenMotionClipsNeedRepair validates clip timing order', () => {
  const makeMockMotionClip = (id: string, startTime: number): ScreenMotionClip =>
    ({ id, timing: { startTime } }) as unknown as ScreenMotionClip;

  assert.equal(TimelineTrackOrdering.screenMotionClipsNeedRepair([]), false);
  assert.equal(
    TimelineTrackOrdering.screenMotionClipsNeedRepair([
      makeMockMotionClip('A', 0),
      makeMockMotionClip('B', 1.5),
    ]),
    false,
  );
  assert.equal(
    TimelineTrackOrdering.screenMotionClipsNeedRepair([
      makeMockMotionClip('B', 1.5),
      makeMockMotionClip('A', 0.5),
    ]),
    true,
  );
});
