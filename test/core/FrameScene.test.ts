import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CompositionSize,
  makeCompositionSize,
  FrameColorSpaceAllCases,
  FrameColorContract,
  makeFrameShadow,
  makeFrameBackgroundScene,
  FrameScreenChromeKind,
  makeFrameScreenChromeScene,
  FrameScreenDecoration,
  makeFrameMosaicScene,
  makeFrameScreenScene,
  makeFrameCameraScene,
  makeFrameCursorScene,
  FrameLayerRoleAllCases,
  makeFrameScene,
  makeFrameRenderPlan,
  FrameSceneEvaluator,
  type FrameSceneProjectLike,
} from '../../src/core/FrameScene.ts';
import {
  makeCompositionRect,
  makeCompositionPoint,
} from '../../src/core/CompositionScene.ts';
import { makeProjectedScreenQuad } from '../../src/core/ScreenProjection.ts';
import { HexColorWhite, HexColorBlack } from '../../src/core/HexColor.ts';
import { makeNormalizedCrop, makeOpeningSequence } from '../../src/core/ProjectModel.ts';
import { makeNormalizedPoint, ZoomAnimationTrack } from '../../src/core/ZoomAnimation.ts';
import { makeNormalizedOverlayRect } from '../../src/core/OverlayTimeline.ts';

test('T6.3: CompositionSize shortEdge and make', () => {
  const size1 = makeCompositionSize(1920, 1080);
  assert.equal(size1.width, 1920);
  assert.equal(size1.height, 1080);
  assert.equal(CompositionSize.shortEdge(size1), 1080);

  const size2 = makeCompositionSize(1080, 1920);
  assert.equal(CompositionSize.shortEdge(size2), 1080);
});

test('T6.3: FrameColorContract defaults match SDR Desktop', () => {
  assert.deepEqual(FrameColorSpaceAllCases, ['linearSRGB', 'sRGB']);
  const contract = FrameColorContract.sdrDesktop;
  assert.equal(contract.workingSpace, 'linearSRGB');
  assert.equal(contract.outputSpace, 'sRGB');
  assert.equal(contract.isHDR, false);
});

test('T6.3: FrameShadow and FrameBackgroundScene clamping', () => {
  const shadow = makeFrameShadow({
    opacity: 1.5,
    radius: -5,
    offset: makeCompositionPoint(0, 10),
  });
  assert.equal(shadow.opacity, 1.0); // clamped to 1
  assert.equal(shadow.radius, 0); // clamped to >= 0
  assert.deepEqual(shadow.color, HexColorBlack);

  const bg = makeFrameBackgroundScene({
    source: { kind: 'color', color: HexColorWhite },
    blurRadius: -10,
    patternScale: 0.01,
    patternOpacity: 2.0,
  });
  assert.equal(bg.blurRadius, 0);
  assert.equal(bg.patternScale, 0.1); // min 0.1
  assert.equal(bg.patternOpacity, 1.0); // max 1.0
});

test('T6.3: FrameScreenChromeKind predicates and FrameScreenChromeScene length limits', () => {
  assert.equal(FrameScreenChromeKind.isDevice('window'), false);
  assert.equal(FrameScreenChromeKind.isDevice('browser'), false);
  assert.equal(FrameScreenChromeKind.isDevice('devicePhonePortrait'), true);
  assert.equal(FrameScreenChromeKind.isDevice('deviceTabletLandscape'), true);

  assert.equal(FrameScreenChromeKind.isPhone('devicePhonePortrait'), true);
  assert.equal(FrameScreenChromeKind.isPhone('deviceTabletPortrait'), false);

  assert.equal(FrameScreenChromeKind.isPortrait('devicePhonePortrait'), true);
  assert.equal(FrameScreenChromeKind.isPortrait('deviceTabletPortrait'), true);
  assert.equal(FrameScreenChromeKind.isPortrait('devicePhoneLandscape'), false);

  // String prefix slicing
  const longTitle = 'A'.repeat(200);
  const longAddr = 'B'.repeat(300);
  const chrome = makeFrameScreenChromeScene({
    kind: 'window',
    outerRect: makeCompositionRect(0, 0, 100, 100),
    toolbarRect: makeCompositionRect(0, 0, 100, 30),
    contentRect: makeCompositionRect(0, 30, 100, 70),
    outerCornerRadius: -5,
    surfaceColor: HexColorWhite,
    toolbarColor: HexColorWhite,
    separatorColor: HexColorWhite,
    fieldColor: HexColorWhite,
    glyphColor: HexColorWhite,
    title: longTitle,
    browserAddress: longAddr,
  });
  assert.equal(chrome.title.length, 120);
  assert.equal(chrome.browserAddress.length, 240);
  assert.equal(chrome.outerCornerRadius, 0);
});

