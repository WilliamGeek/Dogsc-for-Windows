/**
 * SegmentedSession.ts
 *
 * Implements pause/resume lossless segmented media concatenation via FFmpeg's concat
 * demuxer, seamless pointer timeline stitching across paused gaps, and a live
 * pause-aware RecordingMarker clock for hotkey bookmarking during capture.
 */

import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { makeRecordingMarker, type RecordingMarker } from '../core/RecordingMarker.ts';
import { makePointerEventRecord, type PointerEventRecord } from '../core/ZoomAnimation.ts';

export interface PointerSegmentSlice {
  durationSeconds: number;
  events: readonly PointerEventRecord[];
}

export interface MarkerHotkeySpec {
  primary: string;
  fallback: string;
  description: string;
}

/**
 * Pure function: formats an FFmpeg concat demuxer file list (`concat_list.txt`),
 * normalizing backslashes and escaping single quotes safely.
 */
export function buildConcatListFileContent(segmentPaths: readonly string[]): string {
  if (!segmentPaths || segmentPaths.length === 0) {
    throw new Error('分段拼接需要至少一个媒体分段文件');
  }

  const lines = segmentPaths.map((raw) => {
    const trimmed = raw?.trim() ?? '';
    if (!trimmed) {
      throw new Error('分段路径不能为空');
    }
    const normalized = trimmed.replace(/\\/g, '/').replace(/'/g, "'\\''");
    return `file '${normalized}'`;
  });

  return `${lines.join('\n')}\n`;
}

/**
 * Pure function: builds FFmpeg `-f concat -safe 0 -c copy` lossless concatenation arguments.
 */
export function buildLosslessConcatArgs(concatListPath: string, outFile: string): string[] {
  return ['-y', '-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', outFile];
}

/**
 * Pure function: stitches pointer tracks recorded across multiple resumed segments
 * into a single continuous timeline, dropping paused wall-clock gaps cleanly.
 */
export function stitchSegmentedPointerTracks(
  segments: readonly PointerSegmentSlice[]
): PointerEventRecord[] {
  const result: PointerEventRecord[] = [];
  let accumulatedOffset = 0;

  for (const seg of segments) {
    const segDuration =
      Number.isFinite(seg.durationSeconds) && seg.durationSeconds > 0 ? seg.durationSeconds : 0;

    for (const evt of seg.events) {
      result.push(
        makePointerEventRecord({
          time: Math.max(0, evt.time) + accumulatedOffset,
          location: evt.location,
          kind: evt.kind,
          modifiers: evt.modifiers,
          cursorAssetID: evt.cursorAssetID,
        })
      );
    }

    accumulatedOffset += segDuration;
  }

  return result;
}

/**
 * Pure function: returns the default global hotkey bindings for live marker stamping.
 */
export function buildMarkerHotkeySpec(): MarkerHotkeySpec {
  return {
    primary: 'Ctrl+Shift+M',
    fallback: 'F8',
    description: '录制中在当前活跃时间点打下编号标记 (RecordingMarker)',
  };
}

/**
 * Pause-aware live recording clock that stamps numbered `RecordingMarker` notes
 * on active recording time (excluding any paused wall-clock intervals).
 */
export class LiveRecordingMarkerRecorder {
  private startMs: number | null = null;
  private pausedAtMs: number | null = null;
  private accumulatedPausedMs = 0;
  private readonly list: RecordingMarker[] = [];

  start(nowMs: number = Date.now()): void {
    this.startMs = nowMs;
    this.pausedAtMs = null;
    this.accumulatedPausedMs = 0;
  }

  pause(nowMs: number = Date.now()): void {
    if (this.startMs === null) {
      this.start(nowMs);
    }
    if (this.pausedAtMs !== null) {
      return;
    }
    this.pausedAtMs = nowMs;
  }

  resume(nowMs: number = Date.now()): void {
    if (this.pausedAtMs === null) {
      return;
    }
    this.accumulatedPausedMs += Math.max(0, nowMs - this.pausedAtMs);
    this.pausedAtMs = null;
  }

  isPaused(): boolean {
    return this.pausedAtMs !== null;
  }

  activeDurationSeconds(nowMs: number = Date.now()): number {
    if (this.startMs === null) {
      return 0;
    }
    const effectiveNow = this.pausedAtMs !== null ? this.pausedAtMs : nowMs;
    const elapsedMs = effectiveNow - this.startMs - this.accumulatedPausedMs;
    return Math.max(0, elapsedMs / 1000);
  }

  stamp(nowMs: number = Date.now(), sourceID?: string | null): RecordingMarker {
    if (this.startMs === null) {
      this.start(nowMs);
    }
    const marker = makeRecordingMarker({
      sourceTime: this.activeDurationSeconds(nowMs),
      number: this.list.length + 1,
      sourceID: sourceID ?? null,
    });
    this.list.push(marker);
    return marker;
  }

  markers(): RecordingMarker[] {
    return this.list.slice();
  }
}

/**
 * Losslessly concatenates multiple recorded media segments (`-c copy`) via FFmpeg concat demuxer.
 */
export async function concatMediaSegmentsLossless(
  segmentPaths: readonly string[],
  outFile: string,
  options?: { ffmpegBin?: string; tempDir?: string }
): Promise<string> {
  const resolvedOut = resolve(outFile);
  const outDir = dirname(resolvedOut);
  const tempDir = options?.tempDir ? resolve(options.tempDir) : outDir;
  await mkdir(outDir, { recursive: true });
  await mkdir(tempDir, { recursive: true });

  const resolvedSegments = segmentPaths.map((p) => resolve(p));
  const listContent = buildConcatListFileContent(resolvedSegments);
  const listPath = resolve(
    tempDir,
    `.concat-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`
  );
  await writeFile(listPath, listContent, 'utf-8');

  try {
    const args = buildLosslessConcatArgs(listPath, resolvedOut);
    await new Promise<void>((resolvePromise, reject) => {
      const proc = spawn(options?.ffmpegBin ?? 'ffmpeg', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stderr = '';
      proc.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) {
          resolvePromise();
        } else {
          reject(new Error(`ffmpeg 分段无损拼接失败 (code ${String(code)}):\n${stderr.slice(-800)}`));
        }
      });
    });
    return resolvedOut;
  } finally {
    await rm(listPath, { force: true }).catch(() => {});
  }
}
