import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCaptureConfiguration } from '../../src/core/CaptureConfiguration.ts';
import { makeProjectMediaManifest } from '../../src/core/ProjectMediaModel.ts';
import { makeProjectMediaReference } from '../../src/core/MediaTimeline.ts';
import {
  NormalizedCropFull,
  makeNormalizedCrop,
} from '../../src/core/ProjectModel.ts';
import {
  RecordingSource,
  RecordingSourcePrimaryID,
  makeRecordingSource,
  recordingSourceFromJSON,
} from '../../src/core/RecordingSource.ts';
import { makeScreenCardAppearance } from '../../src/core/ScreenCardAppearance.ts';

test('RecordingSource primaryID and defaults with clamp per Swift L6-37', () => {
  assert.equal(RecordingSourcePrimaryID, '00000000-0000-0000-0000-000000000001');
  assert.equal(RecordingSource.primaryID, RecordingSourcePrimaryID);

  const media = makeProjectMediaManifest({
    screen: makeProjectMediaReference({ relativePath: 'sources/s2/screen.mp4' }),
  });

  const src = makeRecordingSource({
    name: 'Clip B',
    media,
    cameraContentCrop: makeNormalizedCrop(-0.2, 0.1, 2.0, 0.5),
    crop: makeNormalizedCrop(0.25, 0.25, 0.5, 0.5),
    colorIndex: -3,
  });

  assert.equal(src.name, 'Clip B');
  assert.deepEqual(src.crop, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
  assert.ok(src.cameraContentCrop !== null);
  assert.ok(src.cameraContentCrop.x >= 0 && src.cameraContentCrop.width <= 1);
  assert.equal(src.colorIndex, 0);
  assert.equal(src.screenAppearance, null);

  const plain = makeRecordingSource({ name: 'Plain', media });
  assert.deepEqual(plain.crop, NormalizedCropFull);
  assert.equal(plain.colorIndex, null);
  assert.equal(plain.cameraContentCrop, null);
  assert.deepEqual(plain.capture, makeCaptureConfiguration());
});

test('RecordingSource JSON decoding restores optional fields and validates required keys per Swift L43-55', () => {
  const decoded = recordingSourceFromJSON({
    id: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
    media: {
      screen: { relativePath: 's1.mp4', startOffset: 0 },
    },
    crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    colorIndex: 2,
    screenAppearance: {
      cornerRadius: 18,
      borderColor: '#AABBCC',
    },
  });

  assert.equal(decoded.id, 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE');
  assert.equal(decoded.name, '');
  assert.equal(decoded.media.screen.relativePath, 's1.mp4');
  assert.equal(decoded.colorIndex, 2);
  assert.equal(decoded.screenAppearance?.cornerRadius, 18);
  assert.equal(decoded.screenAppearance?.borderColor.rgb24, 0xaabbcc);

  assert.throws(() => recordingSourceFromJSON({ name: 'missing-id' }));
  assert.throws(() => recordingSourceFromJSON({ id: 'X', media: {} }));
});
