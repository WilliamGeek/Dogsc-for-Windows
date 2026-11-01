// Swift standard-library semantics needed to port RecorderCore faithfully.
//
// RULE: when porting, ALWAYS use these helpers instead of Math.min/Math.max
// for any expression that was `min(...)` / `max(...)` in Swift. Swift and JS
// disagree when NaN is involved, e.g. Swift `max(0, .nan) == 0` but
// `Math.max(0, NaN)` is NaN. RecorderCore relies on these clamps to keep
// NaN out of the renderer.

/** Swift `max(x, y, ...rest)`. Exact stdlib semantics: `y >= x ? y : x`. */
export function max(x: number, y: number, ...rest: number[]): number {
  let result = y >= x ? y : x;
  for (const value of rest) {
    if (value >= result) result = value;
  }
  return result;
}

/** Swift `min(x, y, ...rest)`. Exact stdlib semantics: `y < x ? y : x`. */
export function min(x: number, y: number, ...rest: number[]): number {
  let result = y < x ? y : x;
  for (const value of rest) {
    if (value < result) result = value;
  }
  return result;
}

/** Swift idiom `min(max(value, lower), upper)`. Keep this exact order. */
export function clamp(value: number, lower: number, upper: number): number {
  return min(max(value, lower), upper);
}

/** Swift `value.isFinite`. */
export function isFinite(value: number): boolean {
  return Number.isFinite(value);
}

/** Swift `Int(someDouble)`: truncates toward zero. (Swift traps on NaN/inf; we return 0.) */
export function toInt(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

/** Swift `Double.leastNonzeroMagnitude`. */
export const leastNonzeroMagnitude = Number.MIN_VALUE;
/** Swift `Double.greatestFiniteMagnitude`. */
export const greatestFiniteMagnitude = Number.MAX_VALUE;
/** Swift `Double.ulpOfOne`. */
export const ulpOfOne = Number.EPSILON;
/** Swift `.infinity`. */
export const infinity = Number.POSITIVE_INFINITY;

/** Swift `UUID()` → uuidString (uppercase, like Foundation). */
export function newUUID(): string {
  return crypto.randomUUID().toUpperCase();
}

/**
 * Swift value semantics for structs: `var copy = original` is a copy.
 * In TS objects are references, so copy before mutating. Shallow is enough
 * when nested values are only replaced, never mutated in place.
 */
export function copy<T extends object>(value: T): T {
  return { ...value };
}

/** Swift `precondition(cond, message)`. */
export function precondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`precondition failed: ${message}`);
}

