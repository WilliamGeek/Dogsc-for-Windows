/**
 * src/server/MediaAssetsService.ts
 *
 * Manages session media asset storage, SoundSynth WAV generation,
 * native/FFmpeg audio waveform peak caching, and multi-recording merge (`RecordingProjectImport`).
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  SOUND_EFFECT_PRESETS,
  writeSoundEffectFile,
  type SoundEffectPresetId,
} from './../render/SoundSynth.ts';
import {
  makeAudioClip,
  makeMediaAsset,
  type AudioClip,
  type MediaAsset,
  type MediaAssetKind,
} from '../core/PostProductionModel.ts';
import { makeOverlayTiming } from '../core/OverlayTimeline.ts';
import {
  decodeRecorderProject,
  makeProjectMediaManifest,
  makeProjectMediaReference,
  type RecorderProject,
} from '../core/ProjectMediaModel.ts';
import { ProjectValidator } from '../core/ProjectValidator.ts';
import { inserting } from '../core/RecordingProjectImport.ts';
import { projectSources, RecordingSourcePrimaryID } from '../core/RecordingSource.ts';
import { TimelineMap } from '../core/TimelineMap.ts';

const SAFE_ASSET_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.svg',
  '.dmhtml',
  '.wav',
  '.mp3',
  '.m4a',
  '.mp4',
]);

export function sanitizeAssetFileName(rawName: string): string {
  const base = basename(String(rawName || 'asset')).replace(/\0/g, '').trim();
  const ext = extname(base).toLowerCase();
  const safeExt = SAFE_ASSET_EXTENSIONS.has(ext) ? ext : '.bin';
  const stem = base
    .slice(0, ext ? base.length - ext.length : base.length)
    .replace(/[^a-zA-Z0-9._-\u4e00-\u9fa5]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  const stamp = Date.now().toString(36);
  const finalStem = stem || `asset-${stamp}`;
  return `${finalStem}-${stamp}${safeExt}`;
}

export function inferAssetKind(fileName: string, explicit?: string): MediaAssetKind {
  if (explicit === 'image' || explicit === 'audio' || explicit === 'video' || explicit === 'animation') {
    return explicit;
  }
  const ext = extname(fileName).toLowerCase();
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp' || ext === '.svg') {
    return 'image';
  }
  if (ext === '.wav' || ext === '.mp3' || ext === '.m4a') {
    return 'audio';
  }
  if (ext === '.dmhtml') {
    return 'animation';
  }
  return 'video';
}

export function saveUploadedMediaAsset(
  sessionDir: string,
  opts: { fileName: string; base64Data: string; kind?: string }
): { asset: MediaAsset; relativePath: string; sizeBytes: number } {
  const safeName = sanitizeAssetFileName(opts.fileName);
  const assetsDir = join(sessionDir, 'assets');
  mkdirSync(assetsDir, { recursive: true });
  const cleanedB64 = String(opts.base64Data ?? '').replace(/^data:[^;]+;base64,/i, '').trim();
  const buf = Buffer.from(cleanedB64, 'base64');
  if (buf.byteLength === 0) {
    throw new Error('上传文件内容为空');
  }
  const absPath = join(assetsDir, safeName);
  writeFileSync(absPath, buf);
  const relativePath = `assets/${safeName}`;
  const kind = inferAssetKind(safeName, opts.kind);
  const asset = makeMediaAsset({
    path: relativePath,
    kind,
    name: basename(opts.fileName || safeName),
  });
  return { asset, relativePath, sizeBytes: buf.byteLength };
}

export function applyUploadedAssetToProject(
  project: RecorderProject,
  sessionDir: string,
  rawSourceDuration: number,
  body: {
    fileName: string;
    base64Data: string;
    kind?: string;
    applyAsWallpaper?: boolean;
    insertOnTimeline?: boolean;
    startTime?: number;
  }
): { project: RecorderProject; asset: MediaAsset; sizeBytes: number } {
  const saved = saveUploadedMediaAsset(sessionDir, body);
  let next: RecorderProject = {
    ...project,
    timeline: {
      ...project.timeline,
      mediaAssets: [...project.timeline.mediaAssets, saved.asset],
    },
  };

  if (saved.asset.kind === 'image' && body.applyAsWallpaper) {
    next = {
      ...next,
      canvas: {
        ...next.canvas,
        backgroundSource: {
          kind: 'projectImage',
          relativePath: saved.relativePath,
        },
      },
    };
  } else if (saved.asset.kind === 'audio' && body.insertOnTimeline) {
    const start = Math.max(0, Number(body.startTime) || 0);
    const clip = makeAudioClip({
      timing: makeOverlayTiming(start, Math.max(1, Math.min(8, rawSourceDuration - start))),
      sourcePath: saved.relativePath,
      kind: 'music',
      ducksUnderSpeech: true,
    });
    next = {
      ...next,
      timeline: {
        ...next.timeline,
        audioClips: [...next.timeline.audioClips, clip],
      },
    };
  }

  ProjectValidator.validate(next);
  return { project: next, asset: saved.asset, sizeBytes: saved.sizeBytes };
}

export function createSoundEffectAsset(
  sessionDir: string,
  opts: { preset: SoundEffectPresetId; startTime: number }
): { asset: MediaAsset; audioClip: AudioClip; relativePath: string } {
  const info = SOUND_EFFECT_PRESETS.find((p) => p.id === opts.preset);
  if (!info) {
    throw new Error(`未知内置音效预设: ${String(opts.preset)}`);
  }
  const fileName = `sfx-${info.id}-${Date.now().toString(36)}.wav`;
  const relativePath = `assets/${fileName}`;
  const absPath = join(sessionDir, 'assets', fileName);
  writeSoundEffectFile(info.id, absPath);

  const asset = makeMediaAsset({
    path: relativePath,
    kind: 'audio',
    name: `${info.label}.wav`,
  });
  const start = Math.max(0, Number.isFinite(opts.startTime) ? opts.startTime : 0);
  const audioClip = makeAudioClip({
    timing: makeOverlayTiming(start, info.durationSeconds),
    sourcePath: relativePath,
    kind: 'effect',
    volume: 0.85,
    ducksUnderSpeech: false,
  });
  return { asset, audioClip, relativePath };
}

export function applySoundEffectToProject(
  project: RecorderProject,
  sessionDir: string,
  body: { preset: SoundEffectPresetId; startTime?: number }
): { project: RecorderProject; asset: MediaAsset; audioClip: AudioClip } {
  const created = createSoundEffectAsset(sessionDir, {
    preset: body.preset,
    startTime: Number(body.startTime) || 0,
  });
  const next: RecorderProject = {
    ...project,
    timeline: {
      ...project.timeline,
      mediaAssets: [...project.timeline.mediaAssets, created.asset],
      audioClips: [...project.timeline.audioClips, created.audioClip],
    },
  };
  ProjectValidator.validate(next);
  return { project: next, asset: created.asset, audioClip: created.audioClip };
}

/**
 * Pure fast RIFF/WAVE 16-bit PCM peak bucketing without spawning external processes.
 */
