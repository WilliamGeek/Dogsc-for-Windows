// Port of: F:\dogsc\Sources\RecorderCore\CompositionScene.swift
// STATUS: PARTIAL — only L1–L28 (CompositionRect, CompositionPoint) ported in T5.1.
// The rest (ScreenSceneEvaluation … MotionTrackCacheStore, L30–L501) is task T5.5:
// append below this line, do not create a second file.

export interface CompositionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function makeCompositionRect(x: number, y: number, width: number, height: number): CompositionRect {
  return { x, y, width, height };
}

export function compositionRectMidX(rect: CompositionRect): number {
  return rect.x + rect.width / 2;
}

export function compositionRectMidY(rect: CompositionRect): number {
  return rect.y + rect.height / 2;
}

export interface CompositionPoint {
  x: number;
  y: number;
}

export function makeCompositionPoint(x: number, y: number): CompositionPoint {
  return { x, y };
}

