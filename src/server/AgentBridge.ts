/**
 * src/server/AgentBridge.ts
 *
 * Windows counterpart of macOS `AgentBridgeServer.swift` + `AgentChat.swift`:
 * - Per-server 32-hex bearer token authenticating external Agent/MCP HTTP calls
 * - Atomic pre-turn snapshot cache & `revertTurn()` (one-click undo of any AI turn)
 * - Per-recording AI conversation log persistence (`recordings/<id>/ai-history.json`)
 * - Deterministic local NL intent parser + structured tool executor validated by `ProjectValidator`
 * - Optional OpenAI-compatible (`/chat/completions`) and Gemini (`generateContent`) remote LLM routing
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import {
  decodeRecorderProject,
  encodeRecorderProject,
  type RecorderProject,
} from '../core/ProjectMediaModel.ts';
import {
  BackgroundPatternPresetAllCases,
  DynamicBackgroundPresetAllCases,
  type BackgroundPatternPreset,
  type CanvasAspectRatio,
  type CanvasResolution,
  type DynamicBackgroundPreset,
  type ScreenFrameStyle,
} from '../core/ProjectModel.ts';
import { ProjectValidator } from '../core/ProjectValidator.ts';
import { fitZoomAnimation, exitNormalizations } from '../core/EditorTimeline.ts';
import { materialized, splitPrimarySegment } from '../core/ProjectTimelineEditing.ts';
import {
  makeAnimationClip,
  makeOverlayTiming,
} from '../core/OverlayTimeline.ts';
import {
  makeSubtitleCue,
  subtitleTextNormalized,
} from '../core/PostProductionModel.ts';
import { projectTimelineNextVisualLayer } from '../core/ProjectTimeline.ts';
import { makeNormalizedPoint, type ZoomAnimationClip } from '../core/ZoomAnimation.ts';
import { TimelineMap } from '../core/TimelineMap.ts';
import type { ExportQuality, ExportVideoCodec } from '../core/ExportSettings.ts';
import type { OutputFrameRate } from '../core/CaptureConfiguration.ts';
import {
  discoverInstalledAiClis,
  getPublicAiSettings,
  getResolvedAiApiKey,
  saveAiSettings,
  type AiSettingsStoreOptions,
} from './AiSecrets.ts';

export interface AgentToolInvocation {
  tool:
    | 'set_canvas'
    | 'add_zoom'
    | 'split_segment'
    | 'add_subtitle'
    | 'clean_subtitles'
    | 'add_motion'
    | 'set_export';
  args: Record<string, any>;
}

export interface AgentEditStep {
  title: string;
  detail: string;
  timeSeconds?: number;
}

export interface AgentChangeSummary {
  label: string;
  value: string;
}

export interface AgentChatTurnEntry {
  turnId: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  steps?: AgentEditStep[];
  changes?: AgentChangeSummary[];
  canRevert?: boolean;
  reverted?: boolean;
}

export interface AgentExecuteOutcome {
  project: RecorderProject;
  steps: AgentEditStep[];
  changes: AgentChangeSummary[];
}

const FRAME_ALIASES: Array<[RegExp, ScreenFrameStyle, string]> = [
  [/浅色浏览器/, 'browserLight', '浅色浏览器'],
  [/深色浏览器/, 'browserDark', '深色浏览器'],
  [/浅色窗口/, 'windowLight', '浅色窗口'],
  [/深色窗口/, 'windowDark', '深色窗口'],
  [/手机壳|iPhone/, 'devicePhone', '手机壳'],
  [/平板壳|iPad/, 'deviceTablet', '平板壳'],
  [/无外框|去掉外框|关闭外框/, 'none', '无外框'],
];

const BG_ALIASES: Array<[RegExp, { kind: 'pattern'; preset: BackgroundPatternPreset } | { kind: 'dynamicFlow'; preset: DynamicBackgroundPreset }]> = [
  [/黑曜石网格|深色网格/, { kind: 'pattern', preset: '黑曜石网格' }],
  [/工程白网格|浅色网格/, { kind: 'pattern', preset: '工程白网格' }],
  [/暗夜星阵|深色点阵/, { kind: 'pattern', preset: '暗夜星阵' }],
  [/建筑极简点|浅色点阵/, { kind: 'pattern', preset: '建筑极简点' }],
  [/立体等角网|等角网格/, { kind: 'pattern', preset: '立体等角网' }],
  [/赛博微流网格|流动网格/, { kind: 'dynamicFlow', preset: '赛博微流网格' }],
  [/星辉漫步点阵|流动点阵/, { kind: 'dynamicFlow', preset: '星辉漫步点阵' }],
  [/极光流体星云|流体渐变|极光/, { kind: 'dynamicFlow', preset: '极光流体星云' }],
];

function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Pure deterministic natural-language parser (works offline without API keys)
 * converting common Chinese/English editing instructions into validated tool calls.
 */
