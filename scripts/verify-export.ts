/**
 * scripts/verify-export.ts
 *
 * Automated G1+G2 export quality gate. This is intentionally dependency-free:
 * it uses ffprobe/ffmpeg facts plus pointer clicks, never wall-clock guesses.
 *
 * Usage:
 *   node scripts/verify-export.ts --dir recordings\20261120-140843
 */

import { execFile } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { probeMediaFile } from '../src/capture/MediaProbe.ts';
import { parsePointerJsonl } from '../src/capture/PointerJsonl.ts';

export interface VerificationProbe {
  durationSeconds: number;
  frameCount: number;
  width: number;
  height: number;
}

export interface VerificationFrameSample {
  timeSeconds: number;
  byteLength: number;
  expectedBytes: number;
  mean: number;
  std: number;
}

export interface ExportVerificationInput {
  metaDurationSeconds: number;
  metaFps: number;
  screen: VerificationProbe;
  exported: VerificationProbe;
  captureFrameRate: unknown;
  recordsSystemAudio: boolean | undefined;
  hasAudio: boolean;
  pointerClickTimesSeconds: readonly number[];
  frameSamples?: readonly VerificationFrameSample[];
}

export interface PointerFlashSyncPair {
  clickIndex: number;
  clickTimeSeconds: number;
  expectedFrame: number;
  sourceFlashOnsetFrame: number | null;
  deltaFrames: number | null;
}

export interface PointerFlashSyncResult {
  ok: boolean;
  maxDeltaFrames: number;
  toleranceFrames: number;
  pairs: PointerFlashSyncPair[];
}

export interface ExportVerificationReport {
  ok: boolean;
  errors: string[];
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  sync?: {
    sourceGreenFrames: number[];
    exportGreenFrames: number[];
    ok: boolean;
    maxDeltaFrames: number;
  };
  timingSync?: PointerFlashSyncResult;
}

const DURATION_TOLERANCE_SECONDS = 0.05;
const FRAME_SAMPLE_MIN_MEAN = 8;
const FRAME_SAMPLE_MIN_STD = 5;
const SYNC_SCAN_WIDTH = 272;
const SYNC_SCAN_HEIGHT = 226;
const SYNC_GREEN_MIN_PIXELS = 4;
const SYNC_TOLERANCE_FRAMES = 1;
const FFMPEG_SUBPROCESS_TIMEOUT_MS = 30_000;

function extractFrameRuns(frames: readonly number[]): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  let start: number | null = null;
  let previous: number | null = null;
  for (const frame of frames) {
    if (start === null || previous === null || frame !== previous + 1) {
      if (start !== null && previous !== null) result.push([start, previous]);
      start = frame;
    }
    previous = frame;
  }
  if (start !== null && previous !== null) result.push([start, previous]);
  return result;
}

/**
 * Pure timing validator: compares source green-flash run onsets against
 * pointer.jsonl click timestamps mapped onto the video timeline.
 * Catches first-frame clock residual drift (e.g. 24-frame / 406ms offset).
 */
export function evaluatePointerToFlashSync(
  sourceGreenFrames: readonly number[],
  pointerClickTimesSeconds: readonly number[],
  fps: number,
  toleranceFrames: number = 2
): PointerFlashSyncResult {
  const safeFps = fps > 0 ? fps : 60;
  const sourceRuns = extractFrameRuns(sourceGreenFrames);
  const pairs: PointerFlashSyncPair[] = [];
  let maxDeltaFrames = 0;

  for (let i = 0; i < pointerClickTimesSeconds.length; i++) {
    const clickTime = pointerClickTimesSeconds[i];
    const expectedFrame = Math.round(clickTime * safeFps);
    const run = sourceRuns[i];
    if (!run) {
      pairs.push({
        clickIndex: i + 1,
        clickTimeSeconds: clickTime,
        expectedFrame,
        sourceFlashOnsetFrame: null,
        deltaFrames: null,
      });
      continue;
    }
    const onset = run[0];
    const delta = Math.abs(onset - expectedFrame);
    maxDeltaFrames = Math.max(maxDeltaFrames, delta);
    pairs.push({
      clickIndex: i + 1,
      clickTimeSeconds: clickTime,
      expectedFrame,
      sourceFlashOnsetFrame: onset,
      deltaFrames: delta,
    });
  }

  const ok =
    pointerClickTimesSeconds.length > 0 &&
    sourceRuns.length === pointerClickTimesSeconds.length &&
    pairs.every((p) => p.deltaFrames !== null && p.deltaFrames <= toleranceFrames);

  return {
    ok,
    maxDeltaFrames,
    toleranceFrames,
    pairs,
  };
}

