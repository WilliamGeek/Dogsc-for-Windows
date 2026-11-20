// Test for: F:\dogsc-win\src\core\ProjectMediaModel.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeRecorderProject,
  makeProjectMediaManifest,
  makeProjectMediaReference,
  encodeRecorderProject,
  decodeRecorderProject,
} from '../../src/core/ProjectMediaModel.ts';
import { ProjectSchema } from '../../src/core/ProjectModel.ts';
import { makeZoomAnimationClip, makeNormalizedPoint } from '../../src/core/ZoomAnimation.ts';
import { makeRecordingMarker } from '../../src/core/RecordingMarker.ts';
import { ProjectValidator } from '../../src/core/ProjectValidator.ts';

test('T7.3: makeRecorderProject defaults match current project schema', () => {
  const project = makeRecorderProject();
  assert.equal(project.version, ProjectSchema.currentVersion);
  assert.equal(project.title, '未命名录制');
  assert.ok(project.createdAt instanceof Date);
  assert.ok(project.canvas);
  assert.ok(project.camera);
  assert.ok(project.audio);
  assert.ok(project.motion);
  assert.ok(project.openingSequence);
  assert.ok(project.cursorStyle);
  assert.ok(project.exportSettings);
  assert.ok(project.timeline);
  assert.equal(project.media, null);
  assert.deepEqual(project.recordingMarkers, []);
  assert.deepEqual(project.zoomAnimations, []);
});

test('T7.3: zoomAnimations property synchronizes with timeline.zoomClips', () => {
  const project = makeRecorderProject();
  const clip = makeZoomAnimationClip({
    startTime: 1.0,
    endTime: 3.0,
    scale: 2.0,
    focus: makeNormalizedPoint(0.5, 0.5),
  });
  project.zoomAnimations = [clip];
  assert.equal(project.timeline.zoomClips.length, 1);
  assert.equal(project.zoomAnimations[0].startTime, 1.0);
});

test('T7.3: RecorderProject encode and decode round trip', () => {
  const manifest = makeProjectMediaManifest({
    screen: makeProjectMediaReference({ relativePath: 'screen.mp4', startOffset: 0.5 }),
    camera: makeProjectMediaReference({ relativePath: 'camera.mp4', startOffset: 1.0 }),
  });
  const marker = makeRecordingMarker({ id: 'm1', sourceTime: 2.5, number: 1, label: 'Intro' });
  const clip = makeZoomAnimationClip({
    startTime: 1.0,
    endTime: 3.0,
    scale: 2.5,
    focus: makeNormalizedPoint(0.3, 0.4),
  });

  const project = makeRecorderProject({
    title: 'RoundTripTest',
    media: manifest,
    recordingMarkers: [marker],
    zoomAnimations: [clip],
  });

  const encoded = encodeRecorderProject(project);
  const decoded = decodeRecorderProject(encoded);

  assert.equal(decoded.title, 'RoundTripTest');
  assert.equal(decoded.version, ProjectSchema.currentVersion);
  assert.ok(decoded.media);
  assert.equal(decoded.media.screen.relativePath, 'screen.mp4');
  assert.equal(decoded.media.camera?.relativePath, 'camera.mp4');
  assert.equal(decoded.recordingMarkers.length, 1);
  assert.equal(decoded.recordingMarkers[0].number, 1);
  assert.equal(decoded.recordingMarkers[0].sourceTime, 2.5);
  assert.equal(decoded.timeline.zoomClips.length, 1);
  assert.equal(decoded.timeline.zoomClips[0].scale, 2.5);
});

test('T12.6: legacy English capture values normalize and pass ProjectValidator', () => {
  const legacy = {
    version: ProjectSchema.currentVersion,
    capture: {
      source: 'display',
      displayID: 0,
      displayName: '\\\\.\\DISPLAY1',
      captureFrameRate: 30,
      captureCodec: 'h264',
      captureResolutionLimit: 'native',
      systemAudioScope: 'all',
      recordsSystemAudio: true,
    },
  };

  const decoded = decodeRecorderProject(legacy);
  assert.equal(decoded.capture.source, '整块屏幕');
  assert.equal(decoded.capture.captureCodec, 'H.264');
  assert.equal(decoded.capture.captureResolutionLimit, '原始分辨率');
  assert.equal(decoded.capture.systemAudioScope, '全部系统声音');
  assert.equal(decoded.capture.captureFrameRate, 30);
  assert.equal(decoded.capture.displayID, 0);

  assert.doesNotThrow(() => ProjectValidator.validate(decoded));
});

test('T12.6: buildProjectFromRecording preserves real capture configuration', async () => {
  const { buildProjectFromRecording } = await import('../../src/capture/RecordingSession.ts');
  const project = buildProjectFromRecording([], 0, 2, {
    source: '整块屏幕',
    displayID: 1,
    displayName: '\\\\.\\DISPLAY2',
    captureFrameRate: 30,
    captureCodec: 'H.264',
    recordsSystemAudio: false,
    recordsMicrophone: false,
    recordsCamera: false,
  });

  assert.equal(project.capture.captureFrameRate, 30);
  assert.equal(project.capture.captureCodec, 'H.264');
  assert.equal(project.capture.recordsSystemAudio, false);
  assert.equal(project.capture.displayID, 1);
  assert.equal(project.capture.displayName, '\\\\.\\DISPLAY2');
});

test('T7.3: decodeRecorderProject handles project with media manifest', () => {
  const v23JSON = {
    version: 23,
    title: 'ProjectV23',
    media: {
      screen: { relativePath: 'screen_23.mp4' },
      camera: { relativePath: 'cam_23.mp4', startOffset: 0.75 },
    },
  };

  const decoded = decodeRecorderProject(v23JSON);
  assert.equal(decoded.version, ProjectSchema.currentVersion);
  assert.ok(decoded.media);
  assert.equal(decoded.media.screen.relativePath, 'screen_23.mp4');
  assert.equal(decoded.media.camera?.relativePath, 'cam_23.mp4');
  assert.equal(decoded.media.camera?.startOffset, 0.75);
  assert.equal(decoded.media.microphone, null);
});