test('T6.3: FrameScreenDecoration and FrameScreenScene projectionRect', () => {
  const dummyQuad = makeProjectedScreenQuad(
    makeCompositionPoint(0, 0),
    makeCompositionPoint(100, 0),
    makeCompositionPoint(100, 100),
    makeCompositionPoint(0, 100)
  );

  const screenNoChrome = makeFrameScreenScene({
    sourceCrop: makeNormalizedCrop(0, 0, 1, 1),
    fittedRect: makeCompositionRect(10, 10, 100, 100),
    baseRect: makeCompositionRect(10, 10, 100, 100),
    finalRect: makeCompositionRect(10, 10, 100, 100),
    projectedQuad: dummyQuad,
    cornerRadius: 8,
    borderWidth: 2,
    borderColor: HexColorBlack,
    borderOpacity: 0.8,
    shadow: null,
    decoration: FrameScreenDecoration.none,
  });
  assert.deepEqual(screenNoChrome.projectionRect, screenNoChrome.finalRect);

  const chromeOuterRect = makeCompositionRect(0, 0, 120, 140);
  const screenWithChrome = makeFrameScreenScene({
    ...screenNoChrome,
    decoration: FrameScreenDecoration.chrome(
      makeFrameScreenChromeScene({
        kind: 'window',
        outerRect: chromeOuterRect,
        toolbarRect: makeCompositionRect(0, 0, 120, 30),
        contentRect: makeCompositionRect(0, 30, 120, 110),
        outerCornerRadius: 8,
        surfaceColor: HexColorWhite,
        toolbarColor: HexColorWhite,
        separatorColor: HexColorWhite,
        fieldColor: HexColorWhite,
        glyphColor: HexColorWhite,
      })
    ),
  });
  assert.deepEqual(screenWithChrome.projectionRect, chromeOuterRect);
});

test('T6.3: FrameMosaicScene and FrameCursorScene clamping', () => {
  const mosaic = makeFrameMosaicScene({
    sourceRect: makeNormalizedOverlayRect(0, 0, 1, 1),
    cornerRadius: 0.9,
    style: 'spotlight',
    intensity: 1.5,
    spotlightDimming: 0.99,
    transitionProgress: 1.5,
  });
  assert.equal(mosaic.cornerRadius, 0.5); // max 0.5
  assert.equal(mosaic.intensity, 1.0); // max 1.0
  assert.equal(mosaic.spotlightDimming, 0.75); // max 0.75
  assert.equal(mosaic.transitionProgress, 1.0); // max 1.0

  const cursor = makeFrameCursorScene({
    assetID: 'appleBlack',
    metrics: {
      assetID: 'appleBlack',
      size: { width: 32, height: 32 },
      hotspot: { x: 0, y: 0 },
      clickColor: HexColorBlack,
      dragAnchor: { x: 0, y: 0 },
    },
    normalizedScreenPosition: makeNormalizedPoint(0.5, 0.5),
    layout: {
      position: makeCompositionPoint(100, 100),
      size: makeCompositionPoint(32, 32),
      hotspot: makeCompositionPoint(0, 0),
    },
    isClicking: true,
    clickOpacity: 0.01,
    clickScale: 5.0,
    shadow: null,
  });
  assert.equal(cursor.clickOpacity, 0.05); // min 0.05
  assert.equal(cursor.clickScale, 3.0); // max 3.0
  assert.deepEqual(cursor.effectiveClickColor, HexColorBlack);
});

