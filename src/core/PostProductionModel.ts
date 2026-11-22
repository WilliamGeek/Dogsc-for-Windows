// Port of: F:\dogsc-v0.2.0\Sources\RecorderCore\PostProductionModel.swift
// Also hosts pure value structs MainTrackVisualStyle & VisualClipSound from
// VisualTrackTransfer.swift (L1-19) so VideoClip avoids circular imports.
// Note: ProjectTimeline track-layer extensions (L111-209) wait for T13.5 when
// ProjectTimeline gains animationClips, videoClips, and audioClips.

import { max, min, newUUID, toInt } from './swift.ts';
import { type HexColor, HexColorWhite, hexColorFromJSON, makeHexColor } from './HexColor.ts';
import { type OverlayTiming, makeOverlayTiming } from './OverlayTimeline.ts';
import {
  type ScreenCardAppearance,
  screenCardAppearanceFromJSON,
} from './ScreenCardAppearance.ts';
import {
  type SegmentSceneStyle,
  segmentSceneStyleFromJSON,
} from './SegmentSceneStyle.ts';
import { type NormalizedPoint, makeNormalizedPoint } from './ZoomAnimation.ts';

// ---------------------------------------------------------------------------
// MainTrackVisualStyle & VisualClipSound (from VisualTrackTransfer.swift L1-19)
// ---------------------------------------------------------------------------

/// Presentation saved while an authored visual changes track roles.
export interface MainTrackVisualStyle {
  usesFrameStyle: boolean;
  screenAppearance: ScreenCardAppearance | null;
  sceneStyle: SegmentSceneStyle | null;
}

export function makeMainTrackVisualStyle(options: {
  usesFrameStyle?: boolean;
  screenAppearance?: ScreenCardAppearance | null;
  sceneStyle?: SegmentSceneStyle | null;
} = {}): MainTrackVisualStyle {
  return {
    usesFrameStyle: options.usesFrameStyle ?? false,
    screenAppearance: options.screenAppearance ? { ...options.screenAppearance } : null,
    sceneStyle: options.sceneStyle ? { ...options.sceneStyle } : null,
  };
}

export function mainTrackVisualStyleFromJSON(raw: unknown): MainTrackVisualStyle | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  return {
    usesFrameStyle: typeof c.usesFrameStyle === 'boolean' ? c.usesFrameStyle : false,
    screenAppearance:
      c.screenAppearance !== undefined && c.screenAppearance !== null
        ? screenCardAppearanceFromJSON(c.screenAppearance)
        : null,
    sceneStyle:
      c.sceneStyle !== undefined && c.sceneStyle !== null
        ? segmentSceneStyleFromJSON(c.sceneStyle)
        : null,
  };
}

export interface VisualClipSound {
  path: string;
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

export function makeVisualClipSound(options: {
  path: string;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
}): VisualClipSound {
  return {
    path: options.path,
    volume: options.volume ?? 1,
    fadeIn: options.fadeIn ?? 0,
    fadeOut: options.fadeOut ?? 0,
  };
}

export function visualClipSoundFromJSON(raw: unknown): VisualClipSound | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.path !== 'string') return null;
  return makeVisualClipSound({
    path: c.path,
    volume: typeof c.volume === 'number' ? c.volume : 1,
    fadeIn: typeof c.fadeIn === 'number' ? c.fadeIn : 0,
    fadeOut: typeof c.fadeOut === 'number' ? c.fadeOut : 0,
  });
}

// ---------------------------------------------------------------------------
// TimedOverlayClip, MediaAssetKind, MediaAsset
// ---------------------------------------------------------------------------

/// Anything placed on the output timeline for a span of time.
export interface TimedOverlayClip {
  readonly id: string;
  timing: OverlayTiming;
}

export type MediaAssetKind = 'video' | 'image' | 'audio' | 'animation';

