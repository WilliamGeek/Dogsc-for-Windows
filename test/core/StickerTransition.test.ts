import test from 'node:test';
import assert from 'node:assert/strict';

import {
  makeFrameStickerBackdropScene,
  frameStickerBackdropSceneFromClip,
  frameStickerBackdropSceneFromStickers,
  frameStickerBackdropSceneMerge,
  frameStickerBackdropSceneInterpolated,
  StickerTransitionTrack,
} from '../../src/core/StickerTransition.ts';
import {
  makeStickerClip,
  makeOverlayTiming,
} from '../../src/core/OverlayTimeline.ts';

test('T6.2: FrameStickerBackdropScene operations and clip mapping', () => {
  const b0 = makeFrameStickerBackdropScene();
  assert.equal(b0.screenSuppression, 0);
  assert.equal(b0.cameraSuppression, 0);
  assert.equal(b0.screenBlur, 0);
  assert.equal(b0.cameraBlur, 0);

  const clip = makeStickerClip({
    timing: makeOverlayTiming(0, 3),
    relativePath: 'a.png',
    hidesScreen: true,
    hidesCamera: true,
    backdropBlur: 30,
    backdropBlurIncludesCamera: true,
  });

  const bClip = frameStickerBackdropSceneFromClip(clip, 0.8);
  assert.equal(bClip.screenSuppression, 0.8);
  assert.equal(bClip.cameraSuppression, 0.8);
  assert.equal(bClip.screenBlur, 0); // hidesScreen zeroes screenBlur
  assert.equal(bClip.cameraBlur, 30 * 0.8);

  const b2 = makeFrameStickerBackdropScene({ screenSuppression: 0.5, screenBlur: 50 });
  frameStickerBackdropSceneMerge(bClip, b2);
  assert.equal(bClip.screenSuppression, 0.8);
  assert.equal(bClip.screenBlur, 50);

  const interpolated = frameStickerBackdropSceneInterpolated(b0, bClip, 0.5);
  assert.equal(interpolated.screenSuppression, 0.4);
  assert.equal(interpolated.screenBlur, 25);
});

test('T6.2: FrameStickerBackdropScene fromStickers list', () => {
  const stickers = [
    {
      hidesScreen: true,
      hidesCamera: false,
      transitionProgress: 0.9,
      backdropBlur: 20,
      backdropBlurIncludesCamera: false,
    },
    {
      hidesScreen: false,
      hidesCamera: true,
      transitionProgress: 0.6,
      backdropBlur: 40,
      backdropBlurIncludesCamera: true,
    },
  ];
  const merged = frameStickerBackdropSceneFromStickers(stickers);
  assert.equal(merged.screenSuppression, 0.9);
  assert.equal(merged.cameraSuppression, 0.6);
  assert.equal(merged.screenBlur, 40); // second sticker does not hide screen
  assert.equal(merged.cameraBlur, 40);
});

test('T6.2: StickerTransitionTrack single clip sampling and suppressesInitialEntry', () => {
  const clip = makeStickerClip({
    id: 'c-1',
    timing: makeOverlayTiming(0, 4),
    relativePath: 'img.png',
    enterDuration: 1.0,
    exitDuration: 0.5,
    animation: 'fade',
  });

  const track = new StickerTransitionTrack([clip]);

  // At t=0 without suppression: fade linear=0, visibility=0
  const sample0 = track.sample(0, false);
  assert.equal(sample0.stickers.length, 1);
  assert.ok(Math.abs(sample0.stickers[0].visibility - 0) < 1e-6);

  // At t=0 with suppressesInitialEntry: visibility=1
  const sampleSuppressed = track.sample(0, true);
  assert.equal(sampleSuppressed.stickers.length, 1);
  assert.equal(sampleSuppressed.stickers[0].visibility, 1.0);

  // At mid t=2.0: full visibility
  const sampleMid = track.sample(2.0, false);
  assert.equal(sampleMid.stickers[0].visibility, 1.0);
  assert.equal(sampleMid.stickers[0].preset, 'fade');

  // During exit t=3.8 (remaining 0.2 < 0.5): isExiting = true
  const sampleExit = track.sample(3.8, false);
  assert.ok(sampleExit.stickers[0].visibility < 1.0);
  assert.equal(sampleExit.stickers[0].preset, 'fade');
});

test('T6.2: StickerTransitionTrack joined contiguous clips handoff', () => {
  const clip1 = makeStickerClip({
    id: 'c-1',
    timing: makeOverlayTiming(0, 2),
    relativePath: '1.png',
    enterDuration: 0.4,
    exitDuration: 0.4,
    animation: 'slideLeft',
    hidesScreen: true,
  });

  const clip2 = makeStickerClip({
    id: 'c-2',
    timing: makeOverlayTiming(2, 2),
    relativePath: '2.png',
    enterDuration: 0.4,
    exitDuration: 0.4,
    animation: 'slideRight',
    hidesScreen: true,
  });

  const track = new StickerTransitionTrack([clip1, clip2]);

  assert.equal(track.hasJoinedEntry('c-2'), true);

  // At boundary t=2.0, both joined clips participate in the handoff
  const sampleHandoff = track.sample(2.0);
  // Screen suppression is bridged across handoff
  assert.ok(sampleHandoff.backdrop.screenSuppression > 0.5);
});
