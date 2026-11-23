/**
 * scripts/export.ts
 *
 * CLI entrypoint for exporting a recorded DogSC session to a rendered MP4 video
 * using headless Edge WebGL2 rendering + ExportServer + ffmpeg hardware/software encoding.
 * Usage: node scripts/export.ts --dir <recordingDir> [--out <outFile>] [--format <mp4|m4a>] [--max-frames <N>]
 */

import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { parsePointerJsonl } from '../src/capture/PointerJsonl.ts';
import { extractFrames } from '../src/capture/FrameExtractor.ts';
import { extractCameraFrames } from '../src/capture/CameraRecorder.ts';
import { detectEncoder } from '../src/capture/ScreenRecorder.ts';
import { probeMediaFile } from '../src/capture/MediaProbe.ts';
import {
  buildAudioMixFilterGraph,
  buildAudioOnlyM4aArgs,
  buildSessionAudioTracks,
  extractAudioSourceSlices,
} from '../src/render/AudioMixPlan.ts';
import { makeOutputFrameSchedule } from '../src/core/OutputFrameSchedule.ts';
import { makePointerEventRecord } from '../src/core/ZoomAnimation.ts';
import { startExportServer } from '../src/server/ExportServer.ts';
import type { OutputFrameRate } from '../src/core/CaptureConfiguration.ts';

const EDGE_EXE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

function runFfmpegSync(args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (c) => {
      stderr += c.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`ffmpeg 音频导出失败 (code ${String(code)}):\n${stderr.slice(-800)}`));
      }
    });
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string' },
      out: { type: 'string' },
      format: { type: 'string' },
      'max-frames': { type: 'string' },
    },
    strict: false,
  });

  if (!values.dir || typeof values.dir !== 'string') {
    console.error(
      '用法: node scripts/export.ts --dir <录制目录> [--out <输出文件>] [--format <mp4|m4a>] [--max-frames <N>]'
    );
    process.exit(1);
  }

  const formatRaw =
    typeof values.format === 'string' && values.format.length > 0
      ? values.format.toLowerCase()
      : 'mp4';
  if (formatRaw !== 'mp4' && formatRaw !== 'm4a') {
    console.error(`不支持的导出格式: ${formatRaw}（仅支持 mp4 / m4a）`);
    process.exit(1);
  }

  const rootDir = path.resolve(import.meta.dirname, '..');
  const recDir = path.resolve(values.dir);
  const outFile =
    typeof values.out === 'string' && values.out.length > 0
      ? path.resolve(values.out)
      : path.join(recDir, formatRaw === 'm4a' ? 'export.m4a' : 'export.mp4');
  const maxFrames =
    typeof values['max-frames'] === 'string' ? Number.parseInt(values['max-frames'], 10) : 0;

  const t0 = Date.now();
  console.log(`[Export] 读取录制目录: ${recDir}`);

  const meta = JSON.parse(await fs.readFile(path.join(recDir, 'meta.json'), 'utf8'));
  const projectJson = JSON.parse(await fs.readFile(path.join(recDir, 'project.json'), 'utf8'));

  const fps = Number(meta.fps) || 60;
  const probed = await probeMediaFile(path.join(recDir, 'screen.mp4'));
  const width = probed.width > 0 ? probed.width : (Number(meta.width) || 1920);
  const height = probed.height > 0 ? probed.height : (Number(meta.height) || 1080);

  const audioTracks = buildSessionAudioTracks({ project: projectJson, recDir, meta });
  const sourceSlices = extractAudioSourceSlices(projectJson, probed.durationSeconds);

  if (formatRaw === 'm4a') {
    const m4aArgs = buildAudioOnlyM4aArgs(audioTracks, outFile, {
      durationSeconds: probed.durationSeconds,
      sourceSlices,
    });
    if (!m4aArgs) {
      console.error(
        '未找到可导出的有效音轨（请确认 system-audio.wav / mic-audio.wav 或音频贴片存在且未静音）'
      );
      process.exit(1);
    }
    await fs.mkdir(path.dirname(outFile), { recursive: true });
    console.log(`[Export] 正在直接混音导出纯音频 M4A (${audioTracks.length} 条输入轨)...`);
    await runFfmpegSync(m4aArgs);
    const elapsedSec = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(`[Export] M4A 导出完成，耗时 ${elapsedSec}s`);
    console.log(`[Export] 输出文件: ${outFile}`);
    return;
  }

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

  const cameraFileName =
    typeof meta.cameraFile === 'string' && meta.cameraFile.trim().length > 0
      ? meta.cameraFile.trim()
      : 'camera.mp4';
  const cameraMp4Path = path.join(recDir, cameraFileName);
  let cameraFramesDir: string | undefined;
  let cameraFramesBaseUrl: string | null = null;
  if (existsSync(cameraMp4Path)) {
    const camFramesDir = path.join(recDir, 'camera_frames');
    let camFrameCount = 0;
    try {
      const existingCam = await fs.readdir(camFramesDir);
      camFrameCount = existingCam.filter((f) => /^\d{6}\.jpg$/.test(f)).length;
    } catch {
      camFrameCount = 0;
    }
    if (camFrameCount === 0) {
      console.log(`[Export] 正在预解码摄像头帧到 ${camFramesDir} ...`);
      camFrameCount = await extractCameraFrames({
        video: cameraMp4Path,
        outDir: camFramesDir,
        fps,
      });
    }
    if (camFrameCount > 0) {
      cameraFramesDir = camFramesDir;
      cameraFramesBaseUrl = '/camera_frames';
    }
  }

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
  const audioMix = buildAudioMixFilterGraph(audioTracks, {
    durationSeconds: trueDuration,
    videoInputIndex: 0,
    sourceSlices,
  });
  console.log(
    `[Export] 输出规格: ${width}x${height} @ ${fps}fps, 共 ${frameCount} 帧, 编码器: ${encoder}` +
      (audioMix ? `, 混音轨: ${audioMix.inputs.length}` : '')
  );

  const server = await startExportServer({
    rootDir,
    framesDir,
    cameraFramesDir,
    outFile,
    encoder,
    audioMix: audioMix ?? undefined,
    plan: {
      fps,
      width,
      height,
      frameCount,
      sourceFrameCount,
      durationSeconds: trueDuration,
      framesBaseUrl: '/frames',
      cameraFramesBaseUrl,
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
      // Edge spawns child renderer/GPU processes. Kill the whole tree on
      // Windows so a failed export cannot leave orphaned headless browsers.
      if (process.platform === 'win32' && edge.pid) {
        spawnSync('taskkill', ['/F', '/T', '/PID', String(edge.pid)], {
          stdio: 'ignore',
        });
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
