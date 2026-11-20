/**
 * DisplayEnumeration.ts
 *
 * Enumerates Windows displays with physical (Per-Monitor V2) coordinates.
 * The descriptor is the single source of truth for capture output index,
 * pointer-hook bounds, and mixed-DPI negative-coordinate screens.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface DisplayDescriptor {
  index: number;
  deviceName: string;
  isPrimary: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RawDisplay {
  index?: unknown;
  Index?: unknown;
  deviceName?: unknown;
  DeviceName?: unknown;
  isPrimary?: unknown;
  Primary?: unknown;
  primary?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  Bounds?: {
    X?: unknown;
    Y?: unknown;
    Width?: unknown;
    Height?: unknown;
    x?: unknown;
    y?: unknown;
    width?: unknown;
    height?: unknown;
  };
  bounds?: {
    X?: unknown;
    Y?: unknown;
    Width?: unknown;
    Height?: unknown;
    x?: unknown;
    y?: unknown;
    width?: unknown;
    height?: unknown;
  };
}

function finiteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses the JSON emitted by PowerShell's Screen enumeration.
 *
 * Accepts a single object or an array, plus both camelCase descriptors and
 * PowerShell's `DeviceName` / `Primary` / `Bounds` shape. Primary is sorted
 * first when no explicit `index` is supplied; negative coordinates are kept.
 */
export function parseDisplaysJson(stdout: string): DisplayDescriptor[] {
  const text = stdout.replace(/^\uFEFF/, '').trim();
  if (!text) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`显示器枚举 JSON 无效: ${(err as Error).message}`);
  }

  const items: RawDisplay[] = Array.isArray(raw) ? raw : [raw as RawDisplay];
  const candidates: Array<DisplayDescriptor & { explicitIndex: number | null; originalOrder: number }> = [];

  items.forEach((item, originalOrder) => {
    if (!item || typeof item !== 'object') return;

    const bounds = item.Bounds ?? item.bounds;
    const x = finiteNumber(item.x ?? bounds?.x ?? bounds?.X);
    const y = finiteNumber(item.y ?? bounds?.y ?? bounds?.Y);
    const width = finiteNumber(item.width ?? bounds?.width ?? bounds?.Width);
    const height = finiteNumber(item.height ?? bounds?.height ?? bounds?.Height);

    if (x === null || y === null || width === null || height === null) return;
    if (width <= 0 || height <= 0) return;

    const explicitIndex = finiteNumber(item.index ?? item.Index);
    const isPrimary = Boolean(item.isPrimary ?? item.Primary ?? item.primary ?? false);
    const deviceNameValue = item.deviceName ?? item.DeviceName;

    candidates.push({
      index: explicitIndex === null ? originalOrder : explicitIndex,
      deviceName:
        typeof deviceNameValue === 'string' && deviceNameValue.length > 0
          ? deviceNameValue
          : `\\\\.\\DISPLAY${originalOrder + 1}`,
      isPrimary,
      x,
      y,
      width,
      height,
      explicitIndex,
      originalOrder,
    });
  });

  candidates.sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.originalOrder - b.originalOrder;
  });

  const hasExplicitIndex = candidates.some((d) => d.explicitIndex !== null);

  return candidates.map((d, order) => ({
    index: hasExplicitIndex ? d.index : order,
    deviceName: d.deviceName,
    isPrimary: d.isPrimary,
    x: d.x,
    y: d.y,
    width: d.width,
    height: d.height,
  }));
}

/**
 * Runs a no-Bypass PowerShell process that enables Per-Monitor V2 DPI awareness
 * before reading Screen.AllScreens, then parses the JSON.
 */
export async function enumerateDisplays(): Promise<DisplayDescriptor[]> {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class DogSCDisplayDpi {',
    '  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);',
    '  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();',
    '  public static void Enable() {',
    '    try { if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware(); }',
    '    catch { try { SetProcessDPIAware(); } catch { } }',
    '  }',
    '}',
    '"@',
    '[DogSCDisplayDpi]::Enable()',
    '[System.Windows.Forms.Screen]::AllScreens | ForEach-Object {',
    '  [PSCustomObject]@{',
    '    DeviceName = $_.DeviceName;',
    '    Primary = $_.Primary;',
    '    Bounds = [PSCustomObject]@{ X = $_.Bounds.X; Y = $_.Bounds.Y; Width = $_.Bounds.Width; Height = $_.Bounds.Height }',
    '  }',
    '} | ConvertTo-Json -Depth 3',
  ].join('\n');

  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-Command', script],
    { timeout: 10_000, windowsHide: true, maxBuffer: 1024 * 1024 }
  );

  const displays = parseDisplaysJson(stdout);
  if (displays.length === 0) {
    throw new Error('未能枚举到任何显示器');
  }
  return displays;
}