export function parseWavPcm16Peaks(
  buf: Buffer,
  samples: number = 160
): { durationSeconds: number; peaks: number[] } | null {
  if (buf.byteLength < 44) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }

  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let audioFormat = 0;
  let dataOffset = -1;
  let dataSize = 0;

  let pos = 12;
  while (pos + 8 <= buf.byteLength) {
    const chunkId = buf.toString('ascii', pos, pos + 4);
    const chunkSize = buf.readUInt32LE(pos + 4);
    const bodyStart = pos + 8;
    if (chunkId === 'fmt ' && bodyStart + 16 <= buf.byteLength) {
      audioFormat = buf.readUInt16LE(bodyStart);
      channels = buf.readUInt16LE(bodyStart + 2);
      sampleRate = buf.readUInt32LE(bodyStart + 4);
      bitsPerSample = buf.readUInt16LE(bodyStart + 14);
    } else if (chunkId === 'data') {
      dataOffset = bodyStart;
      dataSize = Math.min(chunkSize, Math.max(0, buf.byteLength - bodyStart));
      break;
    }
    pos = bodyStart + chunkSize + (chunkSize & 1);
  }

  if (audioFormat !== 1 || bitsPerSample !== 16 || channels <= 0 || sampleRate <= 0 || dataOffset < 0 || dataSize <= 0) {
    return null;
  }

  const bytesPerFrame = channels * 2;
  const totalFrames = Math.floor(dataSize / bytesPerFrame);
  if (totalFrames <= 0) return null;

  const bucketCount = Math.max(8, Math.min(1024, Math.round(samples)));
  const peaks = new Array<number>(bucketCount).fill(0);

  for (let b = 0; b < bucketCount; b++) {
    const startFrame = Math.floor((b * totalFrames) / bucketCount);
    const endFrame = Math.max(startFrame + 1, Math.floor(((b + 1) * totalFrames) / bucketCount));
    const stride = Math.max(1, Math.floor((endFrame - startFrame) / 120));
    let maxAmp = 0;
    for (let f = startFrame; f < endFrame; f += stride) {
      const frameByte = dataOffset + f * bytesPerFrame;
      for (let ch = 0; ch < channels; ch++) {
        const s = Math.abs(buf.readInt16LE(frameByte + ch * 2)) / 32768;
        if (s > maxAmp) maxAmp = s;
      }
    }
    peaks[b] = Number(Math.min(1, maxAmp).toFixed(4));
  }

  return {
    durationSeconds: Number((totalFrames / sampleRate).toFixed(3)),
    peaks,
  };
}