export function parseLocalIntentCommands(
  prompt: string,
  options: { currentTime?: number; outputDuration?: number } = {}
): AgentToolInvocation[] {
  const text = String(prompt ?? '').trim();
  const currentTime = Math.max(0, Number(options.currentTime) || 0);
  const outDur = Math.max(0.5, Number(options.outputDuration) || 10);
  const calls: AgentToolInvocation[] = [];

  // 1. Canvas styling cues
  const canvasArgs: Record<string, any> = {};
  const ratioMatch = /(16:9|9:16|1:1|4:3|3:4|2\.39:1|1:2\.39|适应)/.exec(text);
  if (ratioMatch) {
    canvasArgs.aspectRatio = ratioMatch[1];
  }
  const radiusMatch = /圆角(?:调[到至]|设为|改成|改为|为|=|:|\s)*(\d+(?:\.\d+)?)/.exec(text);
  if (radiusMatch) {
    canvasArgs.cornerRadius = Number(radiusMatch[1]);
  }
  const padMatch = /(?:内)?边距(?:调[到至]|设为|改成|改为|为|=|:|\s)*(\d+(?:\.\d+)?)/.exec(text);
  if (padMatch) {
    canvasArgs.padding = Number(padMatch[1]);
  }
  const shadowMatch = /阴影(?:调[到至]|设为|改成|改为|为|=|:|\s)*(\d+(?:\.\d+)?)(%?)/.exec(text);
  if (/无阴影|关闭阴影|去掉阴影/.test(text)) {
    canvasArgs.shadowStrength = 0;
  } else if (shadowMatch) {
    const rawS = Number(shadowMatch[1]);
    canvasArgs.shadowStrength = shadowMatch[2] === '%' || rawS > 1 ? rawS / 100 : rawS;
  }
  for (const [re, frame] of FRAME_ALIASES) {
    if (re.test(text)) {
      canvasArgs.screenFrame = frame;
      break;
    }
  }
  for (const [re, bg] of BG_ALIASES) {
    if (re.test(text)) {
      canvasArgs.backgroundPreset = bg.preset;
      break;
    }
  }
  if (Object.keys(canvasArgs).length > 0) {
    calls.push({ tool: 'set_canvas', args: canvasArgs });
  }

  // 2. Timeline split
  if (/分割|切一刀|裁切片段/.test(text)) {
    const tMatch = /(\d+(?:\.\d+)?)\s*秒?\s*(?:处|位置)?(?:分割|切)/.exec(text);
    const splitAt = tMatch ? Number(tMatch[1]) : clamp(currentTime > 0.1 ? currentTime : outDur / 2, 0.2, outDur - 0.2);
    calls.push({ tool: 'split_segment', args: { time: splitAt } });
  }

  // 3. Zoom focus clip
  if (/缩放|放大|聚焦/.test(text)) {
    const rangeMatch = /(\d+(?:\.\d+)?)s?\s*(?:到|至|-|~)\s*(\d+(?:\.\d+)?)s?/.exec(text);
    const singleTimeMatch = /在\s*(\d+(?:\.\d+)?)\s*(?:s|秒)/.exec(text);
    const scaleMatch = /(\d+(?:\.\d+)?)\s*(?:倍|x|X|×)/.exec(text);
    const s = rangeMatch
      ? Number(rangeMatch[1])
      : singleTimeMatch
        ? Number(singleTimeMatch[1])
        : currentTime;
    const e = rangeMatch ? Number(rangeMatch[2]) : Math.min(outDur, s + 2.0);
    const scale = scaleMatch ? Number(scaleMatch[1]) : 1.8;
    calls.push({
      tool: 'add_zoom',
      args: { startTime: s, endTime: Math.max(s + 0.4, e), scale, focusX: 0.5, focusY: 0.5 },
    });
  }

  // 4. Subtitle cues & cleanup
  if (/清理字幕|规范字幕|去除语气词/.test(text)) {
    calls.push({ tool: 'clean_subtitles', args: {} });
  } else if (/字幕/.test(text)) {
    const quoted = /[“"「『]([^”"」』]+)[”"」』]/.exec(text);
    const colon = /字幕(?:内容)?(?:为|是|:|：)\s*([^\n，。,]+)/.exec(text);
    const rangeMatch = /(\d+(?:\.\d+)?)s?\s*(?:到|至|-|~)\s*(\d+(?:\.\d+)?)s?/.exec(text);
    const cueText = (quoted?.[1] ?? colon?.[1] ?? '重点演示步骤').trim();
    const s = rangeMatch ? Number(rangeMatch[1]) : currentTime;
    const e = rangeMatch ? Number(rangeMatch[2]) : Math.min(outDur, s + 2.5);
    calls.push({
      tool: 'add_subtitle',
      args: { startTime: s, endTime: Math.max(s + 0.5, e), text: cueText },
    });
  }

  // 5. HTML Motion card
  if (/动效|标题卡|章节卡|快捷键卡|标注卡|lower-third|keycap|callout|chapter|pill/i.test(text)) {
    const quoted = /[“"「『]([^”"」』]+)[”"」』]/.exec(text);
    let templateId = 'callout';
    if (/快捷键|keycap/i.test(text)) templateId = 'keycap';
    else if (/章节|chapter/i.test(text)) templateId = 'chapter';
    else if (/名牌|标题卡|lower-third/i.test(text)) templateId = 'lower-third';
    else if (/胶囊|pill/i.test(text)) templateId = 'pill';
    calls.push({
      tool: 'add_motion',
      args: {
        templateId,
        startTime: currentTime,
        duration: 3.0,
        title: (quoted?.[1] ?? 'DogSC 核心功能演示').trim(),
      },
    });
  }

  // 6. Export settings
  const exportArgs: Record<string, any> = {};
  if (/4K|4k/.test(text)) exportArgs.resolution = '4K';
  else if (/1440p|2K/i.test(text)) exportArgs.resolution = '1440p';
  else if (/1080p/i.test(text)) exportArgs.resolution = '1080p';
  if (/60\s*fps|60帧/i.test(text)) exportArgs.frameRate = 60;
  else if (/30\s*fps|30帧/i.test(text)) exportArgs.frameRate = 30;
  if (/HEVC|H\.?265/i.test(text)) exportArgs.videoCodec = 'hevc';
  else if (/H\.?264/i.test(text)) exportArgs.videoCodec = 'h264';
  if (/极致/.test(text)) exportArgs.quality = 'maximum';
  else if (/体积优先/.test(text)) exportArgs.quality = 'compact';
  if (Object.keys(exportArgs).length > 0 && /导出|输出|分辨率|编码|帧率|画质/.test(text)) {
    calls.push({ tool: 'set_export', args: exportArgs });
  }

  return calls;
}

