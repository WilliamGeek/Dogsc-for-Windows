// Test for: Wave H (P0-P3) Frontend Craft Modules (icons, previews, colorPicker, controls)

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { STUDIO_ICON_NAMES, svgIcon } from '../../web/studio/icons.ts';
import { hexToHsv, hsvToHex, normalizeHexColor, STUDIO_COLOR_SWATCHES } from '../../web/studio/colorPicker.ts';
import { computeScrubbedValue, rangeProgressPct, snapAndClampValue } from '../../web/studio/controls.ts';
import {
  renderBackgroundSwatchCard,
  renderCameraShapeCard,
  renderChromePreviewCard,
  renderCursorAppearanceCard,
  renderMotionTemplateCard,
  renderOpeningPresetCard,
} from '../../web/studio/previews.ts';
import {
  BackgroundPatternPresetAllCases,
  DynamicBackgroundPresetAllCases,
  CameraShapeAllCases,
  CursorAppearanceAllCases,
  OpeningSequencePresetAllCases,
} from '../../src/core/ProjectModel.ts';
import { HTML_MOTION_TEMPLATES } from '../../web/passes/htmlMotion.ts';

test('T19.4: svgIcon produces valid inline SVGs with zero Unicode placeholder symbols across studio UI', () => {
  assert.ok(STUDIO_ICON_NAMES.length >= 30);
  for (const name of STUDIO_ICON_NAMES) {
    const markup = svgIcon(name, 14);
    assert.ok(markup.startsWith('<svg '), `missing <svg for ${name}`);
    assert.ok(markup.includes('viewBox="0 0 24 24"'), `missing viewBox for ${name}`);
  }

  const forbidden = ['▣', '⊕', '✦', '⌖', '◉', '♫', '💬', '🦆', '🔊', '🎙', '✂', '◀', '▶', '⏸', '✕', '‹', '♪'];
  const studioFiles = [
    'web/studio.html',
    'web/studio/app.ts',
    'web/studio/inspector.ts',
    'web/studio/timeline.ts',
    'web/studio/motionPanel.ts',
    'web/studio/subtitlesPanel.ts',
    'web/studio/assetsPanel.ts',
    'web/studio/recorderIsland.ts',
    'web/studio/exportSheet.ts',
  ];
  for (const rel of studioFiles) {
    const text = readFileSync(resolve('F:\\dogsc-win', rel), 'utf8');
    for (const ch of forbidden) {
      assert.equal(text.includes(ch), false, `${rel} should replace Unicode icon '${ch}' with SVG`);
    }
  }
});

test('T19.5: visual preview renderers emit data-bound cards for all presets and templates', () => {
  for (const p of BackgroundPatternPresetAllCases) {
    const card = renderBackgroundSwatchCard('pattern', p, p, p === '黑曜石网格');
    assert.ok(card.includes(`data-bg-preset="${p}"`));
  }
  for (const d of DynamicBackgroundPresetAllCases) {
    const card = renderBackgroundSwatchCard('dynamicFlow', d, d, false);
    assert.ok(card.includes('swatch-dyn-badge'));
  }
  for (const ch of ['none', 'windowLight', 'windowDark', 'browserLight', 'browserDark', 'devicePhone', 'deviceTablet'] as const) {
    assert.ok(renderChromePreviewCard(ch, ch, ch === 'windowLight').includes(`data-chrome="${ch}"`));
  }
  for (const ap of CursorAppearanceAllCases) {
    assert.ok(renderCursorAppearanceCard(ap, false).includes(`data-cur-shape="${ap}"`));
  }
  for (const sh of CameraShapeAllCases) {
    assert.ok(renderCameraShapeCard(sh, false).includes(`data-cam-shape="${sh}"`));
  }
  for (const op of OpeningSequencePresetAllCases) {
    assert.ok(renderOpeningPresetCard(op, false).includes(`data-op-preset="${op}"`));
  }
  for (const tpl of HTML_MOTION_TEMPLATES) {
    assert.ok(renderMotionTemplateCard(tpl).includes(`data-insert-tpl="${tpl.id}"`));
  }
});

test('T19.6: HSV color picker math roundtrips cleanly across primary & swatch colors', () => {
  assert.equal(normalizeHexColor('#ABC'), '#aabbcc');
  assert.equal(normalizeHexColor('invalid'), null);
  for (const sw of STUDIO_COLOR_SWATCHES) {
    const { h, s, v } = hexToHsv(sw);
    const back = hsvToHex(h, s, v);
    assert.equal(back, sw, `roundtrip failed for ${sw}: got ${back}`);
  }
});

test('T19.7: scrubbable range math snaps to steps, supports fine Shift scaling, and clamps bounds', () => {
  assert.equal(snapAndClampValue(1.83, 1.0, 3.5, 0.05), 1.85);
  assert.equal(snapAndClampValue(99, 0, 10, 0.5), 10);
  assert.equal(rangeProgressPct(50, 0, 200), 25);

  const coarse = computeScrubbedValue(100, 70, 0, 200, 1, false);
  const fine = computeScrubbedValue(100, 70, 0, 200, 1, true);
  assert.equal(coarse, 200);
  assert.equal(fine, 125);
});

test('T19.8: Wave H web modules remain stripTypeScriptTypes compatible with zero node:* imports', () => {
  const newMods = [
    'web/studio/icons.ts',
    'web/studio/previews.ts',
    'web/studio/colorPicker.ts',
    'web/studio/controls.ts',
    'web/studio/inspector.ts',
    'web/studio/timeline.ts',
    'web/studio/motionPanel.ts',
    'web/studio/subtitlesPanel.ts',
    'web/studio/assetsPanel.ts',
  ];
  for (const rel of newMods) {
    const code = readFileSync(resolve('F:\\dogsc-win', rel), 'utf8');
    assert.equal(/['"]node:/.test(code), false, `${rel} must never import node:*`);
    const stripped = stripTypeScriptTypes(code);
    assert.ok(stripped.length > 0);
  }
});

