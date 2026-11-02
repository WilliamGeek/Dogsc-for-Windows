/**
 * PointerJsonl.ts
 *
 * Parses mouse pointer event streams recorded in JSONL format.
 * Adheres strictly to docs/CONTRACTS.md §2.
 */

import {
  makePointerEventRecord,
  makeNormalizedPoint,
  type PointerEventRecord,
  type PointerEventKind,
} from '../core/ZoomAnimation.ts';

export interface PointerScreenBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ParsedPointerJsonl {
  originUnixMs: number;
  screen: PointerScreenBounds;
  events: PointerEventRecord[];
}

const VALID_KINDS = new Set<PointerEventKind>(['move', 'leftClick', 'rightClick']);

/**
 * Parses pointer.jsonl text into structured header and normalized event records.
 *
 * @param text The raw JSONL content (UTF-8 string with \n or \r\n line delimiters)
 * @returns Parsed header (originUnixMs, screen) and events sorted by time
 * @throws Error if header line is missing or invalid
 */
export function parsePointerJsonl(text: string): ParsedPointerJsonl {
  const lines = text.split(/\r?\n/);

  let headerIndex = -1;
  let originUnixMs = 0;
  let screen: PointerScreenBounds | null = null;

  // Locate the header line (first non-empty line)
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0) continue;

    try {
      const parsed = JSON.parse(trimmed);
      if (
        parsed &&
        parsed.hdr === 1 &&
        typeof parsed.originUnixMs === 'number' &&
        parsed.screen &&
        typeof parsed.screen.x === 'number' &&
        typeof parsed.screen.y === 'number' &&
        typeof parsed.screen.w === 'number' &&
        typeof parsed.screen.h === 'number' &&
        parsed.screen.w > 0 &&
        parsed.screen.h > 0
      ) {
        originUnixMs = parsed.originUnixMs;
        screen = {
          x: parsed.screen.x,
          y: parsed.screen.y,
          w: parsed.screen.w,
          h: parsed.screen.h,
        };
        headerIndex = i;
        break;
      }
    } catch {
      // If the first non-empty line fails to parse as header, fail
      break;
    }
    // Only check the first non-empty line for header
    break;
  }

  if (headerIndex === -1 || !screen) {
    throw new Error('pointer.jsonl 缺少表头');
  }

  const events: PointerEventRecord[] = [];

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0) continue;

    try {
      const item = JSON.parse(trimmed);
      if (!item || typeof item !== 'object') continue;

      if (!VALID_KINDS.has(item.k)) continue;
      if (typeof item.t !== 'number' || !Number.isFinite(item.t)) continue;
      if (typeof item.x !== 'number' || !Number.isFinite(item.x)) continue;
      if (typeof item.y !== 'number' || !Number.isFinite(item.y)) continue;

      const rawNx = (item.x - screen.x) / screen.w;
      const rawNy = (item.y - screen.y) / screen.h;

      const nx = Math.min(Math.max(rawNx, 0), 1);
      const ny = Math.min(Math.max(rawNy, 0), 1);

      events.push(
        makePointerEventRecord({
          time: item.t,
          location: makeNormalizedPoint(nx, ny),
          kind: item.k,
        })
      );
    } catch {
      // Ignore unparseable lines as per contract
      continue;
    }
  }

  // Stable sort by ascending timestamp
  events.sort((a, b) => a.time - b.time);

  return {
    originUnixMs,
    screen,
    events,
  };
}
