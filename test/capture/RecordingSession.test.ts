// Test for: F:\dogsc-win\src\capture\RecordingSession.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildMeta,
  buildProjectFromRecording,
  recordSession,
  formatSessionId,
  allocateUniqueSessionDir,
} from '../../src/capture/RecordingSession.ts';
import { probeMediaFile } from '../../src/capture/MediaProbe.ts';
import {
  makePointerEventRecord,
  makeNormalizedPoint,
  type PointerEventRecord,
} from '../../src/core/ZoomAnimation.ts';
import { ProjectValidator } from '../../src/core/ProjectValidator.ts';

test('T10.4: buildMeta correctly calculates pointerOffsetSeconds and preserves fields', () => {
  const meta = buildMeta({
    id: '20261102-120000',
    fps: 60,
    width: 1920,
    height: 1080,
    screenStartUnixMs: 1762000000000,
    pointerOriginUnixMs: 1762000000250, // Hook started 250ms after screen recording
    encoder: 'h264_nvenc',
    durationSeconds: 10.5,
    frameCount: 630,
  });

  assert.equal(meta.id, '20261102-120000');
  assert.equal(meta.fps, 60);
  assert.equal(meta.width, 1920);
  assert.equal(meta.height, 1080);
  assert.equal(meta.screenStartUnixMs, 1762000000000);
  assert.equal(meta.pointerOriginUnixMs, 1762000000250);
  assert.equal(meta.pointerOffsetSeconds, 0.25);
  assert.equal(meta.encoder, 'h264_nvenc');
  assert.equal(meta.durationSeconds, 10.5);
  assert.equal(meta.frameCount, 630);
});

test('T12.7: buildMeta measures pointer offset from first captured frame', () => {
  const meta = buildMeta({
    id: '20261120-180000',
    fps: 60,
    width: 1920,
    height: 1080,
    screenStartUnixMs: 1762000000000,
    spawnUnixMs: 1762000000000,
    firstFrameUnixMs: 1762000000180,
    pointerOriginUnixMs: 1762000000250,
    encoder: 'h264_nvenc',
    durationSeconds: 5,
    frameCount: 300,
  });

  assert.equal(meta.firstFrameUnixMs, 1762000000180);
  assert.equal(meta.spawnUnixMs, 1762000000000);
  assert.equal(meta.pointerOffsetSeconds, 0.07);
});

test('T10.4: buildProjectFromRecording offsets event times and generates valid RecorderProject with 3 zoom clips', () => {
  const events: PointerEventRecord[] = [
    // Click 1 at t = 1.0
    makePointerEventRecord({ time: 0.8, location: makeNormalizedPoint(0.2, 0.2), kind: 'move' }),
    makePointerEventRecord({ time: 1.0, location: makeNormalizedPoint(0.25, 0.25), kind: 'leftClick' }),
    makePointerEventRecord({ time: 1.2, location: makeNormalizedPoint(0.26, 0.26), kind: 'move' }),

    // Click 2 at t = 4.0
    makePointerEventRecord({ time: 3.8, location: makeNormalizedPoint(0.5, 0.5), kind: 'move' }),
    makePointerEventRecord({ time: 4.0, location: makeNormalizedPoint(0.55, 0.55), kind: 'leftClick' }),
    makePointerEventRecord({ time: 4.2, location: makeNormalizedPoint(0.56, 0.56), kind: 'move' }),

    // Click 3 at t = 7.0
    makePointerEventRecord({ time: 6.8, location: makeNormalizedPoint(0.8, 0.8), kind: 'move' }),
    makePointerEventRecord({ time: 7.0, location: makeNormalizedPoint(0.85, 0.85), kind: 'leftClick' }),
    makePointerEventRecord({ time: 7.2, location: makeNormalizedPoint(0.86, 0.86), kind: 'move' }),
  ];

  const offset = 0.5; // Offset by +0.5s
  const project = buildProjectFromRecording(events, offset, 10.0);

  // AutoZoomPlanner should generate 3 clips corresponding to shifted click times (1.5, 4.5, 7.5)
  assert.equal(project.zoomAnimations.length, 3);
  assert.equal(project.timeline.zoomClips.length, 3);

  // Pre-roll start time: clickTime - 0.7 * 0.18 = (1.0 + 0.5) - 0.126 = 1.374
  assert.ok(Math.abs(project.zoomAnimations[0].startTime - 1.374) < 1e-6);
  assert.ok(Math.abs(project.zoomAnimations[1].startTime - 4.374) < 1e-6);
  assert.ok(Math.abs(project.zoomAnimations[2].startTime - 7.374) < 1e-6);

  // Strict domain validator must accept the project without throwing
  assert.doesNotThrow(() => ProjectValidator.validate(project));
});