test('T6.3: FrameScene and FrameRenderPlan construction', () => {
  assert.deepEqual(FrameLayerRoleAllCases, [
    'background',
    'screen',
    'cursor',
    'spotlight',
    'camera',
    'stickers',
    'animations',
    'subtitles',
    'videos',
  ]);

  const dummyQuad = makeProjectedScreenQuad(
    makeCompositionPoint(0, 0),
    makeCompositionPoint(100, 0),
    makeCompositionPoint(100, 100),
    makeCompositionPoint(0, 100)
  );

  const scene = makeFrameScene({
    time: 1.5,
    canvasSize: makeCompositionSize(1920, 1080),
    color: FrameColorContract.sdrDesktop,
    background: makeFrameBackgroundScene({
      source: { kind: 'color', color: HexColorBlack },
      blurRadius: 0,
    }),
    screen: makeFrameScreenScene({
      sourceCrop: makeNormalizedCrop(0, 0, 1, 1),
      fittedRect: makeCompositionRect(0, 0, 1920, 1080),
      baseRect: makeCompositionRect(0, 0, 1920, 1080),
      finalRect: makeCompositionRect(0, 0, 1920, 1080),
      projectedQuad: dummyQuad,
      cornerRadius: 0,
      borderWidth: 0,
      borderColor: HexColorBlack,
      borderOpacity: 0,
      shadow: null,
    }),
    camera: null,
    cursor: null,
    layerOrder: ['background', 'screen'],
  });

  const plan = makeFrameRenderPlan({
    presentationTime: 1.5,
    outputDuration: 10.0,
    frameRate: 60,
    scene,
  });

  assert.equal(plan.presentationTime, 1.5);
  assert.equal(plan.outputDuration, 10.0);
  assert.equal(plan.frameRate, 60);
  assert.equal(plan.scene.canvasSize.width, 1920);
});

test('T6.4: FrameSceneEvaluator.scene idempotency (two identical calls deepEqual)', () => {
  const project: FrameSceneProjectLike = {
    canvas: {
      crop: makeNormalizedCrop(0, 0, 1, 1),
      padding: 20,
      contentPosition: { x: 0.5, y: 0.5 },
      contentScale: 1.0,
      borderWidth: 2,
      borderColor: HexColorBlack,
      insetOpacity: 1.0,
      screenFrame: 'windowLight',
      screenFrameScale: 1.0,
      screenFrameToolbarScale: 1.0,
      screenFrameOuterCornerRadius: 12,
      screenFrameContentCornerRadius: 8,
      screenFrameTitle: 'Demo Window',
      screenFrameBrowserAddress: 'https://example.com',
      cornerRadius: 12,
      shadowStrength: 0.2,
      backgroundSource: { kind: 'color', color: HexColorWhite },
      backgroundBlur: 10,
      patternScale: 1.0,
      patternOpacity: 1.0,
    },
    camera: {
      shape: 'circle',
      position: { x: 0.8, y: 0.8 },
      size: 0.25,
      roundness: 1.0,
      scaleDuringZoom: 1.2,
      borderWidth: 4,
      shadowStrength: 0.3,
      isHidden: false,
      contentPosition: { x: 0.5, y: 0.5 },
      contentScale: 1.0,
      isMirrored: false,
    },
    motion: {
      screenSpring: { mass: 2.4, stiffness: 210, damping: 42 },
      cursorSpring: { mass: 2.8, stiffness: 450, damping: 66 },
    },
    cursorStyle: {
      assetID: 'appleBlack',
      size: 1.0,
      clickEffectStyle: 'ripple',
      clickColor: HexColorBlack,
      clickOpacity: 0.8,
      clickScale: 1.0,
    },
    openingSequence: makeOpeningSequence({
      isEnabled: false,
    }),
    timeline: {
      screenMotionClips: [],
      cameraMotionClips: [],
      stickerClips: [],
      mosaicClips: [],
    },
    zoomAnimations: [],
  };

  const canvasSize = makeCompositionSize(1920, 1080);
  const scene1 = FrameSceneEvaluator.scene(project, 2.5, 10.0, canvasSize, 16 / 9);
  const scene2 = FrameSceneEvaluator.scene(project, 2.5, 10.0, canvasSize, 16 / 9);

  // Exact idempotency requirement
  assert.deepEqual(scene1, scene2);
  assert.equal(scene1.time, 2.5);
  assert.equal(scene1.screen.fittedRect.width > 0, true);
  assert.equal(scene1.layerOrder.includes('screen'), true);
});

