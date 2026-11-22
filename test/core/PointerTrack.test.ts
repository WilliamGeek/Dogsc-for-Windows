import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PointerTrack,
  PointerInterpolator,
  makePointerClickPhase,
  makePointerSample,
} from '../../src/core/PointerTrack.ts';
import { makePointerEventRecord } from '../../src/core/ZoomAnimation.ts';
import { makeMotionStyle, makeCursorStyle } from '../../src/core/ProjectModel.ts';
import { CursorRenderGeometry } from '../../src/core/CursorRenderGeometry.ts';

test('T4.2: PointerTrack construction, 240Hz zero-phase spring simulation, and prewarming', () => {
  const events = [
    makePointerEventRecord(0.0, { x: 0.1, y: 0.2 }, 'move'),
    makePointerEventRecord(0.5, { x: 0.5, y: 0.6 }, 'move'),
    makePointerEventRecord(1.0, { x: 0.9, y: 0.8 }, 'move'),
  ];

  const track = new PointerTrack(events);
  const motion = makeMotionStyle({ cursor: '平滑' });

  // Prewarm cache
  assert.equal(track.cachedSpringVariantCount, 0);
  track.prewarmCursorSpring(motion);
  assert.equal(track.cachedSpringVariantCount, 1);

  // Directly call makeSpringSamples
  const samples = track.makeSpringSamples(motion, () => false);
  assert.ok(samples != null);
  assert.ok(samples.length > 200, `Expected >200 samples at 240Hz, got ${samples.length}`);
  assert.equal(samples[0].time, 0.0);
  assert.ok(samples[0].location.x >= 0 && samples[0].location.x <= 1);
  assert.ok(samples[0].location.y >= 0 && samples[0].location.y <= 1);

  // Zero-phase forward/backward filter has symmetric zero-lag response at t=0.5
  // (step 0.1 -> 0.5 reaches ~0.30 midpoint instead of remaining stuck at 0.10).
  const midStepSample = track.evaluation(0.5, motion);
  assert.ok(midStepSample.position != null);
  assert.ok(
    midStepSample.position.x > 0.25 && midStepSample.position.x < 0.35,
    `Zero-phase symmetric step check failed: x=${midStepSample.position.x}`,
  );

  // Continuous movement (<= 0.12s interval): zero-phase tracks linear target without lag
  const denseEvents = Array.from({ length: 21 }, (_, i) => {
    const t = i * 0.05;
    return makePointerEventRecord(t, { x: 0.1 + 0.8 * t, y: 0.2 + 0.6 * t }, 'move');
  });
  const denseTrack = new PointerTrack(denseEvents);
  const denseMid = denseTrack.evaluation(0.5, motion);
  assert.ok(denseMid.position != null);
  assert.ok(
    Math.abs(denseMid.position.x - 0.5) < 0.02,
    `Zero-phase continuous lag check failed: x=${denseMid.position.x}`,
  );

  // Time before first event returns position: null, cursor: null
  const before = track.evaluation(-0.5, motion);
  assert.equal(before.position, null);
  assert.equal(before.cursor, null);

  // Evaluation during movement produces rotationRadians
  const moving = track.evaluation(0.5, motion);
  assert.ok(moving.position != null);
  assert.ok(moving.cursor != null);
  assert.ok(Number.isFinite(moving.cursor.rotationRadians));
});

test('T4.3: smootherStep property per Swift L658-661', () => {
  assert.equal(PointerTrack.smootherStep(0), 0);
  assert.equal(PointerTrack.smootherStep(1), 1);
  assert.equal(PointerTrack.smootherStep(0.5), 0.5);
  // Monotonic
  let prev = -1e-9;
  for (let i = 0; i <= 50; i++) {
    const s = PointerTrack.smootherStep(i / 50);
    assert.ok(s >= prev);
    prev = s;
  }
});

test('T4.3: Required tests: left click anchoring error < 1e-6 in smooth motion', () => {
  // Required test:
  // motion.cursor = '平滑' (smooth)
  // at left-click moment, samplePosition matches click coordinate with error < 1e-6
  const clickTime = 0.8;
  const clickLoc = { x: 0.642, y: 0.385 };

  const events = [
    makePointerEventRecord(0.0, { x: 0.1, y: 0.1 }, 'move'),
    makePointerEventRecord(0.4, { x: 0.3, y: 0.2 }, 'move'),
    makePointerEventRecord(clickTime, clickLoc, 'leftClick'),
    makePointerEventRecord(1.2, { x: 0.8, y: 0.7 }, 'move'),
  ];

  const track = new PointerTrack(events);
  const motion = makeMotionStyle({ cursor: '平滑' });

  const posAtClick = track.samplePosition(clickTime, motion);
  assert.ok(posAtClick != null);
  assert.ok(
    Math.abs(posAtClick.x - clickLoc.x) < 1e-6,
    `Error on X exceeds 1e-6: got ${posAtClick.x}, expected ${clickLoc.x}`,
  );
  assert.ok(
    Math.abs(posAtClick.y - clickLoc.y) < 1e-6,
    `Error on Y exceeds 1e-6: got ${posAtClick.y}, expected ${clickLoc.y}`,
  );
});

test('T4.3: Required tests: time < first event -> position === null', () => {
  const events = [
    makePointerEventRecord(1.0, { x: 0.5, y: 0.5 }, 'move'),
  ];
  const track = new PointerTrack(events);
  assert.equal(track.samplePosition(0.5), null);
  assert.equal(track.sample(0.5), null);
});

test('T4.3: Required tests: style.assetID === "hidden" -> cursor === null but position !== null', () => {
  const events = [
    makePointerEventRecord(0.0, { x: 0.2, y: 0.3 }, 'move'),
    makePointerEventRecord(1.0, { x: 0.7, y: 0.8 }, 'move'),
  ];
  const track = new PointerTrack(events);
  const hiddenStyle = makeCursorStyle({ assetID: 'hidden' });

  const evalResult = track.evaluation(0.5, makeMotionStyle(), hiddenStyle);
  assert.ok(evalResult.position != null, 'Position must not be null');
  assert.equal(evalResult.cursor, null, 'Cursor must be null when assetID is hidden');

  // Also via PointerInterpolator static helper
  const interpSample = PointerInterpolator.sample(events, 0.5, makeMotionStyle(), hiddenStyle);
  assert.equal(interpSample, null);
});

test('T13.5b-2a: CursorRenderGeometry.pressScale and PointerTrack click pressScale contract', () => {
  assert.equal(CursorRenderGeometry.pressScale(-0.01), 1);
  assert.equal(CursorRenderGeometry.pressScale(0), 1);
  assert.ok(Math.abs(CursorRenderGeometry.pressScale(0.08) - 0.82) < 1e-9);
  assert.ok(CursorRenderGeometry.pressScale(0.20) > 0.95);
  assert.equal(CursorRenderGeometry.pressScale(0.26), 1);

  const events = [
    makePointerEventRecord(0.0, { x: 0.5, y: 0.5 }, 'move'),
    makePointerEventRecord(1.0, { x: 0.5, y: 0.5 }, 'leftClick'),
  ];
  const track = new PointerTrack(events);
  const samplePressed = track.sample(1.08, makeMotionStyle(), makeCursorStyle({ pressesOnClick: true }));
  assert.ok(samplePressed != null);
  assert.ok(Math.abs(samplePressed.pressScale - 0.82) < 1e-6);

  const sampleDisabled = track.sample(1.08, makeMotionStyle(), makeCursorStyle({ pressesOnClick: false }));
  assert.ok(sampleDisabled != null);
  assert.equal(sampleDisabled.pressScale, 1);
});
