/**
 * FramePlan.ts
 *
 * Computes exact frame-by-frame rendering schedules and evaluates FrameScene
 * for each output frame index.
 * Shared between Node.js and Browser WebGL2 renderer.
 * Strictly adheres to docs/CONTRACTS.md §4. NO node:* imports.
 */

import {
  type FrameScene,
  FrameSceneEvaluator,
  makeCompositionSize,
} from '../core/FrameScene.ts';
import {
  makeOutputFrameSchedule,
  outputFrameScheduleFrame,
} from '../core/OutputFrameSchedule.ts';
import { TimelineMap } from '../core/TimelineMap.ts';
import { ProjectPointerTrack } from '../core/ProjectPointerTrack.ts';
import { makeCursorAssetMetrics } from '../core/CursorRenderGeometry.ts';
import { HexColorWhite } from '../core/HexColor.ts';
import type { RecorderProject } from '../core/ProjectMediaModel.ts';
import type { PointerEventRecord } from '../core/ZoomAnimation.ts';
import type { OutputFrameRate } from '../core/CaptureConfiguration.ts';

export interface FramePlanInput {
  project: RecorderProject;
  pointerEvents: PointerEventRecord[];
  fps: number;
  durationSeconds: number;
  sourceFrameCount: number;
  canvas: { width: number; height: number };
}

export interface FramePlanResult {
  frameCount: number;
  frameAt(n: number): { scene: FrameScene; sourceFrameFile: number };
}

/**
 * Builds a deterministic FramePlan for rendering and exporting.
 */
export function makeFramePlan(i: FramePlanInput): FramePlanResult {
  const safeFps = i.fps > 0 ? i.fps : 60;
  const safeDuration = Number.isFinite(i.durationSeconds) && i.durationSeconds > 0 ? i.durationSeconds : 0.001;
  const schedule = makeOutputFrameSchedule(safeDuration, safeFps as OutputFrameRate);

  const timelineMap = new TimelineMap(i.project.timeline.sourceSequence, safeDuration);
  const pointerTrack = new ProjectPointerTrack(timelineMap, i.pointerEvents);
  const canvasSize = makeCompositionSize(i.canvas.width, i.canvas.height);
  const sourceAspectRatio = i.canvas.width / (i.canvas.height > 0 ? i.canvas.height : 1);

  const cursorMetrics = makeCursorAssetMetrics({
    hotspot: { x: 0, y: 0 },
    intrinsicSize: { width: 32, height: 32 },
    clickColor: HexColorWhite,
  });

  return {
    frameCount: schedule.frameCount,
    frameAt(n: number) {
      const safeN = Math.min(Math.max(n, 0), Math.max(schedule.frameCount - 1, 0));
      const frame = outputFrameScheduleFrame(schedule, safeN);
      const tOut = frame ? frame.presentationTimeSeconds : safeN / safeFps;

      const sourceTime = timelineMap.sourceTime(tOut) ?? tOut;
      const rawFrame = Math.round(sourceTime * safeFps) + 1;
      const sourceFrameFile = Math.min(Math.max(rawFrame, 1), Math.max(i.sourceFrameCount, 1));

      const scene = FrameSceneEvaluator.scene(
        i.project,
        tOut,
        safeDuration,
        canvasSize,
        sourceAspectRatio,
        null, // cameraSourceSize
        pointerTrack,
        null, // pointerEvaluation
        cursorMetrics
      );

      return {
        scene,
        sourceFrameFile,
      };
    },
  };
}
