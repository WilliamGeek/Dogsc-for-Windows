/**
 * AudioMixPlan.ts
 *
 * Node-side FFmpeg multi-track audio mixing & M4A export filtergraph builder.
 * Combines WASAPI system audio (`system-audio.wav`), DirectShow mic (`mic-audio.wav`),
 * and timeline `audioClips`, honoring mute flags, volume sliders, clock offsets,
 * segment speed edits (`atempo`), fade envelopes (`afade`), and multi-input `amix`.
 */

import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export interface AudioMixTrackInput {
  path: string;
  kind: 'system' | 'microphone' | 'clip';
  /** Offset (seconds) of audio start relative to screen frame 0. Positive => delay audio. */
  offsetSeconds?: number;
  volume?: number;
  isMuted?: boolean;
  timelineStart?: number;
  sourceStart?: number;
  durationSeconds?: number;
  playbackRate?: number;
  fadeIn?: number;
  fadeOut?: number;
  ducksUnderSpeech?: boolean;
}

export interface SpeechInterval {
  start: number;
  end: number;
}

export interface AudioTimelineSlice {
  sourceStart: number;
  sourceDuration: number;
  playbackRate: number;
}

export interface AudioMixGraph {
  inputs: string[];
  filterComplex: string;
  audioMapLabel: string;
}

function fmtNum(n: number, decimals: number = 6): string {
  const safe = Number.isFinite(n) ? n : 0;
  const rounded = Number(safe.toFixed(decimals));
  return Number.isInteger(rounded) ? `${rounded}.0` : String(rounded);
}

/**
 * Pure function: decomposes any positive playback rate into FFmpeg `atempo` filters,
 * keeping every stage within FFmpeg's required [0.5, 2.0] range.
 */
export function buildAtempoFilterChain(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) {
    return 'anull';
  }
  if (Math.abs(rate - 1) < 1e-4) {
    return 'anull';
  }

  const parts: string[] = [];
  let remaining = rate;

  while (remaining > 2.0 + 1e-9) {
    parts.push('atempo=2.0');
    remaining /= 2.0;
  }
  while (remaining < 0.5 - 1e-9) {
    parts.push('atempo=0.5');
    remaining /= 0.5;
  }

  const clamped = Math.min(2.0, Math.max(0.5, remaining));
  parts.push(`atempo=${fmtNum(clamped, 6)}`);
  return parts.join(',');
}

/**
 * Pure function: extracts primary recorded slices (`media == null`) from project JSON.
 */
export function extractAudioSourceSlices(
  project: Record<string, any> | null | undefined,
  fallbackDurationSeconds: number
): AudioTimelineSlice[] {
  const seq = project?.timeline?.sourceSequence;
  if (seq && seq.kind === 'edited' && Array.isArray(seq.segments)) {
    const slices: AudioTimelineSlice[] = [];
    for (const seg of seq.segments) {
      if (!seg || seg.media != null) continue;
      const sourceStart = Number(seg.sourceStart);
      const sourceDuration = Number(seg.sourceDuration);
      const playbackRate = Number(seg.playbackRate);
      if (Number.isFinite(sourceDuration) && sourceDuration > 0) {
        slices.push({
          sourceStart: Number.isFinite(sourceStart) && sourceStart >= 0 ? sourceStart : 0,
          sourceDuration,
          playbackRate:
            Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1,
        });
      }
    }
    return slices;
  }
  if (Number.isFinite(fallbackDurationSeconds) && fallbackDurationSeconds > 0) {
    return [
      {
        sourceStart: 0,
        sourceDuration: fallbackDurationSeconds,
        playbackRate: 1,
      },
    ];
  }
  return [];
}

/**
 * Resolves session audio tracks (`system-audio.wav`, `mic-audio.wav`, `timeline.audioClips`)
 * against project audio controls and metadata offsets. Accepts `existingFiles` for pure tests.
 */
