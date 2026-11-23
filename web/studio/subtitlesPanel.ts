/**
 * web/studio/subtitlesPanel.ts
 *
 * Left Library `字幕` (`subtitles`) tab:
 * - Global SubtitleStyle controls (`entrance`, `font`, `fontScale`, `bottomMargin`, `backgroundOpacity`, `showsSecondary`, `bold`)
 * - Cue authoring, inline bilingual editing, SRT import/export (`SubtitleSRT`), and text normalization (`SubtitleText`)
 * - Smart Silence Pause-Cut (`detectSilentIntervals` + `removeSilentIntervalsFromProject`) over session audio waveform
 * Strictly ZERO node:* imports and stripTypeScriptTypes compatible.
 */

import type { LibraryPanelHost } from './aiPanel.ts';
import type { RecorderProject } from '../../src/core/ProjectMediaModel.ts';
import {
  makeSubtitleCue,
  makeSubtitleStyle,
  SubtitleSRT,
  SubtitleText,
  type SubtitleCue,
  type SubtitleEntrance,
  type SubtitleFont,
} from '../../src/core/PostProductionModel.ts';
import { makeOverlayTiming } from '../../src/core/OverlayTimeline.ts';
import {
  materialized,
  removePrimarySegment,
  splitPrimarySegment,
} from '../../src/core/ProjectTimelineEditing.ts';
import { TimelineMap } from '../../src/core/TimelineMap.ts';
import { ProjectValidator } from '../../src/core/ProjectValidator.ts';
import { clamp, newUUID } from '../../src/core/swift.ts';

export interface SilentInterval {
  start: number;
  end: number;
  duration: number;
}

const ENTRANCE_OPTIONS: ReadonlyArray<{ id: SubtitleEntrance; label: string }> = [
  { id: 'none', label: '无动画' },
  { id: 'fade', label: '淡入' },
  { id: 'rise', label: '上浮' },
  { id: 'pop', label: '弹跳' },
  { id: 'typewriter', label: '打字机' },
];

const FONT_OPTIONS: ReadonlyArray<{ id: SubtitleFont; label: string }> = [
  { id: 'system', label: '系统' },
  { id: 'rounded', label: '圆体' },
  { id: 'serif', label: '衬线' },
  { id: 'mono', label: '等宽' },
];

