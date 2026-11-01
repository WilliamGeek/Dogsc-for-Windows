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
} from '../../src/core/FrameScene.ts';
import {
  makeCompositionRect,
  makeCompositionPoint,
} from '../../src/core/CompositionScene.ts';
import { makeProjectedScreenQuad } from '../../src/core/ScreenProjection.ts';
import { HexColorWhite, HexColorBlack } from '../../src/core/HexColor.ts';
import { makeNormalizedCrop } from '../../src/core/ProjectModel.ts';
import { makeNormalizedPoint } from '../../src/core/ZoomAnimation.ts';
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
