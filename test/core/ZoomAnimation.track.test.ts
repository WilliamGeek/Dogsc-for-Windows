import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  zoomSpringProgress,
  ZoomInterpolator,
  ZoomAnimationTrack,
  makeZoomAnimationClip,
  makeZoomKeyframe,
  zoomAnimationClipMigrating,
  makeZoomSample,
  ZoomViewportTransform,
  makeZoomViewportTransformFromSample,
  zoomViewportTransformApply,
  makeManualZoomViewportTransition,
} from '../../src/core/ZoomAnimation.ts';
import { makeMotionStyle } from '../../src/core/ProjectModel.ts';
import { makeCompositionRect } from '../../src/core/CompositionScene.ts';

test('T3.2: springProgress(t, 2.4, 210, 42) endpoints and bounds', () => {
  // Required test: t=0 -> 0, t=1 -> 1 (exact), t in (0,1) bounded in [0,1]
  assert.equal(zoomSpringProgress(0, 2.4, 210, 42), 0);
  assert.equal(zoomSpringProgress(1, 2.4, 210, 42), 1);
  assert.equal(zoomSpringProgress(-0.5, 2.4, 210, 42), 0);
  assert.equal(zoomSpringProgress(1.5, 2.4, 210, 42), 1);

  for (let i = 1; i < 100; i++) {
    const t = i / 100;
    const progress = zoomSpringProgress(t, 2.4, 210, 42);
    assert.ok(
      progress >= 0 && progress <= 1,
      `springProgress(${t}) = ${progress} is out of bounds [0, 1]`,
    );
  }
});

test('T3.2: ZoomInterpolator.sample on empty track returns scale=1, focus=(0.5, 0.5)', () => {
  // Required test: sample with no animations
  const sample = ZoomInterpolator.sample([], 1.5);
  assert.equal(sample.scale, 1);
  assert.equal(sample.focus.x, 0.5);
  assert.equal(sample.focus.y, 0.5);
  assert.equal(sample.framingProgress, 0);
  assert.equal(sample.targetScale, 1);

  // Also via track
  const track = new ZoomAnimationTrack([]);
  const trackSample = track.sample(2.0);
  assert.equal(trackSample.scale, 1);
  assert.equal(trackSample.focus.x, 0.5);
  assert.equal(trackSample.focus.y, 0.5);
});

test('T3.2: ZoomViewportTransform.make and applying', () => {
  const sample = makeZoomSample(2.0, { x: 0.5, y: 0.5 }, 1, 2.0);
  const transform = ZoomViewportTransform.make(sample);

  assert.equal(transform.scale, 2.0);
  assert.equal(transform.translation.x, 0);
  assert.equal(transform.translation.y, 0);

  // Applying to center (0.5, 0.5) should yield (0.5, 0.5)
  const mappedCenter = ZoomViewportTransform.applying(transform, { x: 0.5, y: 0.5 });
  assert.equal(mappedCenter.x, 0.5);
  assert.equal(mappedCenter.y, 0.5);

  // Applying to corner (0, 0): 0.5 + 2 * (0 - 0.5) + 0 = -0.5
  const mappedCorner = ZoomViewportTransform.applying(transform, { x: 0, y: 0 });
  assert.equal(mappedCorner.x, -0.5);
  assert.equal(mappedCorner.y, -0.5);

  // Test with visibleRect clamping
  const rect = makeCompositionRect(0, 0, 1, 1);
  const transformWithRect = makeZoomViewportTransformFromSample(sample, undefined, rect);
  assert.equal(transformWithRect.scale, 2.0);
});

test('T3.2: ManualZoomViewportTransition interpolation', () => {
  const transition = makeManualZoomViewportTransition(
    1.5,
    { x: 0.2, y: 0.2 },
    2.5,
    { x: 0.8, y: 0.8 },
    0.5,
  );
  const sample = makeZoomSample(2.0, { x: 0.5, y: 0.5 }, 1, 2.5, transition);
  const transform = ZoomViewportTransform.make(sample);

  // At progress = 0.5, scale should be midway between 1.5 and 2.5 = 2.0
  assert.ok(Math.abs(transform.scale - 2.0) < 1e-6);
});