/**
 * Compare pure-green sync frames between source and export (structural check).
 */
export function evaluateSyncFrames(
  sourceGreenFrames: readonly number[],
  exportGreenFrames: readonly number[],
  toleranceFrames: number = SYNC_TOLERANCE_FRAMES
): NonNullable<ExportVerificationReport['sync']> {
  const sourceRuns = extractFrameRuns(sourceGreenFrames);
  const exportRuns = extractFrameRuns(exportGreenFrames);
  let maxDeltaFrames = 0;
  const ok =
    sourceRuns.length > 0 &&
    sourceRuns.length === exportRuns.length &&
    sourceRuns.every(([sourceStart], index) => {
      const [exportStart] = exportRuns[index] ?? [Number.NaN];
      const startDelta = Math.abs(sourceStart - exportStart);
      maxDeltaFrames = Math.max(maxDeltaFrames, startDelta);
      return startDelta <= toleranceFrames;
    });

  return { sourceGreenFrames: [...sourceGreenFrames], exportGreenFrames: [...exportGreenFrames], ok, maxDeltaFrames };
}

/**
 * Pure evaluator: accepts measured facts only, so the gate can be unit-tested
 * without ffmpeg. It catches the three historical Wave A failures:
 * 1) tail duplicate frames, 2) wall-clock meta duration, 3) lying capture fps.
 */
export function evaluateExportVerification(input: ExportVerificationInput): ExportVerificationReport {
  const errors: string[] = [];
  const checks: ExportVerificationReport['checks'] = [];

  const durations = [
    input.metaDurationSeconds,
    input.screen.durationSeconds,
    input.exported.durationSeconds,
  ];
  const durationSpread = Math.max(...durations) - Math.min(...durations);
  const durationOk = Number.isFinite(durationSpread) && durationSpread <= DURATION_TOLERANCE_SECONDS;
  checks.push({
    name: 'durations',
    ok: durationOk,
    detail: `meta=${input.metaDurationSeconds.toFixed(3)}s screen=${input.screen.durationSeconds.toFixed(3)}s export=${input.exported.durationSeconds.toFixed(3)}s spread=${durationSpread.toFixed(3)}s`,
  });
  if (!durationOk) {
    errors.push(
      `时长不一致：meta/screen/export 最大差 ${durationSpread.toFixed(3)}s，超过 ${DURATION_TOLERANCE_SECONDS}s`
    );
  }

  const frameOk = input.exported.frameCount === input.screen.frameCount;
  checks.push({
    name: 'frameCount',
    ok: frameOk,
    detail: `screen=${input.screen.frameCount} export=${input.exported.frameCount}`,
  });
  if (!frameOk) {
    errors.push(
      `帧数不一致：export ${input.exported.frameCount} !== screen ${input.screen.frameCount}`
    );
  }

  const captureRateOk = Number(input.captureFrameRate) === input.metaFps;
  checks.push({
    name: 'captureFrameRate',
    ok: captureRateOk,
    detail: `project.capture=${String(input.captureFrameRate)} meta.fps=${input.metaFps}`,
  });
  if (!captureRateOk) {
    errors.push(
      `录制帧率谎言：project.capture.captureFrameRate=${String(input.captureFrameRate)}，meta.fps=${input.metaFps}`
    );
  }

  if (!input.hasAudio) {
    const audioFlagOk = input.recordsSystemAudio === false;
    checks.push({
      name: 'recordsSystemAudio',
      ok: audioFlagOk,
      detail: `no audio stream; recordsSystemAudio=${String(input.recordsSystemAudio)}`,
    });
    if (!audioFlagOk) {
      errors.push(
        `无音频却声明系统音频：recordsSystemAudio=${String(input.recordsSystemAudio)}`
      );
    }
  } else {
    checks.push({
      name: 'recordsSystemAudio',
      ok: true,
      detail: 'export contains an audio stream; flag check skipped',
    });
  }

  if (input.pointerClickTimesSeconds.length === 0) {
    checks.push({
      name: 'pointerClicks',
      ok: false,
      detail: 'pointer.jsonl has no click events; cannot sample click frames',
    });
    errors.push('pointer.jsonl 中没有点击事件，无法验证点击帧');
  } else {
    checks.push({
      name: 'pointerClicks',
      ok: true,
      detail: `click count=${input.pointerClickTimesSeconds.length}`,
    });
  }

  if (input.frameSamples) {
    for (let i = 0; i < input.frameSamples.length; i++) {
      const sample = input.frameSamples[i];
      const sizeOk = sample.byteLength === sample.expectedBytes && sample.expectedBytes > 0;
      const readableOk = sample.byteLength > 0 && sample.mean > FRAME_SAMPLE_MIN_MEAN && sample.std > FRAME_SAMPLE_MIN_STD;
      const ok = sizeOk && readableOk;
      checks.push({
        name: `frameSample#${i + 1}`,
        ok,
        detail: `t=${sample.timeSeconds.toFixed(3)}s bytes=${sample.byteLength}/${sample.expectedBytes} mean=${sample.mean.toFixed(1)} std=${sample.std.toFixed(1)}`,
      });
      if (!sizeOk) {
        errors.push(`点击帧 #${i + 1} 原始像素长度异常：${sample.byteLength} != ${sample.expectedBytes}`);
      } else if (!readableOk) {
        errors.push(
          `点击帧 #${i + 1} 全黑或不可读：mean=${sample.mean.toFixed(1)}, std=${sample.std.toFixed(1)}`
        );
      }
    }
  }

  return { ok: errors.length === 0, errors, checks };
}

