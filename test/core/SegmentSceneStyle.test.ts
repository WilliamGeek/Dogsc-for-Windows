import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCameraBeautySettings } from '../../src/core/CameraBeauty.ts';
import { makeHexColor } from '../../src/core/HexColor.ts';
import { makeRecorderProject } from '../../src/core/ProjectMediaModel.ts';
import {
  NormalizedCropFull,
  makeCameraStyle,
  makeCanvasStyle,
  makeCursorStyle,
  makeMotionStyle,
  makeNormalizedCrop,
} from '../../src/core/ProjectModel.ts';
import {
  makeProjectTimeline,
  makeRecordingSegment,
  makeSourceSequenceEdited,
  makeSourceSequenceFullRecording,
} from '../../src/core/ProjectTimeline.ts';
import {
  SEGMENT_APPEARANCE_TRANSITION_DURATION,
  SegmentAppearanceTransition,
  backgroundSourceSceneResourceKey,
  cameraStyleBlend,
  canvasStyleBlend,
  hexColorMixing,
  makeSegmentSceneStyle,
  makeSegmentSceneStyleFromProject,
  projectTimelineRecordingSegmentBoundaryAtOutputTime,
  segmentSceneStyleApplyToProject,
  segmentSceneStyleFromJSON,
  sourceSequenceWithoutSceneStyles,
} from '../../src/core/SegmentSceneStyle.ts';

test('backgroundSourceSceneResourceKey and SegmentSceneStyle preserve global ratio and source crop per Swift L3-64', () => {
  assert.equal(
    backgroundSourceSceneResourceKey({ kind: 'projectImage', relativePath: 'bg/a.png' }),
    'project-image:bg/a.png',
  );
  assert.equal(
    backgroundSourceSceneResourceKey({ kind: 'systemVideo', absolutePath: 'C:/vid.mp4' }),
    'system-video:C:/vid.mp4',
  );
  assert.equal(backgroundSourceSceneResourceKey({ kind: 'pattern', preset: '黑曜石网格' }), null);

  const sourceCrop = makeNormalizedCrop(0.1, 0.2, 0.7, 0.6);
  const project = makeRecorderProject({
    canvas: makeCanvasStyle({ aspectRatio: '16:9', crop: sourceCrop, padding: 60 }),
    camera: makeCameraStyle({ size: 0.35 }),
  });

  const sceneStyle = makeSegmentSceneStyleFromProject(project, 'PRESET-1', 'Focus');
  // Crop on SegmentSceneStyle itself resets to full (Swift L29).
  assert.deepEqual(sceneStyle.canvas.crop, NormalizedCropFull);

  const otherProject = makeRecorderProject({
    canvas: makeCanvasStyle({ aspectRatio: '9:16', crop: sourceCrop, padding: 120 }),
  });
  const applied = segmentSceneStyleApplyToProject(sceneStyle, otherProject);
  // Preserves caller project aspect ratio and resolved crop, applies scene style padding/camera.
  assert.equal(applied.canvas.aspectRatio, '9:16');
  assert.deepEqual(applied.canvas.crop, sourceCrop);
  assert.equal(applied.canvas.padding, 60);
  assert.equal(applied.camera.size, 0.35);
  // Original projects were not mutated.
  assert.equal(otherProject.canvas.padding, 120);

  const fromJson = segmentSceneStyleFromJSON({
    canvas: { padding: 48, crop: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 } },
    camera: { beauty: { smoothing: 0.8, whitening: 2 } },
    cursor: makeCursorStyle({ size: 2 }),
    motion: makeMotionStyle(),
    presetName: 'Deck',
  });
  assert.deepEqual(fromJson.canvas.crop, NormalizedCropFull);
  assert.equal(fromJson.canvas.padding, 48);
  assert.ok(Math.abs(fromJson.camera.beauty.smoothing - 0.8) < 1e-9);
  assert.equal(fromJson.camera.beauty.whitening, 1);
  assert.equal(fromJson.presetName, 'Deck');
});

test('SegmentAppearanceTransition hand-calculated smoothstep and canSettle per Swift L116-144', () => {
  assert.equal(SEGMENT_APPEARANCE_TRANSITION_DURATION, 0.240);
  // Hand calc (Swift L120-125):
  // t = 0.06s, boundary = 0 -> x = 0.06 / 0.240 = 0.25 -> 0.25^2 * (3 - 0.5) = 0.0625 * 2.5 = 0.15625
  const pQuarter = SegmentAppearanceTransition.progress(0.06, 0);
  assert.ok(pQuarter !== null && Math.abs(pQuarter - 0.15625) < 1e-9);
  // t = 0.12s -> x = 0.5 -> 0.25 * 2 = 0.5
  const pHalf = SegmentAppearanceTransition.progress(0.12, 0);
  assert.ok(pHalf !== null && Math.abs(pHalf - 0.5) < 1e-9);
  assert.equal(SegmentAppearanceTransition.progress(-0.01, 0), null);
  assert.equal(SegmentAppearanceTransition.progress(0.24, 0), null);
  assert.equal(SegmentAppearanceTransition.progress(Number.NaN, 0), null);

  const segA = makeRecordingSegment({ sourceStart: 0, sourceDuration: 2 });
  const segB = makeRecordingSegment({ sourceStart: 2, sourceDuration: 2 });
  assert.equal(SegmentAppearanceTransition.canSettle(segA, segB), false);

  const styledB = {
    ...segB,
    sceneStyle: makeSegmentSceneStyle({ canvas: makeCanvasStyle({ padding: 40 }) }),
  };
  assert.equal(SegmentAppearanceTransition.canSettle(segA, styledB), true);

  // Full-canvas insert (usesFrameStyle: false) does not settle into adjacent card.
  const fullCanvasInsert = { ...segA, media: { path: 'intro.mp4', usesFrameStyle: false } };
  assert.equal(SegmentAppearanceTransition.settles(fullCanvasInsert), false);
  assert.equal(SegmentAppearanceTransition.canSettle(fullCanvasInsert, styledB), false);
});