export const MediaAssetKindAllCases: readonly MediaAssetKind[] = Object.freeze([
  'video',
  'image',
  'audio',
  'animation',
]);

export function mediaAssetKindForExtension(ext: string): MediaAssetKind | null {
  switch (ext.toLowerCase()) {
    case 'mov':
    case 'mp4':
    case 'm4v':
      return 'video';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'heic':
    case 'gif':
    case 'webp':
    case 'tiff':
      return 'image';
    case 'mp3':
    case 'm4a':
    case 'wav':
    case 'aiff':
    case 'aif':
    case 'aac':
    case 'caf':
    case 'flac':
      return 'audio';
    case 'dmhtml':
      return 'animation';
    default:
      return null;
  }
}

export const MediaAssetKind = Object.freeze({
  allCases: MediaAssetKindAllCases,
  kindForExtension: mediaAssetKindForExtension,
});

function pathLastComponent(filePath: string): string {
  const trimmed = filePath.replace(/[/\\]+$/, '');
  const idx = max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

function deletingPathExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return name;
  return name.slice(0, dot);
}

/// A file the user brought into this project. Referenced where it lives;
/// never copied (EDT-054). Missing files are relinked by replacing `path`.
export interface MediaAsset {
  id: string;
  path: string;
  kind: MediaAssetKind;
  name: string;
  importedAt: Date;
}

export function makeMediaAsset(options: {
  id?: string;
  path: string;
  kind: MediaAssetKind;
  name?: string | null;
  importedAt?: Date;
}): MediaAsset {
  return {
    id: options.id ?? newUUID(),
    path: options.path,
    kind: options.kind,
    name: options.name ?? pathLastComponent(options.path),
    importedAt: options.importedAt ?? new Date(),
  };
}

/// The label shown in the media library. The extension is dropped: a tile
/// is narrow, the kind is already shown as its own badge, and leaving it in
/// spends the only visible characters on ".dmhtml" for every motion.
export function mediaAssetDisplayName(asset: MediaAsset): string {
  const trimmed = deletingPathExtension(asset.name);
  return trimmed.length === 0 ? asset.name : trimmed;
}

export const MediaAsset = Object.freeze({
  make: makeMediaAsset,
  displayName: mediaAssetDisplayName,
});

// ---------------------------------------------------------------------------
// VideoClip
// ---------------------------------------------------------------------------

/// A video placed over the recording for a span of time (picture-in-picture
/// or full-frame B-roll), with its own sound.
export interface VideoClip extends TimedOverlayClip {
  playbackRate: number;
  mainTrackStyle: MainTrackVisualStyle | null;
  id: string;
  timing: OverlayTiming;
  sourcePath: string;
  sourceStart: number;
  /// Centre, 0-1 from the canvas top-left.
  position: NormalizedPoint;
  /// Width relative to the canvas; height follows `aspect` (h / w).
  width: number;
  aspect: number;
  opacity: number;
  volume: number;
  layerIndex: number;
}

export function makeVideoClip(options: {
  id?: string;
  timing: OverlayTiming;
  sourcePath: string;
  sourceStart?: number;
  position?: NormalizedPoint;
  width?: number;
  aspect?: number;
  opacity?: number;
  volume?: number;
  layerIndex?: number;
  playbackRate?: number;
  mainTrackStyle?: MainTrackVisualStyle | null;
}): VideoClip {
  return {
    id: options.id ?? newUUID(),
    timing: options.timing,
    sourcePath: options.sourcePath,
    sourceStart: options.sourceStart ?? 0,
    position: options.position ?? makeNormalizedPoint(0.5, 0.5),
    width: options.width ?? 1,
    aspect: options.aspect ?? 9.0 / 16.0,
    opacity: options.opacity ?? 1,
    volume: options.volume ?? 1,
    layerIndex: options.layerIndex ?? 0,
    playbackRate: options.playbackRate ?? 1,
    mainTrackStyle: options.mainTrackStyle ?? null,
  };
}

