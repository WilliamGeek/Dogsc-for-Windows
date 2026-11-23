// Test for: F:\dogsc-win\src\capture\SegmentedSession.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import {
  buildConcatListFileContent,
  buildLosslessConcatArgs,
  stitchSegmentedPointerTracks,
  buildMarkerHotkeySpec,
  LiveRecordingMarkerRecorder,
  concatMediaSegmentsLossless,
} from '../../src/capture/SegmentedSession.ts';
import { probeMediaFile } from '../../src/capture/MediaProbe.ts';
import { makeNormalizedPoint, makePointerEventRecord } from '../../src/core/ZoomAnimation.ts';

const execFileAsync = promisify(execFile);

test('T15.6: buildConcatListFileContent and buildLosslessConcatArgs normalize Windows paths and escape quotes', () => {
  const listText = buildConcatListFileContent([
    "F:\\dogsc-win\\seg'1\\screen.mp4",
    'F:\\dogsc-win\\seg2\\screen.mp4',
  ]);

  assert.equal(
    listText,
    "file 'F:/dogsc-win/seg'\\''1/screen.mp4'\nfile 'F:/dogsc-win/seg2/screen.mp4'\n"
  );
  assert.throws(() => buildConcatListFileContent([]), /至少一个/);

  const args = buildLosslessConcatArgs('list.txt', 'merged.mp4');
  assert.deepEqual(args, [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    'list.txt',
    '-c',
    'copy',
    'merged.mp4',
  ]);
});

test('T15.6: stitchSegmentedPointerTracks removes pause gaps smoothly across resumed segments', () => {
  const stitched = stitchSegmentedPointerTracks([
    {
      durationSeconds: 3.5,
      events: [
        makePointerEventRecord({ time: 0.5, location: makeNormalizedPoint(0.1, 0.2), kind: 'move' }),
        makePointerEventRecord({
          time: 2.0,
          location: makeNormalizedPoint(0.4, 0.5),
          kind: 'leftClick',
        }),
      ],
    },
    {
      durationSeconds: 2.0,
      events: [
        makePointerEventRecord({
          time: 0.75,
          location: makeNormalizedPoint(0.6, 0.7),
          kind: 'rightClick',
        }),
      ],
    },
    {
      durationSeconds: 1.5,
      events: [
        makePointerEventRecord({
          time: 0.25,
          location: makeNormalizedPoint(0.9, 0.9),
          kind: 'move',
        }),
      ],
    },
  ]);

  assert.equal(stitched.length, 4);
  assert.equal(stitched[0].time, 0.5);
  assert.equal(stitched[1].time, 2.0);
  assert.equal(stitched[2].time, 4.25); // 3.5 + 0.75
  assert.equal(stitched[2].kind, 'rightClick');
  assert.equal(stitched[3].time, 5.75); // 3.5 + 2.0 + 0.25
});

test('T15.6: LiveRecordingMarkerRecorder freezes active clock across pauses and stamps sequential RecordingMarkers', () => {
  const spec = buildMarkerHotkeySpec();
  assert.equal(spec.primary, 'Ctrl+Shift+M');
  assert.equal(spec.fallback, 'F8');

  const recorder = new LiveRecordingMarkerRecorder();
  recorder.start(1000);
  assert.equal(recorder.isPaused(), false);

  const m1 = recorder.stamp(2500);
  assert.equal(m1.number, 1);
  assert.equal(m1.sourceTime, 1.5);
  assert.equal(m1.sourceID, null);

  // Pause at t = 3000ms (2.0s active elapsed), stay paused for 5000ms
  recorder.pause(3000);
  assert.equal(recorder.isPaused(), true);
  recorder.pause(4000); // Idempotent second pause must not reset pausedAtMs
  const m2 = recorder.stamp(6000, 'cam-source-1');
  assert.equal(m2.number, 2);
  assert.equal(m2.sourceTime, 2.0); // Clock remains frozen at pause timestamp
  assert.equal(m2.sourceID, 'cam-source-1');

  // Resume at t = 8000ms, advance 2.5s to 10500ms -> active should be 2.0 + 2.5 = 4.5s
  recorder.resume(8000);
  assert.equal(recorder.isPaused(), false);
  const m3 = recorder.stamp(10500);
  assert.equal(m3.number, 3);
  assert.equal(m3.sourceTime, 4.5);

  const all = recorder.markers();
  assert.equal(all.length, 3);
  all.pop(); // Shallow copy check
  assert.equal(recorder.markers().length, 3);
});

test('T15.6: real ffmpeg losslessly concatenates two MP4 segments via concatMediaSegmentsLossless', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dogsc-concat-mp4-'));
  const seg1 = path.join(tmpDir, 'seg1.mp4');
  const seg2 = path.join(tmpDir, 'seg2.mp4');
  const merged = path.join(tmpDir, 'screen.mp4');

  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=320x240:rate=30',
        '-t',
        '1',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        seg1,
      ],
      { timeout: 15_000 }
    );
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=320x240:rate=30',
        '-t',
        '1',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        seg2,
      ],
      { timeout: 15_000 }
    );

    const out = await concatMediaSegmentsLossless([seg1, seg2], merged);
    assert.equal(out, path.resolve(merged));

    const probed = await probeMediaFile(merged);
    assert.equal(probed.width, 320);
    assert.equal(probed.height, 240);
    assert.ok(
      probed.durationSeconds >= 1.8 && probed.durationSeconds <= 2.3,
      `unexpected merged duration: ${probed.durationSeconds}`
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
