import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeCanvasCustomAspectRatio,
  canvasCustomAspectRatioValue,
  canvasStyleResolvedFixedAspectRatio,
} from '../../src/core/CanvasCustomAspectRatio.ts';
import type { CanvasStyle } from '../../src/core/ProjectModel.ts';

test('canvasCustomAspectRatioValue defaults and bounds per Swift L13-14', () => {
  const def = makeCanvasCustomAspectRatio();
  assert.equal(def.width, 16);
  assert.equal(def.height, 9);
  assert.equal(canvasCustomAspectRatioValue(def), 16 / 9);

  // Invalid / non-positive numbers fallback to 16/9
  assert.equal(canvasCustomAspectRatioValue(makeCanvasCustomAspectRatio(0, 9)), 16 / 9);
  assert.equal(canvasCustomAspectRatioValue(makeCanvasCustomAspectRatio(16, -1)), 16 / 9);
  assert.equal(canvasCustomAspectRatioValue(makeCanvasCustomAspectRatio(Number.NaN, 9)), 16 / 9);

  // Clamped to [0.1, 10]
  assert.equal(canvasCustomAspectRatioValue(makeCanvasCustomAspectRatio(100, 1)), 10);
  assert.equal(canvasCustomAspectRatioValue(makeCanvasCustomAspectRatio(1, 100)), 0.1);
  assert.equal(canvasCustomAspectRatioValue(makeCanvasCustomAspectRatio(4, 3)), 4 / 3);
});

test('canvasStyleResolvedFixedAspectRatio handles all aspect presets', () => {
  const makeMockStyle = (aspectRatio: any, custom = makeCanvasCustomAspectRatio()): CanvasStyle =>
    ({ aspectRatio, customAspectRatio: custom }) as CanvasStyle;

  assert.equal(canvasStyleResolvedFixedAspectRatio(makeMockStyle('适应')), null);
  assert.equal(canvasStyleResolvedFixedAspectRatio(makeMockStyle('16:9')), 16 / 9);
  assert.equal(canvasStyleResolvedFixedAspectRatio(makeMockStyle('9:16')), 9 / 16);
  assert.equal(canvasStyleResolvedFixedAspectRatio(makeMockStyle('4:3')), 4 / 3);
  assert.equal(canvasStyleResolvedFixedAspectRatio(makeMockStyle('3:4')), 3 / 4);
  assert.equal(canvasStyleResolvedFixedAspectRatio(makeMockStyle('2.39:1')), 2.39);
  assert.equal(canvasStyleResolvedFixedAspectRatio(makeMockStyle('1:2.39')), 1 / 2.39);
  assert.equal(canvasStyleResolvedFixedAspectRatio(makeMockStyle('1:1')), 1);
  assert.equal(
    canvasStyleResolvedFixedAspectRatio(makeMockStyle('自定义', makeCanvasCustomAspectRatio(21, 9))),
    21 / 9,
  );
});
