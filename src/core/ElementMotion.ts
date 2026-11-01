// Port of: F:\dogsc\Sources\RecorderCore\ElementMotion.swift
// EXEMPLAR FILE — shows how a Swift `enum: String` + a static-func namespace is ported.
import { clamp } from './swift.ts';

/**
 * A reusable timing language for authored element entrances and exits.
 * Swift: `enum ElementMotionCurve: String, CaseIterable, Codable`.
 * Ported as a string-literal union + a frozen `allCases` list
 * (TS `enum` is forbidden — Node type-stripping cannot run it).
 */
export type ElementMotionCurve =
  /** Slow at both ends. Best for restrained presentation graphics. */
  | 'smooth'
  /** Starts decisively and settles gently. Compatibility default. */
  | 'swift'
  /** A softer ease-out with less initial acceleration than `swift`. */
  | 'gentle';

export const ElementMotionCurveAllCases: readonly ElementMotionCurve[] = Object.freeze([
  'smooth',
  'swift',
  'gentle',
]);

/**
 * Evaluates a normalized progress value without depending on any render
 * backend. Exit animation passes its remaining progress (1 -> 0), so the
 * same curve naturally settles at the target before accelerating away.
 * Swift: `ElementMotionEvaluator.progress(_:curve:)`.
 */
function progress(linearProgress: number, curve: ElementMotionCurve): number {
  const x = clamp(Number.isFinite(linearProgress) ? linearProgress : 0, 0, 1);
  switch (curve) {
    case 'smooth':
      return x * x * x * (x * (x * 6 - 15) + 10);
    case 'swift':
      return 1 - Math.pow(1 - x, 4);
    case 'gentle':
      return 1 - Math.pow(1 - x, 3);
  }
}

/** Swift `enum ElementMotionEvaluator` (caseless enum = namespace). */
export const ElementMotionEvaluator = Object.freeze({ progress });

