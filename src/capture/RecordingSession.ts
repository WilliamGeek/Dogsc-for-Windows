/**
 * RecordingSession.ts
 *
 * Coordinates screen recording (ffmpeg) and pointer logging (WH_MOUSE_LL),
 * aligns their clocks, and produces a valid RecorderProject ready for editing/rendering.
 * Adheres strictly to docs/CONTRACTS.md §3 and §5.
 */

import {
  writeFileSync,
  mkdirSync,
  createWriteStream,
  existsSync,
  rmSync,
  type WriteStream,
} from 'node:fs';
import { resolve } from 'node:path';
import { finished } from 'node:stream/promises';
import {
  CaptureSource,
  type CaptureConfiguration,
  type NormalizedRect,
  makeCaptureConfiguration,
  makeNormalizedRect,
  type OutputFrameRate,
} from '../core/CaptureConfiguration.ts';
import {
  makeRecorderProject,
  encodeRecorderProject,
  type RecorderProject,
} from '../core/ProjectMediaModel.ts';
import {
  makeProjectTimeline,
  makeSourceSequenceFullRecording,
} from '../core/ProjectTimeline.ts';
import {
  makePointerEventRecord,
  type PointerEventRecord,
} from '../core/ZoomAnimation.ts';
import { AutoZoomPlanner } from '../core/AutoZoomPlanner.ts';
import { parsePointerJsonl } from './PointerJsonl.ts';
import { startMouseHook } from './MouseHook.ts';
import {
  startScreenRecording,
  detectEncoder,
  alignEvenRegion,
  type VideoEncoderKind,
  type CaptureMode,
  type CaptureRegion,
} from './ScreenRecorder.ts';
import { probeMediaFile } from './MediaProbe.ts';
import { enumerateDisplays, type DisplayDescriptor } from './DisplayEnumeration.ts';

export interface RecordingMetaInput {
  id: string;
  fps: number;
  width: number;
  height: number;
  screenStartUnixMs: number;
  spawnUnixMs?: number;
  firstFrameUnixMs?: number;
  pointerOriginUnixMs: number;
  encoder: string;
  durationSeconds: number;
  frameCount?: number;
  displayDescriptor?: DisplayDescriptor;
}

export interface RecordingMeta {
  id: string;
  fps: number;
  width: number;
  height: number;
  screenStartUnixMs: number;
  spawnUnixMs?: number;
  firstFrameUnixMs?: number;
  pointerOriginUnixMs: number;
  pointerOffsetSeconds: number;
  encoder: string;
  durationSeconds: number;
  frameCount?: number;
  displayDescriptor?: DisplayDescriptor;
}

export interface RecordSessionOptions {
  seconds: number;
  fps?: number;
  outputIdx?: number;
  encoder?: VideoEncoderKind;
  captureMode?: CaptureMode;
  region?: CaptureRegion;
  windowTitle?: string;
  windowBounds?: { x: number; y: number; width: number; height: number };
  baseDir?: string;
  /** Injected descriptors for deterministic tests; production enumerates WMI. */
  displays?: DisplayDescriptor[];
}

export interface ResolvedSessionCaptureGeometry {
  captureMode: CaptureMode;
  captureSource: CaptureSource;
  alignedRegion?: CaptureRegion;
  windowTitle?: string;
  normalizedArea: NormalizedRect | null;
  hookBounds: { x: number; y: number; w: number; h: number };
}

/**
 * Pure function: maps display + captureMode ('display' | 'region' | 'window') into
 * aligned ddagrab/gdigrab parameters and virtual-desktop WH_MOUSE_LL screen bounds.
 */
