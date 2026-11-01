import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProjectSchema,
  ProjectSchemaError,
  CanvasAspectRatioAllCases,
  CanvasResolutionAllCases,
  canvasResolutionPresetEdges,
  ScreenFrameStyleAllCases,
  screenFrameStyleIsDeviceFrame,
  screenFrameStyleIsBrowserFrame,
  screenFrameStyleIsWindowFrame,
  screenFrameStyleFromJSON,
  makeOpeningSequence,
  openingSequenceMaximumStagger,
  openingSequenceAvailableElements,
  openingSequenceParticipatingElements,
  BackgroundPatternPresetAllCases,
  DynamicBackgroundPresetAllCases,
  dynamicBackgroundPresetDisplayName,
  dynamicBackgroundPresetFromJSON,
  BackgroundSourceSafeFallback,
  backgroundSourceIsImage,
  backgroundSourceIsVideo,
  backgroundSourceUsesWallpaperMedia,
  CameraShapeAllCases,
  cameraShapeFromJSON,
  ScreenMotionStyleAllCases,
  CursorMotionStyleAllCases,
  CursorAppearanceAllCases,
} from '../../src/core/ProjectModel.ts';

test('ProjectSchema validation for versions 23-27 per Swift L6-41', () => {
  // Valid range: 23 to 27
  for (let v = 23; v <= 27; v++) {
    assert.doesNotThrow(() => ProjectSchema.validateForDecoding(v));
    assert.doesNotThrow(() => ProjectSchema.validateForEncoding(v));
  }

  // Version 22 is legacy unsupported
  assert.throws(
    () => ProjectSchema.validateForDecoding(22),
    (err: any) => err instanceof ProjectSchemaError && err.code === 'unsupportedLegacyVersion',
  );
  assert.throws(
    () => ProjectSchema.validateForEncoding(22),
    (err: any) => err instanceof ProjectSchemaError && err.code === 'refusingToEncodeUnsupportedVersion',
  );

  // Version 28 is future unsupported
  assert.throws(
    () => ProjectSchema.validateForDecoding(28),
    (err: any) => err instanceof ProjectSchemaError && err.code === 'unsupportedFutureVersion',
  );
  assert.throws(
    () => ProjectSchema.validateForEncoding(28),
    (err: any) => err instanceof ProjectSchemaError && err.code === 'refusingToEncodeFutureVersion',
  );
});

test('CanvasResolution preset edges match Swift L88-94', () => {
  assert.equal(CanvasResolutionAllCases.length, 4);
  assert.equal(canvasResolutionPresetEdges('原始素材'), null);
  assert.deepEqual(canvasResolutionPresetEdges('1080p'), { short: 1080, long: 1920 });
  assert.deepEqual(canvasResolutionPresetEdges('1440p'), { short: 1440, long: 2560 });
  assert.deepEqual(canvasResolutionPresetEdges('4K'), { short: 2160, long: 3840 });
});

test('ScreenFrameStyle predicates and legacy JSON decoding per Swift L124-175', () => {
  assert.equal(screenFrameStyleIsDeviceFrame('devicePhone'), true);
  assert.equal(screenFrameStyleIsDeviceFrame('deviceTabletLandscape'), true);
  assert.equal(screenFrameStyleIsDeviceFrame('windowLight'), false);

  assert.equal(screenFrameStyleIsBrowserFrame('browserDark'), true);
  assert.equal(screenFrameStyleIsBrowserFrame('windowLight'), false);

  assert.equal(screenFrameStyleIsWindowFrame('windowLight'), true);
  assert.equal(screenFrameStyleIsWindowFrame('windowDark'), true);
  assert.equal(screenFrameStyleIsWindowFrame('none'), false);

  // Legacy mappings
  assert.equal(screenFrameStyleFromJSON('cyberNeon'), 'windowDark');
  assert.equal(screenFrameStyleFromJSON('frostedGlass'), 'windowLight');
  assert.equal(screenFrameStyleFromJSON('paperWhite'), 'none');
  assert.equal(screenFrameStyleFromJSON('devicePhone'), 'devicePhone');
  assert.throws(() => screenFrameStyleFromJSON('nonExistent'));
});

test('OpeningSequence timing clamps and element filters per Swift L193-306', () => {
  const seq = makeOpeningSequence();
  assert.equal(seq.isEnabled, false);
  assert.equal(seq.preset, '轻 3D');
  assert.equal(seq.motionCurve, 'swift');
  assert.equal(seq.duration, 2.2);
  assert.equal(seq.stagger, 0.16);

  // Duration clamps to [0.4, 8]
  assert.equal(makeOpeningSequence({ duration: 0.1 }).duration, 0.4);
  assert.equal(makeOpeningSequence({ duration: 100 }).duration, 8);

  // Stagger respects maximumStagger
  const maxStagger = openingSequenceMaximumStagger(2.0, 3); // (2.0 - 0.18) / 2 = 0.91
  assert.ok(Math.abs(maxStagger - 0.91) < 1e-6);

  // Available and participating elements
  assert.deepEqual(
    openingSequenceAvailableElements(seq, false, false),
    ['屏幕'],
  );
  assert.deepEqual(
    openingSequenceAvailableElements(seq, true, true),
    ['屏幕', '摄像头', '贴图'],
  );
  assert.deepEqual(
    openingSequenceParticipatingElements(seq, true, false),
    ['屏幕', '摄像头'],
  );
});

test('BackgroundSource types and dynamic presets per Swift L308-465', () => {
  assert.equal(BackgroundPatternPresetAllCases.length, 5);
  assert.equal(DynamicBackgroundPresetAllCases.length, 3);

  assert.equal(dynamicBackgroundPresetDisplayName('赛博微流网格'), '流金缓移网格');
  assert.equal(dynamicBackgroundPresetFromJSON('旋转十字星阵'), '赛博微流网格');

  assert.equal(backgroundSourceIsImage({ kind: 'projectImage', relativePath: 'bg.png' }), true);
  assert.equal(backgroundSourceIsImage({ kind: 'systemImage', absolutePath: '/path' }), true);
  assert.equal(backgroundSourceIsImage({ kind: 'projectVideo', relativePath: 'bg.mp4' }), false);

  assert.equal(backgroundSourceIsVideo({ kind: 'projectVideo', relativePath: 'bg.mp4' }), true);
  assert.equal(backgroundSourceUsesWallpaperMedia({ kind: 'pattern', preset: '黑曜石网格' }), false);
  assert.equal(BackgroundSourceSafeFallback.kind, 'pattern');
});

test('CameraShape legacy decoders per Swift L477-483', () => {
  assert.equal(CameraShapeAllCases.length, 5);
  assert.equal(cameraShapeFromJSON('圆角矩形'), '横向');
  assert.equal(cameraShapeFromJSON('连续圆角'), '方形');
  assert.equal(cameraShapeFromJSON('圆形'), '圆形');
  assert.equal(cameraShapeFromJSON('unknown'), '方形');
});
