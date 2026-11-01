// Test for: F:\dogsc-win\src\core\ExportPolicy.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import { RequiredProjectMedia, ExportEncodingPolicy } from '../../src/core/ExportPolicy.ts';
import { makeRecorderProject, makeProjectMediaManifest, makeProjectMediaReference } from '../../src/core/ProjectMediaModel.ts';
import { makeRecordingSegment, makeSourceSequenceEdited } from '../../src/core/ProjectTimeline.ts';

test('T7.4: RequiredProjectMedia evaluates audio and camera needs', () => {
  const project = makeRecorderProject();
  // By default, systemAudio volume > 0 and unmuted -> screenVideo and systemAudio true
  const req1 = new RequiredProjectMedia(project);
  assert.equal(req1.screenVideo, true);
  assert.equal(req1.systemAudio, true);
  assert.equal(req1.cameraVideo, false);
  assert.equal(req1.microphoneAudio, false);

  // When camera media is present and not hidden -> cameraVideo is true
  const projectWithCam = makeRecorderProject({
    media: makeProjectMediaManifest({
      screen: makeProjectMediaReference({ relativePath: 's.mp4' }),
      camera: makeProjectMediaReference({ relativePath: 'c.mp4' }),
    }),
  });
  const req2 = new RequiredProjectMedia(projectWithCam);
  assert.equal(req2.cameraVideo, true);

  // When audio is muted -> systemAudio is false
  const mutedProject = makeRecorderProject({
    audio: { ...project.audio, isSystemMuted: true },
  });
  const req3 = new RequiredProjectMedia(mutedProject);
  assert.equal(req3.systemAudio, false);
});

test('T7.4: ExportEncodingPolicy calculates bitrate with ceilings', () => {
  // Audio bitrate is 192kbps
  assert.equal(ExportEncodingPolicy.audioBitrate, 192000);

  // 1080p @ 60fps: 1920 * 1080 = 2,073,600 pixels < 3.5M
  // (2,073,600 * 60) / 6 = 20,736,000 bps, below 65M ceiling
  const b1080 = ExportEncodingPolicy.videoBitrate(1920, 1080, 60);
  assert.equal(b1080, 20736000);

  // 4K @ 60fps: 3840 * 2160 = 8,294,400 pixels >= 7M
  // (8,294,400 * 60) / 6 = 82,944,000 bps, capped by 130M ceiling
  const b4k = ExportEncodingPolicy.videoBitrate(3840, 2160, 60);
  assert.equal(b4k, 82944000);

  // Small resolution clamps to floor of 12Mbps
  const bSmall = ExportEncodingPolicy.videoBitrate(320, 240, 30);
  assert.equal(bSmall, 12000000);
});
