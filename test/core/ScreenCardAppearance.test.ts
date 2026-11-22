import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHexColor } from '../../src/core/HexColor.ts';
import { makeCanvasStyle } from '../../src/core/ProjectModel.ts';
import {
  makeScreenCardAppearance,
  screenCardAppearanceApplyToCanvas,
  screenCardAppearanceFromCanvas,
  screenCardAppearanceFromJSON,
} from '../../src/core/ScreenCardAppearance.ts';

test('ScreenCardAppearance defaults match CanvasStyle defaults per Swift L19-32', () => {
  const canvas = makeCanvasStyle();
  const app = makeScreenCardAppearance();
  assert.equal(app.cornerRadius, canvas.cornerRadius);
  assert.equal(app.borderWidth, canvas.borderWidth);
  assert.equal(app.borderColor.rgb24, canvas.borderColor.rgb24);
  assert.equal(app.shadowStrength, canvas.shadowStrength);
  assert.equal(app.insetOpacity, canvas.insetOpacity);
  assert.equal(app.screenFrame, canvas.screenFrame);
  assert.equal(app.screenFrameScale, canvas.screenFrameScale);
  assert.equal(app.screenFrameToolbarScale, canvas.screenFrameToolbarScale);
  assert.equal(app.screenFrameOuterCornerRadius, null);
  assert.equal(app.screenFrameContentCornerRadius, null);
  assert.equal(app.screenFrameTitle, '');
  assert.equal(app.screenFrameBrowserAddress, '');
});

test('ScreenCardAppearance applyToCanvas uses value semantics and preserves shared canvas layout', () => {
  const baseCanvas = makeCanvasStyle({
    aspectRatio: '16:9',
    padding: 80,
    backgroundBlur: 0.4,
    cornerRadius: 24,
  });
  const edited = makeScreenCardAppearance({
    cornerRadius: 40,
    borderWidth: 4,
    borderColor: makeHexColor(0x112233),
    shadowStrength: 0.65,
    insetOpacity: 0.2,
    screenFrame: 'browserDark',
    screenFrameScale: 1.25,
    screenFrameToolbarScale: 1.1,
    screenFrameOuterCornerRadius: 18,
    screenFrameContentCornerRadius: 12,
    screenFrameTitle: 'DogSC Demo',
    screenFrameBrowserAddress: 'https://example.com',
  });

  const updated = screenCardAppearanceApplyToCanvas(edited, baseCanvas);
  // Input canvas must remain untouched.
  assert.equal(baseCanvas.cornerRadius, 24);
  assert.equal(baseCanvas.screenFrame, 'none');

  // Shared canvas properties stay unchanged; 12 appearance properties update.
  assert.equal(updated.aspectRatio, '16:9');
  assert.equal(updated.padding, 80);
  assert.equal(updated.backgroundBlur, 0.4);
  assert.equal(updated.cornerRadius, 40);
  assert.equal(updated.borderWidth, 4);
  assert.equal(updated.borderColor.rgb24, 0x112233);
  assert.equal(updated.shadowStrength, 0.65);
  assert.equal(updated.screenFrame, 'browserDark');
  assert.equal(updated.screenFrameTitle, 'DogSC Demo');
  assert.equal(updated.screenFrameBrowserAddress, 'https://example.com');

  const roundtrip = screenCardAppearanceFromCanvas(updated);
  assert.deepEqual(roundtrip, edited);
});

test('ScreenCardAppearance JSON decoding fills missing keys from defaults and parses #RRGGBB', () => {
  const decoded = screenCardAppearanceFromJSON({
    cornerRadius: 16,
    borderColor: '#336699',
    screenFrame: 'windowLight',
    screenFrameOuterCornerRadius: 22,
  });
  assert.equal(decoded.cornerRadius, 16);
  assert.equal(decoded.borderColor.rgb24, 0x336699);
  assert.equal(decoded.screenFrame, 'windowLight');
  assert.equal(decoded.screenFrameOuterCornerRadius, 22);
  assert.equal(decoded.screenFrameContentCornerRadius, null);
  assert.equal(decoded.shadowStrength, makeCanvasStyle().shadowStrength);

  assert.throws(() => screenCardAppearanceFromJSON({ borderColor: 'not-a-hex' }));
});
