/**
 * scripts/export.ts
 *
 * CLI entrypoint for exporting a recorded DogSC session to a rendered MP4 video
 * using headless Edge WebGL2 rendering + ExportServer + ffmpeg hardware/software encoding.
 * Usage: node scripts/export.ts --dir <recordingDir> [--out <outMp4>] [--max-frames <N>]
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { parsePointerJsonl } from '../src/capture/PointerJsonl.ts';
import { extractFrames } from '../src/capture/FrameExtractor.ts';
import { detectEncoder } from '../src/capture/ScreenRecorder.ts';
import { probeMediaFile } from '../src/capture/MediaProbe.ts';
import { makeOutputFrameSchedule } from '../src/core/OutputFrameSchedule.ts';
import { makePointerEventRecord } from '../src/core/ZoomAnimation.ts';
import { startExportServer } from '../src/server/ExportServer.ts';
import type { OutputFrameRate } from '../src/core/CaptureConfiguration.ts';

const EDGE_EXE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string' },
      out: { type: 'string' },
      'max-frames': { type: 'string' },
    },
    strict: false,
  });

  if (!values.dir || typeof values.dir !== 'string') {
    console.error('用法: node scripts/export.ts --dir <录制目录> [--out <输出MP4>] [--max-frames <N>]');
    process.exit(1);
  }

  const rootDir = path.resolve(import.meta.dirname, '..');
  const recDir = path.resolve(values.dir);
  const outFile =
    typeof values.out === 'string' && values.out.length > 0
      ? path.resolve(values.out)
      : path.join(recDir, 'export.mp4');
  const maxFrames =
    typeof values['max-frames'] === 'string' ? Number.parseInt(values['max-frames'], 10) : 0;

  const t0 = Date.now();
  console.log(`[Export] 读取录制目录: ${recDir}`);

  const meta = JSON.parse(await fs.readFile(path.join(recDir, 'meta.json'), 'utf8'));
  const projectJson = JSON.parse(await fs.readFile(path.join(recDir, 'project.json'), 'utf8'));
  const pointerText = await fs.readFile(path.join(recDir, 'pointer.jsonl'), 'utf8');
  const parsedPointer = parsePointerJsonl(pointerText);

  const offset = Number(meta.pointerOffsetSeconds) || 0;
  const pointerEvents = parsedPointer.events.map((e) =>
    makePointerEventRecord({
      time: Math.max(e.time + offset, 0),
      location: e.location,
      kind: e.kind,
      modifiers: e.modifiers,
      cursorAssetID: e.cursorAssetID,
    })
  );

  const framesDir = path.join(recDir, 'frames');
  let sourceFrameCount = 0;
  try {
    const existing = await fs.readdir(framesDir);
    sourceFrameCount = existing.filter((f) => /^\d{6}\.jpg$/.test(f)).length;
  } catch {
    sourceFrameCount = 0;
  }

  if (sourceFrameCount === 0) {
    console.log(`[Export] 正在使用 ffmpeg 预解码源视频帧到 ${framesDir} ...`);
    sourceFrameCount = await extractFrames({
      video: path.join(recDir, 'screen.mp4'),
      outDir: framesDir,
      fps: Number(meta.fps) || 60,
    });
    console.log(`[Export] 预解码完成，共提取 ${sourceFrameCount} 帧`);
  } else {
    console.log(`[Export] 复用已提取的源帧序列 (${sourceFrameCount} 帧)`);
  }

  const fps = Number(meta.fps) || 60;
  const probed = await probeMediaFile(path.join(recDir, 'screen.mp4'));
  const width = probed.width > 0 ? probed.width : (Number(meta.width) || 1920);
  const height = probed.height > 0 ? probed.height : (Number(meta.height) || 1080);
  const trueDuration = Math.min(
    probed.durationSeconds,
    sourceFrameCount > 0 ? sourceFrameCount / fps : probed.durationSeconds
  );
  const schedule = makeOutputFrameSchedule(trueDuration, fps as OutputFrameRate);
  let frameCount = schedule.frameCount;
  if (Number.isFinite(maxFrames) && maxFrames > 0) {
    frameCount = Math.min(frameCount, maxFrames);
  }

  console.log(
    `[Export] 媒体真相: ${probed.width}x${probed.height} @ ${probed.fps}fps, ` +
    `${probed.frameCount} 帧 / ${probed.durationSeconds.toFixed(3)}s; ` +
    `导出时间轴 ${trueDuration.toFixed(3)}s`
  );

  const encoder = await detectEncoder();
  console.log(`[Export] 输出规格: ${width}x${height} @ ${fps}fps, 共 ${frameCount} 帧, 编码器: ${encoder}`);

  const server = await startExportServer({
    rootDir,
    framesDir,
    outFile,
    encoder,
    plan: {
      fps,
      width,
      height,
      frameCount,
      sourceFrameCount,
      durationSeconds: trueDuration,
      framesBaseUrl: '/frames',
      project: projectJson,
      pointerEvents,
    },
    onProgress: (done, total) => {
      if (done === 1 || done % 30 === 0 || done === total) {
        const pct = Math.round((done / Math.max(total, 1)) * 100);
        console.log(`[Export] 进度: ${done}/${total} (${pct}%)`);
      }
    },
  });

  const tmpProfile = await fs.mkdtemp(path.join(os.tmpdir(), 'dogsc-edge-export-'));
  const url = `http://127.0.0.1:${server.port}/web/render.html?mode=export`;
  console.log(`[Export] 启动无头 Edge 渲染: ${url}`);

  let finished = false;
  const edge = spawn(
    EDGE_EXE,
    [
      '--headless=new',
      `--user-data-dir=${tmpProfile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu-sandbox',
      '--use-angle=d3d11',
      `--window-size=${width},${height}`,
      url,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  let edgeStderr = '';
  edge.stderr?.on('data', (chunk) => {
    edgeStderr += chunk.toString();
  });

  const earlyEdgeExit = new Promise<never>((_, reject) => {
    edge.on('error', (err) => {
      if (!finished) reject(err);
    });
    edge.on('close', (code) => {
      if (!finished) {
        reject(new Error(`Edge exited unexpectedly with code ${code} before export finished:\n${edgeStderr}`));
      }
    });
  });

  try {
    const result = await Promise.race([server.waitForDone(), earlyEdgeExit]);
    finished = true;
    const elapsedSec = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(`[Export] 完成！共导出 ${result.receivedFrames} 帧，耗时 ${elapsedSec}s`);
    console.log(`[Export] 输出文件: ${outFile}`);
  } finally {
    finished = true;
    try {
      if (!edge.killed) {
        edge.kill('SIGKILL');
      }
    } catch {
      // ignore
    }
    await server.close();
    try {
      await fs.rm(tmpProfile, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

main().catch((err) => {
  console.error('[Export] 导出失败:', err);
  process.exit(1);
});