test('T6.4: FrameSceneEvaluator.refreshingCursor only modifies cursor and presentationTime', () => {
  const project: FrameSceneProjectLike = {
    canvas: {
      crop: makeNormalizedCrop(0, 0, 1, 1),
      padding: 0,
      contentPosition: { x: 0.5, y: 0.5 },
      contentScale: 1.0,
      borderWidth: 0,
      borderColor: HexColorBlack,
      insetOpacity: 1.0,
      screenFrame: 'none',
      screenFrameScale: 1.0,
      screenFrameToolbarScale: 1.0,
      screenFrameOuterCornerRadius: null,
      screenFrameContentCornerRadius: null,
      screenFrameTitle: '',
      screenFrameBrowserAddress: '',
      cornerRadius: 0,
      shadowStrength: 0,
      backgroundSource: { kind: 'color', color: HexColorBlack },
      backgroundBlur: 0,
      patternScale: 1.0,
      patternOpacity: 1.0,
    },
    camera: {
      shape: 'circle',
      position: { x: 0.5, y: 0.5 },
      size: 0.2,
      roundness: 1,
      scaleDuringZoom: 1,
      borderWidth: 0,
      shadowStrength: 0,
      isHidden: true,
      contentPosition: { x: 0.5, y: 0.5 },
      contentScale: 1,
      isMirrored: false,
    },
    motion: {
      screenSpring: { mass: 2.4, stiffness: 210, damping: 42 },
      cursorSpring: { mass: 2.8, stiffness: 450, damping: 66 },
    },
    cursorStyle: {
      assetID: 'appleBlack',
      size: 1.0,
      clickEffectStyle: 'ripple',
      clickColor: null,
      clickOpacity: 0.8,
      clickScale: 1.0,
    },
    openingSequence: makeOpeningSequence({
      isEnabled: false,
    }),
    timeline: {
      screenMotionClips: [],
      cameraMotionClips: [],
      stickerClips: [],
      mosaicClips: [],
    },
    zoomAnimations: [],
  };

  const canvasSize = makeCompositionSize(1920, 1080);
  const zoomTrack = new ZoomAnimationTrack([]);

  const plan = FrameSceneEvaluator.renderPlan(
    project,
    1.0,
    10.0,
    60,
    canvasSize,
    16 / 9,
    null,
    null,
    null,
    {},
    zoomTrack
  );

  // refreshingCursor at t = 1.5
  const refreshedPlan = FrameSceneEvaluator.refreshingCursor(
    plan,
    1.5,
    project,
    null,
    null,
    {},
    zoomTrack
  );

  // presentationTime updated
  assert.equal(refreshedPlan.presentationTime, 1.5);
  assert.equal(plan.presentationTime, 1.0);

  // Everything in scene except presentationTime / cursor remains strictly equal
  assert.deepEqual(refreshedPlan.scene.screen, plan.scene.screen);
  assert.deepEqual(refreshedPlan.scene.background, plan.scene.background);
  assert.deepEqual(refreshedPlan.scene.canvasSize, plan.scene.canvasSize);
  assert.deepEqual(refreshedPlan.scene.color, plan.scene.color);
  assert.deepEqual(refreshedPlan.scene.stickers, plan.scene.stickers);
  assert.deepEqual(refreshedPlan.scene.stickerBackdrop, plan.scene.stickerBackdrop);
});

