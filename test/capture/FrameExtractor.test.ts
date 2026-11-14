// Test for: F:\dogsc-win\src\capture\FrameExtractor.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { buildExtractArgs, extractFrames } from '../../src/capture/FrameExtractor.ts';

test('T11.3: buildExtractArgs generates correct ffmpeg arguments and sequential %06d.jpg pattern', () => {
  const args = buildExtractArgs({
    video: 'C:\\test\\screen.mp4',
    outDir: 'C:\\test\\frames',
    fps: 60,
  });

  assert.deepEqual(args.slice(0, 4), ['-y', '-i', 'C:\\test\\screen.mp4', '-vf']);
  assert.equal(args[4], 'fps=60');
  assert.equal(args[5], '-q:v');
  assert.equal(args[6], '2');
  assert.ok(args[7].endsWith(path.join('frames', '%06d.jpg')));
});

test('T11.3: buildExtractArgs falls back to default 60 fps for non-positive fps', () => {
  const args = buildExtractArgs({
    video: 'video.mp4',
    outDir: 'frames',
    fps: 0,
  });

  assert.equal(args[4], 'fps=60');
});

test('T11.3: extractFrames rejects when source video file does not exist', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dogsc-test-extract-'));
  try {
    await assert.rejects(
      async () => {
        await extractFrames({
          video: path.join(tmpDir, 'non_existent.mp4'),
          outDir: path.join(tmpDir, 'frames'),
          fps: 60,
        });
      },
      /ffmpeg exited with code/
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('T11.3: E2E extractFrames extracts sequential frames from recorded video', { skip: !process.env.DOGSC_E2E }, async () => {
  const videoPath = 'F:\\dogsc-win\\recordings\\20261114-184749\\screen.mp4';
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dogsc-e2e-frames-'));
  try {
    const count = await extractFrames({
      video: videoPath,
      outDir: tmpDir,
      fps: 10,
    });

    assert.ok(count > 0, 'Extracted count should be > 0');
    const firstFrame = path.join(tmpDir, '000001.jpg');
    const stat = await fs.stat(firstFrame);
    assert.ok(stat.size > 1000, 'First frame size should be > 1KB');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
