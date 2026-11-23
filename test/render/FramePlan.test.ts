// Test for: F:\dogsc-win\src\render\FramePlan.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFramePlan } from '../../src/render/FramePlan.ts';
import { makeRecorderProject } from '../../src/core/ProjectMediaModel.ts';
import { makeProjectTimeline } from '../../src/core/ProjectTimeline.ts';
import {
  makePointerEventRecord,
  makeNormalizedPoint,
  makeZoomAnimationClip,
} from '../../src/core/ZoomAnimation.ts';

function assertNoNaN(obj: unknown, path: string = 'root'): void {
  if (typeof obj === 'number') {
    assert.ok(!Number.isNaN(obj), `NaN detected at ${path}`);
    assert.ok(Number.isFinite(obj), `Non-finite number (${obj}) detected at ${path}`);
  } else if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      assertNoNaN(obj[i], `${path}[${i}]`);
    }
  } else if (obj !== null && typeof obj === 'object') {
    for (const [key, val] of Object.entries(obj)) {
      assertNoNaN(val, `${path}.${key}`);
    }
  }
}

test('T12.1: authoritative source frame count wins over stale meta duration and removes tail freeze', () => {
  const timeline = makeProjectTimeline({});
  const project = makeRecorderProject({ timeline, zoomAnimations: [] });

  const plan = makeFramePlan({
    project,
    pointerEvents: [],
    fps: 60,
    durationSeconds: 12.377,
    sourceFrameCount: 588,
    canvas: { width: 1920, height: 1080 },
  });

  assert.equal(plan.frameCount, 588);
  const lastFrame = plan.frameAt(587);
  assert.equal(lastFrame.sourceFrameFile, 588);
  assert.ok(
    lastFrame.scene.time < 9.800001,
    `last presentation time ${lastFrame.scene.time}s must stay inside 9.8s source`
  );
});

test('T11.2: makeFramePlan satisfies CONTRACTS §4 mapping and idempotency', () => {
  const zoomClip = makeZoomAnimationClip({
    id: 'z1',
    startTime: 1.0,
    duration: 2.0,
    scale: 1.8,
    focus: makeNormalizedPoint(0.5, 0.5),
  });

  const timeline = makeProjectTimeline({ zoomClips: [zoomClip] });
  const project = makeRecorderProject({
    timeline,
    zoomAnimations: [zoomClip],
  });

  const pointerEvents = [
    makePointerEventRecord({ time: 0.0, location: makeNormalizedPoint(0.2, 0.2), kind: 'move' }),
    makePointerEventRecord({ time: 1.0, location: makeNormalizedPoint(0.5, 0.5), kind: 'leftClick' }),
    makePointerEventRecord({ time: 3.0, location: makeNormalizedPoint(0.8, 0.8), kind: 'move' }),
  ];

  const plan = makeFramePlan({
    project,
    pointerEvents,
    fps: 60,
    durationSeconds: 3.0,
    sourceFrameCount: 180,
    canvas: { width: 1920, height: 1080 },
  });

  assert.equal(plan.frameCount, 180);

  // 1. n = 0 must map to sourceFrameFile = 1
  const firstFrame = plan.frameAt(0);
  assert.equal(firstFrame.sourceFrameFile, 1);
  assert.equal(firstFrame.scene.time, 0);

  // 2. Last frame n = 179 must not exceed sourceFrameCount
  const lastFrame = plan.frameAt(179);
  assert.ok(lastFrame.sourceFrameFile <= 180);
  assert.ok(lastFrame.sourceFrameFile >= 1);

  // 3. Exact idempotency requirement
  const midFrameA = plan.frameAt(60); // t = 1.0s
  const midFrameB = plan.frameAt(60);
  assert.deepEqual(midFrameA, midFrameB);
  assert.equal(midFrameA.sourceFrameFile, 61); // 1.0 * 60 + 1 = 61

  // 4. Boundary clipping for out-of-bounds n
  const underflow = plan.frameAt(-10);
  assert.equal(underflow.sourceFrameFile, 1);
  const overflow = plan.frameAt(999);
  assert.equal(overflow.sourceFrameFile, 180);

  // 5. Zero NaN assertion across key sampled frames
  const sampleFrames = [0, 1, 30, 60, 90, 120, 179];
  for (const n of sampleFrames) {
    const f = plan.frameAt(n);
    assertNoNaN(f.scene, `frameAt(${n}).scene`);
    assert.ok(f.scene.screen.fittedRect.width > 0);
    assert.ok(f.scene.screen.fittedRect.height > 0);
  }
});

test('T16.5: makeFramePlan decodes 60fps sourceFrames accurately when exporting at 30fps', () => {
  const project = makeRecorderProject({ timeline: makeProjectTimeline({}) });
  const plan = makeFramePlan({
    project,
    pointerEvents: [],
    fps: 30,
    sourceFps: 60,
    durationSeconds: 2.0,
    sourceFrameCount: 120,
    canvas: { width: 1920, height: 1080 },
  });

  assert.equal(plan.frameCount, 60);
  assert.equal(plan.frameAt(0).sourceFrameFile, 1);
  // At 1.0s output (frame 30 @ 30fps), source frame must be frame 61 (at 60fps), NOT frame 31!
  assert.equal(plan.frameAt(30).sourceFrameFile, 61);
  assert.equal(plan.frameAt(59).sourceFrameFile, 119);
});
