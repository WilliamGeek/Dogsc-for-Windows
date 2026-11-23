// Test for: F:\dogsc-win\src\capture\CameraRecorder.ts & ExportServer /camera_frames

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { get as httpGet } from 'node:http';
import {
  buildCameraFfmpegArgs,
  computeCameraOffsetSeconds,
  buildCameraSyncAnchor,
  startCameraRecording,
} from '../../src/capture/CameraRecorder.ts';
import { buildMeta } from '../../src/capture/RecordingSession.ts';
import { startExportServer, type ExportServerHandle } from '../../src/server/ExportServer.ts';

function rawGet(port: number, rawPath: string): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolvePromise, reject) => {
    const req = httpGet({ hostname: '127.0.0.1', port, path: rawPath }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () =>
        resolvePromise({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) })
      );
    });
    req.on('error', reject);
  });
}

test('T15.4: buildCameraFfmpegArgs builds DirectShow video args with showinfo and optional size', () => {
  const withSize = buildCameraFfmpegArgs({
    deviceName: 'HP True Vision FHD Camera',
    outFile: 'camera.mp4',
    fps: 30,
    width: 1280,
    height: 720,
    encoder: 'libx264',
  });
  assert.ok(withSize.includes('-f'));
  assert.ok(withSize.includes('dshow'));
  assert.ok(withSize.includes('-video_size'));
  assert.ok(withSize.includes('1280x720'));
  assert.ok(withSize.includes('video=HP True Vision FHD Camera'));
  assert.ok(withSize.some((a) => a.includes('showinfo')));
  assert.ok(withSize.includes('libx264'));
  assert.equal(withSize[withSize.length - 1], 'camera.mp4');

  const nvencDefault = buildCameraFfmpegArgs({
    deviceName: 'Logitech StreamCam',
    outFile: 'cam_nvenc.mp4',
    encoder: 'h264_nvenc',
  });
  assert.ok(!nvencDefault.includes('-video_size'));
  assert.ok(nvencDefault.includes('h264_nvenc'));
  assert.ok(nvencDefault.includes('video=Logitech StreamCam'));

  assert.throws(
    () => buildCameraFfmpegArgs({ deviceName: '   ', outFile: 'cam.mp4' }),
    /deviceName/i
  );
});

test('T15.4: computeCameraOffsetSeconds and buildCameraSyncAnchor compute exact signed sync', () => {
  assert.equal(computeCameraOffsetSeconds(1762000000420, 1762000000100), 0.32);
  assert.equal(computeCameraOffsetSeconds(1762000000000, 1762000000150), -0.15);
  assert.equal(computeCameraOffsetSeconds(Number.NaN, 1762000000100), 0);

  const anchor = buildCameraSyncAnchor(1762000000420, 1762000000100);
  assert.equal(anchor.sourceTime, 0);
  assert.equal(anchor.offset, 0.32);

  // Respects MediaSyncAnchor [-10, 10] clamp
  const clamped = buildCameraSyncAnchor(1762000025000, 1762000000000);
  assert.equal(clamped.offset, 10);
});

test('T15.4: startCameraRecording resolves ready from stderr showinfo n:0 and shuts down cleanly on q', async () => {
  const script = [
    'process.stderr.write("[Parsed_showinfo_0 @ 0x1] n:   0 pts:      0 pts_time:0.000000 pos:123\\n");',
    'let buf = "";',
    'process.stdin.on("data", (d) => {',
    '  buf += d.toString();',
    '  if (buf.includes("q")) process.exit(0);',
    '});',
  ].join('\n');

  const handle = startCameraRecording({
    deviceName: 'Fake Cam',
    outFile: 'fake-cam.mp4',
    fps: 30,
    encoder: 'libx264',
    ffmpegBin: process.execPath,
    ffmpegArgsPrefix: ['-e', script, '--'],
  });

  const firstFrameMs = await handle.ready;
  assert.ok(Number.isFinite(firstFrameMs));
  assert.ok(firstFrameMs >= handle.cameraStartUnixMs - 50);
  assert.equal(handle.firstFrameUnixMs, firstFrameMs);

  await handle.stop();
  const exit = await handle.exited;
  assert.equal(exit.code, 0);
});