function escapeHtml(text: string): string {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatClock(sec: number): string {
  const s = Math.max(0, sec);
  const mins = Math.floor(s / 60);
  const rem = s - mins * 60;
  return `${mins}:${rem.toFixed(1).padStart(4, '0')}`;
}

/**
 * Pure function: finds contiguous low-energy speech pauses in normalized [0..1] waveform peaks,
 * shrinking edges by `keepPaddingSeconds` so consonant onsets and tails stay intact.
 */
export function detectSilentIntervals(
  peaks: readonly number[],
  durationSeconds: number,
  options: {
    threshold?: number;
    minPauseSeconds?: number;
    keepPaddingSeconds?: number;
  } = {}
): SilentInterval[] {
  const n = peaks.length;
  const dur = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  if (n === 0 || dur <= 0) return [];

  const threshold = clamp(options.threshold ?? 0.045, 0.005, 0.5);
  const minPause = clamp(options.minPauseSeconds ?? 0.45, 0.1, 30);
  const pad = clamp(options.keepPaddingSeconds ?? 0.08, 0, 0.5);
  const secPerBucket = dur / n;

  const rawRuns: Array<{ start: number; end: number }> = [];
  let runStartIdx: number | null = null;
  for (let i = 0; i < n; i++) {
    const val = Number.isFinite(peaks[i]) ? peaks[i] : 0;
    if (val < threshold) {
      if (runStartIdx === null) runStartIdx = i;
    } else if (runStartIdx !== null) {
      rawRuns.push({ start: runStartIdx * secPerBucket, end: i * secPerBucket });
      runStartIdx = null;
    }
  }
  if (runStartIdx !== null) {
    rawRuns.push({ start: runStartIdx * secPerBucket, end: dur });
  }

  const out: SilentInterval[] = [];
  for (const r of rawRuns) {
    const trimmedStart = r.start === 0 ? 0 : r.start + pad;
    const trimmedEnd = r.end >= dur - 0.01 ? dur : r.end - pad;
    const span = trimmedEnd - trimmedStart;
    if (span >= minPause) {
      out.push({
        start: Number(trimmedStart.toFixed(3)),
        end: Number(trimmedEnd.toFixed(3)),
        duration: Number(span.toFixed(3)),
      });
    }
  }
  return out;
}

/**
 * Pure function: ripples out silent pauses from high-to-low output time using
 * Core's `splitPrimarySegment` + `removePrimarySegment` so earlier timestamps remain invariant.
 */
export function removeSilentIntervalsFromProject(
  project: RecorderProject,
  rawSourceDuration: number,
  intervals: ReadonlyArray<{ start: number; end: number }>
): RecorderProject {
  if (!intervals || intervals.length === 0) return project;
  const safeDur = Math.max(0.2, rawSourceDuration);
  const defaultExit = project.motion.defaultZoomTransitionDuration ?? 0.7;

  let tl =
    project.timeline.sourceSequence.kind === 'fullRecording'
      ? materialized(project.timeline, safeDur)
      : project.timeline;

  const sortedDesc = intervals
    .filter((iv) => Number.isFinite(iv.start) && Number.isFinite(iv.end) && iv.end - iv.start >= 0.15)
    .slice()
    .sort((a, b) => b.start - a.start);

  const edgeEps = 0.04;

  for (const iv of sortedDesc) {
    let map = new TimelineMap({ sourceSequence: tl.sourceSequence, sourceDurations: safeDur });
    if (map.outputDuration - (iv.end - iv.start) < 0.25) {
      continue;
    }

    const cutStart = clamp(iv.start, 0, map.outputDuration);
    const cutEnd = clamp(iv.end, 0, map.outputDuration);
    if (cutEnd - cutStart < 0.12) continue;

    // Split end boundary first (larger time)
    if (cutEnd < map.outputDuration - edgeEps) {
      const segAtEnd = map.segmentAtOutputTime(cutEnd);
      if (segAtEnd && cutEnd > segAtEnd.outputStart + edgeEps && cutEnd < segAtEnd.outputEnd - edgeEps) {
        tl = splitPrimarySegment(tl, cutEnd, newUUID(), safeDur);
        map = new TimelineMap({ sourceSequence: tl.sourceSequence, sourceDurations: safeDur });
      }
    }

    // Split start boundary second
    if (cutStart > edgeEps) {
      const segAtStart = map.segmentAtOutputTime(cutStart);
      if (segAtStart && cutStart > segAtStart.outputStart + edgeEps && cutStart < segAtStart.outputEnd - edgeEps) {
        tl = splitPrimarySegment(tl, cutStart, newUUID(), safeDur);
        map = new TimelineMap({ sourceSequence: tl.sourceSequence, sourceDurations: safeDur });
      }
    }

    if (map.segments.length <= 1) continue;
    const mid = (cutStart + cutEnd) * 0.5;
    const victim = map.segmentAtOutputTime(mid);
    if (!victim) continue;
    // Guard against eating a much larger segment when boundaries weren't splittable
    if (victim.outputDuration > (cutEnd - cutStart) * 2.2 + 0.5) continue;

    try {
      tl = removePrimarySegment(tl, victim.id, safeDur, defaultExit);
    } catch {
      // Skip unremovable boundary segment
    }
  }

  const nextProject: RecorderProject = { ...project, timeline: tl };
  ProjectValidator.validate(nextProject);
  return nextProject;
}

export class SubtitlesLibraryPanel {
  private container: HTMLElement | null = null;
  private host: LibraryPanelHost | null = null;
  private waveformSessionId: string | null = null;
  private waveformPeaks: number[] = [];
  private waveformDuration = 0;
  private hasWaveformAudio = false;
  private pauseThreshold = 0.045;
  private minPauseSec = 0.45;
  private noticeText: string | null = null;

  mountOrSync(container: HTMLElement, host: LibraryPanelHost): void {
    this.container = container;
    this.host = host;

    const sessionId = host.getSessionId();
    if (sessionId && sessionId !== this.waveformSessionId) {
      this.waveformSessionId = sessionId;
      this.waveformPeaks = [];
      this.hasWaveformAudio = false;
      void this.loadWaveform(sessionId);
    }

    // Preserve active cue inline input while editing
    const active = document.activeElement as HTMLElement | null;
    if (active && container.contains(active) && active.tagName === 'INPUT' && (active as HTMLInputElement).type === 'text') {
      return;
    }

    this.render();
  }

  private async loadWaveform(sessionId: string): Promise<void> {
    try {
      const res = await fetch(`/api/recordings/${encodeURIComponent(sessionId)}/waveform?samples=240`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = await res.json();
      if (this.waveformSessionId !== sessionId) return;
      this.hasWaveformAudio = Boolean(data.hasAudio);
      this.waveformDuration = Number(data.durationSeconds) || 0;
      this.waveformPeaks = Array.isArray(data.peaks) ? data.peaks : [];
      if (this.container) {
        this.render();
      }
    } catch {
      // Ignore waveform load error
    }
  }

  private render(): void {
    if (!this.container || !this.host) return;
    const sessionId = this.host.getSessionId();
    const project = this.host.getProject();

    if (!sessionId || !project) {
      this.container.innerHTML = `<div class="lib-placeholder-card"><div class="lib-placeholder-title">双语字幕与停顿剪辑</div><p class="lib-placeholder-desc">请先选择或新建一段录制工程。</p></div>`;
      return;
    }

    const style = project.timeline.subtitleStyle ?? makeSubtitleStyle();
    const cues = (project.timeline.subtitleCues ?? [])
      .slice()
      .sort((a, b) => a.timing.startTime - b.timing.startTime);

    const effectiveDur =
      this.waveformDuration > 0 ? this.waveformDuration : this.host.getOutputDuration();
    const silentIntervals = this.hasWaveformAudio
      ? detectSilentIntervals(this.waveformPeaks, effectiveDur, {
          threshold: this.pauseThreshold,
          minPauseSeconds: this.minPauseSec,
        })
      : [];

    const entrancePills = ENTRANCE_OPTIONS.map(
      (opt) =>
        `<button class="pill-choice ${style.entrance === opt.id ? 'active' : ''}" data-sub-entrance="${opt.id}">${opt.label}</button>`
    ).join('');

    const fontPills = FONT_OPTIONS.map(
      (opt) =>
        `<button class="pill-choice ${style.font === opt.id ? 'active' : ''}" data-sub-font="${opt.id}">${opt.label}</button>`
    ).join('');

    const pauseChipsHtml = !this.hasWaveformAudio
      ? `<div class="assets-empty">当前录制无系统声/麦克风音轨可用于静音检测。</div>`
      : silentIntervals.length === 0
        ? `<div class="assets-empty">在阈值 ${(this.pauseThreshold * 100).toFixed(1)}% / ≥${this.minPauseSec.toFixed(2)}s 下未发现可删减停顿。</div>`
        : `<div class="pause-chips-wrap">${silentIntervals
            .map(
              (iv) =>
                `<button class="pause-chip" data-seek-sec="${iv.start.toFixed(2)}" title="点击跳转至此静音段">${formatClock(iv.start)}-${formatClock(iv.end)} (${iv.duration.toFixed(1)}s)</button>`
            )
            .join('')}</div>`;

    const cuesHtml =
      cues.length === 0
        ? `<div class="assets-empty">暂无字幕。点击“+ 加字幕”、导入 SRT 或直接用 AI 助手生成。</div>`
        : cues
            .map(
              (c) => `
            <div class="sub-cue-card" data-cue-id="${escapeHtml(c.id)}">
              <div class="sub-cue-head">
                <button class="ai-step-time" data-seek-sec="${c.timing.startTime.toFixed(3)}" title="跳转到字幕起始位置">${formatClock(
                  c.timing.startTime
                )} → ${formatClock(c.timing.endTime)}</button>
                <button class="chrome-btn asset-act-btn" data-del-cue="${escapeHtml(c.id)}">删除</button>
              </div>
              <input type="text" class="ai-input sub-cue-primary" data-edit-primary="${escapeHtml(
                c.id
              )}" value="${escapeHtml(c.text)}" placeholder="主字幕文本" />
              <input type="text" class="ai-input sub-cue-secondary" data-edit-secondary="${escapeHtml(
                c.id
              )}" value="${escapeHtml(c.secondaryText ?? '')}" placeholder="双语副字幕（可选）" />
            </div>`
            )
            .join('');

    this.container.innerHTML = `
      <div class="sub-panel-root">
        ${this.noticeText ? `<div class="ai-notice-banner">${escapeHtml(this.noticeText)}</div>` : ''}

        <div class="insp-card">
          <div class="insp-card-title">字幕操作与 SRT</div>
          <div class="sub-actions-grid">
            <button id="sub-btn-add" class="chrome-btn subtle-well">+ 加字幕</button>
            <label class="chrome-btn subtle-well sub-import-lbl">
              <input id="sub-srt-input" type="file" accept=".srt,.txt" hidden />
              导入 SRT
            </label>
            <button id="sub-btn-export-srt" class="chrome-btn" ${cues.length === 0 ? 'disabled' : ''}>导出 SRT</button>
            <button id="sub-btn-normalize" class="chrome-btn" ${cues.length === 0 ? 'disabled' : ''}>清洗规范</button>
          </div>
        </div>

        <div class="insp-card">
          <div class="insp-card-title">入场动画与字体</div>
          <div class="pill-grid">${entrancePills}</div>
          <div class="pill-grid">${fontPills}</div>
          <div class="insp-row">
            <span class="insp-label">字号</span>
            <input id="sub-font-scale" class="insp-slider" type="range" min="0.6" max="1.8" step="0.05" value="${style.fontScale}" />
            <span class="insp-val">${Math.round(style.fontScale * 100)}%</span>
          </div>
          <div class="insp-row">
            <span class="insp-label">边距</span>
            <input id="sub-bottom-margin" class="insp-slider" type="range" min="0.04" max="0.24" step="0.01" value="${style.bottomMargin}" />
            <span class="insp-val">${Math.round(style.bottomMargin * 100)}%</span>
          </div>
          <div class="insp-row">
            <span class="insp-label">底色</span>
            <input id="sub-bg-opacity" class="insp-slider" type="range" min="0" max="0.95" step="0.05" value="${style.backgroundOpacity}" />
            <span class="insp-val">${Math.round(style.backgroundOpacity * 100)}%</span>
          </div>
          <div class="sub-checks-row">
            <label class="assets-check-label">
              <input id="sub-chk-secondary" type="checkbox" ${style.showsSecondary ? 'checked' : ''} />
              <span>显示副字幕</span>
            </label>
            <label class="assets-check-label">
              <input id="sub-chk-bold" type="checkbox" ${style.bold ? 'checked' : ''} />
              <span>加粗</span>
            </label>
          </div>
        </div>

        <div class="insp-card">
          <div class="insp-row">
            <span class="insp-card-title">智能静音停顿删剪</span>
            <span class="insp-val">${silentIntervals.length} 处</span>
          </div>
          <div class="insp-row">
            <span class="insp-label">静音阈值</span>
            <input id="pause-thresh-slider" class="insp-slider" type="range" min="0.02" max="0.15" step="0.005" value="${this.pauseThreshold}" />
            <span class="insp-val">${(this.pauseThreshold * 100).toFixed(1)}%</span>
          </div>
          <div class="insp-row">
            <span class="insp-label">最小时长</span>
            <input id="pause-min-slider" class="insp-slider" type="range" min="0.3" max="2.0" step="0.05" value="${this.minPauseSec}" />
            <span class="insp-val">${this.minPauseSec.toFixed(2)}s</span>
          </div>
          ${pauseChipsHtml}
          <button id="pause-cut-all-btn" class="chrome-btn subtle-well" ${
            silentIntervals.length === 0 ? 'disabled' : ''
          }>一键删除全部静音停顿 (${silentIntervals.length})</button>
        </div>

        <div class="insp-card">
          <div class="insp-card-title">字幕条列表 (${cues.length})</div>
          <div class="assets-list">${cuesHtml}</div>
        </div>
      </div>
    `;

    this.bindEvents(silentIntervals);
  }

  private bindEvents(silentIntervals: readonly SilentInterval[]): void {
    if (!this.container || !this.host) return;
    const host = this.host;

    const mutateStyle = (patch: Partial<ReturnType<typeof makeSubtitleStyle>>) => {
      const cur = host.getProject();
      if (!cur) return;
      const prev = cur.timeline.subtitleStyle ?? makeSubtitleStyle();
      host.mutateProject({
        ...cur,
        timeline: {
          ...cur.timeline,
          subtitleStyle: makeSubtitleStyle({ ...prev, ...patch }),
        },
      });
    };

    const mutateCues = (updater: (cues: readonly SubtitleCue[]) => SubtitleCue[]) => {
      const cur = host.getProject();
      if (!cur) return;
      const nextCues = updater(cur.timeline.subtitleCues ?? []).sort(
        (a, b) => a.timing.startTime - b.timing.startTime
      );
      host.mutateProject(
        {
          ...cur,
          timeline: { ...cur.timeline, subtitleCues: nextCues },
        },
        { immediate: true }
      );
    };

    this.container.querySelector('#sub-btn-add')?.addEventListener('click', () => {
      const curTime = host.getCurrentTime();
      const outDur = Math.max(0.5, host.getOutputDuration());
      const start = clamp(curTime, 0, Math.max(0, outDur - 0.3));
      const dur = clamp(2.2, 0.3, Math.max(0.3, outDur - start));
      const cue = makeSubtitleCue({
        timing: makeOverlayTiming(start, dur),
        text: '重点内容说明',
        secondaryText: 'Key Highlight',
      });
      mutateCues((cues) => [...cues, cue]);
      this.noticeText = `已在 ${formatClock(start)} 添加双语字幕。`;
      this.render();
    });

    const srtInput = this.container.querySelector('#sub-srt-input') as HTMLInputElement | null;
    srtInput?.addEventListener('change', () => {
      const file = srtInput.files?.[0];
      if (!file) return;
      void file.text().then((raw) => {
        const parsed = SubtitleSRT.decode(raw);
        if (parsed.length === 0) {
          this.noticeText = '未能从 SRT 文件中解析出有效字幕条目。';
          this.render();
          return;
        }
        mutateCues(() => parsed);
        this.noticeText = `已导入 ${parsed.length} 条 SRT 字幕。`;
        this.render();
      });
    });

    this.container.querySelector('#sub-btn-export-srt')?.addEventListener('click', () => {
      const cur = host.getProject();
      if (!cur) return;
      const srt = SubtitleSRT.encode(cur.timeline.subtitleCues ?? []);
      const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${host.getSessionId() ?? 'subtitles'}.srt`;
      a.click();
      URL.revokeObjectURL(a.href);
    });

    this.container.querySelector('#sub-btn-normalize')?.addEventListener('click', () => {
      mutateCues((cues) => SubtitleText.normalized(cues));
      this.noticeText = '已按标点与语气词规则清洗规范字幕文本。';
      this.render();
    });

    this.container.querySelectorAll('[data-sub-entrance]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = btn.getAttribute('data-sub-entrance') as SubtitleEntrance | null;
        if (val) mutateStyle({ entrance: val });
      });
    });

    this.container.querySelectorAll('[data-sub-font]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = btn.getAttribute('data-sub-font') as SubtitleFont | null;
        if (val) mutateStyle({ font: val });
      });
    });

    const bindSlider = (id: string, cb: (v: number) => void) => {
      const el = this.container?.querySelector(`#${id}`) as HTMLInputElement | null;
      el?.addEventListener('change', () => cb(Number(el.value)));
    };
    bindSlider('sub-font-scale', (v) => mutateStyle({ fontScale: v }));
    bindSlider('sub-bottom-margin', (v) => mutateStyle({ bottomMargin: v }));
    bindSlider('sub-bg-opacity', (v) => mutateStyle({ backgroundOpacity: v }));

    this.container.querySelector('#sub-chk-secondary')?.addEventListener('change', (ev) => {
      mutateStyle({ showsSecondary: (ev.target as HTMLInputElement).checked });
    });
    this.container.querySelector('#sub-chk-bold')?.addEventListener('change', (ev) => {
      mutateStyle({ bold: (ev.target as HTMLInputElement).checked });
    });

    this.container.querySelector('#pause-thresh-slider')?.addEventListener('change', (ev) => {
      this.pauseThreshold = Number((ev.target as HTMLInputElement).value) || 0.045;
      this.render();
    });
    this.container.querySelector('#pause-min-slider')?.addEventListener('change', (ev) => {
      this.minPauseSec = Number((ev.target as HTMLInputElement).value) || 0.45;
      this.render();
    });

    this.container.querySelector('#pause-cut-all-btn')?.addEventListener('click', () => {
      const cur = host.getProject();
      if (!cur || silentIntervals.length === 0) return;
      try {
        const nextProj = removeSilentIntervalsFromProject(
          cur,
          host.getRawDuration(),
          silentIntervals
        );
        host.mutateProject(nextProj, { immediate: true });
        this.noticeText = `已智能删除 ${silentIntervals.length} 处静音停顿段落。`;
      } catch (err: any) {
        this.noticeText = `停顿删减失败: ${err?.message ?? err}`;
      }
      this.render();
    });

    this.container.querySelectorAll('[data-seek-sec]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const t = Number(btn.getAttribute('data-seek-sec'));
        if (Number.isFinite(t)) host.seekTo(t);
      });
    });

    this.container.querySelectorAll('[data-del-cue]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-del-cue');
        if (id) mutateCues((cues) => cues.filter((c) => c.id !== id));
      });
    });

    this.container.querySelectorAll('[data-edit-primary]').forEach((inp) => {
      inp.addEventListener('change', () => {
        const id = inp.getAttribute('data-edit-primary');
        const val = (inp as HTMLInputElement).value;
        if (!id) return;
        mutateCues((cues) => cues.map((c) => (c.id === id ? { ...c, text: val } : c)));
      });
    });

    this.container.querySelectorAll('[data-edit-secondary]').forEach((inp) => {
      inp.addEventListener('change', () => {
        const id = inp.getAttribute('data-edit-secondary');
        const val = (inp as HTMLInputElement).value.trim();
        if (!id) return;
        mutateCues((cues) =>
          cues.map((c) => (c.id === id ? { ...c, secondaryText: val || null } : c))
        );
      });
    });
  }
}
