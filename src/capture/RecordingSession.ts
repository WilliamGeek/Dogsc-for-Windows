/**
 * RecordingSession.ts
 *
 * Coordinates screen recording (ffmpeg) and pointer logging (WH_MOUSE_LL),
 * aligns their clocks, and produces a valid RecorderProject ready for editing/rendering.
 * Adheres strictly to docs/CONTRACTS.md §3 and §5.
 */

import { writeFileSync, mkdirSync, createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
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
import { startScreenRecording, detectEncoder, type VideoEncoderKind } from './ScreenRecorder.ts';
import { probeMediaFile } from './MediaProbe.ts';

export interface RecordingMetaInput {
  id: string;
  fps: number;
  width: number;
  height: number;
  screenStartUnixMs: number;
  pointerOriginUnixMs: number;
  encoder: string;
  durationSeconds: number;
  frameCount?: number;
}

export interface RecordingMeta {
  id: string;
  fps: number;
  width: number;
  height: number;
  screenStartUnixMs: number;
  pointerOriginUnixMs: number;
  pointerOffsetSeconds: number;
  encoder: string;
  durationSeconds: number;
  frameCount?: number;
}

export interface RecordSessionOptions {
  seconds: number;
  fps?: number;
  outputIdx?: number;
  encoder?: VideoEncoderKind;
  baseDir?: string;
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
 * Pure function: constructs the metadata object with precise pointerOffsetSeconds.
 * Formula per CONTRACTS.md §3: pointerOffsetSeconds = (pointerOriginUnixMs - screenStartUnixMs) / 1000
 */
export function buildMeta(i: RecordingMetaInput): RecordingMeta {
  const pointerOffsetSeconds = (i.pointerOriginUnixMs - i.screenStartUnixMs) / 1000;
  return {
    id: i.id,
    fps: i.fps,
    width: i.width,
    height: i.height,
    screenStartUnixMs: i.screenStartUnixMs,
    pointerOriginUnixMs: i.pointerOriginUnixMs,
    pointerOffsetSeconds,
    encoder: i.encoder,
    durationSeconds: i.durationSeconds,
    frameCount: i.frameCount,
  };
}

/**
 * Pure function: shifts pointer events by offsetSeconds onto the video timeline
 * and generates a complete, valid RecorderProject with automatic zoom animations.
 */
export function buildProjectFromRecording(
  events: readonly PointerEventRecord[],
  offsetSeconds: number,
  durationSeconds: number
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
    timeline,
    zoomAnimations: zoomClips,
  });

  return project;
}

/**
 * Orchestrates a complete recording session:
 * 1. Launches mouse hook and waits for header.
 * 2. Launches screen recording (ddagrab).
 * 3. Waits for the requested duration.
 * 4. Gracefully stops screen recording and mouse hook.
 * 5. Saves pointer.jsonl, meta.json, and project.json.
 *
 * @returns The absolute path to the session directory.
 */
export async function recordSession(o: RecordSessionOptions): Promise<string> {
  const fps = o.fps ?? 60;
  const outputIdx = o.outputIdx ?? 0;
  const encoder = o.encoder ?? (await detectEncoder());
  const id = formatSessionId();
  const sessionDir = resolve(o.baseDir ?? 'recordings', id);

  mkdirSync(sessionDir, { recursive: true });

  const screenMp4Path = resolve(sessionDir, 'screen.mp4');
  const pointerJsonlPath = resolve(sessionDir, 'pointer.jsonl');
  const metaJsonPath = resolve(sessionDir, 'meta.json');
  const projectJsonPath = resolve(sessionDir, 'project.json');

  const jsonlStream = createWriteStream(pointerJsonlPath, { encoding: 'utf-8' });
  const rawLines: string[] = [];

  // Step 1: Start mouse hook and wait for header
  const hook = startMouseHook();
  const lineIterator = hook.lines[Symbol.asyncIterator]();

  const firstLineResult = await lineIterator.next();
  if (firstLineResult.done || !firstLineResult.value) {
    await hook.stop();
    throw new Error('未能从鼠标钩子获取表头');
  }

  const headerLine = firstLineResult.value;
  rawLines.push(headerLine);
  jsonlStream.write(headerLine + '\n');

  const headerData = JSON.parse(headerLine);
  if (headerData.hdr !== 1 || typeof headerData.originUnixMs !== 'number') {
    await hook.stop();
    throw new Error('鼠标钩子表头无效');
  }

  const pointerOriginUnixMs = headerData.originUnixMs;

  // Continuously pump remaining mouse events to file and memory
  let isPumping = true;
  const pumpPromise = (async () => {
    try {
      while (isPumping) {
        const next = await lineIterator.next();
        if (next.done) break;
        if (next.value) {
          rawLines.push(next.value);
          jsonlStream.write(next.value + '\n');
        }
      }
    } catch {
      // Stream ending
    }
  })();

  // Step 2: Start screen recording
  const recorder = startScreenRecording({
    outFile: screenMp4Path,
    fps,
    outputIdx,
    encoder,
  });

  // Step 3: Wait for requested duration
  await new Promise((r) => setTimeout(r, Math.max(o.seconds, 0.5) * 1000));

  // Step 4: Stop screen recorder and hook
  await recorder.stop();
  isPumping = false;
  await hook.stop();
  await pumpPromise;

  jsonlStream.end();

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
    pointerOriginUnixMs,
    encoder,
    durationSeconds: probed.durationSeconds,
    frameCount: probed.frameCount,
  });
  writeFileSync(metaJsonPath, JSON.stringify(meta, null, 2), 'utf-8');

  // Parse pointer events and generate project
  const fullJsonlText = rawLines.join('\n');
  const parsed = parsePointerJsonl(fullJsonlText);
  const project = buildProjectFromRecording(parsed.events, meta.pointerOffsetSeconds, probed.durationSeconds);
  writeFileSync(projectJsonPath, encodeRecorderProject(project), 'utf-8');

  return sessionDir;
}