export function videoClipFromJSON(raw: unknown): VideoClip {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Expected VideoClip JSON object');
  }
  const c = raw as Record<string, unknown>;
  if (typeof c.id !== 'string' || typeof c.sourcePath !== 'string') {
    throw new Error('VideoClip requires id and sourcePath');
  }
  const rawTiming = c.timing as Record<string, unknown> | undefined;
  const rawPos = c.position as Record<string, unknown> | undefined;
  if (!rawTiming || typeof rawTiming.startTime !== 'number') {
    throw new Error('VideoClip requires timing');
  }
  if (!rawPos || typeof rawPos.x !== 'number' || typeof rawPos.y !== 'number') {
    throw new Error('VideoClip requires position');
  }
  if (
    typeof c.width !== 'number' ||
    typeof c.aspect !== 'number' ||
    typeof c.opacity !== 'number' ||
    typeof c.volume !== 'number' ||
    typeof c.layerIndex !== 'number'
  ) {
    throw new Error('VideoClip requires numeric geometry/render properties');
  }
  return makeVideoClip({
    id: c.id,
    timing: makeOverlayTiming(
      rawTiming.startTime,
      typeof rawTiming.duration === 'number' ? rawTiming.duration : 3,
    ),
    sourcePath: c.sourcePath,
    sourceStart: typeof c.sourceStart === 'number' ? c.sourceStart : 0,
    position: makeNormalizedPoint(rawPos.x, rawPos.y),
    width: c.width,
    aspect: c.aspect,
    opacity: c.opacity,
    volume: c.volume,
    layerIndex: c.layerIndex,
    playbackRate: typeof c.playbackRate === 'number' ? c.playbackRate : 1,
    mainTrackStyle: mainTrackVisualStyleFromJSON(c.mainTrackStyle),
  });
}

// ---------------------------------------------------------------------------
// AudioClipKind & AudioClip
// ---------------------------------------------------------------------------

export type AudioClipKind = 'music' | 'effect';

/// Background music or a sound effect mixed under the recording.
export interface AudioClip extends TimedOverlayClip {
  playbackRate: number;
  id: string;
  timing: OverlayTiming;
  sourcePath: string;
  /// Offset into the source file where playback starts.
  sourceStart: number;
  volume: number;
  isMuted: boolean;
  fadeIn: number;
  fadeOut: number;
  kind: AudioClipKind;
  /// Lower this clip while someone is speaking (subtitle cues mark speech).
  ducksUnderSpeech: boolean;
  /// Audio row on the timeline (0 = first row under the recording).
  lane: number;
}

export function makeAudioClip(options: {
  id?: string;
  timing: OverlayTiming;
  sourcePath: string;
  sourceStart?: number;
  volume?: number;
  isMuted?: boolean;
  fadeIn?: number;
  fadeOut?: number;
  kind?: AudioClipKind;
  playbackRate?: number;
  ducksUnderSpeech?: boolean;
  lane?: number;
}): AudioClip {
  const kind: AudioClipKind = options.kind ?? 'music';
  return {
    id: options.id ?? newUUID(),
    timing: options.timing,
    sourcePath: options.sourcePath,
    sourceStart: options.sourceStart ?? 0,
    volume: options.volume ?? 0.6,
    isMuted: options.isMuted ?? false,
    fadeIn: options.fadeIn ?? 0.5,
    fadeOut: options.fadeOut ?? 1,
    kind,
    playbackRate: options.playbackRate ?? 1,
    ducksUnderSpeech: options.ducksUnderSpeech ?? kind === 'music',
    lane: options.lane ?? (kind === 'music' ? 0 : 1),
  };
}