/**
 * Computes human-readable macOS-style change diff summary pills between two project versions.
 */
export function computeProjectChanges(
  before: RecorderProject,
  after: RecorderProject
): AgentChangeSummary[] {
  const changes: AgentChangeSummary[] = [];

  const canvasParts: string[] = [];
  if (before.canvas.aspectRatio !== after.canvas.aspectRatio) {
    canvasParts.push(`比例 ${after.canvas.aspectRatio}`);
  }
  if (Math.abs(before.canvas.cornerRadius - after.canvas.cornerRadius) > 0.01) {
    canvasParts.push(`圆角 ${Math.round(after.canvas.cornerRadius)}px`);
  }
  if (Math.abs(before.canvas.padding - after.canvas.padding) > 0.01) {
    canvasParts.push(`边距 ${Math.round(after.canvas.padding)}px`);
  }
  if (before.canvas.screenFrame !== after.canvas.screenFrame) {
    canvasParts.push(`外框 ${after.canvas.screenFrame}`);
  }
  if (JSON.stringify(before.canvas.backgroundSource) !== JSON.stringify(after.canvas.backgroundSource)) {
    canvasParts.push(`背景 ${after.canvas.backgroundSource.kind}`);
  }
  if (JSON.stringify(before.canvas.crop) !== JSON.stringify(after.canvas.crop)) {
    canvasParts.push('裁切已更新');
  }
  if (canvasParts.length > 0) {
    changes.push({ label: '画面', value: canvasParts.join(' · ') });
  }

  if (before.timeline.zoomClips.length !== after.timeline.zoomClips.length) {
    changes.push({
      label: '运镜',
      value: `${before.timeline.zoomClips.length} 段 → ${after.timeline.zoomClips.length} 段`,
    });
  }
  if (JSON.stringify(before.timeline.sourceSequence) !== JSON.stringify(after.timeline.sourceSequence)) {
    changes.push({ label: '主轨', value: '时间线序列已调整' });
  }
  if (JSON.stringify(before.timeline.subtitleCues) !== JSON.stringify(after.timeline.subtitleCues)) {
    changes.push({
      label: '字幕',
      value: `${before.timeline.subtitleCues.length} 条 → ${after.timeline.subtitleCues.length} 条`,
    });
  }
  if (before.timeline.animationClips.length !== after.timeline.animationClips.length) {
    changes.push({
      label: '动效',
      value: `${before.timeline.animationClips.length} 个 → ${after.timeline.animationClips.length} 个`,
    });
  }
  if (JSON.stringify(before.exportSettings) !== JSON.stringify(after.exportSettings)) {
    changes.push({
      label: '导出',
      value: `${after.exportSettings.resolution} ${after.exportSettings.frameRate}fps ${after.exportSettings.videoCodec ?? 'h264'}`,
    });
  }

  return changes;
}

