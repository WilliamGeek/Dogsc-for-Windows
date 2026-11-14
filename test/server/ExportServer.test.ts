// Test for: F:\dogsc-win\src\server\ExportServer.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildExportFfmpegArgs,
  startExportServer,
  type ExportServerHandle,
} from '../../src/server/ExportServer.ts';

test('T11.6: buildExportFfmpegArgs constructs rawvideo RGBA vflip arguments for nvenc and libx264', () => {
  const nvenc = buildExportFfmpegArgs({
    width: 1920,
    height: 1080,
    fps: 60,
    encoder: 'h264_nvenc',
    outFile: 'out.mp4',
  });
  assert.ok(nvenc.includes('rawvideo'));
  assert.ok(nvenc.includes('rgba'));
  assert.ok(nvenc.includes('1920x1080'));
  assert.ok(nvenc.includes('vflip'));
  assert.ok(nvenc.includes('h264_nvenc'));
  assert.equal(nvenc[nvenc.length - 1], 'out.mp4');

  const x264 = buildExportFfmpegArgs({
    width: 1280,
    height: 720,
    fps: 30,
    encoder: 'libx264',
    outFile: 'out720.mp4',
  });
  assert.ok(x264.includes('libx264'));
  assert.ok(x264.includes('1280x720'));
  assert.ok(x264.includes('vflip'));
});

test('T11.6: ExportServer enforces frame byte length (400), strict sequence (409), and counts frames through fake ffmpeg stdin', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dogsc-export-srv-'));
  let server: ExportServerHandle | null = null;

  try {
    const width = 4;
    const height = 2;
    const expectedLen = width * height * 4; // 32 bytes per frame

    server = await startExportServer({
      rootDir: path.resolve('F:\\dogsc-win'),
      framesDir: tmpDir,
      outFile: path.join(tmpDir, 'mock.mp4'),
      plan: {
        fps: 60,
        width,
        height,
        frameCount: 3,
        sourceFrameCount: 3,
        durationSeconds: 0.05,
        framesBaseUrl: '/frames',
        project: {},
        pointerEvents: [],
      },
      ffmpegCommand: {
        command: process.execPath,
        args: ['-e', 'process.stdin.resume(); process.stdin.on("end", () => process.exit(0));'],
      },
    });

    const base = `http://127.0.0.1:${server.port}`;

    // 1. GET /api/plan
    const planRes = await fetch(`${base}/api/plan`, { headers: { Connection: 'close' } });
    assert.equal(planRes.status, 200);
    const planJson: any = await planRes.json();
    assert.equal(planJson.frameCount, 3);
    assert.equal(planJson.width, width);
    assert.equal(planJson.height, height);

    // 2. Wrong byte length -> 400
    const badLenRes = await fetch(`${base}/api/frame/0`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Connection: 'close' },
      body: new Uint8Array(10),
    });
    assert.equal(badLenRes.status, 400);
    assert.equal(server.receivedFrames(), 0);

    // 3. Out-of-order frame 1 before frame 0 -> 409
    const oooRes = await fetch(`${base}/api/frame/1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Connection: 'close' },
      body: new Uint8Array(expectedLen),
    });
    assert.equal(oooRes.status, 409);
    assert.equal(server.receivedFrames(), 0);

    // 4. Send frames 0, 1, 2 sequentially -> 200
    for (let n = 0; n < 3; n++) {
      const frameBuf = new Uint8Array(expectedLen).fill(n + 1);
      const okRes = await fetch(`${base}/api/frame/${n}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', Connection: 'close' },
        body: frameBuf,
      });
      assert.equal(okRes.status, 200);
    }
    assert.equal(server.receivedFrames(), 3);

    // 5. Out-of-order frame 1 after frame 2 -> 409
    const dupRes = await fetch(`${base}/api/frame/1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Connection: 'close' },
      body: new Uint8Array(expectedLen),
    });
    assert.equal(dupRes.status, 409);

    // 6. POST /api/done -> 200 and waitForDone resolves with receivedFrames === 3
    const doneRes = await fetch(`${base}/api/done`, {
      method: 'POST',
      headers: { Connection: 'close' },
    });
    assert.equal(doneRes.status, 200);
    const doneResult = await server.waitForDone();
    assert.equal(doneResult.receivedFrames, 3);
  } finally {
    if (server) {
      await server.close();
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