export interface WaveformPayload {
  ok: true;
  hasAudio: boolean;
  source: 'mic' | 'system' | 'none';
  durationSeconds: number;
  peaks: number[];
}

export function extractAudioWaveformPeaks(
  sessionDir: string,
  options: { samples?: number } = {}
): WaveformPayload {
  const samples = Math.max(16, Math.min(512, Math.round(options.samples ?? 160)));
  const candidates: Array<{ file: string; source: 'mic' | 'system' }> = [
    { file: join(sessionDir, 'mic-audio.wav'), source: 'mic' },
    { file: join(sessionDir, 'system-audio.wav'), source: 'system' },
  ];
  const hit = candidates.find((c) => existsSync(c.file));
  if (!hit) {
    return {
      ok: true,
      hasAudio: false,
      source: 'none',
      durationSeconds: 0,
      peaks: new Array<number>(samples).fill(0),
    };
  }

  const st = statSync(hit.file);
  const cachePath = join(sessionDir, '.waveform.json');
  if (existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
      if (
        cached &&
        cached.source === hit.source &&
        cached.size === st.size &&
        cached.mtimeMs === st.mtimeMs &&
        Array.isArray(cached.peaks) &&
        cached.peaks.length === samples
      ) {
        return {
          ok: true,
          hasAudio: true,
          source: hit.source,
          durationSeconds: Number(cached.durationSeconds) || 0,
          peaks: cached.peaks,
        };
      }
    } catch {
      // Cache stale/corrupt; recompute
    }
  }

  const rawBuf = readFileSync(hit.file);
  let parsed = parseWavPcm16Peaks(rawBuf, samples);

  if (!parsed) {
    const ff = spawnSync(
      'ffmpeg',
      ['-v', 'error', '-i', hit.file, '-ac', '1', '-ar', '2000', '-f', 'f32le', 'pipe:1'],
      { maxBuffer: 64 * 1024 * 1024, windowsHide: true }
    );
    if (ff.status === 0 && ff.stdout && ff.stdout.byteLength >= 4) {
      const floats = new Float32Array(
        ff.stdout.buffer,
        ff.stdout.byteOffset,
        Math.floor(ff.stdout.byteLength / 4)
      );
      const peaks = new Array<number>(samples).fill(0);
      for (let b = 0; b < samples; b++) {
        const s0 = Math.floor((b * floats.length) / samples);
        const s1 = Math.max(s0 + 1, Math.floor(((b + 1) * floats.length) / samples));
        let maxAmp = 0;
        for (let i = s0; i < s1; i++) {
          const a = Math.abs(floats[i]);
          if (a > maxAmp) maxAmp = a;
        }
        peaks[b] = Number(Math.min(1, maxAmp).toFixed(4));
      }
      parsed = { durationSeconds: Number((floats.length / 2000).toFixed(3)), peaks };
    }
  }

  if (!parsed) {
    return {
      ok: true,
      hasAudio: false,
      source: hit.source,
      durationSeconds: 0,
      peaks: new Array<number>(samples).fill(0),
    };
  }

  try {
    writeFileSync(
      cachePath,
      JSON.stringify({
        source: hit.source,
        size: st.size,
        mtimeMs: st.mtimeMs,
        durationSeconds: parsed.durationSeconds,
        peaks: parsed.peaks,
      }),
      'utf8'
    );
  } catch {
    // Non-fatal cache write error
  }

  return {
    ok: true,
    hasAudio: true,
    source: hit.source,
    durationSeconds: parsed.durationSeconds,
    peaks: parsed.peaks,
  };
}