/**
 * Pure, atomic tool executor: applies structured Agent tool calls onto a RecorderProject,
 * validates every mutation with `ProjectValidator.validate`, and emits steps + diff summaries.
 */
export function executeAgentTools(
  baseProject: RecorderProject,
  invocations: readonly AgentToolInvocation[],
  options: { rawSourceDuration: number }
): AgentExecuteOutcome {
  let next: RecorderProject = decodeRecorderProject(JSON.parse(encodeRecorderProject(baseProject)));
  const rawDur = Math.max(options.rawSourceDuration, 0.05);
  const steps: AgentEditStep[] = [];

  for (const inv of invocations) {
    const a = inv.args ?? {};
    if (inv.tool === 'set_canvas') {
      const nextCanvas = { ...next.canvas };
      const touched: string[] = [];

      if (typeof a.aspectRatio === 'string') {
        nextCanvas.aspectRatio = a.aspectRatio as CanvasAspectRatio;
        touched.push(`比例 ${a.aspectRatio}`);
      }
      if (typeof a.cornerRadius === 'number' && Number.isFinite(a.cornerRadius)) {
        nextCanvas.cornerRadius = clamp(a.cornerRadius, 0, 500);
        touched.push(`圆角 ${Math.round(nextCanvas.cornerRadius)}px`);
      }
      if (typeof a.padding === 'number' && Number.isFinite(a.padding)) {
        nextCanvas.padding = clamp(a.padding, 0, 1000);
        touched.push(`边距 ${Math.round(nextCanvas.padding)}px`);
      }
      if (typeof a.shadowStrength === 'number' && Number.isFinite(a.shadowStrength)) {
        nextCanvas.shadowStrength = clamp(a.shadowStrength, 0, 1);
        touched.push(`阴影 ${Math.round(nextCanvas.shadowStrength * 100)}%`);
      }
      if (typeof a.screenFrame === 'string') {
        nextCanvas.screenFrame = a.screenFrame as ScreenFrameStyle;
        touched.push(`外框 ${a.screenFrame}`);
      }
      if (typeof a.backgroundPreset === 'string') {
        const preset = a.backgroundPreset;
        if ((BackgroundPatternPresetAllCases as readonly string[]).includes(preset)) {
          nextCanvas.backgroundSource = { kind: 'pattern', preset: preset as BackgroundPatternPreset };
          touched.push(`背景 ${preset}`);
        } else if ((DynamicBackgroundPresetAllCases as readonly string[]).includes(preset)) {
          nextCanvas.backgroundSource = { kind: 'dynamicFlow', preset: preset as DynamicBackgroundPreset };
          touched.push(`背景 ${preset}`);
        }
      }
      if (a.crop && typeof a.crop === 'object') {
        const cw = clamp(Number(a.crop.width) || 1, 0.05, 1);
        const ch = clamp(Number(a.crop.height) || 1, 0.05, 1);
        const cx = clamp(Number(a.crop.x) || 0, 0, 1 - cw);
        const cy = clamp(Number(a.crop.y) || 0, 0, 1 - ch);
        nextCanvas.crop = { x: cx, y: cy, width: cw, height: ch };
        touched.push('裁切更新');
      }
      next = { ...next, canvas: nextCanvas };
      steps.push({ title: '调整画面样式', detail: touched.join('，') || '画布参数更新' });
    } else if (inv.tool === 'add_zoom') {
      const outDur = Math.max(new TimelineMap(next.timeline.sourceSequence, rawDur).outputDuration, 0.5);
      const startTime = clamp(Number(a.startTime) || 0, 0, Math.max(0, outDur - 0.3));
      const endTime = clamp(Number(a.endTime) || startTime + 1.8, startTime + 0.2, outDur);
      const scale = clamp(Number(a.scale) || 1.8, 1.05, 6);
      const fx = clamp(Number(a.focusX ?? 0.5), 0, 1);
      const fy = clamp(Number(a.focusY ?? 0.5), 0, 1);
      const defaultExit = next.motion.defaultZoomTransitionDuration ?? 0.7;

      const clip = fitZoomAnimation({
        start: startTime,
        end: endTime,
        among: next.timeline.zoomClips,
        duration: outDur,
        scale,
        focus: { x: fx, y: fy },
        origin: 'manual',
        easing: next.motion.defaultZoomEasing ?? '弹簧',
        transitionDuration: defaultExit,
      });

      if (clip) {
        const sorted = [...next.timeline.zoomClips, clip].sort((x, y) => x.startTime - y.startTime);
        const patches = exitNormalizations(clip.id, sorted, defaultExit);
        const byId = new Map(patches.map((p) => [p.id, p]));
        const zoomClips: ZoomAnimationClip[] = sorted.map((c) => byId.get(c.id) ?? c);
        next = { ...next, timeline: { ...next.timeline, zoomClips } };
        steps.push({
          title: '添加缩放片段',
          detail: `${formatClock(clip.startTime)}–${formatClock(clip.endTime)} (${clip.scale.toFixed(1)}×)`,
          timeSeconds: clip.startTime,
        });
      } else {
        steps.push({
          title: '跳过冲突缩放区间',
          detail: `${formatClock(startTime)} 附近已被已有缩放片段占用`,
          timeSeconds: startTime,
        });
      }
    } else if (inv.tool === 'split_segment') {
      const outDur = new TimelineMap(next.timeline.sourceSequence, rawDur).outputDuration;
      const splitTime = clamp(Number(a.time) || outDur / 2, 0.15, Math.max(0.2, outDur - 0.15));
      const mat =
        next.timeline.sourceSequence.kind === 'fullRecording'
          ? materialized(next.timeline, rawDur)
          : next.timeline;
      const nextTimeline = splitPrimarySegment(mat, splitTime, randomUUID(), rawDur);
      next = { ...next, timeline: nextTimeline };
      steps.push({
        title: '分割主视频轨道',
        detail: `在 ${formatClock(splitTime)} 处分割片段`,
        timeSeconds: splitTime,
      });
    } else if (inv.tool === 'add_subtitle') {
      const outDur = Math.max(new TimelineMap(next.timeline.sourceSequence, rawDur).outputDuration, 0.5);
      const s = clamp(Number(a.startTime) || 0, 0, Math.max(0, outDur - 0.25));
      const dur = clamp(
        typeof a.endTime === 'number' ? Number(a.endTime) - s : Number(a.duration) || 2.5,
        0.2,
        Math.max(0.2, outDur - s)
      );
      const cue = makeSubtitleCue({
        timing: makeOverlayTiming(s, dur),
        text: String(a.text ?? '字幕内容').trim() || '字幕内容',
        secondaryText: typeof a.secondaryText === 'string' ? a.secondaryText.trim() || null : null,
      });
      const subtitleCues = [...next.timeline.subtitleCues, cue].sort(
        (x, y) => x.timing.startTime - y.timing.startTime
      );
      next = { ...next, timeline: { ...next.timeline, subtitleCues } };
      steps.push({
        title: '添加双语字幕',
        detail: `${formatClock(s)} “${cue.text}”`,
        timeSeconds: s,
      });
    } else if (inv.tool === 'clean_subtitles') {
      const cleaned = subtitleTextNormalized(next.timeline.subtitleCues);
      next = { ...next, timeline: { ...next.timeline, subtitleCues: cleaned } };
      steps.push({ title: '清洗规范字幕文本', detail: `处理后保留 ${cleaned.length} 条字幕` });
    } else if (inv.tool === 'add_motion') {
      const outDur = Math.max(new TimelineMap(next.timeline.sourceSequence, rawDur).outputDuration, 0.5);
      const templateId = typeof a.templateId === 'string' ? a.templateId : 'callout';
      const s = clamp(Number(a.startTime) || 0, 0, Math.max(0, outDur - 0.4));
      const dur = clamp(Number(a.duration) || 3.0, 0.4, Math.max(0.4, outDur - s));
      const clip = makeAnimationClip({
        timing: makeOverlayTiming(s, dur),
        sourcePath: `builtin://${templateId}`,
        position: makeNormalizedPoint(clamp(Number(a.x ?? 0.5), 0.1, 0.9), clamp(Number(a.y ?? 0.82), 0.1, 0.9)),
        width: clamp(Number(a.width ?? 0.42), 0.15, 0.9),
        properties: {
          template: { kind: 'string', value: templateId },
          title: { kind: 'string', value: String(a.title ?? '重点提示') },
          subtitle: { kind: 'string', value: String(a.subtitle ?? 'DogSC Motion') },
        },
        layerIndex: projectTimelineNextVisualLayer(next.timeline),
      });
      next = {
        ...next,
        timeline: {
          ...next.timeline,
          animationClips: [...next.timeline.animationClips, clip],
        },
      };
      steps.push({
        title: `添加 ${templateId} 动效卡片`,
        detail: `${formatClock(s)} “${String(a.title ?? '重点提示')}”`,
        timeSeconds: s,
      });
    } else if (inv.tool === 'set_export') {
      const es = { ...next.exportSettings };
      if (a.resolution === '原始素材' || a.resolution === '1080p' || a.resolution === '1440p' || a.resolution === '4K') {
        es.resolution = a.resolution as CanvasResolution;
      }
      if (a.frameRate === 30 || a.frameRate === 60) {
        es.frameRate = a.frameRate as OutputFrameRate;
      }
      if (a.videoCodec === 'h264' || a.videoCodec === 'hevc') {
        es.videoCodec = a.videoCodec as ExportVideoCodec;
      }
      if (a.quality === 'compact' || a.quality === 'high' || a.quality === 'maximum') {
        es.quality = a.quality as ExportQuality;
      }
      next = { ...next, exportSettings: es };
      steps.push({
        title: '更新导出规格',
        detail: `${es.resolution} · ${es.frameRate}fps · ${es.videoCodec ?? 'h264'} (${es.quality})`,
      });
    }
  }

  ProjectValidator.validate(next);
  return {
    project: next,
    steps,
    changes: computeProjectChanges(baseProject, next),
  };
}