function argsValue(args: string[], name: string): string | null {
  const idx = args.indexOf(name);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return null;
}

function runFfmpegRawFrame(
  filePath: string,
  timeSeconds: number,
  width: number,
  height: number
): Promise<VerificationFrameSample> {
  return new Promise((resolvePromise, reject) => {
    const args = [
      '-v', 'error',
      '-i', filePath,
      '-ss', String(Math.max(timeSeconds, 0)),
      '-frames:v', '1',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      'pipe:1',
    ];
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill('SIGKILL');
      } catch {
        // ignore
      }
      reject(new Error(`ffmpeg 抽帧超时 (${FFMPEG_SUBPROCESS_TIMEOUT_MS}ms)`));
    }, FFMPEG_SUBPROCESS_TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();

    proc.stdout?.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + String(chunk)).slice(-500);
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      if (!timedOut) reject(new Error(`ffmpeg 抽帧启动失败: ${err.message}`));
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code !== 0) {
        reject(new Error(`ffmpeg 抽帧失败 (${timeSeconds}s, code ${String(code)}): ${stderr}`));
        return;
      }
      const pixels = Buffer.concat(chunks);
      const mean = pixels.length > 0 ? pixels.reduce((sum, value) => sum + value, 0) / pixels.length : 0;
      const variance = pixels.length > 0
        ? pixels.reduce((sum, value) => sum + (value - mean) ** 2, 0) / pixels.length
        : 0;
      resolvePromise({
        timeSeconds,
        byteLength: pixels.length,
        expectedBytes: width * height * 3,
        mean,
        std: Math.sqrt(variance),
      });
    });
  });
}

function probeHasAudio(filePath: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    execFile(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', filePath],
      { timeout: 10_000 },
      (error, stdout) => resolvePromise(!error && stdout.trim().length > 0)
    );
  });
}

