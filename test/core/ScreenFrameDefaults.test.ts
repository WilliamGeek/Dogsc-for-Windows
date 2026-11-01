import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  screenFrameStyleDefaults,
  canvasStyleApplyingScreenFrameStyle,
} from '../../src/core/ScreenFrameDefaults.ts';
import { makeCanvasStyle } from '../../src/core/ProjectModel.ts';

test('screenFrameStyleDefaults exact values per Swift L25-39', () => {
  const none = screenFrameStyleDefaults('none');
  assert.equal(none.outerRadius, 24);
  assert.equal(none.contentRadius, 24);
  assert.equal(none.shadowStrength, 0.28);
  assert.equal(none.toolbarScale, 1.0);
  assert.equal(none.frameScale, 1.0);

  const winLight = screenFrameStyleDefaults('windowLight');
  assert.equal(winLight.outerRadius, 18);
  assert.equal(winLight.contentRadius, 0);
  assert.equal(winLight.toolbarScale, 0.9);
  assert.equal(winLight.shadowStrength, 0.22);

  const winDark = screenFrameStyleDefaults('windowDark');
  assert.equal(winDark.outerRadius, 18);
  assert.equal(winDark.contentRadius, 0);
  assert.equal(winDark.toolbarScale, 0.9);
  assert.equal(winDark.shadowStrength, 0.3);

  const browserLight = screenFrameStyleDefaults('browserLight');
  assert.equal(browserLight.outerRadius, 22);
  assert.equal(browserLight.contentRadius, 0);
  assert.equal(browserLight.toolbarScale, 1.08);
  assert.equal(browserLight.shadowStrength, 0.22);

  const browserDark = screenFrameStyleDefaults('browserDark');
  assert.equal(browserDark.outerRadius, 22);
  assert.equal(browserDark.contentRadius, 0);
  assert.equal(browserDark.toolbarScale, 1.08);
  assert.equal(browserDark.shadowStrength, 0.3);

  const phone = screenFrameStyleDefaults('devicePhone');
  assert.equal(phone.outerRadius, 64);
  assert.equal(phone.contentRadius, 40);
  assert.equal(phone.frameScale, 0.9);
  assert.equal(phone.shadowStrength, 0.24);

  const tablet = screenFrameStyleDefaults('deviceTablet');
  assert.equal(tablet.outerRadius, 48);
  assert.equal(tablet.contentRadius, 24);
  assert.equal(tablet.shadowStrength, 0.24);
});

test('canvasStyleApplyingScreenFrameStyle applies all preset overrides per Swift L41-55', () => {
  const initial = makeCanvasStyle();
  assert.equal(initial.screenFrame, 'none');
  assert.equal(initial.cornerRadius, 24);

  // Apply windowDark
  const withWinDark = canvasStyleApplyingScreenFrameStyle(initial, 'windowDark');
  assert.equal(withWinDark.screenFrame, 'windowDark');
  assert.equal(withWinDark.screenFrameToolbarScale, 0.9);
  assert.equal(withWinDark.screenFrameOuterCornerRadius, 18);
  assert.equal(withWinDark.screenFrameContentCornerRadius, 0);
  assert.equal(withWinDark.cornerRadius, 0);
  assert.equal(withWinDark.shadowStrength, 0.3);

  // Apply devicePhone
  const withPhone = canvasStyleApplyingScreenFrameStyle(withWinDark, 'devicePhone');
  assert.equal(withPhone.screenFrame, 'devicePhone');
  assert.equal(withPhone.screenFrameScale, 0.9);
  assert.equal(withPhone.screenFrameOuterCornerRadius, 64);
  assert.equal(withPhone.screenFrameContentCornerRadius, 40);
  assert.equal(withPhone.cornerRadius, 40);
  assert.equal(withPhone.shadowStrength, 0.24);
});