export function buildExternalAgentInstructions(port: number, token: string): string {
  return [
    '# DogSC Windows 本地 Agent Bridge 接入说明',
    `接口地址: http://127.0.0.1:${port}/api/recordings/<recordingId>/ai/command`,
    `鉴权请求头: Authorization: Bearer ${token}`,
    '',
    '请求体 JSON 示例:',
    '{',
    '  "prompt": "把比例改成 16:9，圆角设为 32，在 1.5s 到 4s 加字幕“核心演示”",',
    '  "commands": [',
    '    { "tool": "set_canvas", "args": { "aspectRatio": "16:9", "cornerRadius": 32 } },',
    '    { "tool": "add_subtitle", "args": { "startTime": 1.5, "endTime": 4.0, "text": "核心演示" } }',
    '  ]',
    '}',
  ].join('\n');
}

const OPENAI_SYSTEM_PROMPT = [
  '你是 DogSC Studio Windows 视频编辑助手。根据用户的要求输出严格 JSON 对象（不要输出 Markdown 代码块之外的多余解释）：',
  '{"reply":"简短中文说明","commands":[{"tool":"set_canvas|add_zoom|split_segment|add_subtitle|clean_subtitles|add_motion|set_export","args":{...}}]}',
  '可用工具参数:',
  '- set_canvas: { aspectRatio?: "适应"|"16:9"|"9:16"|"1:1"|"4:3", cornerRadius?: number, padding?: number, shadowStrength?: 0..1, screenFrame?: "none"|"windowLight"|"windowDark"|"browserLight"|"browserDark"|"devicePhone"|"deviceTablet", backgroundPreset?: "黑曜石网格"|"工程白网格"|"极光流体星云"|"赛博微流网格" }',
  '- add_zoom: { startTime: number, endTime: number, scale: 1.1..6, focusX?: 0..1, focusY?: 0..1 }',
  '- split_segment: { time: number }',
  '- add_subtitle: { startTime: number, endTime: number, text: string, secondaryText?: string }',
  '- clean_subtitles: {}',
  '- add_motion: { templateId: "lower-third"|"keycap"|"callout"|"chapter"|"pill", startTime: number, duration?: number, title: string, subtitle?: string }',
  '- set_export: { resolution?: "原始素材"|"1080p"|"1440p"|"4K", frameRate?: 30|60, videoCodec?: "h264"|"hevc", quality?: "compact"|"high"|"maximum" }',
].join('\n');