function scanGreenFrames(filePath: string): Promise<number[]> {
  return new Promise((resolvePromise, reject) => {
    const args = [
      '-v', 'error',
      '-i', filePath,
      '-vf', `scale=${SYNC_SCAN_WIDTH}:${SYNC_SCAN_HEIGHT}:flags=area`,
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      'pipe:1',
    ];
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const frameBytes = SYNC_SCAN_WIDTH * SYNC_SCAN_HEIGHT * 3;
    const greenFrames: number[] = [];
    let pending = Buffer.alloc(0);
    let frameIndex = 0;
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill('SIGKILL');
      } catch {
        // ignore
      }
      reject(new Error(`绿色同步帧扫描超时 (${FFMPEG_SUBPROCESS_TIMEOUT_MS}ms)`));
    }, FFMPEG_SUBPROCESS_TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + String(chunk)).slice(-500);
    });
    proc.stdout?.on('data', (chunk: Buffer) => {
      pending = Buffer.concat([pending, Buffer.from(chunk)]);
      while (pending.length >= frameBytes) {
        const frame = pending.subarray(0, frameBytes);
        let greenPixels = 0;
        for (let i = 0; i < frame.length; i += 3) {
          if (frame[i] < 40 && frame[i + 1] > 180 && frame[i + 2] < 40) {
            greenPixels++;
            if (greenPixels >= SYNC_GREEN_MIN_PIXELS) break;
          }
        }
        if (greenPixels >= SYNC_GREEN_MIN_PIXELS) greenFrames.push(frameIndex);
        pending = pending.subarray(frameBytes);
        frameIndex++;
      }
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      if (!timedOut) reject(new Error(`绿色同步帧扫描启动失败: ${err.message}`));
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return;
      if (code !== 0) {
        reject(new Error(`绿色同步帧扫描失败 (code ${String(code)}): ${stderr}`));
        return;
      }
      resolvePromise(greenFrames);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const dir = argsValue(args, '--dir') ?? args.find((arg) => !arg.startsWith('-')) ?? null;
  const reportOutPath = argsValue(args, '--report');
  if (!dir) {
    console.error('用法: node scripts/verify-export.ts --dir <recordingDir> [--sync] [--report <path>]');
    process.exit(2);
  }

  const recordingDir = resolve(dir);
  const metaPath = resolve(recordingDir, 'meta.json');
  const projectPath = resolve(recordingDir, 'project.json');
  const pointerPath = resolve(recordingDir, 'pointer.jsonl');
  const screenPath = resolve(recordingDir, 'screen.mp4');
  const exportPath = resolve(recordingDir, 'export.mp4');

  for (const p of [metaPath, projectPath, pointerPath, screenPath, exportPath]) {
    if (!existsSync(p)) {
      console.error(JSON.stringify({ ok: false, errors: [`缺少文件: ${p}`] }, null, 2));
      process.exit(1);
    }
  }

  const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as Record<string, any>;
  const project = JSON.parse(readFileSync(projectPath, 'utf-8')) as Record<string, any>;
  const pointerText = readFileSync(pointerPath, 'utf-8');
  const screen = await probeMediaFile(screenPath);
  const exported = await probeMediaFile(exportPath);
  const hasAudio = await probeHasAudio(exportPath);
  const clicks = parsePointerJsonl(pointerText).events
    .filter((event) => event.kind === 'leftClick' || event.kind === 'rightClick')
    .map((event) => Math.max(event.time + (meta.pointerOffsetSeconds ?? 0), 0));

  const frameSamples: VerificationFrameSample[] = [];
  for (const clickTime of clicks) {
    frameSamples.push(await runFfmpegRawFrame(exportPath, clickTime, exported.width, exported.height));
  }

  const report = evaluateExportVerification({
    metaDurationSeconds: Number(meta.durationSeconds),
    metaFps: Number(meta.fps),
    screen,
    exported,
    captureFrameRate: project.capture?.captureFrameRate,
    recordsSystemAudio: project.capture?.recordsSystemAudio,
    hasAudio,
    pointerClickTimesSeconds: clicks,
    frameSamples,
  });

  if (args.includes('--sync')) {
    const sourceGreenFrames = await scanGreenFrames(screenPath);
    const exportGreenFrames = await scanGreenFrames(exportPath);
    const structuralSync = evaluateSyncFrames(sourceGreenFrames, exportGreenFrames);
    const timingSync = evaluatePointerToFlashSync(sourceGreenFrames, clicks, Number(meta.fps) || screen.fps);
    report.sync = structuralSync;
    report.timingSync = timingSync;

    report.checks.push({
      name: 'structuralSyncFrames',
      ok: structuralSync.ok,
      detail: `source=${sourceGreenFrames.join(',') || 'none'} export=${exportGreenFrames.join(',') || 'none'} maxDelta=${structuralSync.maxDeltaFrames}`,
    });
    if (!structuralSync.ok) {
      report.ok = false;
      report.errors.push(
        `源/导出闪帧不一致：source=[${sourceGreenFrames.join(',')}] export=[${exportGreenFrames.join(',')}]，容差 ${SYNC_TOLERANCE_FRAMES} 帧`
      );
    }

    report.checks.push({
      name: 'pointerTimingSync',
      ok: timingSync.ok,
      detail: `maxDelta=${timingSync.maxDeltaFrames} pairs=${JSON.stringify(timingSync.pairs)}`,
    });
    if (!timingSync.ok) {
      report.ok = false;
      report.errors.push(
        `指针点击时刻与源视频绿色闪帧偏差过大：maxDelta=${timingSync.maxDeltaFrames} 帧 (容差 ${timingSync.toleranceFrames} 帧)`
      );
    }
  }

  const payload = {
    dir: recordingDir,
    ok: report.ok,
    errors: report.errors,
    checks: report.checks,
    structuralSync: report.sync ?? null,
    timingSync: report.timingSync ?? null,
    measured: {
      metaDurationSeconds: meta.durationSeconds,
      screen,
      exported,
      hasAudio,
      clicks,
    },
  };
  if (reportOutPath) {
    const resolvedReport = resolve(reportOutPath);
    mkdirSync(dirname(resolvedReport), { recursive: true });
    writeFileSync(resolvedReport, JSON.stringify(payload, null, 2), 'utf-8');
  }
  console.log(JSON.stringify(payload, null, 2));
  process.exit(report.ok ? 0 : 1);
}

const invokedPath = process.argv[1];
if (invokedPath && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, errors: [String(error?.message ?? error)] }, null, 2));
    process.exit(1);
  });
}