export function resolveSessionCaptureGeometry(
  display: DisplayDescriptor,
  options: Pick<RecordSessionOptions, 'captureMode' | 'region' | 'windowTitle' | 'windowBounds'>
): ResolvedSessionCaptureGeometry {
  const mode: CaptureMode = options.captureMode ?? 'display';
  if (mode === 'region') {
    if (!options.region) {
      throw new Error('captureMode="region" 需要提供 region 参数');
    }
    const aligned = alignEvenRegion(options.region, {
      width: display.width,
      height: display.height,
    });
    return {
      captureMode: 'region',
      captureSource: CaptureSource.area,
      alignedRegion: aligned,
      normalizedArea: makeNormalizedRect({
        x: aligned.x / Math.max(display.width, 1),
        y: aligned.y / Math.max(display.height, 1),
        width: aligned.width / Math.max(display.width, 1),
        height: aligned.height / Math.max(display.height, 1),
      }),
      hookBounds: {
        x: display.x + aligned.x,
        y: display.y + aligned.y,
        w: aligned.width,
        h: aligned.height,
      },
    };
  }

  if (mode === 'window') {
    const title = options.windowTitle?.trim() ?? '';
    if (!title) {
      throw new Error('captureMode="window" 需要提供非空的 windowTitle 参数');
    }
    const wb = options.windowBounds;
    const validWb =
      wb &&
      Number.isFinite(wb.x) &&
      Number.isFinite(wb.y) &&
      Number.isFinite(wb.width) &&
      Number.isFinite(wb.height) &&
      wb.width > 0 &&
      wb.height > 0;
    return {
      captureMode: 'window',
      captureSource: CaptureSource.window,
      windowTitle: title,
      normalizedArea: null,
      hookBounds: validWb
        ? { x: wb.x, y: wb.y, w: wb.width, h: wb.height }
        : { x: display.x, y: display.y, w: display.width, h: display.height },
    };
  }

  return {
    captureMode: 'display',
    captureSource: CaptureSource.display,
    normalizedArea: null,
    hookBounds: {
      x: display.x,
      y: display.y,
      w: display.width,
      h: display.height,
    },
  };
}

export function formatSessionId(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const Y = d.getFullYear();
  const M = pad(d.getMonth() + 1);
  const D = pad(d.getDate());
  const h = pad(d.getHours());
  const m = pad(d.getMinutes());
  const s = pad(d.getSeconds());
  return `${Y}${M}${D}-${h}${m}${s}`;
}

/**
 * Allocates a directory path that does not collide with an existing session.
 * Same-second sessions become `${id}-01` .. `${id}-99`; allocation is not
 * creation, so the caller still owns the final mkdir.
 */
export function allocateUniqueSessionDir(baseDir: string, id: string): string {
  const base = resolve(baseDir);
  const first = resolve(base, id);
  if (!existsSync(first)) return first;

  for (let suffix = 1; suffix <= 99; suffix++) {
    const candidate = resolve(base, `${id}-${String(suffix).padStart(2, '0')}`);
    if (!existsSync(candidate)) return candidate;
  }

  throw new Error(`无法分配唯一录制目录：${first} 及其 -01..-99 后缀均已存在`);
}

/**
 * Pure function: constructs the metadata object with precise pointerOffsetSeconds.
 * Formula per CONTRACTS.md §3: pointerOffsetSeconds is measured from the first
 * captured frame (not process spawn), because ffmpeg startup latency is not
 * part of the video timeline.
 */
export function buildMeta(i: RecordingMetaInput): RecordingMeta {
  const videoStartUnixMs = i.firstFrameUnixMs ?? i.screenStartUnixMs;
  const pointerOffsetSeconds = (i.pointerOriginUnixMs - videoStartUnixMs) / 1000;
  return {
    id: i.id,
    fps: i.fps,
    width: i.width,
    height: i.height,
    screenStartUnixMs: i.screenStartUnixMs,
    spawnUnixMs: i.spawnUnixMs,
    firstFrameUnixMs: i.firstFrameUnixMs,
    pointerOriginUnixMs: i.pointerOriginUnixMs,
    pointerOffsetSeconds,
    encoder: i.encoder,
    durationSeconds: i.durationSeconds,
    frameCount: i.frameCount,
    displayDescriptor: i.displayDescriptor,
  };
}

/**
 * Pure function: shifts pointer events by offsetSeconds onto the video timeline
 * and generates a complete, valid RecorderProject with automatic zoom animations.
 */