test('T3.2: ZoomAnimationClip.migrating reconstructs clips from legacy keyframes', () => {
  const kfs = [
    makeZoomKeyframe({ time: 0.0, scale: 1.0, focus: { x: 0.5, y: 0.5 } }),
    makeZoomKeyframe({ time: 1.0, scale: 2.0, focus: { x: 0.3, y: 0.4 }, origin: 'manual' }),
    makeZoomKeyframe({ time: 1.5, scale: 2.5, focus: { x: 0.35, y: 0.45 }, origin: 'automatic' }),
    makeZoomKeyframe({ time: 3.0, scale: 1.0, focus: { x: 0.5, y: 0.5 } }),
  ];

  const clips = zoomAnimationClipMigrating(kfs);
  assert.equal(clips.length, 1);
  const clip = clips[0];
  assert.equal(clip.startTime, 0.0);
  assert.equal(clip.endTime, 3.0);
  // Representative should have highest scale = 2.5
  assert.equal(clip.scale, 2.5);
  assert.equal(clip.focus.x, 0.35);
  assert.equal(clip.focus.y, 0.45);
  // Should inherit manual origin if any frame has manual
  assert.equal(clip.origin, 'manual');
});

test('T3.2: ZoomAnimationTrack activeClip and adjacentPreviousClip lookup', () => {
  const clip1 = makeZoomAnimationClip({
    id: 'clip-1',
    startTime: 1.0,
    endTime: 2.0,
    scale: 2.0,
    enterDuration: 0.4,
    exitDuration: 0.4,
    origin: 'automatic',
  });
  const clip2 = makeZoomAnimationClip({
    id: 'clip-2',
    startTime: 2.0, // Touching clip
    endTime: 3.5,
    scale: 3.0,
    enterDuration: 0.4,
    exitDuration: 0.5,
    origin: 'manual',
  });

  const track = new ZoomAnimationTrack([clip1, clip2]);

  assert.equal(track.activeClip(0.5), null);
  assert.equal(track.activeClip(1.5)?.id, 'clip-1');
  assert.equal(track.activeAutomaticClip(1.5)?.id, 'clip-1');

  assert.equal(track.activeClip(2.5)?.id, 'clip-2');
  assert.equal(track.activeAutomaticClip(2.5), null); // clip2 is manual

  // Adjacent previous clip lookup
  assert.equal(track.adjacentPreviousClip(clip1), null);
  assert.equal(track.adjacentPreviousClip(clip2)?.id, 'clip-1');

  // Sample during entrance of clip1 (t = 1.2, halfway through enterDuration=0.4)
  const enteringSample = track.sample(1.2);
  assert.ok(enteringSample.scale > 1.0 && enteringSample.scale < 2.0);

  // Sample during hold of clip1 (t = 1.6)
  const holdSample = track.sample(1.6);
  assert.equal(holdSample.scale, 2.0);

  // Sample during touching clip2 (t = 2.2)
  const touchingSample = track.sample(2.2);
  assert.ok(touchingSample.scale >= 2.0 && touchingSample.scale <= 3.0);
});

test('T3.2: ZoomInterpolator.sampleKeyframes keyframe evaluation', () => {
  const kfs = [
    makeZoomKeyframe({ time: 1.0, scale: 1.0, focus: { x: 0.5, y: 0.5 } }),
    makeZoomKeyframe({ time: 2.0, scale: 2.0, focus: { x: 0.2, y: 0.8 } }),
  ];

  const motion = makeMotionStyle({ screen: '聚焦' });

  // Before first keyframe
  const before = ZoomInterpolator.sampleKeyframes(kfs, 0.5, motion);
  assert.equal(before.scale, 1.0);

  // After last keyframe
  const after = ZoomInterpolator.sampleKeyframes(kfs, 2.5, motion);
  assert.equal(after.scale, 2.0);
  assert.equal(after.focus.x, 0.2);
  assert.equal(after.focus.y, 0.8);

  // Midway keyframe with smooth motion
  const smoothMotion = makeMotionStyle({ screen: '平滑' });
  const midway = ZoomInterpolator.sampleKeyframes(kfs, 1.5, smoothMotion);
  assert.ok(midway.scale > 1.0 && midway.scale < 2.0);
  assert.ok(midway.focus.x > 0.2 && midway.focus.x < 0.5);
});
