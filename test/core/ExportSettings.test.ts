import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  exportSettingsFromJSON,
  exportSettingsOutputDimensions,
  exportSettingsResolvedVideoCodec,
  makeExportSettings,
} from '../../src/core/ExportSettings.ts';
import { makeCanvasDimensions } from '../../src/core/ProjectModel.ts';

test('makeExportSettings default values match Swift L42-59', () => {
  const s = makeExportSettings();
  assert.equal(s.frameRate, 60);
  assert.equal(s.resolution, '原始素材');
  assert.equal(s.videoCodec, 'h264');
  assert.equal(s.quality, 'high');
});

test('makeExportSettings preserves positional and options parameters', () => {
  const s = makeExportSettings(30 as any, '1080p' as any);
  assert.equal(s.frameRate, 30);
  assert.equal(s.resolution, '1080p');
  assert.equal(s.videoCodec, 'h264');
  assert.equal(s.quality, 'high');

  const hevc = makeExportSettings({
    frameRate: 60,
    resolution: '4K',
    videoCodec: 'hevc',
    quality: 'maximum',
  });
  assert.equal(hevc.videoCodec, 'hevc');
  assert.equal(hevc.quality, 'maximum');
});

test('ExportSettings JSON decoding, codec fallback and H.264 4096 even clamp per Swift L63-85', () => {
  const legacy = exportSettingsFromJSON({ frameRate: 30, resolution: '1080p' });
  assert.equal(legacy.videoCodec, null);
  assert.equal(exportSettingsResolvedVideoCodec(legacy), 'h264');
  assert.equal(legacy.quality, 'high');

  const h264 = makeExportSettings({ videoCodec: 'h264' });
  // 5120x2880 scaled by 4096/5120 = 0.8 -> 4096x2304 (even)
  const clamped = exportSettingsOutputDimensions(h264, makeCanvasDimensions(5120, 2880));
  assert.deepEqual(clamped, { width: 4096, height: 2304 });

  // HEVC retains requested native pixels > 4096
  const hevc = makeExportSettings({ videoCodec: 'hevc' });
  assert.deepEqual(
    exportSettingsOutputDimensions(hevc, makeCanvasDimensions(5120, 2880)),
    { width: 5120, height: 2880 },
  );
});