export function audioClipFromJSON(raw: unknown): AudioClip {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Expected AudioClip JSON object');
  }
  const c = raw as Record<string, unknown>;
  if (typeof c.id !== 'string' || typeof c.sourcePath !== 'string') {
    throw new Error('AudioClip requires id and sourcePath');
  }
  const rawTiming = c.timing as Record<string, unknown> | undefined;
  if (!rawTiming || typeof rawTiming.startTime !== 'number') {
    throw new Error('AudioClip requires timing');
  }
  const kind: AudioClipKind = c.kind === 'effect' ? 'effect' : 'music';
  return makeAudioClip({
    id: c.id,
    timing: makeOverlayTiming(
      rawTiming.startTime,
      typeof rawTiming.duration === 'number' ? rawTiming.duration : 3,
    ),
    sourcePath: c.sourcePath,
    sourceStart: typeof c.sourceStart === 'number' ? c.sourceStart : 0,
    volume: typeof c.volume === 'number' ? c.volume : 0.6,
    isMuted: typeof c.isMuted === 'boolean' ? c.isMuted : false,
    // Swift CodingKeys decodeIfPresent defaults fadeIn/fadeOut to 0 when absent in JSON.
    fadeIn: typeof c.fadeIn === 'number' ? c.fadeIn : 0,
    fadeOut: typeof c.fadeOut === 'number' ? c.fadeOut : 0,
    kind,
    ducksUnderSpeech:
      typeof c.ducksUnderSpeech === 'boolean' ? c.ducksUnderSpeech : kind === 'music',
    lane: typeof c.lane === 'number' ? c.lane : kind === 'music' ? 0 : 1,
    playbackRate: typeof c.playbackRate === 'number' ? c.playbackRate : 1,
  });
}

/// Whether two clips build identical `AVMutableCompositionTrack` time ranges.
/// Gain, mute, fades and ducking only affect `AVAudioMix`.
export function audioClipMatchesCompositionStructure(lhs: AudioClip, rhs: AudioClip): boolean {
  return (
    lhs.id === rhs.id &&
    lhs.timing.startTime === rhs.timing.startTime &&
    lhs.timing.duration === rhs.timing.duration &&
    lhs.sourcePath === rhs.sourcePath &&
    Math.abs(lhs.sourceStart - rhs.sourceStart) <= 0.000_001 &&
    Math.abs(lhs.playbackRate - rhs.playbackRate) <= 0.000_001
  );
}

// ---------------------------------------------------------------------------
// SubtitleCue, SubtitleFont, SubtitleEntrance, SubtitleStyle
// ---------------------------------------------------------------------------

/// One subtitle line, optionally with a second language beneath it.
export interface SubtitleCue extends TimedOverlayClip {
  id: string;
  timing: OverlayTiming;
  text: string;
  secondaryText: string | null;
}

export function makeSubtitleCue(options: {
  id?: string;
  timing: OverlayTiming;
  text: string;
  secondaryText?: string | null;
}): SubtitleCue {
  return {
    id: options.id ?? newUUID(),
    timing: options.timing,
    text: options.text,
    secondaryText: options.secondaryText ?? null,
  };
}

export type SubtitleFont = 'system' | 'rounded' | 'serif' | 'mono';

export const SubtitleFontAllCases: readonly SubtitleFont[] = Object.freeze([
  'system',
  'rounded',
  'serif',
  'mono',
]);

export type SubtitleEntrance = 'none' | 'fade' | 'rise' | 'pop' | 'typewriter';

export const SubtitleEntranceAllCases: readonly SubtitleEntrance[] = Object.freeze([
  'none',
  'fade',
  'rise',
  'pop',
  'typewriter',
]);

export interface SubtitleStyle {
  /// Font size relative to canvas height.
  fontScale: number;
  /// Baseline distance from the bottom, relative to canvas height.
  bottomMargin: number;
  textColor: HexColor;
  backgroundOpacity: number;
  showsSecondary: boolean;
  font: SubtitleFont;
  /// A specific installed font family; nil uses `font`'s system design.
  fontFamily: string | null;
  bold: boolean;
  entrance: SubtitleEntrance;
}

