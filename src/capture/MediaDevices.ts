/**
 * MediaDevices.ts
 *
 * Enumerates Windows DirectShow camera (video) and microphone (audio) devices via FFmpeg.
 */

import { execFile } from 'node:child_process';

export type MediaDeviceKind = 'video' | 'audio';

export interface DirectShowDevice {
  kind: MediaDeviceKind;
  name: string;
  alternativeName: string | null;
}

export interface DirectShowDeviceList {
  video: DirectShowDevice[];
  audio: DirectShowDevice[];
}

/**
 * Pure function: parses `ffmpeg -hide_banner -list_devices true -f dshow -i dummy` stderr output
 * supporting both modern `(video)`/`(audio)` suffix lines and legacy DirectShow section headers,
 * preserving Alternative names and Unicode/CJK device labels while deduplicating endpoints.
 */
export function parseDshowDevicesOutput(stderr: string): DirectShowDeviceList {
  const candidates: DirectShowDevice[] = [];
  let currentSection: MediaDeviceKind | null = null;
  let lastDevice: DirectShowDevice | null = null;

  const lines = stderr.split(/\r?\n/);
  for (const rawLine of lines) {
    const body = rawLine.replace(/^\[[^\]]+\]\s*/, '').trim();
    if (!body) continue;

    if (/^DirectShow video devices\b/i.test(body)) {
      currentSection = 'video';
      lastDevice = null;
      continue;
    }
    if (/^DirectShow audio devices\b/i.test(body)) {
      currentSection = 'audio';
      lastDevice = null;
      continue;
    }

    const altMatch = /^Alternative name\s+"([^"]+)"/i.exec(body);
    if (altMatch && lastDevice) {
      lastDevice.alternativeName = altMatch[1];
      continue;
    }

    const modernMatch = /^"([^"]+)"\s+\((video|audio)(?:,\s*[^)]*)?\)\s*$/i.exec(body);
    if (modernMatch) {
      const name = modernMatch[1];
      const kind = modernMatch[2].toLowerCase() as MediaDeviceKind;
      if (name) {
        const entry: DirectShowDevice = { kind, name, alternativeName: null };
        candidates.push(entry);
        lastDevice = entry;
      }
      continue;
    }

    if (currentSection !== null) {
      const legacyMatch = /^"([^"]+)"\s*$/.exec(body);
      if (legacyMatch && legacyMatch[1]) {
        const entry: DirectShowDevice = {
          kind: currentSection,
          name: legacyMatch[1],
          alternativeName: null,
        };
        candidates.push(entry);
        lastDevice = entry;
      }
    }
  }

  const video: DirectShowDevice[] = [];
  const audio: DirectShowDevice[] = [];
  const seen = new Set<string>();

  for (const dev of candidates) {
    const dedupeKey = `${dev.kind}:${dev.alternativeName ?? dev.name}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    if (dev.kind === 'video') {
      video.push(dev);
    } else {
      audio.push(dev);
    }
  }

  return { video, audio };
}

/**
 * Pure function: chooses unambiguous FFmpeg dshow input identifier
 * (prefers Alternative name `@device_...` when available).
 */
export function selectDirectShowInputSpec(device: DirectShowDevice): string {
  return device.alternativeName ?? device.name;
}

/**
 * Enumerates local DirectShow video and audio capture devices using `ffmpeg`.
 * Note: ffmpeg `-i dummy` always exits non-zero; stderr still carries the device list.
 */
export function enumerateDirectShowDevices(
  options: { ffmpegBin?: string; ffmpegArgsPrefix?: string[] } = {}
): Promise<DirectShowDeviceList> {
  const bin = options.ffmpegBin ?? 'ffmpeg';
  const args = [
    ...(options.ffmpegArgsPrefix ?? []),
    '-hide_banner',
    '-list_devices',
    'true',
    '-f',
    'dshow',
    '-i',
    'dummy',
  ];

  return new Promise<DirectShowDeviceList>((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, _stdout, stderr) => {
        const text = String(stderr ?? '');
        if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error(`DirectShow 设备枚举失败: 未找到可执行文件 ${bin}`));
          return;
        }
        resolve(parseDshowDevicesOutput(text));
      }
    );
  });
}