test('T13.5b-2b: FrameSceneEvaluator v0.2.0 supports multi-source, inserted media, beauty, pressScale, post tracks, and layerOrder', async () => {
  const {
    makeRecorderProject,
    makeProjectMediaManifest,
    makeProjectMediaReference,
  } = await import('../../src/core/ProjectMediaModel.ts');
  const { makeCameraBeautySettings } = await import('../../src/core/CameraBeauty.ts');
  const { makeCameraStyle, makeCursorStyle } = await import('../../src/core/ProjectModel.ts');
  const {
    makeProjectTimeline,
    makeRecordingSegment,
    makeSourceSequenceEdited,
    makeInsertedMedia,
  } = await import('../../src/core/ProjectTimeline.ts');
  const { makeAnimationClip, makeOverlayTiming } = await import('../../src/core/OverlayTimeline.ts');
  const {
    makeVideoClip,
    makeSubtitleCue,
    makeSubtitleStyle,
  } = await import('../../src/core/PostProductionModel.ts');
  const { makePointerTrackEvaluation, makePointerSample } = await import('../../src/core/PointerTrack.ts');

  const altSourceID = 'cccccccc-3333-4333-8333-333333333333';
  const project = makeRecorderProject({
    media: makeProjectMediaManifest({
      screen: makeProjectMediaReference({ relativePath: 'media/primary.mp4' }),
      camera: makeProjectMediaReference({ relativePath: 'media/cam.mp4' }),
    }),
    camera: makeCameraStyle({
      isHidden: false,
      beauty: makeCameraBeautySettings({ smoothing: 0.45, whitening: 0.3 }),
    }),
    cursorStyle: makeCursorStyle({ assetID: 'appleBlack' }),
    timeline: makeProjectTimeline({
      sourceSequence: makeSourceSequenceEdited([
        makeRecordingSegment({ id: 'rec-1', sourceStart: 0, sourceDuration: 5 }),
        makeRecordingSegment({
          id: 'ins-vid',
          sourceStart: 0,
          sourceDuration: 4,
          media: makeInsertedMedia({
            path: 'assets/card.mp4',
            fileDuration: 4,
            name: 'TitleCard',
            usesFrameStyle: false,
          }),
        }),
        makeRecordingSegment({
          id: 'rec-2',
          sourceStart: 0,
          sourceDuration: 4,
          sourceID: altSourceID,
        }),
      ]),
      videoClips: [
        makeVideoClip({
          id: 'ov-vid',
          timing: makeOverlayTiming(1.0, 2.0),
          sourcePath: 'clips/pip.mp4',
          sourceStart: 0.5,
          playbackRate: 2.0,
        }),
      ],
      animationClips: [
        makeAnimationClip({
          id: 'ov-anim',
          timing: makeOverlayTiming(1.0, 2.0),
          sourcePath: 'motions/callout.dmhtml',
          timeOffset: 0.25,
          playbackRate: 1.5,
        }),
      ],
      subtitleCues: [
        makeSubtitleCue({
          id: 'cue-1',
          timing: makeOverlayTiming(1.0, 2.0),
          text: 'Hello world',
          secondaryText: '你好世界',
        }),
      ],
      subtitleStyle: makeSubtitleStyle({ showsSecondary: true }),
    }),
  });

  const canvasSize = makeCompositionSize(1920, 1080);
  const pointerEval = makePointerTrackEvaluation(
    makeNormalizedPoint(0.5, 0.5),
    makePointerSample(makeNormalizedPoint(0.5, 0.5), true, null, 0, null, 0.82)
  );
  const metrics = {
    hotspot: { x: 0, y: 0 },
    intrinsicSize: { width: 32, height: 32 },
    clickColor: HexColorBlack,
    scaleReferenceHeight: 32,
  };

  // Sample during first recording segment (t=2.0): videos, animations, camera (+beauty), cursor (+pressScale), subtitles active
  const recScene = FrameSceneEvaluator.scene(
    project,
    2.0,
    13.0,
    canvasSize,
    16 / 9,
    { width: 640, height: 480 },
    null,
    pointerEval,
    metrics
  );
  assert.ok(recScene.camera);
  assert.equal(recScene.camera.beauty.smoothing, 0.45);
  assert.equal(recScene.camera.beauty.whitening, 0.3);
  assert.ok(recScene.cursor);
  assert.ok(Math.abs(recScene.cursor.pressScale - 0.82) < 1e-6);
  assert.equal(recScene.videos.length, 1);
  assert.equal(recScene.videos[0].sourceTime, 2.5); // 0.5 + (2-1)*2
  assert.equal(recScene.animations.length, 1);
  assert.equal(recScene.animations[0].localTime, 1.75); // (2-1)*1.5 + 0.25
  assert.equal(recScene.subtitle?.text, 'Hello world');
  assert.equal(recScene.subtitle?.secondaryText, '你好世界');
  // Camera renders after overlay videos/animations, and subtitles last
  assert.ok(recScene.layerOrder.indexOf('videos') < recScene.layerOrder.indexOf('camera'));
  assert.ok(recScene.layerOrder.indexOf('animations') < recScene.layerOrder.indexOf('camera'));
  assert.equal(recScene.layerOrder[recScene.layerOrder.length - 1], 'subtitles');

  // Sample inside flat inserted video segment (t=6.5): full canvas, no chrome, camera & cursor suppressed
  const insScene = FrameSceneEvaluator.scene(
    project,
    6.5,
    13.0,
    canvasSize,
    16 / 9,
    { width: 640, height: 480 },
    null,
    pointerEval,
    metrics
  );
  assert.equal(insScene.screen.fillsFrame, true);
  assert.equal(insScene.screen.cornerRadius, 0);
  assert.equal(insScene.screen.decoration.kind, 'none');
  assert.equal(insScene.camera, null);
  assert.equal(insScene.cursor, null);

  // Content aspect mismatch sets sourceContentRect distinct from finalRect
  const morphScene = FrameSceneEvaluator.scene(
    project,
    2.0,
    13.0,
    canvasSize,
    1.0, // square source
    null,
    null,
    null,
    null,
    {},
    null,
    null,
    null,
    null,
    null,
    16 / 9 // wider outer card geometry
  );
  assert.equal(morphScene.screen.contentAspectRatio, 1.0);
  assert.ok(morphScene.screen.sourceContentRect!.width < morphScene.screen.finalRect.width);
});