export function makeSubtitleStyle(options: Partial<SubtitleStyle> = {}): SubtitleStyle {
  return {
    fontScale: options.fontScale ?? 0.03,
    bottomMargin: options.bottomMargin ?? 0.05,
    textColor: options.textColor ?? HexColorWhite,
    backgroundOpacity: options.backgroundOpacity ?? 1,
    showsSecondary: options.showsSecondary ?? true,
    font: options.font ?? 'system',
    fontFamily: options.fontFamily ?? null,
    bold: options.bold ?? true,
    entrance: options.entrance ?? 'none',
  };
}

/// Used only before a project's first captions, never to restyle existing
/// subtitles or overwrite a user's custom appearance.
export const SubtitleStyleLegacyDefault: SubtitleStyle = Object.freeze(
  makeSubtitleStyle({
    fontScale: 0.045,
    bottomMargin: 0.08,
    backgroundOpacity: 0.55,
    entrance: 'fade',
  }),
);

function parseColor(raw: unknown, fallback: HexColor): HexColor {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'string') return hexColorFromJSON(raw);
  if (typeof raw === 'object' && typeof (raw as { rgb24?: unknown }).rgb24 === 'number') {
    return makeHexColor((raw as { rgb24: number }).rgb24);
  }
  throw new Error('Invalid HexColor value');
}

export function subtitleStyleFromJSON(raw: unknown): SubtitleStyle {
  if (!raw || typeof raw !== 'object') return makeSubtitleStyle();
  const c = raw as Record<string, unknown>;
  const d = makeSubtitleStyle();
  const font: SubtitleFont = SubtitleFontAllCases.includes(c.font as SubtitleFont)
    ? (c.font as SubtitleFont)
    : d.font;
  const entrance: SubtitleEntrance = SubtitleEntranceAllCases.includes(
    c.entrance as SubtitleEntrance,
  )
    ? (c.entrance as SubtitleEntrance)
    : d.entrance;
  return {
    fontScale: typeof c.fontScale === 'number' ? c.fontScale : d.fontScale,
    bottomMargin: typeof c.bottomMargin === 'number' ? c.bottomMargin : d.bottomMargin,
    textColor: parseColor(c.textColor, d.textColor),
    backgroundOpacity:
      typeof c.backgroundOpacity === 'number' ? c.backgroundOpacity : d.backgroundOpacity,
    showsSecondary: typeof c.showsSecondary === 'boolean' ? c.showsSecondary : d.showsSecondary,
    font,
    fontFamily: typeof c.fontFamily === 'string' ? c.fontFamily : null,
    bold: typeof c.bold === 'boolean' ? c.bold : d.bold,
    entrance,
  };
}

export const SubtitleStyle = Object.freeze({
  make: makeSubtitleStyle,
  legacyDefault: SubtitleStyleLegacyDefault,
  fromJSON: subtitleStyleFromJSON,
});

// ---------------------------------------------------------------------------
// SubtitleText
// ---------------------------------------------------------------------------

const SUBTITLE_FILLERS = '啊|呃|嗯|哦|噢|唉|诶|欸';

const SUBTITLE_PROFANITY_PATTERN =
  '([他她它]\\s*妈\\s*的|特\\s*么\\s*的|(?<![a-z0-9])tmd(?![a-z0-9]))|(?:操\\s*你\\s*妈|傻\\s*逼|狗\\s*屎|屎(?!\\s*壳\\s*郎)|我\\s*操(?=\\s*(?:[，,。！？!?；;]|$))|(?<![a-z0-9])(?:motherfuck(?:er|ing)|fuck(?:s|ed|ing)?|bullshit|shit(?:ty)?|asshole|bitch)(?![a-z0-9]))';

function escapeRegexLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/// Subtitle display text cleanup. Numeric and name notation is preserved.
export const SUBTITLE_TEXT_MAX_UNITS = 16;

