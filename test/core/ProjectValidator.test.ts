// Test for: F:\dogsc-win\src\core\ProjectValidator.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectValidator, ProjectValidationError } from '../../src/core/ProjectValidator.ts';
import { makeRecorderProject } from '../../src/core/ProjectMediaModel.ts';
import { makeCanvasStyle, makeCameraStyle, makeAudioStyle, makeCursorStyle, makeMotionStyle } from '../../src/core/ProjectModel.ts';
import { makeZoomAnimationClip, makeNormalizedPoint } from '../../src/core/ZoomAnimation.ts';
import {
  makeProjectTimeline,
  makeRecordingSegment,
  makeSourceSequenceEdited,
} from '../../src/core/ProjectTimeline.ts';

test('T7.4: ProjectValidator accepts default project', () => {
  const project = makeRecorderProject();
  assert.doesNotThrow(() => {
    ProjectValidator.validate(project);
  });
});

test('T7.4: ProjectValidator rejects invalid canvas parameters', () => {
  // Padding > 1000
  const invalidCanvas = makeCanvasStyle({ padding: 1500 });
  assert.throws(
    () => ProjectValidator.validate(invalidCanvas),
    (err: any) => err instanceof ProjectValidationError && err.kind === 'invalidCanvas'
  );
});

test('T7.4: ProjectValidator rejects invalid camera parameters', () => {
  // Size > 1.0
  const invalidCam = makeCameraStyle({ size: 1.5 });
  assert.throws(
    () => ProjectValidator.validate(invalidCam),
    (err: any) => err instanceof ProjectValidationError && err.kind === 'invalidCamera'
  );
});

test('T7.4: ProjectValidator rejects invalid audio volume', () => {
  const invalidAudio = { ...makeAudioStyle(), systemVolume: 1.5 };
  assert.throws(
    () => ProjectValidator.validate(invalidAudio),
    (err: any) => err instanceof ProjectValidationError && err.kind === 'invalidAudio'
  );
});

test('T7.4: ProjectValidator rejects invalid cursor parameters', () => {
  const invalidCursor = { ...makeCursorStyle(), size: 0.1 }; // min size is 0.25
  assert.throws(
    () => ProjectValidator.validate(invalidCursor),
    (err: any) => err instanceof ProjectValidationError && err.kind === 'invalidCursor'
  );
});

test('T7.4: ProjectValidator detects duplicate and overlapping zoom clips', () => {
  const c1 = makeZoomAnimationClip({ id: 'z1', startTime: 0, endTime: 2, scale: 2 });
  const c2 = makeZoomAnimationClip({ id: 'z1', startTime: 3, endTime: 5, scale: 2 }); // duplicate ID
  assert.throws(
    () => ProjectValidator.validate(makeProjectTimeline({ zoomClips: [c1, c2] })),
    (err: any) => err instanceof ProjectValidationError && err.kind === 'duplicateZoomID'
  );

  const c3 = makeZoomAnimationClip({ id: 'z2', startTime: 1, endTime: 3, scale: 2 }); // overlaps with c1
  assert.throws(
    () => ProjectValidator.validate(makeProjectTimeline({ zoomClips: [c1, c3] })),
    (err: any) => err instanceof ProjectValidationError && err.kind === 'overlappingZoom'
  );
});

test('v0.2.0: ProjectValidator rejects dangling recording segment sourceID per Swift L124-134', () => {
  const danglingSeg = makeRecordingSegment({
    sourceStart: 0,
    sourceDuration: 3,
    sourceID: 'MISSING-SOURCE-UUID',
  });
  const invalidProject = makeRecorderProject({
    timeline: makeProjectTimeline({
      sourceSequence: makeSourceSequenceEdited([danglingSeg]),
    }),
  });
  assert.throws(
    () => ProjectValidator.validate(invalidProject),
    (err: any) => err instanceof ProjectValidationError && err.kind === 'invalidTimeline',
  );
});
