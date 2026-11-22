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

test('v0.2.0: RecordingSource RecorderProject multi-source mutators preserve value semantics per Swift L58-154', async () => {
  const { makeRecorderProject } = await import('../../src/core/ProjectMediaModel.ts');
  const { makeProjectTimeline, makeRecordingSegment, makeSourceSequenceEdited } = await import(
    '../../src/core/ProjectTimeline.ts'
  );

  const primaryMedia = makeProjectMediaManifest({
    screen: makeProjectMediaReference({ relativePath: 'primary.mp4' }),
  });
  const extraMedia = makeProjectMediaManifest({
    screen: makeProjectMediaReference({ relativePath: 'extra.mp4' }),
    camera: makeProjectMediaReference({ relativePath: 'extra_cam.mp4' }),
  });
  const extraSource = makeRecordingSource({
    id: 'EXTRA-SRC-1',
    name: 'Extra',
    media: extraMedia,
    capture: makeCaptureConfiguration({ captureFrameRate: 30 }),
  });
  const segExtra = makeRecordingSegment({
    id: 'SEG-EXTRA',
    sourceStart: 0,
    sourceDuration: 4,
    sourceID: extraSource.id,
  });

  const proj = makeRecorderProject({
    title: 'Multi',
    media: primaryMedia,
    additionalSources: [extraSource],
    timeline: makeProjectTimeline({ sourceSequence: makeSourceSequenceEdited([segExtra]) }),
  });

  assert.equal(RecordingSource.sources(proj).length, 2);
  assert.equal(RecordingSource.openingRecordingSourceID(proj), extraSource.id);
  assert.equal(RecordingSource.openingDeclaresCamera(proj), true);
  assert.equal(RecordingSource.captureFrameRate(proj, extraSource.id), 30);

  const cropped = RecordingSource.setCrop(
    proj,
    makeNormalizedCrop(0.1, 0.2, 0.6, 0.5),
    extraSource.id,
  );
  assert.equal(cropped.changed, true);
  assert.deepEqual(cropped.project.additionalSources[0].crop, {
    x: 0.1,
    y: 0.2,
    width: 0.6,
    height: 0.5,
  });
  // Input project untouched
  assert.deepEqual(proj.additionalSources[0].crop, NormalizedCropFull);

  const segCropped = RecordingSource.setSegmentCrop(
    cropped.project,
    makeNormalizedCrop(0, 0, 0.5, 0.5),
    segExtra.id,
  );
  assert.equal(segCropped.changed, true);
  if (segCropped.project.timeline.sourceSequence.kind === 'edited') {
    assert.deepEqual(segCropped.project.timeline.sourceSequence.segments[0].crop, {
      x: 0,
      y: 0,
      width: 0.5,
      height: 0.5,
    });
  }
});