test('T15.4: buildMeta preserves multi-source audio and camera metadata fields when present', () => {
  const meta = buildMeta({
    id: '20261123-050000',
    fps: 60,
    width: 1920,
    height: 1080,
    screenStartUnixMs: 1762000000000,
    firstFrameUnixMs: 1762000000100,
    pointerOriginUnixMs: 1762000000150,
    encoder: 'h264_nvenc',
    durationSeconds: 5,
    frameCount: 300,
    systemAudioFile: 'system-audio.wav',
    systemAudioOffsetSeconds: -0.02,
    micAudioFile: 'mic-audio.wav',
    micAudioOffsetSeconds: 0.04,
    cameraFile: 'camera.mp4',
    cameraOffsetSeconds: 0.12,
  });

  assert.equal(meta.systemAudioFile, 'system-audio.wav');
  assert.equal(meta.systemAudioOffsetSeconds, -0.02);
  assert.equal(meta.micAudioFile, 'mic-audio.wav');
  assert.equal(meta.micAudioOffsetSeconds, 0.04);
  assert.equal(meta.cameraFile, 'camera.mp4');
  assert.equal(meta.cameraOffsetSeconds, 0.12);
});

test('T15.4: ExportServer serves /camera_frames/<name> and blocks traversal outside cameraFramesDir', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dogsc-cam-frames-'));
  const framesDir = path.join(tmpDir, 'frames');
  const camDir = path.join(tmpDir, 'camera_frames');
  const siblingDir = `${camDir}-secret`;

  await fs.mkdir(framesDir, { recursive: true });
  await fs.mkdir(camDir, { recursive: true });
  await fs.mkdir(siblingDir, { recursive: true });
  const fakeJpg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  await fs.writeFile(path.join(camDir, '000001.jpg'), fakeJpg);
  await fs.writeFile(path.join(siblingDir, 'leak.jpg'), 'SECRET', 'utf-8');

  let server: ExportServerHandle | null = null;
  try {
    server = await startExportServer({
      rootDir: path.resolve('F:\\dogsc-win'),
      framesDir,
      cameraFramesDir: camDir,
      outFile: path.join(tmpDir, 'out.mp4'),
      plan: {
        fps: 60,
        width: 4,
        height: 2,
        frameCount: 1,
        sourceFrameCount: 1,
        durationSeconds: 0.016,
        framesBaseUrl: '/frames',
        cameraFramesBaseUrl: '/camera_frames',
        project: {},
        pointerEvents: [],
      },
      ffmpegCommand: {
        command: process.execPath,
        args: ['-e', 'process.stdin.resume();'],
      },
    });

    const planRes = await rawGet(server.port, '/api/plan');
    assert.equal(planRes.status, 200);
    const planJson = JSON.parse(planRes.body.toString('utf8'));
    assert.equal(planJson.cameraFramesBaseUrl, '/camera_frames');

    const okRes = await rawGet(server.port, '/camera_frames/000001.jpg');
    assert.equal(okRes.status, 200);
    assert.deepEqual(okRes.body, fakeJpg);

    const missingRes = await rawGet(server.port, '/camera_frames/000099.jpg');
    assert.equal(missingRes.status, 404);

    const escapeRes = await rawGet(
      server.port,
      `/camera_frames/%2e%2e%5C${path.basename(siblingDir)}/leak.jpg`
    );
    assert.equal(escapeRes.status, 403);
    assert.ok(!escapeRes.body.toString('utf8').includes('SECRET'));
  } finally {
    if (server) await server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(siblingDir, { recursive: true, force: true });
  }
});
