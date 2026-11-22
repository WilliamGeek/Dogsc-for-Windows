// Test for: F:\dogsc-win\src\core\VisualTrackTransfer.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findTransferableVisualClip,
  moveToMain,
  moveToOverlay,
  VisualTrackTransferError,
  makeMainTrackVisualStyle,
  makeVisualClipSound,
} from '../../src/core/VisualTrackTransfer.ts';
import {
  makeProjectTimeline,
  makeRecordingSegment,
  makeSourceSequenceEdited,
  makeInsertedMedia,
  makePrimarySegmentAudioOverrides,
} from '../../src/core/ProjectTimeline.ts';
import {
  makeAnimationClip,
  makeMotionElementEdit,
  makeOverlayTiming,
  makeStickerClip,
} from '../../src/core/OverlayTimeline.ts';
import { makeVideoClip } from '../../src/core/PostProductionModel.ts';
import { makeScreenCardAppearance } from '../../src/core/ScreenCardAppearance.ts';
import { makeSegmentSceneStyle } from '../../src/core/SegmentSceneStyle.ts';

test('T13.4: find locates video, animation, and sticker clips and roundtrips video -> main -> overlay', () => {
  const savedAppearance = makeScreenCardAppearance({
    cornerRadius: 36,
    screenFrame: 'windowDark',
  });
  const savedScene = makeSegmentSceneStyle({ presetID: 'preset-main' });
  const savedStyle = makeMainTrackVisualStyle({
    usesFrameStyle: true,
    screenAppearance: savedAppearance,
    sceneStyle: savedScene,
  });

  const videoClip = makeVideoClip({
    id: 'clip-vid',
    timing: makeOverlayTiming(2, 3),
    sourcePath: 'assets/broll.mp4',
    sourceStart: 1.5,
    playbackRate: 2.0,
    volume: 0.75,
    mainTrackStyle: savedStyle,
  });

  const timeline = makeProjectTimeline({
    sourceSequence: makeSourceSequenceEdited([
      makeRecordingSegment({ id: 'base-1', sourceStart: 0, sourceDuration: 10 }),
    ]),
    videoClips: [videoClip],
  });

  const found = findTransferableVisualClip('clip-vid', timeline);
  assert.equal(found?.kind, 'video');

  // Move video overlay onto main track at t=4
  const prepared = makeInsertedMedia({
    path: 'assets/broll.mp4',
    fileDuration: 12,
    name: 'broll',
  });
  const onMain = moveToMain('clip-vid', prepared, 4, timeline, 10);
  assert.equal(onMain.videoClips.length, 0);
  assert.equal(onMain.sourceSequence.kind, 'edited');
  if (onMain.sourceSequence.kind === 'edited') {
    assert.equal(onMain.sourceSequence.segments.length, 3);
    const seg = onMain.sourceSequence.segments[1];
    assert.equal(seg.id, 'clip-vid');
    assert.equal(seg.sourceStart, 1.5);
    assert.equal(seg.playbackRate, 2.0);
    assert.equal(seg.sourceDuration, 6.0); // 3s output * 2.0 rate
    assert.equal(seg.media?.usesFrameStyle, true);
    assert.equal(seg.media?.screenAppearance?.cornerRadius, 36);
    assert.equal(seg.sceneStyle?.presetID, 'preset-main');
  }

  // Override audio on the main segment, then transfer back to overlay
  const withMute = {
    ...onMain,
    primarySegmentAudioOverrides: {
      ...onMain.primarySegmentAudioOverrides,
      'clip-vid': makePrimarySegmentAudioOverrides({ systemVolume: 0.4, isSystemMuted: true }),
    },
  };
  const backToOverlay = moveToOverlay('clip-vid', 2.5, 2, withMute, 10);
  assert.equal(backToOverlay.videoClips.length, 1);
  const restored = backToOverlay.videoClips[0];
  assert.equal(restored.id, 'clip-vid');
  assert.equal(restored.timing.startTime, 2.5);
  assert.equal(restored.timing.duration, 3.0);
  assert.equal(restored.sourceStart, 1.5);
  assert.equal(restored.playbackRate, 2.0);
  assert.equal(restored.layerIndex, 2);
  assert.equal(restored.volume, 0); // isSystemMuted overrides volume to 0
  assert.equal(restored.mainTrackStyle?.usesFrameStyle, true);
  assert.equal(restored.mainTrackStyle?.sceneStyle?.presetID, 'preset-main');
});