export function buildProjectFromRecording(
  events: readonly PointerEventRecord[],
  offsetSeconds: number,
  durationSeconds: number,
  captureOptions?: Partial<CaptureConfiguration>
): RecorderProject {
  // Shift event timestamp onto video timeline (CONTRACTS §3)
  const alignedEvents: PointerEventRecord[] = events.map((e) =>
    makePointerEventRecord({
      time: Math.max(e.time + offsetSeconds, 0),
      location: e.location,
      kind: e.kind,
      modifiers: e.modifiers,
      cursorAssetID: e.cursorAssetID,
    })
  );

  const zoomClips = AutoZoomPlanner.makeAnimationsFromPointerEvents(alignedEvents, {
    zoomScale: 1.8,
    transitionDuration: 0.7,
  });

  const timeline = makeProjectTimeline({
    zoomClips,
    sourceSequence: makeSourceSequenceFullRecording(),
  });

  const project = makeRecorderProject({
    capture: makeCaptureConfiguration(captureOptions),
    timeline,
    zoomAnimations: zoomClips,
  });

  return project;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/**
 * Orchestrates a complete recording session:
 * 1. Launches mouse hook and waits for header.
 * 2. Launches screen recording (ddagrab).
 * 3. Waits for the requested duration, racing against early ffmpeg failure.
 * 4. Gracefully stops screen recording and mouse hook.
 * 5. Saves pointer.jsonl, meta.json, and project.json.
 *
 * Any failure after the session directory exists removes that directory, so
 * a failed session can never masquerade as a successful recording.
 *
 * @returns The absolute path to the session directory.
 */
export async function recordSession(o: RecordSessionOptions): Promise<string> {
  const fps = o.fps ?? 60;
  const outputIdx = o.outputIdx ?? 0;
  const encoder = o.encoder ?? (await detectEncoder());

  const displays = o.displays ?? (await enumerateDisplays());
  const display = displays.find((d) => d.index === outputIdx);
  if (!display) {
    throw new Error(
      `显示器索引越界: ${outputIdx}；可用索引: ${displays.map((d) => d.index).join(', ') || '无'}`
    );
  }
  const captureGeometry = resolveSessionCaptureGeometry(display, o);

  const id = formatSessionId();
  const baseDir = resolve(o.baseDir ?? 'recordings');

  mkdirSync(baseDir, { recursive: true });
  const sessionDir = allocateUniqueSessionDir(baseDir, id);
  mkdirSync(sessionDir, { recursive: true });

  const screenMp4Path = resolve(sessionDir, 'screen.mp4');
  const pointerJsonlPath = resolve(sessionDir, 'pointer.jsonl');
  const metaJsonPath = resolve(sessionDir, 'meta.json');
  const projectJsonPath = resolve(sessionDir, 'project.json');

  let jsonlStream: WriteStream | null = null;
  let hook: ReturnType<typeof startMouseHook> | null = null;
  let recorder: ReturnType<typeof startScreenRecording> | null = null;
  let isPumping = false;
  let pumpPromise: Promise<void> | null = null;

  try {
    jsonlStream = createWriteStream(pointerJsonlPath, { encoding: 'utf-8' });
    const rawLines: string[] = [];

    // Step 1: Start mouse hook and wait for header. The hook and ffmpeg share
    // the same physical pixel rectangle, including negative-coordinate screens.
    hook = startMouseHook({
      screenBounds: captureGeometry.hookBounds,
    });
    const lineIterator = hook.lines[Symbol.asyncIterator]();

    const firstLineResult = await lineIterator.next();
    if (firstLineResult.done || !firstLineResult.value) {
      throw new Error('未能从鼠标钩子获取表头');
    }

    const headerLine = firstLineResult.value;
    rawLines.push(headerLine);
    jsonlStream.write(headerLine + '\n');

    const headerData = JSON.parse(headerLine);
    if (headerData.hdr !== 1 || typeof headerData.originUnixMs !== 'number') {
      throw new Error('鼠标钩子表头无效');
    }

    const pointerOriginUnixMs = headerData.originUnixMs;

    // Continuously pump remaining mouse events to file and memory.
    isPumping = true;
    pumpPromise = (async () => {
      try {
        while (isPumping) {
          const next = await lineIterator.next();
          if (next.done) break;
          if (next.value) {
            rawLines.push(next.value);
            jsonlStream?.write(next.value + '\n');
          }
        }
      } catch {
        // Stream ending.
      }
    })();

    // Step 2: Start screen recording.
    recorder = startScreenRecording({
      outFile: screenMp4Path,
      fps,
      outputIdx,
      encoder,
      captureMode: captureGeometry.captureMode,
      region: captureGeometry.alignedRegion,
      windowTitle: captureGeometry.windowTitle,
    });

    // Step 3: Wait for the first captured frame, then start the requested
    // duration clock. Spawn-to-first-frame latency must not count as content.
    const firstFrameUnixMs = await Promise.race([
      recorder.ready,
      recorder.exited.then((result) => {
        const tail = result.stderr.trim().slice(-300);
        const reason = result.spawnError
          ? `ffmpeg 启动失败: ${result.spawnError.message}`
          : `ffmpeg 在首帧前退出 (code ${String(result.code)})`;
        throw new Error(tail ? `${reason}: ${tail}` : reason);
      }),
    ]);

    // Step 4: Wait for requested duration. If ffmpeg dies early (invalid
    // display, encoder unavailable, permission error), fail immediately
    // instead of sleeping through the entire requested duration.
    let stoppingNormally = false;
    const requestedWait = sleep(Math.max(o.seconds, 0.5) * 1000);
    const earlyExit = recorder.exited.then((result) => {
      if (stoppingNormally) return;
      if (result.spawnError) {
        throw new Error(`ffmpeg 启动失败: ${result.spawnError.message}`);
      }
      if (result.code !== 0) {
        const tail = result.stderr.trim().slice(-500);
        throw new Error(
          `ffmpeg 提前退出 (code ${String(result.code)})${tail ? `: ${tail}` : ''}`
        );
      }
      const tail0 = result.stderr.trim().slice(-500);
      throw new Error(
        `ffmpeg 在录制结束前提前退出 (code 0)${tail0 ? `: ${tail0}` : ''}`
      );
    });
    await Promise.race([requestedWait, earlyExit]);
    stoppingNormally = true;

    // Step 4: Stop screen recorder and hook.
    await recorder.stop();
    isPumping = false;
    await hook.stop();
    await pumpPromise;
    pumpPromise = null;

    jsonlStream.end();
    await finished(jsonlStream);
    jsonlStream = null;

    // Step 5: Save metadata and project using ffprobe's real media truth.
    // Never fall back to wall-clock duration here: ffmpeg startup/finalization
    // and hook shutdown are not part of the recorded video timeline.
    const probed = await probeMediaFile(screenMp4Path);
    const meta = buildMeta({
      id,
      fps,
      width: probed.width,
      height: probed.height,
      screenStartUnixMs: recorder.screenStartUnixMs,
      spawnUnixMs: recorder.screenStartUnixMs,
      firstFrameUnixMs,
      pointerOriginUnixMs,
      encoder,
      durationSeconds: probed.durationSeconds,
      frameCount: probed.frameCount,
      displayDescriptor: display,
    });
    writeFileSync(metaJsonPath, JSON.stringify(meta, null, 2), 'utf-8');

    // Parse pointer events and generate project.
    const fullJsonlText = rawLines.join('\n');
    const parsed = parsePointerJsonl(fullJsonlText);
    const project = buildProjectFromRecording(
      parsed.events,
      meta.pointerOffsetSeconds,
      probed.durationSeconds,
      {
        source: captureGeometry.captureSource,
        displayID: outputIdx,
        displayName: display.deviceName,
        windowName: captureGeometry.windowTitle ?? null,
        area: captureGeometry.normalizedArea,
        captureFrameRate: fps as OutputFrameRate,
        captureCodec: 'H.264',
        recordsSystemAudio: false,
        recordsMicrophone: false,
        recordsCamera: false,
      }
    );
    writeFileSync(projectJsonPath, encodeRecorderProject(project), 'utf-8');

    return sessionDir;
  } catch (err) {
    // Failure is not a recording. Stop both producers, close the JSONL
    // stream, and remove the partial session directory before surfacing the
    // original error.
    isPumping = false;

    if (hook) {
      await hook.stop().catch(() => {});
    }

    if (pumpPromise) {
      await pumpPromise.catch(() => {});
      pumpPromise = null;
    }

    if (recorder) {
      await recorder.stop().catch(() => {});
    }

    if (jsonlStream) {
      jsonlStream.destroy();
      await finished(jsonlStream).catch(() => {});
      jsonlStream = null;
    }

    rmSync(sessionDir, { recursive: true, force: true });
    throw err;
  }
}
