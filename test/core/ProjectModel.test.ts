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
  CursorClickEffectStyleAllCases,
  cursorClickEffectStyleDuration,
  cursorClickEffectStyleDisplayName,
  makeCursorStyle,
  cursorStyleShowsClickEffect,
  cursorStyleSetShowsClickEffect,
  cursorStyleAppearance,
  cursorStyleAssetIDForAppearance,
  makeNormalizedCrop,
  NormalizedCropFull,
  normalizedCropClamped,
  normalizedCropFromEdges,
  makeCanvasStyle,
  makeCanvasDimensions,
  canvasStylePixelDimensions,
  makeAudioStyle,
  makeCameraStyle,
  makeMotionStyle,
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

test('CursorClickEffectStyle durations and CursorStyle defaults per Swift L554-772', () => {
  assert.equal(CursorClickEffectStyleAllCases.length, 5);
  assert.equal(cursorClickEffectStyleDuration('ripple'), 0.36);
  assert.equal(cursorClickEffectStyleDuration('glow'), 0.32);
  assert.equal(cursorClickEffectStyleDuration('none'), 0.0);
  assert.equal(cursorClickEffectStyleDisplayName('ripple'), '涟漪扩散');

  const cursor = makeCursorStyle();
  assert.equal(cursor.assetID, 'system.automatic');
  assert.equal(cursor.size, 1.25);
  assert.equal(cursor.hideWhenIdle, false);
  assert.equal(cursor.idleDelay, 1.2);
  assert.equal(cursor.clickEffectStyle, 'ripple');
  assert.equal(cursor.motionTiltStrength, 2.0);
  assert.equal(cursorStyleShowsClickEffect(cursor), true);

  // Clamps
  assert.equal(makeCursorStyle({ size: 0.01 }).size, 0.25);
  assert.equal(makeCursorStyle({ size: 10 }).size, 6);
  assert.equal(makeCursorStyle({ motionTiltStrength: 10 }).motionTiltStrength, 4);

  // Setter for showsClickEffect
  const disabled = cursorStyleSetShowsClickEffect(cursor, false);
  assert.equal(disabled.clickEffectStyle, 'none');
  const restored = cursorStyleSetShowsClickEffect(disabled, true);
  assert.equal(restored.clickEffectStyle, 'ripple');

  // Appearance mapping
  assert.equal(cursorStyleAppearance(cursor), '系统箭头');
  assert.equal(
    cursorStyleAppearance({ ...cursor, assetID: 'system.pointing-hand' }),
    '指向手势',
  );
  assert.equal(cursorStyleAssetIDForAppearance('指向手势'), 'system.pointing-hand');
});

test('NormalizedCrop clamping and edge creation per Swift L777-828', () => {
  assert.deepEqual(NormalizedCropFull, { x: 0, y: 0, width: 1, height: 1 });

  // Out of bound crop clamped
  const oob = makeNormalizedCrop(-0.5, -0.5, 2, 2);
  const clamped = normalizedCropClamped(oob, 0.1);
  assert.equal(clamped.x, 0);
  assert.equal(clamped.y, 0);
  assert.equal(clamped.width, 1.0);
  assert.equal(clamped.height, 1.0);

  // fromEdges
  const fromEdges = normalizedCropFromEdges(0.1, 0.2, 0.05, 0.15);
  assert.ok(Math.abs(fromEdges.x - 0.1) < 1e-9);
  assert.ok(Math.abs(fromEdges.y - 0.05) < 1e-9);
  assert.ok(Math.abs(fromEdges.width - 0.7) < 1e-9);
  assert.ok(Math.abs(fromEdges.height - 0.8) < 1e-9);
});