export function subtitleTextUnits(text: string): number {
  let total = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    total += code < 0x80 ? 0.5 : 1;
  }
  return total;
}

function formatSubtitleText(text: string, removesFillers: boolean): string {
  let result = text;
  const rules: Array<[RegExp, string]> = [
    [/(?<![0-9])[，,]|[，,](?![0-9])/g, ' '],
    [/[。！？!?；;：:….]+(?=\s*$)/g, ' '],
  ];
  if (removesFillers) {
    rules.push(
      [new RegExp(`(^|\\s)(?:${SUBTITLE_FILLERS})+(?=\\s|$)`, 'g'), '$1'],
      [new RegExp(`^(?:${SUBTITLE_FILLERS})+`, 'g'), ''],
      [new RegExp(`(?:${SUBTITLE_FILLERS})+$`, 'g'), ''],
    );
  }
  rules.push([/\s+/g, ' ']);
  for (const [regex, replacement] of rules) {
    result = result.replace(regex, replacement);
  }
  return result.trim();
}

/// Match across recognizer tokens before grouping captions. A cue may
/// split a profane phrase, so retain one output element per original token.
export function subtitleTextCensoredSpeechTokens(tokens: readonly string[]): string[] {
  if (tokens.length === 0) return [];
  const offsets: number[] = [0];
  for (const token of tokens) {
    offsets.push(offsets[offsets.length - 1] + token.length);
  }
  const joined = tokens.join('');
  const regex = new RegExp(SUBTITLE_PROFANITY_PATTERN, 'gi');
  const matches = Array.from(joined.matchAll(regex));
  const output = tokens.slice();
  let tokenIndex = tokens.length - 1;
  // Right-to-left replacements leave the original offsets of earlier
  // matches valid, even when several of them are in the same token.
  for (const match of matches.reverse()) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    while (tokenIndex >= 0 && offsets[tokenIndex] >= end) {
      tokenIndex -= 1;
    }
    while (tokenIndex >= 0 && offsets[tokenIndex + 1] > start) {
      const lower = max(start, offsets[tokenIndex]);
      const upper = min(end, offsets[tokenIndex + 1]);
      if (lower < upper) {
        const localStart = lower - offsets[tokenIndex];
        const localEnd = upper - offsets[tokenIndex];
        const replacement = lower === start ? (match[1] !== undefined ? 'TM' : ' ') : '';
        output[tokenIndex] =
          output[tokenIndex].slice(0, localStart) +
          replacement +
          output[tokenIndex].slice(localEnd);
      }
      if (offsets[tokenIndex] <= start) break;
      tokenIndex -= 1;
    }
  }
  return output;
}

/// Explicit subtitle cleanup also removes filler sounds.
export function subtitleTextClean(text: string): string {
  return formatSubtitleText(text, true);
}

/// Speech captions retain recognizer wording, including fillers. Only
/// presentation punctuation and recognized profanity are filtered here.
export function subtitleTextSpeechDisplay(text: string): string {
  return formatSubtitleText(subtitleTextCensoredSpeechTokens([text])[0] ?? '', false);
}

/// Retain notation present in the recognized audio text when generating
/// corrected/translated display text. Timing never depends on this text.
export function subtitleTextPreservingNumericNotation(
  text: string,
  reference: string,
): string {
  const numberRegex = /(?<![0-9])[0-9]+(?:\.[0-9]+)+(?![0-9])/g;
  let result = text;
  for (const match of reference.matchAll(numberRegex)) {
    const numberText = match[0];
    const pieces = numberText.split('.').map(escapeRegexLiteral);
    const pattern = new RegExp(
      `(?<![0-9])${pieces.join('\\s*(?:\\.|点|point)\\s*')}(?![0-9])`,
      'gi',
    );
    result = result.replace(pattern, () => numberText);
  }
  return result;
}

