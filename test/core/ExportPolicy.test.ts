// Test for: F:\dogsc-win\src\core\ExportPolicy.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CaptureEncodingPolicy,
  ExportEncodingPolicy,
  RequiredProjectMedia,
} from '../../src/core/ExportPolicy.ts';
import {
  makeProjectMediaManifest,
  makeProjectMediaReference,
  makeRecorderProject,
} from '../../src/core/ProjectMediaModel.ts';
import {
  makeProjectTimeline,
  makeRecordingSegment,
  makeSourceSequenceEdited,
} from '../../src/core/ProjectTimeline.ts';
import { makeRecordingSource } from '../../src/core/RecordingSource.ts';
import { makeSegmentSceneStyle } from '../../src/core/SegmentSceneStyle.ts';
import { makeCameraStyle } from '../../src/core/ProjectModel.ts';

test('T7.4 / v0.2.0: RequiredProjectMedia evaluates audio, multi-source camera and background needs', () => {
  const project = makeRecorderProject();
  const req1 = new RequiredProjectMedia(project);
  assert.equal(req1.screenVideo, true);
  assert.equal(req1.systemAudio, true);
  assert.equal(req1.cameraVideo, false);
  assert.equal(req1.microphoneAudio, false);
  assert.equal(req1.backgroundImage, false);
  assert.equal(req1.backgroundVideo, false);

  const src2 = makeRecordingSource({
    name: 'Cam Src',
    media: makeProjectMediaManifest({
      screen: makeProjectMediaReference({ relativePath: 's2.mp4' }),
      camera: makeProjectMediaReference({ relativePath: 'cam2.mp4' }),
    }),
  });
  const seg1 = makeRecordingSegment({
    sourceStart: 0,
    sourceDuration: 2,
    sceneStyle: makeSegmentSceneStyle({ camera: makeCameraStyle({ isHidden: true }) }),
  });
  const seg2 = makeRecordingSegment({
    sourceStart: 0,
    sourceDuration: 3,
    sourceID: src2.id,
  });
  const multi = makeRecorderProject({
    media: makeProjectMediaManifest({
      screen: makeProjectMediaReference({ relativePath: 's1.mp4' }),
      camera: makeProjectMediaReference({ relativePath: 'c1.mp4' }),
    }),
    additionalSources: [src2],
    timeline: makeProjectTimeline({ sourceSequence: makeSourceSequenceEdited([seg1, seg2]) }),
    canvas: {
      ...project.canvas,
      backgroundSource: { kind: 'projectImage', relativePath: 'wallpaper.png' },
    },
  });

  // seg1 hides camera -> scoped to primary reports cameraVideo=false; global reports true via src2
  assert.equal(new RequiredProjectMedia(multi).cameraVideo, true);
  assert.equal(new RequiredProjectMedia(multi).backgroundImage, true);
  assert.equal(new RequiredProjectMedia(multi, src2.id).cameraVideo, true);

  const mutedProject = makeRecorderProject({
    audio: { ...project.audio, isSystemMuted: true },
  });
  assert.equal(new RequiredProjectMedia(mutedProject).systemAudio, false);
});

test('T7.4 / v0.2.0: ExportEncodingPolicy & CaptureEncodingPolicy calculate bitrates per Swift L48-115', () => {
  assert.equal(ExportEncodingPolicy.audioBitrate, 192000);

  // Hand calc: 1080p @ 60fps -> anchor 12,000,000 * high(1.0) * h264(1.0) = 12,000,000
  assert.equal(ExportEncodingPolicy.videoBitrate(1920, 1080, 60), 12000000);
  // HEVC compact on 1080p@60 -> 12M * 0.6 * 0.75 = 5,400,000
  assert.equal(
    ExportEncodingPolicy.videoBitrate(1920, 1080, 60, 'hevc', 'compact'),
    5400000,
  );
  // 4K @ 60fps -> 55,000,000; maximum -> 82,500,000
  assert.equal(ExportEncodingPolicy.videoBitrate(3840, 2160, 60), 55000000);
  assert.equal(
    ExportEncodingPolicy.videoBitrate(3840, 2160, 60, 'h264', 'maximum'),
    82500000,
  );
  // Very small clamps to 250,000
  assert.equal(ExportEncodingPolicy.videoBitrate(32, 32, 10), 250000);

  // CaptureEncodingPolicy retains high capture budget & ceilings
  assert.equal(CaptureEncodingPolicy.videoBitrate(1920, 1080, 60), 20736000);
  assert.equal(CaptureEncodingPolicy.videoBitrate(3840, 2160, 60), 82944000);
  assert.equal(CaptureEncodingPolicy.videoBitrate(320, 240, 30), 12000000);
});
