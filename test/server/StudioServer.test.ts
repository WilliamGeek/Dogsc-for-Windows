// Test for: F:\dogsc-win\src\server\StudioServer.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { get as httpGet } from 'node:http';
import {
  validateRecordingId,
  resolveExportSpec,
  startStudioServer,
  type StudioServerHandle,
} from '../../src/server/StudioServer.ts';
import {
  makeRecorderProject,
  encodeRecorderProject,
} from '../../src/core/ProjectMediaModel.ts';
import { makeCanvasStyle } from '../../src/core/ProjectModel.ts';

function rawGet(port: number, rawPath: string): Promise<{ status: number; body: string; headers: any }> {
  return new Promise((resolvePromise, reject) => {
    const req = httpGet({ hostname: '127.0.0.1', port, path: rawPath }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on('error', reject);
  });
}

test('T16.1: validateRecordingId accepts valid session IDs and blocks traversal or legacy dir', () => {
  assert.equal(validateRecordingId('20261120-175917'), true);
  assert.equal(validateRecordingId('session_01-a.b'), true);
  assert.equal(validateRecordingId('_legacy-invalid'), false);
  assert.equal(validateRecordingId('..'), false);
  assert.equal(validateRecordingId('.hidden'), false);
  assert.equal(validateRecordingId('foo/bar'), false);
  assert.equal(validateRecordingId('foo\\bar'), false);
  assert.equal(validateRecordingId(''), false);
});

test('T16.1: resolveExportSpec computes accurate dimensions and bitrates for 1080p, 1440p, 4K, 9:16 and M4A', () => {
  const baseProject = makeRecorderProject({
    canvas: makeCanvasStyle({ aspectRatio: '16:9' }),
  });
  const meta = { width: 2176, height: 1812, fps: 60, durationSeconds: 10 };

  const spec1080 = resolveExportSpec({
    project: baseProject,
    meta,
    resolution: '1080p',
    fps: 60,
    quality: 'high',
    includesAudio: true,
  });
  assert.equal(spec1080.width, 1920);
  assert.equal(spec1080.height, 1080);
  assert.equal(spec1080.fps, 60);
  assert.ok(spec1080.estimatedBytes > 10_000_000);

  const spec4k = resolveExportSpec({
    project: baseProject,
    meta,
    resolution: '4K',
    fps: 30,
    quality: 'maximum',
  });
  assert.equal(spec4k.width, 3840);
  assert.equal(spec4k.height, 2160);
  assert.ok(spec4k.estimatedBytes > spec1080.estimatedBytes);

  const portraitProject = makeRecorderProject({
    canvas: makeCanvasStyle({ aspectRatio: '9:16' }),
  });
  const specPortrait = resolveExportSpec({
    project: portraitProject,
    meta,
    resolution: '1440p',
    fps: 30,
  });
  assert.equal(specPortrait.width, 1440);
  assert.equal(specPortrait.height, 2560);

  const specM4a = resolveExportSpec({
    project: baseProject,
    meta,
    format: 'm4a',
  });
  assert.equal(specM4a.format, 'm4a');
  assert.equal(specM4a.estimatedBytes, Math.round((192_000 * 10) / 8));
});

test('T16.1: StudioServer lists sessions, validates atomic project PUT, serves stripped TS, and blocks traversal', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dogsc-studio-srv-'));
  const recDir = path.join(tmpDir, 'recordings');
  const sessDir = path.join(recDir, '20261123-100000');
  const legacyDir = path.join(recDir, '_legacy-invalid');
  await fs.mkdir(path.join(sessDir, 'frames'), { recursive: true });
  await fs.mkdir(legacyDir, { recursive: true });

  const project = makeRecorderProject({ title: 'Studio Test Session' });
  await fs.writeFile(
    path.join(sessDir, 'meta.json'),
    JSON.stringify({
      id: '20261123-100000',
      fps: 60,
      width: 1920,
      height: 1080,
      durationSeconds: 3.5,
      frameCount: 210,
      pointerOffsetSeconds: 0.1,
    }),
    'utf8'
  );
  await fs.writeFile(path.join(sessDir, 'project.json'), encodeRecorderProject(project), 'utf8');
  await fs.writeFile(path.join(sessDir, 'screen.mp4'), 'FAKE_MP4', 'utf8');
  await fs.writeFile(
    path.join(sessDir, 'pointer.jsonl'),
    '{"hdr":1,"originUnixMs":1762000000000,"screen":{"x":0,"y":0,"w":1920,"h":1080}}\n{"t":1.0,"x":960,"y":540,"k":"leftClick"}\n',
    'utf8'
  );
  await fs.writeFile(path.join(sessDir, 'frames', '000001.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  let handle: StudioServerHandle | null = null;
  try {
    handle = await startStudioServer({
      rootDir: path.resolve('F:\\dogsc-win'),
      recordingsDir: recDir,
      allowShellOpen: false,
    });

    const base = `http://127.0.0.1:${handle.port}`;

    // 1. List recordings (excludes _legacy-invalid)
    const listRes = await fetch(`${base}/api/recordings`);
    assert.equal(listRes.status, 200);
    const listJson = (await listRes.json()) as any;
    assert.equal(listJson.recordings.length, 1);
    assert.equal(listJson.recordings[0].id, '20261123-100000');
    assert.equal(listJson.recordings[0].title, 'Studio Test Session');

    // 2. Get session detail
    const detailRes = await fetch(`${base}/api/recordings/20261123-100000`);
    assert.equal(detailRes.status, 200);
    const detail = (await detailRes.json()) as any;
    assert.equal(detail.pointerEvents.length, 1);
    assert.ok(Math.abs(detail.pointerEvents[0].time - 1.1) < 1e-6);

    // 3. Reject invalid ProjectValidator save
    const badProject = JSON.parse(encodeRecorderProject(project));
    badProject.canvas.padding = -100;
    const badRes = await fetch(`${base}/api/recordings/20261123-100000/project`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(badProject),
    });
    assert.equal(badRes.status, 400);

    // 4. Atomic valid save updates project.json
    const goodProject = JSON.parse(encodeRecorderProject(project));
    goodProject.canvas.cornerRadius = 28;
    goodProject.title = 'Updated Studio Title';
    const goodRes = await fetch(`${base}/api/recordings/20261123-100000/project`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(goodProject),
    });
    assert.equal(goodRes.status, 200);
    const savedOnDisk = JSON.parse(await fs.readFile(path.join(sessDir, 'project.json'), 'utf8'));
    assert.equal(savedOnDisk.canvas.cornerRadius, 28);
    assert.equal(savedOnDisk.title, 'Updated Studio Title');

    // 5. Serving frames & blocking traversal
    const frameOk = await fetch(`${base}/recordings/20261123-100000/frames/000001.jpg`);
    assert.equal(frameOk.status, 200);
    const frameEscape = await rawGet(handle.port, '/recordings/20261123-100000/frames/%2e%2e%5Cmeta.json');
    assert.equal(frameEscape.status, 403);
    const rootEscape = await rawGet(handle.port, '/../package.json');
    assert.equal(rootEscape.status, 403);

    // 6. On-the-fly stripped TypeScript ESM serving
    const tsRes = await rawGet(handle.port, '/src/core/swift.ts');
    assert.equal(tsRes.status, 200);
    assert.ok(tsRes.headers['content-type'].includes('javascript'));
    assert.ok(!tsRes.body.includes(': number'));
  } finally {
    if (handle) await handle.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
