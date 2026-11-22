import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NormalizedOverlayRect,
  makeNormalizedOverlayRect,
  normalizedOverlayRectClamped,
  OverlayTiming,
  makeOverlayTiming,
  overlayTimingEndTime,
  overlayTimingContains,
  MosaicEffectStyleAllCases,
  mosaicEffectStyleFromJSON,
  MosaicTransitionStyleAllCases,
  makeMosaicClip,
  mosaicClipFromJSON,
  StickerAnimationPresetAllCases,
  stickerAnimationPresetAutomaticExit,
  makeStickerClip,
  stickerClipFromJSON,
} from '../../src/core/OverlayTimeline.ts';

test('T6.1: NormalizedOverlayRect centered and clamping', () => {
  const centered = NormalizedOverlayRect.centered;
  assert.equal(centered.x, 0.35);
  assert.equal(centered.y, 0.39);
  assert.equal(centered.width, 0.30);
  assert.equal(centered.height, 0.22);

  // Normal rect clamping
  const r1 = makeNormalizedOverlayRect(-0.5, 1.5, 2.0, 0.001);
  const c1 = normalizedOverlayRectClamped(r1);
  assert.equal(c1.width, 1.0); // max 1
  assert.equal(c1.height, 0.01); // min 0.01
  assert.equal(c1.x, 0); // min 0, max 1 - safeWidth
  assert.equal(c1.y, 1 - 0.01); // min 0, max 1 - safeHeight

  // Non-finite fallback per Swift L25-29
  const rNaN = makeNormalizedOverlayRect(NaN, NaN, NaN, NaN);
  const cNaN = normalizedOverlayRectClamped(rNaN);
  assert.equal(cNaN.width, 0.30);
  assert.equal(cNaN.height, 0.22);
  assert.equal(cNaN.x, 0.35);
  assert.equal(cNaN.y, 0.39);
});

test('T6.1: OverlayTiming contains and endTime', () => {
  const timing = makeOverlayTiming(2.5, 4.0);
  assert.equal(overlayTimingEndTime(timing), 6.5);
  assert.equal(overlayTimingContains(timing, 2.49), false);
  assert.equal(overlayTimingContains(timing, 2.5), true);
  assert.equal(overlayTimingContains(timing, 5.0), true);
  assert.equal(overlayTimingContains(timing, 6.499), true);
  assert.equal(overlayTimingContains(timing, 6.5), false); // end-exclusive
});

test('T6.1: MosaicEffectStyle and MosaicClip presets and JSON decoding', () => {
  assert.deepEqual(MosaicEffectStyleAllCases, ['blur', 'spotlight']);
  assert.deepEqual(MosaicTransitionStyleAllCases, ['none', 'linear', 'smooth']);

  // Legacy pixel preset maps to blur
  assert.equal(mosaicEffectStyleFromJSON('pixel-blocks'), 'blur');
  assert.equal(mosaicEffectStyleFromJSON('spotlight'), 'spotlight');

  // Default clip
  const clip = makeMosaicClip({
    timing: makeOverlayTiming(1.0, 2.0),
  });
  assert.equal(clip.style, 'blur');
  assert.equal(clip.intensity, 0.55);
  assert.equal(clip.spotlightDimming, 0.22);
  assert.equal(clip.transitionStyle, 'none');
  assert.equal(clip.cornerRadius, 0.08);

  // JSON decode spotlight without explicit transitionStyle infers 'smooth' per Swift L149
  const spotlightJSON = mosaicClipFromJSON({
    id: 'test-id',
    timing: { startTime: 0, duration: 2 },
    style: 'spotlight',
  });
  assert.equal(spotlightJSON.style, 'spotlight');
  assert.equal(spotlightJSON.transitionStyle, 'smooth');

  // JSON decode blur without explicit transitionStyle infers 'none'
  const blurJSON = mosaicClipFromJSON({
    id: 'test-id-2',
    timing: { startTime: 0, duration: 2 },
    style: 'blur',
  });
  assert.equal(blurJSON.style, 'blur');
  assert.equal(blurJSON.transitionStyle, 'none');
});

