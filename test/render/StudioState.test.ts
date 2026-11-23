// Test for: F:\dogsc-win\web\studio\state.ts & web/studio/*.ts TS stripping / zero node:* guard

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import {
  StudioHistory,
  computeTimelineOutputDuration,
  resolveTimelineSegments,
  splitSegmentAtTime,
  deleteSegmentById,
  setSegmentPlaybackRate,
  addZoomClipAtTime,
  moveZoomClipById,
  resizeZoomClipById,
  updateZoomClipById,
  deleteZoomClipById,
  addMosaicClipAtTime,
  moveMosaicClipById,
  updateMosaicClipById,
  deleteMosaicClipById,
  recomputeAutoZoomClips,
} from '../../web/studio/state.ts';
import { makeRecorderProject } from '../../src/core/ProjectMediaModel.ts';
import { ProjectValidator } from '../../src/core/ProjectValidator.ts';
import { makeNormalizedPoint, makePointerEventRecord } from '../../src/core/ZoomAnimation.ts';

test('T16.3: StudioHistory records undo/redo stack and preserves ProjectValidator validity', () => {
  const history = new StudioHistory(5);
  const p0 = makeRecorderProject({ title: 'Initial' });
  const p1 = { ...p0, title: 'Step 1' };
  const p2 = { ...p0, title: 'Step 2' };

  assert.equal(history.canUndo(), false);
  history.push(p0);
  history.push(p1);
  assert.equal(history.canUndo(), true);
  assert.equal(history.canRedo(), false);

  const undone = history.undo(p2);
  assert.ok(undone);
  assert.equal(undone.title, 'Step 1');
  assert.equal(history.canRedo(), true);

  const redone = history.redo(undone);
  assert.ok(redone);
  assert.equal(redone.title, 'Step 2');
  assert.doesNotThrow(() => ProjectValidator.validate(redone));
});

test('T16.3: segment split, playback rate retime, and delete validate against ProjectValidator', () => {
  const sourceDur = 10;
  let proj = makeRecorderProject();
  assert.equal(computeTimelineOutputDuration(proj, sourceDur), 10);

  // Split at 4s -> [0..4s, 4..10s]
  const splitRes = splitSegmentAtTime(proj, sourceDur, 4);
  proj = splitRes.project;
  assert.doesNotThrow(() => ProjectValidator.validate(proj));
  let segs = resolveTimelineSegments(proj, sourceDur);
  assert.equal(segs.length, 2);
  assert.ok(Math.abs(segs[0].outputDuration - 4) < 1e-6);
  assert.ok(Math.abs(segs[1].outputDuration - 6) < 1e-6);

  // Speed up segment 2 to 2x -> output duration becomes 4 + 3 = 7s
  const rateRes = setSegmentPlaybackRate(proj, sourceDur, segs[1].id, 2);
  proj = rateRes.project;
  assert.doesNotThrow(() => ProjectValidator.validate(proj));
  assert.ok(Math.abs(computeTimelineOutputDuration(proj, sourceDur) - 7) < 1e-6);

  // Delete segment 1 -> only segment 2 remains (3s), cannot delete final segment
  segs = resolveTimelineSegments(proj, sourceDur);
  const delRes = deleteSegmentById(proj, sourceDur, segs[0].id);
  proj = delRes.project;
  assert.doesNotThrow(() => ProjectValidator.validate(proj));
  assert.equal(resolveTimelineSegments(proj, sourceDur).length, 1);

  assert.throws(
    () => deleteSegmentById(proj, sourceDur, resolveTimelineSegments(proj, sourceDur)[0].id),
    /至少需要保留/
  );
});

test('T16.3: zoom & mosaic clip creation, move, resize, auto-zoom recompute, and delete stay valid', () => {
  const duration = 12;
  let proj = makeRecorderProject();

  const addedZoom = addZoomClipAtTime(proj, duration, 2.0, { x: 0.3, y: 0.4 });
  proj = addedZoom.project;
  assert.doesNotThrow(() => ProjectValidator.validate(proj));
  assert.equal(proj.timeline.zoomClips.length, 1);
  const zoomId = proj.timeline.zoomClips[0].id;

  const moved = moveZoomClipById(proj, duration, zoomId, 3.0);
  proj = moved.project;
  assert.doesNotThrow(() => ProjectValidator.validate(proj));
  assert.ok(Math.abs(proj.timeline.zoomClips[0].startTime - 3.0) < 1e-6);

  const resized = resizeZoomClipById(proj, duration, zoomId, 'right', 6.5);
  proj = resized.project;
  assert.doesNotThrow(() => ProjectValidator.validate(proj));
  assert.ok(Math.abs(proj.timeline.zoomClips[0].endTime - 6.5) < 1e-6);

  const patched = updateZoomClipById(proj, zoomId, { scale: 2.2, focus: { x: 0.75, y: 0.25 } });
  proj = patched.project;
  assert.equal(proj.timeline.zoomClips[0].scale, 2.2);
  assert.equal(proj.timeline.zoomClips[0].focus.x, 0.75);

  const delZoom = deleteZoomClipById(proj, zoomId);
  proj = delZoom.project;
  assert.equal(proj.timeline.zoomClips.length, 0);

  // Mosaic clip operations
  const addedMos = addMosaicClipAtTime(proj, duration, 1.0, 'spotlight');
  proj = addedMos.project;
  assert.equal(proj.timeline.mosaicClips.length, 1);
  const mosId = proj.timeline.mosaicClips[0].id;

  proj = moveMosaicClipById(proj, duration, mosId, 4.0).project;
  assert.ok(Math.abs(proj.timeline.mosaicClips[0].timing.startTime - 4.0) < 1e-6);

  proj = updateMosaicClipById(proj, mosId, { style: 'blur', intensity: 0.8 }).project;
  assert.equal(proj.timeline.mosaicClips[0].style, 'blur');
  assert.equal(proj.timeline.mosaicClips[0].intensity, 0.8);

  proj = deleteMosaicClipById(proj, mosId).project;
  assert.equal(proj.timeline.mosaicClips.length, 0);

  // Recompute auto-zoom from pointer clicks
  const clicks = [
    makePointerEventRecord({ time: 1.5, location: makeNormalizedPoint(0.2, 0.3), kind: 'leftClick' }),
    makePointerEventRecord({ time: 5.5, location: makeNormalizedPoint(0.8, 0.7), kind: 'leftClick' }),
  ];
  proj = recomputeAutoZoomClips(proj, clicks).project;
  assert.doesNotThrow(() => ProjectValidator.validate(proj));
  assert.equal(proj.timeline.zoomClips.length, 2);
});

test('T16.3: all web/studio/*.ts modules strip cleanly and have ZERO node:* imports', () => {
  const studioDir = resolve('F:\\dogsc-win\\web\\studio');
  const entries = readdirSync(studioDir).filter((f) => f.endsWith('.ts'));
  assert.ok(entries.length >= 4);

  for (const name of entries) {
    const full = join(studioDir, name);
    const code = readFileSync(full, 'utf8');
    assert.equal(/['"]node:/.test(code), false, `${name} must not import node:*`);
    assert.doesNotThrow(() => stripTypeScriptTypes(code), `${name} failed stripTypeScriptTypes`);
  }
});