test('T10.4: formatSessionId produces YYYYMMDD-HHmmss format', () => {
  const d = new Date(2026, 10, 2, 9, 5, 8); // month 10 = Nov
  assert.equal(formatSessionId(d), '20261102-090508');
});

test('T12.2: allocateUniqueSessionDir avoids same-second collisions', () => {
  const base = resolve('out', `t122-unique-${process.pid}-${Date.now()}`);
  mkdirSync(base, { recursive: true });

  try {
    assert.equal(allocateUniqueSessionDir(base, '20261102-120000'), resolve(base, '20261102-120000'));

    mkdirSync(resolve(base, '20261102-120000'));
    assert.equal(
      allocateUniqueSessionDir(base, '20261102-120000'),
      resolve(base, '20261102-120000-01')
    );

    mkdirSync(resolve(base, '20261102-120000-01'));
    assert.equal(
      allocateUniqueSessionDir(base, '20261102-120000'),
      resolve(base, '20261102-120000-02')
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('T12.5: recordSession rejects an injected out-of-range display before creating a session', async () => {
  const base = resolve('out', `t125-bad-display-${process.pid}-${Date.now()}`);
  const displays = [
    {
      index: 0,
      deviceName: '\\\\.\\DISPLAY1',
      isPrimary: true,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    },
  ];

  await assert.rejects(
    recordSession({ seconds: 1, outputIdx: 9, displays, baseDir: base }),
    /显示器索引越界/
  );
  assert.equal(existsSync(base), false, 'invalid display must fail before mkdir');
});

test(
  'T12.2: E2E invalid display rejects and removes the partial session directory',
  { skip: !process.env.DOGSC_E2E },
  async () => {
    const base = resolve('out', `t122-invalid-${process.pid}-${Date.now()}`);
    mkdirSync(base, { recursive: true });

    try {
      await assert.rejects(
        recordSession({ seconds: 1, fps: 30, outputIdx: 9, baseDir: base }),
        /ffmpeg|DXGI|ddagrab|display|显示器|索引/i
      );
      assert.deepEqual(readdirSync(base), [], 'failed session directory must be removed');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }
);

test(
  'T10.4: E2E recordSession creates directory with all 4 artifacts',
  { skip: !process.env.DOGSC_E2E },
  async () => {
    let sessionDir: string | null = null;
    try {
      sessionDir = await recordSession({ seconds: 2, baseDir: 'out/recordings_test' });
      assert.ok(existsSync(sessionDir), 'Session directory exists');
      assert.ok(existsSync(`${sessionDir}/screen.mp4`), 'screen.mp4 exists');
      assert.ok(existsSync(`${sessionDir}/pointer.jsonl`), 'pointer.jsonl exists');
      assert.ok(existsSync(`${sessionDir}/meta.json`), 'meta.json exists');
      assert.ok(existsSync(`${sessionDir}/project.json`), 'project.json exists');

      const meta = JSON.parse(readFileSync(`${sessionDir}/meta.json`, 'utf-8'));
      const probed = await probeMediaFile(`${sessionDir}/screen.mp4`);
      assert.ok(
        Math.abs(meta.durationSeconds - probed.durationSeconds) <= 0.05,
        `meta duration ${meta.durationSeconds}s should match ffprobe ${probed.durationSeconds}s`
      );
      assert.equal(meta.frameCount, probed.frameCount, 'meta frameCount should match ffprobe');
      assert.equal(meta.width, probed.width, 'meta width should match ffprobe');
      assert.equal(meta.height, probed.height, 'meta height should match ffprobe');
    } finally {
      if (sessionDir && existsSync(sessionDir)) {
        rmSync(sessionDir, { recursive: true, force: true });
      }
    }
  }
);