export function mergeRecordingIntoProject(opts: {
  targetProject: RecorderProject;
  targetMeta: Record<string, any>;
  targetSessionDir: string;
  sourceRecId: string;
  sourceRecDir: string;
}): RecorderProject {
  const srcMetaPath = join(opts.sourceRecDir, 'meta.json');
  const srcProjPath = join(opts.sourceRecDir, 'project.json');
  if (!existsSync(srcProjPath)) {
    throw new Error(`源录制缺少 project.json: ${opts.sourceRecId}`);
  }
  const srcMeta = existsSync(srcMetaPath) ? JSON.parse(readFileSync(srcMetaPath, 'utf8')) : {};
  let imported = decodeRecorderProject(JSON.parse(readFileSync(srcProjPath, 'utf8')));

  const importFolderRel = `assets/imported-${opts.sourceRecId}`;
  const importFolderAbs = resolve(opts.targetSessionDir, importFolderRel);
  mkdirSync(importFolderAbs, { recursive: true });
  const srcScreenMp4 = join(opts.sourceRecDir, 'screen.mp4');
  if (existsSync(srcScreenMp4)) {
    copyFileSync(srcScreenMp4, join(importFolderAbs, 'screen.mp4'));
  }

  if (!imported.media) {
    imported = {
      ...imported,
      media: makeProjectMediaManifest({
        screen: makeProjectMediaReference({
          relativePath: `${importFolderRel}/screen.mp4`,
        }),
      }),
    };
  } else {
    imported = {
      ...imported,
      media: {
        ...imported.media,
        screen: makeProjectMediaReference({
          ...imported.media.screen,
          relativePath: `${importFolderRel}/screen.mp4`,
        }),
      },
    };
  }

  const targetRawDur = Math.max(Number(opts.targetMeta?.durationSeconds) || 1, 0.1);
  const srcRawDur = Math.max(Number(srcMeta?.durationSeconds) || 1, 0.1);

  const curDurations = new Map<string, number>([[RecordingSourcePrimaryID, targetRawDur]]);
  for (const s of projectSources(opts.targetProject)) {
    if (!curDurations.has(s.id)) curDurations.set(s.id, targetRawDur);
  }

  const impDurations = new Map<string, number>();
  const idMap = new Map<string, string>();
  for (const s of projectSources(imported)) {
    impDurations.set(s.id, srcRawDur);
    idMap.set(s.id, randomUUID());
  }

  const curMap = new TimelineMap(opts.targetProject.timeline.sourceSequence, curDurations);
  const appendAt = curMap.outputDuration;

  const merged = inserting(
    imported,
    opts.targetProject,
    appendAt,
    curDurations,
    impDurations,
    {
      includesMotion: true,
      includesOverlays: true,
      includesAudio: true,
      includesSubtitles: true,
    },
    idMap
  );
  ProjectValidator.validate(merged);
  return merged;
}