test('T13.4: animation with soundtrack, properties & elementEdits roundtrips main <-> overlay', () => {
  const animClip = makeAnimationClip({
    id: 'clip-anim',
    timing: makeOverlayTiming(1, 4),
    sourcePath: 'motions/callout.dmhtml',
    timeOffset: 0.5,
    playbackRate: 1.5,
    properties: { headline: { kind: 'string', value: 'Hello' } },
    elementEdits: { title: makeMotionElementEdit({ text: 'Edited' }) },
    soundtrack: makeVisualClipSound({
      path: 'audio/whoosh.wav',
      volume: 0.9,
      fadeIn: 0.1,
      fadeOut: 0.2,
    }),
  });

  const timeline = makeProjectTimeline({
    sourceSequence: makeSourceSequenceEdited([
      makeRecordingSegment({ id: 'base-1', sourceStart: 0, sourceDuration: 10 }),
    ]),
    animationClips: [animClip],
  });

  const standIn = makeInsertedMedia({
    path: 'standins/anim-black.mp4',
    fileDuration: 20,
    name: 'Callout',
  });
  const onMain = moveToMain('clip-anim', standIn, 3, timeline, 10);
  assert.equal(onMain.animationClips.length, 0);
  if (onMain.sourceSequence.kind === 'edited') {
    const seg = onMain.sourceSequence.segments[1];
    assert.equal(seg.media?.motionPath, 'motions/callout.dmhtml');
    assert.equal(seg.media?.soundPath, 'audio/whoosh.wav');
    assert.equal(seg.media?.elementEdits.title.text, 'Edited');
  }

  const backToOverlay = moveToOverlay('clip-anim', 1.5, null, onMain, 10);
  assert.equal(backToOverlay.animationClips.length, 1);
  const restored = backToOverlay.animationClips[0];
  assert.equal(restored.sourcePath, 'motions/callout.dmhtml');
  assert.equal(restored.timeOffset, 0.5);
  assert.equal(restored.playbackRate, 1.5);
  assert.equal(restored.properties.headline.kind, 'string');
  assert.equal(restored.elementEdits.title.text, 'Edited');
  assert.equal(restored.soundtrack?.path, 'audio/whoosh.wav');
  assert.equal(restored.soundtrack?.fadeIn, 0.1);
  assert.equal(restored.soundtrack?.fadeOut, 0.2);
});

test('T13.4: sticker imagePath moves to overlay cleanly and invalid transfers throw VisualTrackTransferError', () => {
  const sticker = makeStickerClip({
    id: 'clip-st',
    timing: makeOverlayTiming(1, 2),
    relativePath: 'stickers/arrow.png',
    sourceStart: 0.25,
    playbackRate: 1.0,
  });
  const timeline = makeProjectTimeline({
    sourceSequence: makeSourceSequenceEdited([
      makeRecordingSegment({ id: 'base-1', sourceStart: 0, sourceDuration: 10 }),
    ]),
    stickerClips: [sticker],
  });

  const standIn = makeInsertedMedia({
    path: 'standins/img.mp4',
    fileDuration: 10,
    name: 'arrow',
    imagePath: 'stickers/arrow-updated.png',
  });
  const onMain = moveToMain('clip-st', standIn, 2, timeline, 10);
  assert.equal(onMain.stickerClips.length, 0);

  const restored = moveToOverlay('clip-st', 2, null, onMain, 10);
  assert.equal(restored.stickerClips.length, 1);
  assert.equal(restored.stickerClips[0].relativePath, 'stickers/arrow-updated.png');
  assert.equal(restored.stickerClips[0].sourceStart, 0.25);

  // Missing overlay clip -> unsupportedClip
  assert.throws(
    () => moveToMain('missing-id', standIn, 0, timeline, 10),
    (e: unknown) => e instanceof VisualTrackTransferError && e.kind === 'unsupportedClip'
  );

  // Non-media primary recording segment cannot move to overlay -> unsupportedClip
  assert.throws(
    () => moveToOverlay('base-1', 0, null, timeline, 10),
    (e: unknown) => e instanceof VisualTrackTransferError && e.kind === 'unsupportedClip'
  );

  // Inserted media longer than remaining timeline -> insufficientMainDuration
  const shortMain = makeProjectTimeline({
    sourceSequence: makeSourceSequenceEdited([
      makeRecordingSegment({ id: 'short-rec', sourceStart: 0, sourceDuration: 2 }),
      makeRecordingSegment({
        id: 'long-media',
        sourceStart: 0,
        sourceDuration: 5,
        media: makeInsertedMedia({ path: 'long.mp4', fileDuration: 5, name: 'long' }),
      }),
    ]),
  });
  assert.throws(
    () => moveToOverlay('long-media', 0, null, shortMain, 2),
    (e: unknown) => e instanceof VisualTrackTransferError && e.kind === 'insufficientMainDuration'
  );
});
