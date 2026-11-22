/**
 * WindowEnumeration.ts
 *
 * Enumerates visible top-level Windows windows with physical (Per-Monitor V2)
 * coordinates for single-window (`gdigrab`) capture targeting.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface WindowDescriptor {
  hwnd: string;
  title: string;
  processName: string;
  pid: number;
  x: number;
  y: number;
  width: number;
  height: number;
  isMinimized: boolean;
}

interface RawWindow {
  hwnd?: unknown;
  Hwnd?: unknown;
  HWND?: unknown;
  title?: unknown;
  Title?: unknown;
  processName?: unknown;
  ProcessName?: unknown;
  pid?: unknown;
  Pid?: unknown;
  PID?: unknown;
  isMinimized?: unknown;
  IsMinimized?: unknown;
  x?: unknown;
  X?: unknown;
  y?: unknown;
  Y?: unknown;
  width?: unknown;
  Width?: unknown;
  height?: unknown;
  Height?: unknown;
  bounds?: Record<string, unknown>;
  Bounds?: Record<string, unknown>;
}

function finiteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses the JSON emitted by PowerShell's window enumeration script.
 *
 * Strips UTF-8 BOM, accepts either a single object or array, filters out
 * minimized / untitled / zero-area windows, and preserves negative multi-monitor coords.
 */
export function parseWindowsJson(stdout: string): WindowDescriptor[] {
  const text = stdout.replace(/^\uFEFF/, '').trim();
  if (!text) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`窗口枚举 JSON 无效: ${(err as Error).message}`);
  }

  const items: RawWindow[] = Array.isArray(raw) ? raw : [raw as RawWindow];
  const result: WindowDescriptor[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;

    const rawTitle = item.title ?? item.Title;
    const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
    if (!title) continue;

    const isMinimized = Boolean(item.isMinimized ?? item.IsMinimized ?? false);
    if (isMinimized) continue;

    const bounds = item.Bounds ?? item.bounds;
    const x = finiteNumber(item.x ?? item.X ?? bounds?.x ?? bounds?.X);
    const y = finiteNumber(item.y ?? item.Y ?? bounds?.y ?? bounds?.Y);
    const width = finiteNumber(item.width ?? item.Width ?? bounds?.width ?? bounds?.Width);
    const height = finiteNumber(item.height ?? item.Height ?? bounds?.height ?? bounds?.Height);
    if (x === null || y === null || width === null || height === null) continue;
    if (width <= 0 || height <= 0) continue;

    const rawHwnd = item.hwnd ?? item.Hwnd ?? item.HWND ?? '';
    const hwnd = typeof rawHwnd === 'string' ? rawHwnd : String(rawHwnd);
    const rawProc = item.processName ?? item.ProcessName ?? '';
    const processName = typeof rawProc === 'string' ? rawProc : '';
    const pid = finiteNumber(item.pid ?? item.Pid ?? item.PID) ?? 0;

    result.push({
      hwnd,
      title,
      processName,
      pid: Math.max(0, Math.trunc(pid)),
      x,
      y,
      width,
      height,
      isMinimized: false,
    });
  }

  return result;
}

/**
 * Runs a no-Bypass PowerShell process enabling Per-Monitor V2 DPI awareness
 * and enumerates visible non-minimized top-level windows with physical bounds.
 */
export async function enumerateWindows(): Promise<WindowDescriptor[]> {
  const script = [
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Collections.Generic;',
    'using System.Runtime.InteropServices;',
    'using System.Text;',
    'public static class DogSCWindowEnum {',
    '  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }',
    '  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);',
    '  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);',
    '  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();',
    '  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);',
    '  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);',
    '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);',
    '  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);',
    '  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);',
    '  public static void EnableDpi() {',
    '    try { if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware(); }',
    '    catch { try { SetProcessDPIAware(); } catch { } }',
    '  }',
    '  public static object[] Collect() {',
    '    EnableDpi();',
    '    var list = new List<object>();',
    '    EnumWindows((hWnd, lParam) => {',
    '      if (!IsWindowVisible(hWnd) || IsIconic(hWnd)) return true;',
    '      int len = GetWindowTextLength(hWnd);',
    '      if (len <= 0) return true;',
    '      var sb = new StringBuilder(len + 1);',
    '      GetWindowText(hWnd, sb, sb.Capacity);',
    '      string title = sb.ToString().Trim();',
    '      if (string.IsNullOrEmpty(title)) return true;',
    '      RECT r;',
    '      if (!GetWindowRect(hWnd, out r)) return true;',
    '      int w = r.Right - r.Left;',
    '      int h = r.Bottom - r.Top;',
    '      if (w <= 0 || h <= 0) return true;',
    '      uint pid = 0;',
    '      GetWindowThreadProcessId(hWnd, out pid);',
    '      string procName = "";',
    '      try { procName = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch { }',
    '      list.Add(new { hwnd = "0x" + hWnd.ToInt64().ToString("x"), title = title, processName = procName, pid = (int)pid, x = r.Left, y = r.Top, width = w, height = h, isMinimized = false });',
    '      return true;',
    '    }, IntPtr.Zero);',
    '    return list.ToArray();',
    '  }',
    '}',
    '"@',
    '$items = [DogSCWindowEnum]::Collect()',
    'if ($items.Count -eq 0) { "[]" } else { ConvertTo-Json -InputObject $items -Depth 3 }',
  ].join('\n');

  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-Command', script],
    { timeout: 10_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }
  );

  return parseWindowsJson(stdout);
}