function extractJsonPlan(rawText: string): { reply?: string; commands?: AgentToolInvocation[] } | null {
  const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(cleaned.slice(first, last + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export class AgentBridgeManager {
  readonly token = randomBytes(16).toString('hex');
  private readonly snapshots = new Map<string, { recordingId: string; encodedProject: string }>();
  private readonly aiSettingsOpts: AiSettingsStoreOptions;

  constructor(aiSettingsOpts: AiSettingsStoreOptions = {}) {
    this.aiSettingsOpts = aiSettingsOpts;
  }

  verifyBearerToken(authHeader: string | undefined): boolean {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
    const provided = Buffer.from(authHeader.slice('Bearer '.length).trim(), 'utf8');
    const expected = Buffer.from(this.token, 'utf8');
    if (provided.length !== expected.length) return false;
    return timingSafeEqual(provided, expected);
  }

  recordSnapshot(turnId: string, recordingId: string, project: RecorderProject): void {
    this.snapshots.set(turnId, {
      recordingId,
      encodedProject: encodeRecorderProject(project),
    });
  }

  takeSnapshot(turnId: string, recordingId: string): RecorderProject | null {
    const item = this.snapshots.get(turnId);
    if (!item || item.recordingId !== recordingId) return null;
    this.snapshots.delete(turnId);
    return decodeRecorderProject(JSON.parse(item.encodedProject));
  }

  loadHistory(sessionDir: string): AgentChatTurnEntry[] {
    const p = join(sessionDir, 'ai-history.json');
    if (!existsSync(p)) return [];
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  saveHistory(sessionDir: string, entries: readonly AgentChatTurnEntry[]): void {
    const p = join(sessionDir, 'ai-history.json');
    const capped = entries.slice(-60);
    writeFileSync(p, JSON.stringify(capped, null, 2), 'utf8');
  }

  async resolveCommandsForPrompt(
    prompt: string,
    project: RecorderProject,
    context: { currentTime: number; outputDuration: number }
  ): Promise<{ reply: string; commands: AgentToolInvocation[]; providerUsed: string }> {
    const settings = getPublicAiSettings(this.aiSettingsOpts);
    const apiKey = getResolvedAiApiKey(this.aiSettingsOpts);

    if ((settings.provider === 'openai' || settings.provider === 'gemini') && apiKey) {
      const summary = `当前工程时长=${context.outputDuration.toFixed(2)}s, 播放头=${context.currentTime.toFixed(2)}s, 比例=${project.canvas.aspectRatio}, 圆角=${project.canvas.cornerRadius}, 缩放片段=${project.timeline.zoomClips.length}, 字幕=${project.timeline.subtitleCues.length}, 动效=${project.timeline.animationClips.length}`;
      try {
        if (settings.provider === 'openai') {
          const resp = await fetch(`${settings.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: settings.model,
              temperature: 0.1,
              messages: [
                { role: 'system', content: OPENAI_SYSTEM_PROMPT },
                { role: 'user', content: `${summary}\n用户指令: ${prompt}` },
              ],
            }),
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const data = (await resp.json()) as any;
          const content = String(data?.choices?.[0]?.message?.content ?? '');
          const plan = extractJsonPlan(content);
          if (plan && Array.isArray(plan.commands)) {
            return {
              reply: plan.reply ?? '已完成 LLM 规划并应用剪辑修改。',
              commands: plan.commands,
              providerUsed: `openai:${settings.model}`,
            };
          }
        } else if (settings.provider === 'gemini') {
          const url = `${settings.baseUrl}/models/${encodeURIComponent(settings.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
          const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [{ text: `${OPENAI_SYSTEM_PROMPT}\n${summary}\n用户指令: ${prompt}` }],
                },
              ],
            }),
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const data = (await resp.json()) as any;
          const content = String(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
          const plan = extractJsonPlan(content);
          if (plan && Array.isArray(plan.commands)) {
            return {
              reply: plan.reply ?? '已完成 Gemini 规划并应用剪辑修改。',
              commands: plan.commands,
              providerUsed: `gemini:${settings.model}`,
            };
          }
        }
      } catch (err: any) {
        const localFallback = parseLocalIntentCommands(prompt, context);
        if (localFallback.length > 0) {
          return {
            reply: `远程模型调用失败 (${err?.message ?? err})，已自动降级为本地确定性规则执行。`,
            commands: localFallback,
            providerUsed: 'local-fallback',
          };
        }
        return {
          reply: `远程模型调用失败 (${err?.message ?? err})。可切换本地引擎或检查 API 配置。`,
          commands: [],
          providerUsed: 'error',
        };
      }
    }

    const commands = parseLocalIntentCommands(prompt, context);
    const reply =
      commands.length > 0
        ? `已在本地解析并执行 ${commands.length} 项剪辑操作（全程经 ProjectValidator 校验）。`
        : '暂未匹配到可执行的剪辑指令。可尝试输入：“把比例改成 16:9，圆角设为 32，加上浅色窗口，并在 1s 到 3s 加字幕“功能演示””。';
    return { reply, commands, providerUsed: 'local' };
  }

  getStatus(port: number) {
    return {
      ok: true,
      bridgeToken: this.token,
      port,
      settings: getPublicAiSettings(this.aiSettingsOpts),
      clis: discoverInstalledAiClis(),
      instructions: buildExternalAgentInstructions(port, this.token),
    };
  }

  getSettingsPayload() {
    return {
      ok: true,
      settings: getPublicAiSettings(this.aiSettingsOpts),
      clis: discoverInstalledAiClis(),
    };
  }

  updateSettingsPayload(patch: Parameters<typeof saveAiSettings>[0]) {
    const settings = saveAiSettings(patch, this.aiSettingsOpts);
    return {
      ok: true,
      settings,
      clis: discoverInstalledAiClis(),
    };
  }

  private readSessionProjectAndDuration(sessionDir: string): {
    project: RecorderProject;
    rawSourceDuration: number;
    outputDuration: number;
  } {
    const metaPath = join(sessionDir, 'meta.json');
    const projectPath = join(sessionDir, 'project.json');
    const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
    const rawProject = JSON.parse(readFileSync(projectPath, 'utf8'));
    const project = decodeRecorderProject(rawProject);
    const rawSourceDuration = Math.max(Number(meta?.durationSeconds) || 8, 0.2);
    const outputDuration = new TimelineMap(project.timeline.sourceSequence, rawSourceDuration).outputDuration;
    return { project, rawSourceDuration, outputDuration };
  }

  async executeChatTurn(
    sessionDir: string,
    recId: string,
    body: { prompt?: string; currentTime?: number }
  ): Promise<{ nextProject: RecorderProject; payload: Record<string, any> }> {
    const prompt = String(body.prompt ?? '').trim();
    const { project, rawSourceDuration, outputDuration } = this.readSessionProjectAndDuration(sessionDir);
    const currentTime = clamp(Number(body.currentTime) || 0, 0, Math.max(0.1, outputDuration));

    const resolved = await this.resolveCommandsForPrompt(prompt, project, {
      currentTime,
      outputDuration,
    });
    const outcome = executeAgentTools(project, resolved.commands, { rawSourceDuration });
    const turnId = randomUUID();
    const now = new Date().toISOString();
    const didMutate = outcome.steps.length > 0;
    if (didMutate) {
      this.recordSnapshot(turnId, recId, project);
    }

    const history = this.loadHistory(sessionDir);
    history.push(
      {
        turnId: randomUUID(),
        role: 'user',
        text: prompt,
        createdAt: now,
      },
      {
        turnId,
        role: 'assistant',
        text: resolved.reply,
        createdAt: now,
        steps: outcome.steps,
        changes: outcome.changes,
        canRevert: didMutate,
        reverted: false,
      }
    );
    this.saveHistory(sessionDir, history);

    return {
      nextProject: outcome.project,
      payload: {
        ok: true,
        turnId,
        reply: resolved.reply,
        providerUsed: resolved.providerUsed,
        steps: outcome.steps,
        changes: outcome.changes,
        project: JSON.parse(encodeRecorderProject(outcome.project)),
        history: this.loadHistory(sessionDir),
      },
    };
  }

  async executeCommandTurn(
    sessionDir: string,
    recId: string,
    body: { prompt?: string; commands?: AgentToolInvocation[]; currentTime?: number }
  ): Promise<{ nextProject: RecorderProject; payload: Record<string, any> }> {
    const prompt = String(body.prompt ?? '').trim();
    const { project, rawSourceDuration, outputDuration } = this.readSessionProjectAndDuration(sessionDir);
    const currentTime = clamp(Number(body.currentTime) || 0, 0, Math.max(0.1, outputDuration));

    let commands: AgentToolInvocation[] = [];
    let reply = '';
    if (Array.isArray(body.commands) && body.commands.length > 0) {
      commands = body.commands;
      reply = prompt
        ? `外部 Agent 已执行：${prompt}`
        : `外部 Agent 已执行 ${commands.length} 项结构化剪辑指令。`;
    } else {
      const resolved = await this.resolveCommandsForPrompt(prompt, project, {
        currentTime,
        outputDuration,
      });
      commands = resolved.commands;
      reply = resolved.reply;
    }

    const outcome = executeAgentTools(project, commands, { rawSourceDuration });
    const turnId = randomUUID();
    const now = new Date().toISOString();
    const didMutate = outcome.steps.length > 0;
    if (didMutate) {
      this.recordSnapshot(turnId, recId, project);
    }

    const history = this.loadHistory(sessionDir);
    history.push(
      {
        turnId: randomUUID(),
        role: 'user',
        text: prompt ? `[外部 Agent] ${prompt}` : `[外部 Agent] 执行 ${commands.length} 项工具调用`,
        createdAt: now,
      },
      {
        turnId,
        role: 'assistant',
        text: reply,
        createdAt: now,
        steps: outcome.steps,
        changes: outcome.changes,
        canRevert: didMutate,
        reverted: false,
      }
    );
    this.saveHistory(sessionDir, history);

    return {
      nextProject: outcome.project,
      payload: {
        ok: true,
        turnId,
        reply,
        steps: outcome.steps,
        changes: outcome.changes,
        project: JSON.parse(encodeRecorderProject(outcome.project)),
        history: this.loadHistory(sessionDir),
      },
    };
  }

  revertChatTurn(
    sessionDir: string,
    recId: string,
    turnId: string
  ): { nextProject: RecorderProject; payload: Record<string, any> } | null {
    const restored = this.takeSnapshot(turnId, recId);
    if (!restored) return null;

    const history = this.loadHistory(sessionDir).map((entry) =>
      entry.turnId === turnId
        ? { ...entry, canRevert: false, reverted: true }
        : entry
    );
    this.saveHistory(sessionDir, history);

    return {
      nextProject: restored,
      payload: {
        ok: true,
        turnId,
        project: JSON.parse(encodeRecorderProject(restored)),
        history: this.loadHistory(sessionDir),
      },
    };
  }
}