test('T6.1: StickerAnimationPreset automaticExit complementary mapping', () => {
  assert.equal(stickerAnimationPresetAutomaticExit('slideLeft'), 'slideRight');
  assert.equal(stickerAnimationPresetAutomaticExit('slideRight'), 'slideLeft');
  assert.equal(stickerAnimationPresetAutomaticExit('slideUp'), 'slideDown');
  assert.equal(stickerAnimationPresetAutomaticExit('slideDown'), 'slideUp');
  assert.equal(stickerAnimationPresetAutomaticExit('slideTopLeft'), 'slideBottomRight');
  assert.equal(stickerAnimationPresetAutomaticExit('slideTopRight'), 'slideBottomLeft');
  assert.equal(stickerAnimationPresetAutomaticExit('slideBottomLeft'), 'slideTopRight');
  assert.equal(stickerAnimationPresetAutomaticExit('slideBottomRight'), 'slideTopLeft');
  assert.equal(stickerAnimationPresetAutomaticExit('none'), 'none');
  assert.equal(stickerAnimationPresetAutomaticExit('fade'), 'fade');
  assert.equal(stickerAnimationPresetAutomaticExit('pop'), 'pop');
});

test('T6.1: StickerClip defaults and JSON decoding', () => {
  const clip = makeStickerClip({
    timing: makeOverlayTiming(0, 5),
    relativePath: 'images/badge.png',
  });

  assert.equal(clip.width, 0.38);
  assert.equal(clip.rotationDegrees, 0);
  assert.equal(clip.opacity, 1);
  assert.equal(clip.cornerRadius, 18);
  assert.equal(clip.borderWidth, 0);
  assert.equal(clip.animation, 'pop');
  assert.equal(clip.animationCurve, 'swift');
  assert.equal(clip.enterDuration, 0.45);
  assert.equal(clip.exitDuration, 0.3);
  assert.equal(clip.backdropBlur, 20);
  assert.equal(clip.backdropBlurIncludesCamera, false);
  assert.equal(clip.hidesScreen, false);
  assert.equal(clip.hidesCamera, false);
  assert.equal(clip.layerIndex, 0);
  assert.equal(clip.mainTrackStyle, null);
  assert.equal(clip.sourceStart, 0);
  assert.equal(clip.playbackRate, 1);

  const parsed = stickerClipFromJSON({
    id: 's-1',
    timing: { startTime: 1, duration: 4 },
    relativePath: 'test.png',
    position: { x: 0.2, y: 0.8 },
    animation: 'slideUp',
    hidesScreen: true,
    sourceStart: 1.5,
    playbackRate: 2,
    mainTrackStyle: { usesFrameStyle: true },
  });
  assert.equal(parsed.id, 's-1');
  assert.equal(parsed.timing.startTime, 1);
  assert.equal(parsed.position.x, 0.2);
  assert.equal(parsed.position.y, 0.8);
  assert.equal(parsed.animation, 'slideUp');
  assert.equal(parsed.hidesScreen, true);
  assert.equal(parsed.hidesCamera, false);
  assert.equal(parsed.sourceStart, 1.5);
  assert.equal(parsed.playbackRate, 2);
  assert.equal(parsed.mainTrackStyle?.usesFrameStyle, true);
});

test('v0.2.0: MotionElementEdit & AnimationClip defaults and Swift JSON decoding', async () => {
  const {
    motionElementEditIsEmpty,
    makeMotionElementEdit,
    motionElementEditFromJSON,
    animationClipFromJSON,
  } = await import('../../src/core/OverlayTimeline.ts');

  const empty = makeMotionElementEdit();
  assert.equal(motionElementEditIsEmpty(empty), true);
  const fw = makeMotionElementEdit({ fontWeight: 1200 });
  assert.equal(fw.fontWeight, 900);
  assert.equal(motionElementEditIsEmpty(fw), false);
  assert.equal(motionElementEditFromJSON({ fontWeight: 50 }).fontWeight, 100);

  const anim = animationClipFromJSON({
    id: 'anim-1',
    timing: { startTime: 2, duration: 3 },
    sourcePath: 'motions/card.dmhtml',
    position: { x: 0.5, y: 0.5 },
    width: 0.6,
    opacity: 0.9,
    properties: {
      headline: { string: { _0: 'Hello' } },
      accent: { color: { _0: '#FF5500' } },
    },
    soundtrack: { path: 'fx/whoosh.wav', volume: 0.8 },
  });
  assert.equal(anim.properties.headline.kind, 'string');
  assert.equal(anim.properties.headline.value, 'Hello');
  assert.equal(anim.properties.accent.kind, 'color');
  if (anim.properties.accent.kind === 'color') {
    assert.equal(anim.properties.accent.value.rgb24, 0xff5500);
  }
  assert.equal(anim.soundtrack?.path, 'fx/whoosh.wav');
});
