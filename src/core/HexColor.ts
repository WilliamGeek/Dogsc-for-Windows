// Port of: F:\dogsc\Sources\RecorderCore\HexColor.swift
// EXEMPLAR FILE — shows custom Codable (toJSON/fromJSON), static constants, precondition.
import { precondition } from './swift.ts';

export interface HexColorComponents {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

/** One canonical 24-bit sRGB color value. */
export interface HexColor {
  readonly rgb24: number;
}

/** Swift `init(rgb24:)` — programmer literal, traps if out of range. */
export function makeHexColor(rgb24: number): HexColor {
  precondition(Number.isInteger(rgb24) && rgb24 >= 0 && rgb24 <= 0xffffff, 'HexColor requires a 24-bit RGB value');
  return Object.freeze({ rgb24 });
}

function isASCIIHexDigit(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
}

/** Swift `init?(_ source: String)`: strictly `RRGGBB` or `#RRGGBB`, surrounding whitespace allowed. */
export function parseHexColor(source: string): HexColor | null {
  const trimmed = source.trim();
  const digits = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (digits.length !== 6) return null;
  for (let i = 0; i < digits.length; i++) {
    if (!isASCIIHexDigit(digits.charCodeAt(i))) return null;
  }
  return Object.freeze({ rgb24: parseInt(digits, 16) });
}

export function hexColorComponents(color: HexColor): HexColorComponents {
  return {
    red: ((color.rgb24 >> 16) & 0xff) / 255,
    green: ((color.rgb24 >> 8) & 0xff) / 255,
    blue: (color.rgb24 & 0xff) / 255,
  };
}

/** The sole persisted and display representation: `#RRGGBB` uppercase. */
export function hexColorString(color: HexColor): string {
  return '#' + color.rgb24.toString(16).toUpperCase().padStart(6, '0');
}

export const HexColorWhite = makeHexColor(0xffffff);
export const HexColorBlack = makeHexColor(0x000000);
export const HexColorDefaultBackground = makeHexColor(0x2d3342);

/** Swift `encode(to:)` — single string value. */
export function hexColorToJSON(color: HexColor): string {
  return hexColorString(color);
}

/** Swift `init(from:)` — throws on malformed input. */
export function hexColorFromJSON(value: unknown): HexColor {
  const color = typeof value === 'string' ? parseHexColor(value) : null;
  if (color === null) throw new Error('Expected #RRGGBB or RRGGBB sRGB color');
  return color;
}