export function buildSessionAudioTracks(options: {
  project: Record<string, any>;
  recDir: string;
  meta?: Record<string, any> | null;
  existingFiles?: ReadonlySet<string>;
}): AudioMixTrackInput[] {
  const recDir = resolve(options.recDir);
  const meta = options.meta ?? {};
  const audioStyle = options.project?.audio ?? {};

  const fileExists = (candidatePath: string, fileName?: string): boolean => {
    if (options.existingFiles) {
      return (
        options.existingFiles.has(candidatePath) ||
        (fileName !== undefined && options.existingFiles.has(fileName))
      );
    }
    return existsSync(candidatePath);
  };

  const tracks: AudioMixTrackInput[] = [];

  const sysName =
    typeof meta.systemAudioFile === 'string' && meta.systemAudioFile.trim().length > 0
      ? meta.systemAudioFile.trim()
      : 'system-audio.wav';
  const sysPath = isAbsolute(sysName) ? sysName : resolve(recDir, sysName);
  if (fileExists(sysPath, sysName)) {
    tracks.push({
      path: sysPath,
      kind: 'system',
      offsetSeconds: Number.isFinite(Number(meta.systemAudioOffsetSeconds))
        ? Number(meta.systemAudioOffsetSeconds)
        : 0,
      volume:
        typeof audioStyle.systemVolume === 'number' && Number.isFinite(audioStyle.systemVolume)
          ? audioStyle.systemVolume
          : 0.82,
      isMuted: Boolean(audioStyle.isSystemMuted),
    });
  }

  const micName =
    typeof meta.micAudioFile === 'string' && meta.micAudioFile.trim().length > 0
      ? meta.micAudioFile.trim()
      : 'mic-audio.wav';
  const micPath = isAbsolute(micName) ? micName : resolve(recDir, micName);
  if (fileExists(micPath, micName)) {
    tracks.push({
      path: micPath,
      kind: 'microphone',
      offsetSeconds: Number.isFinite(Number(meta.micAudioOffsetSeconds))
        ? Number(meta.micAudioOffsetSeconds)
        : 0,
      volume:
        typeof audioStyle.microphoneVolume === 'number' &&
        Number.isFinite(audioStyle.microphoneVolume)
          ? audioStyle.microphoneVolume
          : 0.9,
      isMuted: Boolean(audioStyle.isMicrophoneMuted),
    });
  }

  const audioClips = options.project?.timeline?.audioClips;
  if (Array.isArray(audioClips)) {
    for (const clip of audioClips) {
      if (!clip || typeof clip.sourcePath !== 'string' || clip.sourcePath.trim().length === 0) {
        continue;
      }
      const rawPath = clip.sourcePath.trim();
      const resolved = isAbsolute(rawPath) ? rawPath : resolve(recDir, rawPath);
      if (!fileExists(resolved, rawPath)) {
        continue;
      }
      const timing = clip.timing ?? {};
      tracks.push({
        path: resolved,
        kind: 'clip',
        volume:
          typeof clip.volume === 'number' && Number.isFinite(clip.volume) ? clip.volume : 0.6,
        isMuted: Boolean(clip.isMuted),
        timelineStart:
          typeof timing.startTime === 'number' && Number.isFinite(timing.startTime)
            ? Math.max(0, timing.startTime)
            : 0,
        sourceStart:
          typeof clip.sourceStart === 'number' && Number.isFinite(clip.sourceStart)
            ? Math.max(0, clip.sourceStart)
            : 0,
        durationSeconds:
          typeof timing.duration === 'number' && Number.isFinite(timing.duration)
            ? Math.max(0, timing.duration)
            : 0,
        playbackRate:
          typeof clip.playbackRate === 'number' &&
          Number.isFinite(clip.playbackRate) &&
          clip.playbackRate > 0
            ? clip.playbackRate
            : 1,
        fadeIn:
          typeof clip.fadeIn === 'number' && Number.isFinite(clip.fadeIn)
            ? Math.max(0, clip.fadeIn)
            : 0,
        fadeOut:
          typeof clip.fadeOut === 'number' && Number.isFinite(clip.fadeOut)
            ? Math.max(0, clip.fadeOut)
            : 0,
        ducksUnderSpeech: Boolean(clip.ducksUnderSpeech),
      });
    }
  }

  return tracks;
}

