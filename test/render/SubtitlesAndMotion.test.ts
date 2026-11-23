// Test for: F:\dogsc-win\web\passes\subtitles.ts, htmlMotion.ts, background.ts, ExportServer.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  computeAspectFillUvRect,
  dispatchSceneLayers,
  resolveActiveSubtitleState,
  resolveSubtitleFontFamily,
  HTML_MOTION_TEMPLATES,
  buildDmhtmlDocument,
  parseDmhtmlMeta,
  computeMotionEnvelope,
  resolveMotionClipRenderSpec,
} from '../../web/renderer.ts';
import { makeFramePlan } from '../../src/render/FramePlan.ts';
import { makeFrameAnimationSceneFromClip, makeFrameSubtitleScene } from '../../src/core/FrameScene.ts';
import { makeSubtitleCue, makeSubtitleStyle } from '../../src/core/PostProductionModel.ts';
import { makeAnimationClip, makeOverlayTiming } from '../../src/core/OverlayTimeline.ts';
import { makeRecorderProject } from '../../src/core/ProjectMediaModel.ts';
import { makeProjectTimeline } from '../../src/core/ProjectTimeline.ts';
import { makeNormalizedPoint } from '../../src/core/ZoomAnimation.ts';
import { startExportServer } from '../../src/server/ExportServer.ts';

test('T18.2: resolveActiveSubtitleState handles all 5 entrances cleanly without NaNs', () => {
  assert.equal(resolveActiveSubtitleState(null, 1920, 1080), null);

  const baseStyle = makeSubtitleStyle({ showsSecondary: true, font: 'rounded', bold: true });
  const cue = makeFrameSubtitleScene({
    cueID: 'cue-1',
    text: '核心功能演示🚀',
    secondaryText: 'Core Demo',
    style: baseStyle,
    elapsed: 0.1,
    remaining: 1.8,
  });

  const entrances = ['none', 'fade', 'rise', 'pop', 'typewriter'] as const;
  for (const entrance of entrances) {
    const state = resolveActiveSubtitleState(
      { ...cue, style: { ...baseStyle, entrance } },
      1920,
      1080
    );
    assert.ok(state, `Expected valid state for ${entrance}`);
    assert.ok(Number.isFinite(state.opacity) && state.opacity >= 0 && state.opacity <= 1);
    assert.ok(Number.isFinite(state.scale) && state.scale > 0);
    assert.ok(Number.isFinite(state.offsetYPx));
    assert.equal(state.secondaryText, 'Core Demo');
    if (entrance === 'typewriter') {
      assert.ok(Array.from(state.visibleText).length < Array.from(cue.text).length);
    } else {
      assert.equal(state.visibleText, cue.text);
    }
  }

  // Secondary subtitle hidden when showsSecondary is false
  const hiddenSec = resolveActiveSubtitleState(
    { ...cue, style: { ...baseStyle, showsSecondary: false } },
    1280,
    720
  );
  assert.equal(hiddenSec?.secondaryText, null);
  assert.ok(resolveSubtitleFontFamily('mono').includes('monospace'));
});

test('T18.2: HTML motion .dmhtml templates, metadata roundtrip, envelope, and spec resolve validly', () => {
  assert.ok(HTML_MOTION_TEMPLATES.length >= 5);

  const html = buildDmhtmlDocument('chapter', {
    title: '第一章：架构重构',
    subtitle: 'DogSC Studio v1.1',
    accent: '#da7a52',
  });
  const parsed = parseDmhtmlMeta(html);
  assert.ok(parsed);
  assert.equal(parsed.templateId, 'chapter');
  assert.equal(parsed.title, '第一章：架构重构');
  assert.equal(parsed.subtitle, 'DogSC Studio v1.1');
  assert.equal(parsed.accent, '#da7a52');

  const earlyEnv = computeMotionEnvelope(0.05, 3.0);
  const steadyEnv = computeMotionEnvelope(1.5, 3.0);
  assert.ok(earlyEnv.opacity > 0 && earlyEnv.opacity < 1);
  assert.equal(steadyEnv.opacity, 1);
  assert.equal(steadyEnv.scale, 1);

  const animClip = makeFrameAnimationSceneFromClip(
    makeAnimationClip({
      timing: makeOverlayTiming(0.5, 3.0),
      sourcePath: 'builtin://keycap',
      position: makeNormalizedPoint(0.5, 0.8),
      width: 0.35,
      properties: {
        template: { kind: 'string', value: 'keycap' },
        title: { kind: 'string', value: 'Ctrl+K' },
      },
    }),
    0.8
  );
  const spec = resolveMotionClipRenderSpec(animClip, 1920, 1080);
  assert.equal(spec.templateId, 'keycap');
  assert.equal(spec.title, 'Ctrl+K');
  assert.ok(spec.widthPx >= 600);
  assert.ok(spec.opacity > 0.5);
});

