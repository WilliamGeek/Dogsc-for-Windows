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

test('T4.2: PointerTrack construction, 240Hz spring simulation, and prewarming', () => {
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
  assert.ok(Math.abs(samples[0].location.x - 0.1) < 1e-6);
  assert.ok(Math.abs(samples[0].location.y - 0.2) < 1e-6);

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