/**
 * Pure function: extracts merged speech activity intervals (seconds) from project subtitle cues
 * so BGM tracks with `ducksUnderSpeech` smoothly attenuate around spoken sections.
 */
export function extractSpeechIntervals(
  project: Record<string, any> | null | undefined,
  options: { paddingSeconds?: number; mergeGapSeconds?: number; maxDuration?: number } = {}
): SpeechInterval[] {
  const cues = project?.timeline?.subtitleCues;
  if (!Array.isArray(cues) || cues.length === 0) return [];

  const pad = Math.max(0, options.paddingSeconds ?? 0.15);
  const mergeGap = Math.max(0, options.mergeGapSeconds ?? 0.2);
  const capEnd = options.maxDuration && options.maxDuration > 0 ? options.maxDuration : 86400;

  const raw: SpeechInterval[] = [];
  for (const cue of cues) {
    const startRaw = Number(cue?.timing?.startTime);
    const durRaw = Number(cue?.timing?.duration);
    if (!Number.isFinite(startRaw) || !Number.isFinite(durRaw) || durRaw <= 0) continue;
    const s = Math.max(0, startRaw - pad);
    const e = Math.min(capEnd, startRaw + durRaw + pad);
    if (e > s + 0.01) {
      raw.push({ start: s, end: e });
    }
  }
  if (raw.length === 0) return [];

  raw.sort((a, b) => a.start - b.start);
  const merged: SpeechInterval[] = [{ ...raw[0] }];
  for (let i = 1; i < raw.length; i++) {
    const prev = merged[merged.length - 1];
    const cur = raw[i];
    if (cur.start <= prev.end + mergeGap) {
      prev.end = Math.max(prev.end, cur.end);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged.slice(0, 40);
}

/**
 * Pure function: constructs an FFmpeg `volume` filter expression that ducks volume to `duckGain`
 * during speech intervals using `:eval=frame`.
 */
export function buildDuckingVolumeFilter(
  baseVolume: number,
  intervals: readonly SpeechInterval[],
  duckGain: number = 0.25
): string {
  const base = Number.isFinite(baseVolume) ? Math.max(0, baseVolume) : 1;
  const ratio = Number.isFinite(duckGain) ? Math.min(Math.max(duckGain, 0), 1) : 0.25;
  const active = intervals.filter((iv) => Number.isFinite(iv.start) && Number.isFinite(iv.end) && iv.end > iv.start).slice(0, 40);
  if (active.length === 0) {
    return `volume=${fmtNum(base, 4)}`;
  }
  const cond = active
    .map((iv) => `between(t,${fmtNum(Math.max(0, iv.start), 3)},${fmtNum(iv.end, 3)})`)
    .join('+');
  const duckVol = fmtNum(base * ratio, 4);
  const normalVol = fmtNum(base, 4);
  return `volume='if(gt(${cond},0),${duckVol},${normalVol})':eval=frame`;
}

/**
 * Pure function: constructs an FFmpeg `filter_complex` string combining all active
 * tracks with slice trimming, speed adjustment (`atempo`), positive-offset delay (`adelay`),
 * fades (`afade`), per-track volume (including speech ducking), and multi-track mixing (`amix`).
 */
export function buildAudioMixFilterGraph(
  tracks: readonly AudioMixTrackInput[],
  options: {
    durationSeconds: number;
    videoInputIndex?: number | null;
    sourceSlices?: readonly AudioTimelineSlice[];
    speechIntervals?: readonly SpeechInterval[];
  }
): AudioMixGraph | null {
  const activeTracks = tracks.filter(
    (t) =>
      Boolean(t.path && t.path.trim().length > 0) &&
      !t.isMuted &&
      (t.volume === undefined || t.volume > 0)
  );
  if (activeTracks.length === 0) {
    return null;
  }

  const safeDuration =
    Number.isFinite(options.durationSeconds) && options.durationSeconds > 0
      ? options.durationSeconds
      : 0.01;
  const inputBaseIndex =
    options.videoInputIndex === null ? 0 : (options.videoInputIndex ?? 0) + 1;
  const sourceSlices = options.sourceSlices;

  const filterParts: string[] = [];
  const trackLabels: string[] = [];

  for (let i = 0; i < activeTracks.length; i++) {
    const track = activeTracks[i];
    const inIdx = inputBaseIndex + i;
    const vol = track.volume !== undefined && Number.isFinite(track.volume) ? Math.max(0, track.volume) : 1;
    const offset = Number.isFinite(track.offsetSeconds) ? Number(track.offsetSeconds) : 0;
    const trkLabel = `[atrk${i}]`;
    trackLabels.push(trkLabel);

    if (
      (track.kind === 'system' || track.kind === 'microphone') &&
      sourceSlices &&
      sourceSlices.length > 0
    ) {
      const sliceLabels: string[] = [];
      for (let s = 0; s < sourceSlices.length; s++) {
        const slice = sourceSlices[s];
        const rawStart = slice.sourceStart - offset;
        const trimStart = Math.max(0, rawStart);
        const rawEnd = slice.sourceStart + slice.sourceDuration - offset;
        const sliceLabel = `[a${i}_s${s}]`;
        sliceLabels.push(sliceLabel);

        const tempoChain = buildAtempoFilterChain(slice.playbackRate);
        if (rawEnd <= 0.0005) {
          const outSliceDur = Math.max(0.01, slice.sourceDuration / Math.max(slice.playbackRate, 0.01));
          filterParts.push(
            `anullsrc=r=48000:cl=stereo,atrim=0:${fmtNum(outSliceDur)},asetpts=PTS-STARTPTS${sliceLabel}`
          );
        } else {
          const leadingGap = rawStart < 0 ? -rawStart : 0;
          const trimEnd = Math.max(trimStart + 0.001, rawEnd);
          const chain: string[] = [
            `atrim=start=${fmtNum(trimStart)}:end=${fmtNum(trimEnd)}`,
            'asetpts=PTS-STARTPTS',
          ];
          if (leadingGap > 0.0005) {
            const ms = Math.round(leadingGap * 1000);
            chain.push(`adelay=${ms}|${ms}`);
          }
          if (tempoChain !== 'anull') {
            chain.push(tempoChain);
          }
          filterParts.push(`[${inIdx}:a]${chain.join(',')}${sliceLabel}`);
        }
      }

      if (sliceLabels.length === 1) {
        const singleOut = sliceLabels[0];
        filterParts.push(`${singleOut}volume=${fmtNum(vol, 4)}${trkLabel}`);
      } else {
        const catLabel = `[a${i}_cat]`;
        filterParts.push(`${sliceLabels.join('')}concat=n=${sliceLabels.length}:v=0:a=1${catLabel}`);
        filterParts.push(`${catLabel}volume=${fmtNum(vol, 4)}${trkLabel}`);
      }
      continue;
    }

    // Simple recorded track (no slices) or overlay audio clip track.
    const chain: string[] = [];
    const baseSourceStart = Math.max(0, track.sourceStart ?? 0);
    const negOffsetTrim = offset < 0 ? -offset : 0;
    const trimStart = baseSourceStart + negOffsetTrim;
    const clipDuration = track.durationSeconds && track.durationSeconds > 0 ? track.durationSeconds : 0;
    const playbackRate =
      track.playbackRate !== undefined && Number.isFinite(track.playbackRate) && track.playbackRate > 0
        ? track.playbackRate
        : 1;

    if (trimStart > 0.0005 && clipDuration > 0) {
      chain.push(`atrim=start=${fmtNum(trimStart)}:end=${fmtNum(trimStart + clipDuration * playbackRate)}`);
      chain.push('asetpts=PTS-STARTPTS');
    } else if (trimStart > 0.0005) {
      chain.push(`atrim=start=${fmtNum(trimStart)}`);
      chain.push('asetpts=PTS-STARTPTS');
    } else if (clipDuration > 0) {
      chain.push(`atrim=start=0:end=${fmtNum(clipDuration * playbackRate)}`);
      chain.push('asetpts=PTS-STARTPTS');
    } else {
      chain.push('asetpts=PTS-STARTPTS');
    }

    const tempoChain = buildAtempoFilterChain(playbackRate);
    if (tempoChain !== 'anull') {
      chain.push(tempoChain);
    }

    const posOffsetDelay = offset > 0 ? offset : 0;
    const timelineDelay = Math.max(0, (track.timelineStart ?? 0) + posOffsetDelay);
    if (timelineDelay > 0.0005) {
      const ms = Math.round(timelineDelay * 1000);
      chain.push(`adelay=${ms}|${ms}`);
    }

    const fadeIn = track.fadeIn ?? 0;
    if (fadeIn > 0.0005) {
      chain.push(`afade=t=in:st=${fmtNum(timelineDelay)}:d=${fmtNum(fadeIn)}`);
    }

    const fadeOut = track.fadeOut ?? 0;
    if (fadeOut > 0.0005 && clipDuration > 0) {
      const fadeOutStart = Math.max(timelineDelay, timelineDelay + clipDuration - fadeOut);
      chain.push(`afade=t=out:st=${fmtNum(fadeOutStart)}:d=${fmtNum(fadeOut)}`);
    }

    const speechIntervals = options.speechIntervals;
    if (track.ducksUnderSpeech && speechIntervals && speechIntervals.length > 0) {
      chain.push(buildDuckingVolumeFilter(vol, speechIntervals));
    } else {
      chain.push(`volume=${fmtNum(vol, 4)}`);
    }
    filterParts.push(`[${inIdx}:a]${chain.join(',')}${trkLabel}`);
  }

  if (trackLabels.length === 1) {
    filterParts.push(
      `${trackLabels[0]}atrim=0:${fmtNum(safeDuration)},asetpts=PTS-STARTPTS[aout]`
    );
  } else {
    filterParts.push(
      `${trackLabels.join('')}amix=inputs=${trackLabels.length}:duration=longest:normalize=0,atrim=0:${fmtNum(safeDuration)},asetpts=PTS-STARTPTS[aout]`
    );
  }

  return {
    inputs: activeTracks.map((t) => t.path),
    filterComplex: filterParts.join(';'),
    audioMapLabel: '[aout]',
  };
}

/**
 * Pure function: constructs FFmpeg CLI arguments for pure audio M4A export (`--format m4a`)
 * without spawning any headless browser or rendering video frames.
 */
export function buildAudioOnlyM4aArgs(
  tracks: readonly AudioMixTrackInput[],
  outFile: string,
  options: {
    durationSeconds: number;
    sourceSlices?: readonly AudioTimelineSlice[];
    audioBitrate?: string;
    speechIntervals?: readonly SpeechInterval[];
  }
): string[] | null {
  const graph = buildAudioMixFilterGraph(tracks, {
    durationSeconds: options.durationSeconds,
    videoInputIndex: null,
    sourceSlices: options.sourceSlices,
    speechIntervals: options.speechIntervals,
  });
  if (!graph) {
    return null;
  }

  return [
    '-y',
    ...graph.inputs.flatMap((p) => ['-i', p]),
    '-filter_complex',
    graph.filterComplex,
    '-map',
    graph.audioMapLabel,
    '-vn',
    '-c:a',
    'aac',
    '-b:a',
    options.audioBitrate ?? '192k',
    '-movflags',
    '+faststart',
    outFile,
  ];
}