test('hexColorMixing, canvasStyleBlend, cameraStyleBlend hand calculations per Swift L146-222', () => {
  // Hand calc (Swift L212-221): #000000 -> #FFFFFF at t=0.5 => round(0.5 * 255) = 128 = 0x80 => #808080
  const mid = hexColorMixing(makeHexColor(0x000000), makeHexColor(0xffffff), 0.5);
  assert.equal(mid.rgb24, 0x808080);
  assert.equal(hexColorMixing(makeHexColor(0x123456), makeHexColor(0x123456), 0.3).rgb24, 0x123456);

  const prevCanvas = makeCanvasStyle({
    padding: 40,
    cornerRadius: 10,
    borderColor: makeHexColor(0x000000),
    backgroundSource: { kind: 'pattern', preset: '黑曜石网格' },
    patternScale: 1.0,
    screenFrame: 'windowLight',
    screenFrameScale: 0.8,
    screenFrameOuterCornerRadius: 10,
  });
  const targetCanvasSame = makeCanvasStyle({
    padding: 120,
    cornerRadius: 30,
    borderColor: makeHexColor(0xffffff),
    backgroundSource: { kind: 'pattern', preset: '黑曜石网格' },
    patternScale: 2.0,
    screenFrame: 'windowLight',
    screenFrameScale: 1.2,
    screenFrameOuterCornerRadius: 30,
  });
  const blended = canvasStyleBlend(targetCanvasSame, prevCanvas, 0.25);
  // Hand calc: padding = 40 + (120 - 40) * 0.25 = 60; patternScale = 1.0 + 1.0 * 0.25 = 1.25
  assert.ok(Math.abs(blended.padding - 60) < 1e-9);
  assert.ok(Math.abs(blended.patternScale - 1.25) < 1e-9);
  assert.ok(Math.abs(blended.screenFrameScale - 0.9) < 1e-9);
  assert.ok(blended.screenFrameOuterCornerRadius !== null);
  assert.ok(Math.abs(blended.screenFrameOuterCornerRadius! - 15) < 1e-9);

  // Mismatched screenFrame / backgroundSource must snap to target rather than interpolate.
  const targetCanvasDiff = makeCanvasStyle({
    backgroundSource: { kind: 'pattern', preset: '工程白网格' },
    patternScale: 3.0,
    screenFrame: 'browserDark',
    screenFrameScale: 1.4,
  });
  const snapped = canvasStyleBlend(targetCanvasDiff, prevCanvas, 0.25);
  assert.equal(snapped.patternScale, 3.0);
  assert.equal(snapped.screenFrameScale, 1.4);

  // Camera blend (including beauty) respects matching vs mismatching isHidden.
  const prevCam = makeCameraStyle({
    size: 0.2,
    beauty: makeCameraBeautySettings({ smoothing: 0.2, whitening: 0.4 }),
  });
  const targetCam = makeCameraStyle({
    size: 0.6,
    beauty: makeCameraBeautySettings({ smoothing: 0.8, whitening: 0.0 }),
  });
  const camMid = cameraStyleBlend(targetCam, prevCam, 0.5);
  assert.ok(Math.abs(camMid.size - 0.4) < 1e-9);
  assert.ok(Math.abs(camMid.beauty.smoothing - 0.5) < 1e-9);
  assert.ok(Math.abs(camMid.beauty.whitening - 0.2) < 1e-9);

  const hiddenCam = { ...targetCam, isHidden: true };
  assert.equal(cameraStyleBlend(hiddenCam, prevCam, 0.5).size, 0.6);
});

test('ProjectTimeline segment boundary lookup and withoutSceneStyles per Swift L66-96, L276-281', () => {
  const s1 = makeRecordingSegment({ sourceStart: 0, sourceDuration: 2, playbackRate: 1 });
  const s2 = {
    ...makeRecordingSegment({ sourceStart: 2, sourceDuration: 4, playbackRate: 2 }),
    sceneStyle: makeSegmentSceneStyle(),
  };
  const timeline = makeProjectTimeline({ sourceSequence: makeSourceSequenceEdited([s1, s2]) });

  // Boundary at output t = 2.0 (s2 start, duration = 2s, ends at 4.0)
  const bAtCut = projectTimelineRecordingSegmentBoundaryAtOutputTime(timeline, 2.0);
  assert.equal(bAtCut.segment?.id, s2.id);
  assert.equal(bAtCut.previous?.id, s1.id);
  assert.equal(bAtCut.start, 2.0);

  // Programme end t = 4.0 still resolves last segment per Swift L92-95.
  const bAtEnd = projectTimelineRecordingSegmentBoundaryAtOutputTime(timeline, 4.0);
  assert.equal(bAtEnd.segment?.id, s2.id);
  assert.equal(bAtEnd.start, 2.0);

  const bInvalid = projectTimelineRecordingSegmentBoundaryAtOutputTime(
    makeProjectTimeline({ sourceSequence: makeSourceSequenceFullRecording() }),
    1.0,
  );
  assert.equal(bInvalid.segment, null);

  const stripped = sourceSequenceWithoutSceneStyles(timeline.sourceSequence);
  assert.equal(stripped.kind, 'edited');
  if (stripped.kind === 'edited') {
    assert.equal((stripped.segments[1] as { sceneStyle?: unknown }).sceneStyle, undefined);
  }
});
