import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeCanvasStyle,
  makeNormalizedCrop,
} from '../../src/core/ProjectModel.ts';
import {
  RECORDING_ASPECT_TRANSITION_DURATION,
  RecordingAspectTransitions,
  canTransitionScreenFrame,
  makeRecordingAspectTransitions,
  recordingAspectRatioAtOutputTime,
} from '../../src/core/RecordingAspectTransitions.ts';
import { makeSegmentSceneStyle } from '../../src/core/SegmentSceneStyle.ts';

test('RecordingAspectTransitions smoothstep hand calculation and crop division per Swift L10-94', () => {
  assert.equal(RECORDING_ASPECT_TRANSITION_DURATION, 0.240);

  const s1 = 'SOURCE-1';
  const s2 = 'SOURCE-2';
  const crop1 = makeNormalizedCrop(0, 0, 1, 1); // aspect = 1.0
  const crop2 = makeNormalizedCrop(0, 0, 0.5, 1); // cropAspect = 0.5

  const table = makeRecordingAspectTransitions({
    slices: [
      { outputStart: 0, outputEnd: 1.0, sourceID: s1, segmentID: 'SEG-1' },
      { outputStart: 1.0, outputEnd: 2.0, sourceID: s2, segmentID: 'SEG-2' },
    ],
    sourceAspectRatios: new Map([
      [s1, 16 / 9],
      [s2, 2.0],
    ]),
    crops: new Map([
      [s1, crop1],
      [s2, crop2],
    ]),
    frameStyles: new Map([
      [s1, 'windowLight'],
      [s2, 'windowDark'],
    ]),
  });

  // Compatibility checks
  assert.equal(canTransitionScreenFrame('windowLight', 'windowDark'), true);
  assert.equal(canTransitionScreenFrame('browserLight', 'browserDark'), true);
  assert.equal(canTransitionScreenFrame('devicePhone', 'deviceTabletLandscape'), true);
  assert.equal(canTransitionScreenFrame('windowLight', 'browserLight'), false);
  assert.equal(canTransitionScreenFrame('none', 'windowLight'), false);

  // At t = 0.5 in SEG-1, steady uncropped aspect is 16/9.
  const r0 = recordingAspectRatioAtOutputTime(table, 0.5, s1);
  assert.ok(r0 !== null && Math.abs(r0 - 16 / 9) < 1e-9);

  // Hand calc for SEG-2 at t = 1.12 (Swift L14-18, L52, L93):
  // SEG-1 croppedAspect = (16/9)*1 = 16/9.
  // SEG-2 croppedAspect = 2.0 * 0.5 = 1.0, span.cropAspect = 0.5.
  // x = (1.12 - 1.0) / 0.240 = 0.5 -> eased = 0.5.
  // transition.value = 16/9 + (1.0 - 16/9) * 0.5 = (16/9 + 1) / 2 = 25 / 18.
  // Returned uncropped aspect = (25 / 18) / 0.5 = 25 / 9.
  const rMid = recordingAspectRatioAtOutputTime(table, 1.12, s2);
  assert.ok(rMid !== null && Math.abs(rMid - 25 / 9) < 1e-9);

  // After morph settles (t = 1.5), returned uncropped aspect equals raw 2.0.
  const rSettled = RecordingAspectTransitions.sourceAspectRatio(table, 1.5, s2);
  assert.ok(rSettled !== null && Math.abs(rSettled - 2.0) < 1e-9);

  // Boundary / mismatch / NaN checks
  assert.equal(recordingAspectRatioAtOutputTime(table, 1.5, s1), null);
  assert.equal(recordingAspectRatioAtOutputTime(table, -0.1, s1), null);
  assert.equal(recordingAspectRatioAtOutputTime(table, 2.0, s2), null);
  assert.equal(recordingAspectRatioAtOutputTime(table, Number.NaN, s2), null);
  assert.equal(recordingAspectRatioAtOutputTime(table, 0.5, null), null);
});

test('RecordingAspectTransitions retargets mid-morph and snaps on incompatible mockups', () => {
  const s1 = 'S1';
  const s2 = 'S2';
  const s3 = 'S3';

  // SEG-2 lasts only 0.12s (half of 240ms), then SEG-3 starts from its midpoint presented value.
  const midTable = makeRecordingAspectTransitions({
    slices: [
      { outputStart: 0, outputEnd: 1.0, sourceID: s1, segmentID: 'SEG-1' },
      { outputStart: 1.0, outputEnd: 1.12, sourceID: s2, segmentID: 'SEG-2' },
      { outputStart: 1.12, outputEnd: 2.0, sourceID: s3, segmentID: 'SEG-3' },
    ],
    sourceAspectRatios: new Map([
      [s1, 1.0],
      [s2, 3.0],
      [s3, 1.0],
    ]),
    crops: new Map(),
    frameStyles: new Map([
      [s1, 'devicePhone'],
      [s2, 'devicePhoneLandscape'],
      [s3, 'deviceTablet'],
    ]),
  });

  // At t=1.12, SEG-2 has reached 0.5 * (3 - 1) + 1 = 2.0, so SEG-3 morph starts at 2.0 (NOT 3.0).
  const atStartOfS3 = recordingAspectRatioAtOutputTime(midTable, 1.12, s3);
  assert.ok(atStartOfS3 !== null && Math.abs(atStartOfS3 - 2.0) < 1e-9);

  // Incompatible mockup snaps immediately; inserted media resets continuity.
  const incompat = makeRecordingAspectTransitions({
    slices: [
      { outputStart: 0, outputEnd: 1.0, sourceID: s1, segmentID: 'SEG-1' },
      { outputStart: 1.0, outputEnd: 2.0, sourceID: s2, segmentID: 'SEG-2' },
      { outputStart: 2.0, outputEnd: 3.0, sourceID: s1, segmentID: 'INSERT', media: { path: 'x.mp4' } },
      { outputStart: 3.0, outputEnd: 4.0, sourceID: s3, segmentID: 'SEG-3' },
    ],
    sourceAspectRatios: new Map([
      [s1, 1.0],
      [s2, 2.0],
      [s3, 1.5],
    ]),
    crops: new Map(),
    segmentStyles: new Map([
      ['SEG-1', makeSegmentSceneStyle({ canvas: makeCanvasStyle({ screenFrame: 'windowLight' }) })],
      ['SEG-2', makeSegmentSceneStyle({ canvas: makeCanvasStyle({ screenFrame: 'browserDark' }) })],
      ['SEG-3', makeSegmentSceneStyle({ canvas: makeCanvasStyle({ screenFrame: 'browserLight' }) })],
    ]),
  });

  assert.ok(Math.abs((recordingAspectRatioAtOutputTime(incompat, 1.0, s2) ?? 0) - 2.0) < 1e-9);
  assert.equal(recordingAspectRatioAtOutputTime(incompat, 2.5, s1), null);
  assert.ok(Math.abs((recordingAspectRatioAtOutputTime(incompat, 3.0, s3) ?? 0) - 1.5) < 1e-9);
});