test('T18.2: computeAspectFillUvRect preserves image aspect ratio without overflow', () => {
  const wideOn16x9 = computeAspectFillUvRect(3840, 1080, 1920, 1080);
  assert.deepEqual(wideOn16x9, [0.25, 0, 0.5, 1]);

  const tallOn16x9 = computeAspectFillUvRect(1080, 1920, 1920, 1080);
  assert.equal(tallOn16x9[0], 0);
  assert.equal(tallOn16x9[2], 1);
  assert.ok(tallOn16x9[1] > 0.3 && tallOn16x9[3] < 0.4);

  const exactMatch = computeAspectFillUvRect(1920, 1080, 1280, 720);
  assert.ok(Math.abs(exactMatch[2] - 1) < 1e-6 && Math.abs(exactMatch[3] - 1) < 1e-6);
});

test('T18.2: FramePlan + dispatchSceneLayers executes animations and subtitles in layer order', () => {
  const cue = makeSubtitleCue({
    timing: makeOverlayTiming(0.2, 2.0),
    text: '第一句字幕',
    secondaryText: 'First cue',
  });
  const anim = makeAnimationClip({
    timing: makeOverlayTiming(0.2, 2.0),
    sourcePath: 'builtin://pill',
    properties: { title: { kind: 'string', value: '实时预览' } },
  });
  const project = makeRecorderProject({
    timeline: makeProjectTimeline({
      subtitleCues: [cue],
      animationClips: [anim],
    }),
  });
  const plan = makeFramePlan({
    project,
    pointerEvents: [],
    fps: 30,
    durationSeconds: 3,
    sourceFrameCount: 90,
    canvas: { width: 1280, height: 720 },
  });

  const { scene } = plan.frameAt(15); // t = 0.5s
  assert.ok(scene.subtitle && scene.subtitle.text === '第一句字幕');
  assert.equal(scene.animations.length, 1);

  const executed = dispatchSceneLayers(scene, {
    background: () => {},
    screen: () => {},
    cursor: () => {},
    spotlight: () => {},
    camera: () => {},
    stickers: () => {},
    animations: () => {},
    subtitles: () => {},
  });
  assert.ok(executed.includes('animations'));
  assert.ok(executed.includes('subtitles'));
  assert.ok(executed.indexOf('animations') > executed.indexOf('screen'));
});

test('T18.2: ExportServer serves /assets/<file> safely and blocks traversal', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dogsc-exp-assets-'));
  const framesDir = path.join(tmpDir, 'frames');
  const assetsDir = path.join(tmpDir, 'assets');
  await fs.mkdir(framesDir, { recursive: true });
  await fs.mkdir(assetsDir, { recursive: true });
  await fs.writeFile(path.join(assetsDir, 'bg.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const rootDir = path.resolve(import.meta.dirname, '..', '..');
  const srv = await startExportServer({
    rootDir,
    framesDir,
    sessionDir: tmpDir,
    outFile: path.join(tmpDir, 'out.mp4'),
    ffmpegCommand: { command: process.execPath, args: ['-e', 'process.stdin.resume();'] },
    plan: {
      fps: 30,
      width: 640,
      height: 360,
      frameCount: 1,
      durationSeconds: 1,
      framesBaseUrl: '/frames',
      assetsBaseUrl: '/assets',
      project: {},
      pointerEvents: [],
    },
  });

  try {
    const okRes = await fetch(`http://127.0.0.1:${srv.port}/assets/bg.png`);
    assert.equal(okRes.status, 200);
    assert.equal(okRes.headers.get('content-type'), 'image/png');

    const badStatus = await new Promise<number>((resolveStatus, rejectStatus) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: srv.port,
          path: '/assets/%2e%2e/package.json',
          method: 'GET',
        },
        (res) => {
          res.resume();
          resolveStatus(res.statusCode ?? 0);
        }
      );
      req.on('error', rejectStatus);
      req.end();
    });
    assert.equal(badStatus, 403);
  } finally {
    await srv.close();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});