/// Cleans display text while preserving cue identity and timing. New
/// subtitle segments are authored from speech token boundaries instead.
export function subtitleTextNormalized(cues: readonly SubtitleCue[]): SubtitleCue[] {
  const out: SubtitleCue[] = [];
  for (const original of cues) {
    const cleanedPrimary = subtitleTextClean(original.text);
    if (cleanedPrimary.length === 0) continue;
    let secondaryText: string | null = null;
    if (original.secondaryText !== null) {
      const cleanedSec = subtitleTextClean(original.secondaryText);
      secondaryText = cleanedSec.length === 0 ? null : cleanedSec;
    }
    out.push({
      ...original,
      text: cleanedPrimary,
      secondaryText,
    });
  }
  return out;
}

export const SubtitleText = Object.freeze({
  maxUnits: SUBTITLE_TEXT_MAX_UNITS,
  units: subtitleTextUnits,
  clean: subtitleTextClean,
  speechDisplay: subtitleTextSpeechDisplay,
  censoredSpeechTokens: subtitleTextCensoredSpeechTokens,
  preservingNumericNotation: subtitleTextPreservingNumericNotation,
  normalized: subtitleTextNormalized,
});

// ---------------------------------------------------------------------------
// SubtitleSRT
// ---------------------------------------------------------------------------

export function subtitleSRTStamp(t: number): string {
  const safe = Number.isFinite(t) ? max(t, 0) : 0;
  const ms = Math.round(safe * 1000);
  const hours = toInt(ms / 3_600_000);
  const mins = toInt(ms / 60_000) % 60;
  const secs = toInt(ms / 1000) % 60;
  const millis = ms % 1000;
  return (
    String(hours).padStart(2, '0') +
    ':' +
    String(mins).padStart(2, '0') +
    ':' +
    String(secs).padStart(2, '0') +
    ',' +
    String(millis).padStart(3, '0')
  );
}

export function subtitleSRTSeconds(text: string): number | null {
  const parts = text.trim().replace(/,/g, '.').split(':');
  if (parts.length !== 3) return null;
  if (parts.some((p) => p.length === 0)) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  const s = Number(parts[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) return null;
  return h * 3600 + m * 60 + s;
}

export function subtitleSRTEncode(
  cues: readonly SubtitleCue[],
  secondary: boolean = false,
): string {
  const sorted = cues.slice().sort((a, b) => a.timing.startTime - b.timing.startTime);
  const blocks: string[] = [];
  for (let index = 0; index < sorted.length; index++) {
    const cue = sorted[index];
    const text = secondary ? (cue.secondaryText ?? '') : cue.text;
    if (text.length === 0) continue;
    blocks.push(
      `${index + 1}\n${subtitleSRTStamp(cue.timing.startTime)} --> ${subtitleSRTStamp(cue.timing.endTime)}\n${text}\n`,
    );
  }
  return blocks.join('\n');
}

export function subtitleSRTDecode(srt: string): SubtitleCue[] {
  const blocks = srt.replace(/\r\n/g, '\n').split('\n\n');
  const result: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.length > 0);
    const arrow = lines.findIndex((line) => line.includes('-->'));
    if (arrow < 0) continue;
    const parts = lines[arrow].split('-->');
    if (parts.length !== 2) continue;
    const start = subtitleSRTSeconds(parts[0]);
    const end = subtitleSRTSeconds(parts[1]);
    if (start === null || end === null || !(end > start)) continue;
    const text = lines.slice(arrow + 1).join('\n');
    if (text.length === 0) continue;
    result.push(
      makeSubtitleCue({
        timing: makeOverlayTiming(start, end - start),
        text,
      }),
    );
  }
  return result;
}

export const SubtitleSRT = Object.freeze({
  encode: subtitleSRTEncode,
  decode: subtitleSRTDecode,
  stamp: subtitleSRTStamp,
  seconds: subtitleSRTSeconds,
});
