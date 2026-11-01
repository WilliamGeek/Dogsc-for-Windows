import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeExportSettings } from '../../src/core/ExportSettings.ts';

test('makeExportSettings default values match Swift L13-14', () => {
  // Swift L13-14: frameRate: OutputFrameRate = .fps60 (60), resolution: CanvasResolution = .source ("原始素材")
  const s = makeExportSettings();
  assert.equal(s.frameRate, 60);
  assert.equal(s.resolution, '原始素材');
});

test('makeExportSettings preserves explicit parameters', () => {
  const s = makeExportSettings(30 as any, '1080p' as any);
  assert.equal(s.frameRate, 30);
  assert.equal(s.resolution, '1080p');
});