test('CanvasStyle defaults and pixel dimensions calculation per Swift L830-1133', () => {
  const style = makeCanvasStyle();
  assert.equal(style.aspectRatio, '适应');
  assert.equal(style.padding, 100);
  assert.equal(style.cornerRadius, 24);
  assert.equal(style.shadowStrength, 0.28);
  assert.equal(style.screenFrame, 'none');

  // Fixed aspect ratio presets under 1080p
  const landscape = makeCanvasStyle({ aspectRatio: '16:9' });
  const dims1080p = canvasStylePixelDimensions(landscape, '1080p');
  assert.deepEqual(dims1080p, { width: 1920, height: 1080 });

  const portrait = makeCanvasStyle({ aspectRatio: '9:16' });
  assert.deepEqual(canvasStylePixelDimensions(portrait, '1080p'), { width: 1080, height: 1920 });

  const square = makeCanvasStyle({ aspectRatio: '1:1' });
  assert.deepEqual(canvasStylePixelDimensions(square, '1080p'), { width: 1080, height: 1080 });

  // 4K 16:9
  assert.deepEqual(canvasStylePixelDimensions(landscape, '4K'), { width: 3840, height: 2160 });

  // Source resolution
  const sourceDims = canvasStylePixelDimensions(style, '原始素材', null, makeCanvasDimensions(1920, 1080));
  assert.deepEqual(sourceDims, { width: 1920, height: 1080 });

  // Source resolution with 50% crop
  const croppedStyle = makeCanvasStyle({
    crop: makeNormalizedCrop(0, 0, 0.5, 0.5),
  });
  const croppedDims = canvasStylePixelDimensions(
    croppedStyle,
    '原始素材',
    null,
    makeCanvasDimensions(1920, 1080),
  );
  assert.deepEqual(croppedDims, { width: 960, height: 540 });
});

test('AudioStyle and CameraStyle defaults per Swift L1134-1246', () => {
  const audio = makeAudioStyle();
  assert.equal(audio.systemVolume, 0.82);
  assert.equal(audio.microphoneVolume, 0.9);
  assert.equal(audio.isSystemMuted, false);
  assert.equal(audio.isMicrophoneMuted, false);

  // Volumes clamp to [0, 1]
  assert.equal(makeAudioStyle({ systemVolume: -0.5 }).systemVolume, 0);
  assert.equal(makeAudioStyle({ microphoneVolume: 2.5 }).microphoneVolume, 1);

  const camera = makeCameraStyle();
  assert.equal(camera.shape, '方形');
  assert.deepEqual(camera.position, { x: 0.96, y: 0.47 });
  assert.equal(camera.size, 0.29);
  assert.equal(camera.borderWidth, 3);
  assert.equal(camera.shadowStrength, 0.25);
  assert.equal(camera.roundness, 0.5);
  assert.equal(camera.isMirrored, true);
  assert.equal(camera.isHidden, false);
  assert.equal(camera.scaleDuringZoom, 0.7);
  assert.deepEqual(camera.contentPosition, { x: 0.5, y: 0.5 });
  assert.equal(camera.contentScale, 1);
});

test('MotionStyle exact spring defaults per Swift L1264-1277', () => {
  const motion = makeMotionStyle();

  // MUST TEST: Exact physical constants from Swift L1267-1272
  assert.equal(motion.screen, '聚焦');
  assert.equal(motion.cursor, '平滑');
  assert.equal(motion.screenSpringMass, 2.4);
  assert.equal(motion.screenSpringStiffness, 210);
  assert.equal(motion.screenSpringDamping, 42);
  assert.equal(motion.cursorSpringMass, 2.8);
  assert.equal(motion.cursorSpringStiffness, 450);
  assert.equal(motion.cursorSpringDamping, 66);
  assert.equal(motion.defaultZoomEasing, '弹簧');
  assert.equal(motion.defaultZoomTransitionDuration, 0.7);
  assert.equal(motion.defaultZoomScale, null);
  assert.equal(motion.defaultScreenMotion, null);

  // Clamping of transition duration to [0, 5]
  assert.equal(makeMotionStyle({ defaultZoomTransitionDuration: -1 }).defaultZoomTransitionDuration, 0);
  assert.equal(makeMotionStyle({ defaultZoomTransitionDuration: 99 }).defaultZoomTransitionDuration, 5);
});


