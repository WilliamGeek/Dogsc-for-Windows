/**
 * web/studio/motionPanel.ts
 *
 * Left Library `动效` (`motion`) tab:
 * - 5 built-in macOS-aligned HTML/SVG motion templates rendered as visual preview cards (`previews.ts`)
 * - Click-to-insert at current playhead with live WebGL2 preview
 * - Property inspector (title, subtitle, HSV popover accent color, scrubbable sliders)
 * - `.dmhtml` export download + delete clip
 * Strictly ZERO node:* imports and stripTypeScriptTypes compatible.
 */

import type { LibraryPanelHost } from './aiPanel.ts';
import {
  buildDmhtmlDocument,
  HTML_MOTION_TEMPLATES,
  type HtmlMotionTemplateId,
} from '../passes/htmlMotion.ts';
import {
  makeAnimationClip,
  makeOverlayTiming,
  type AnimationClip,
} from '../../src/core/OverlayTimeline.ts';
import { projectTimelineNextVisualLayer } from '../../src/core/ProjectTimeline.ts';
import { makeNormalizedPoint } from '../../src/core/ZoomAnimation.ts';
import { clamp } from '../../src/core/swift.ts';
import { svgIcon } from './icons.ts';
import { renderMotionTemplateCard } from './previews.ts';
import { mountStudioColorPicker, renderColorChipButton } from './colorPicker.ts';
import { bindProRange, renderSliderRow } from './controls.ts';

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

function propText(clip: AnimationClip, key: string, fallback: string): string {
  const v = clip.properties[key];
  if (v && v.kind === 'string') return v.value;
  return fallback;
}

function templateIdOf(clip: AnimationClip): HtmlMotionTemplateId {
  const raw =
    propText(clip, 'template', '') ||
    (clip.sourcePath.startsWith('builtin://') ? clip.sourcePath.slice('builtin://'.length) : '');
  if (
    raw === 'lower-third' ||
    raw === 'keycap' ||
    raw === 'callout' ||
    raw === 'chapter' ||
    raw === 'pill'
  ) {
    return raw;
  }
  return 'callout';
}

export class MotionLibraryPanel {
  private container: HTMLElement | null = null;
  private host: LibraryPanelHost | null = null;
  private selectedClipId: string | null = null;
  private noticeText: string | null = null;

  mountOrSync(container: HTMLElement, host: LibraryPanelHost): void {
    this.container = container;
    this.host = host;

    const project = host.getProject();
    if (project) {
      const clips = project.timeline.animationClips ?? [];
      if (!this.selectedClipId || !clips.some((c) => c.id === this.selectedClipId)) {
        this.selectedClipId = clips[0]?.id ?? null;
      }
    }

    const activeEl = document.activeElement as HTMLElement | null;
    if (
      activeEl &&
      container.contains(activeEl) &&
      activeEl.tagName === 'INPUT' &&
      (activeEl as HTMLInputElement).type === 'text'
    ) {
      return;
    }

    this.render();
  }

  private render(): void {
    if (!this.container || !this.host) return;
    const sessionId = this.host.getSessionId();
    const project = this.host.getProject();

    if (!sessionId || !project) {
      this.container.innerHTML = `<div class="lib-placeholder-card"><div class="lib-placeholder-title">HTML/SVG 动效贴纸</div><p class="lib-placeholder-desc">请先选择或新建一段录制工程。</p></div>`;
      return;
    }

    const clips = (project.timeline.animationClips ?? [])
      .slice()
      .sort((a, b) => a.timing.startTime - b.timing.startTime);
    const active = clips.find((c) => c.id === this.selectedClipId) ?? null;

    const templatesHtml = HTML_MOTION_TEMPLATES.map((t) => renderMotionTemplateCard(t)).join('');

    const clipsHtml =
      clips.length === 0
        ? `<div class="assets-empty">尚未添加动效卡片。点击上方模板即可插入到当前播放头。</div>`
        : clips
            .map((c) => {
              const title = propText(c, 'title', '动效卡片');
              const isSel = c.id === active?.id;
              return `
                <button class="motion-clip-pill ${isSel ? 'active' : ''}" data-select-motion="${escapeHtml(c.id)}">
                  <span>${escapeHtml(title)}</span>
                  <span class="motion-clip-time">${formatClock(c.timing.startTime)}</span>
                </button>`;
            })
            .join('');

    const editorHtml = active
      ? (() => {
          const tpl = templateIdOf(active);
          const tplInfo =
            HTML_MOTION_TEMPLATES.find((t) => t.id === tpl) ?? HTML_MOTION_TEMPLATES[2];
          const curTitle = propText(active, 'title', tplInfo.defaultTitle);
          const curSub = propText(active, 'subtitle', '');
          const curAccent = propText(active, 'accent', tplInfo.defaultAccent);
          return `
            <div class="insp-card">
              <div class="insp-row">
                <span class="insp-card-title">编辑动效 · ${escapeHtml(tplInfo.label)}</span>
                <button id="motion-btn-delete" class="insp-btn danger">${svgIcon('trash', 12)}<span>删除</span></button>
              </div>
              <div class="ai-field-col">
                <label class="ai-field-label" for="motion-input-title">主标题</label>
                <input id="motion-input-title" class="ai-input" type="text" value="${escapeHtml(curTitle)}" />
              </div>
              <div class="ai-field-col">
                <label class="ai-field-label" for="motion-input-sub">副标题</label>
                <input id="motion-input-sub" class="ai-input" type="text" value="${escapeHtml(curSub)}" placeholder="可选副标题描述" />
              </div>
              <div class="insp-row">
                <span class="insp-label">强调色</span>
                ${renderColorChipButton('motion-input-accent', curAccent)}
              </div>
              ${renderSliderRow({ id: 'motion-pos-x', label: '水平 X', min: 0.08, max: 0.92, step: 0.01, value: active.position.x, defaultValue: tplInfo.defaultX, display: `${Math.round(active.position.x * 100)}%`, labelWidth: 58 })}
              ${renderSliderRow({ id: 'motion-pos-y', label: '垂直 Y', min: 0.08, max: 0.92, step: 0.01, value: active.position.y, defaultValue: tplInfo.defaultY, display: `${Math.round(active.position.y * 100)}%`, labelWidth: 58 })}
              ${renderSliderRow({ id: 'motion-width', label: '卡片宽度', min: 0.16, max: 0.85, step: 0.02, value: active.width, defaultValue: tplInfo.defaultWidth, display: `${Math.round(active.width * 100)}%`, labelWidth: 58 })}
              ${renderSliderRow({ id: 'motion-opacity', label: '不透明度', min: 0.1, max: 1, step: 0.05, value: active.opacity, defaultValue: 1, display: `${Math.round(active.opacity * 100)}%`, labelWidth: 58 })}
              ${renderSliderRow({ id: 'motion-duration', label: '持续时长', min: 0.5, max: 15, step: 0.1, value: active.timing.duration, defaultValue: 3.0, display: `${active.timing.duration.toFixed(1)}s`, labelWidth: 58 })}
              <button id="motion-export-dmhtml" class="chrome-btn subtle-well">${svgIcon('download', 12)}<span>导出 .dmhtml 模板源码</span></button>
            </div>`;
        })()
      : '';

    this.container.innerHTML = `
      <div class="motion-panel-root">
        ${this.noticeText ? `<div class="ai-notice-banner">${escapeHtml(this.noticeText)}</div>` : ''}
        <div class="insp-card">
          <div class="insp-card-title">内置动效模板库 (点击插入)</div>
          <div class="motion-tpl-grid">${templatesHtml}</div>
        </div>
        <div class="insp-card">
          <div class="insp-card-title">工程动效片段 (${clips.length})</div>
          <div class="motion-clips-list">${clipsHtml}</div>
        </div>
        ${editorHtml}
      </div>
    `;

    this.bindEvents(active);
  }

  private bindEvents(active: AnimationClip | null): void {
    if (!this.container || !this.host) return;
    const host = this.host;

    this.container.querySelectorAll('[data-insert-tpl]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cur = host.getProject();
        if (!cur) return;
        const tplId = btn.getAttribute('data-insert-tpl') as HtmlMotionTemplateId | null;
        const info = HTML_MOTION_TEMPLATES.find((t) => t.id === tplId);
        if (!info) return;

        const outDur = Math.max(0.6, host.getOutputDuration());
        const start = clamp(host.getCurrentTime(), 0, Math.max(0, outDur - 0.5));
        const dur = clamp(3.0, 0.5, Math.max(0.5, outDur - start));

        const clip = makeAnimationClip({
          timing: makeOverlayTiming(start, dur),
          sourcePath: `builtin://${info.id}`,
          position: makeNormalizedPoint(info.defaultX, info.defaultY),
          width: info.defaultWidth,
          properties: {
            template: { kind: 'string', value: info.id },
            title: { kind: 'string', value: info.defaultTitle },
            subtitle: { kind: 'string', value: info.defaultSubtitle },
            accent: { kind: 'string', value: info.defaultAccent },
          },
          layerIndex: projectTimelineNextVisualLayer(cur.timeline),
        });

        this.selectedClipId = clip.id;
        host.mutateProject(
          {
            ...cur,
            timeline: {
              ...cur.timeline,
              animationClips: [...cur.timeline.animationClips, clip],
            },
          },
          { immediate: true }
        );
        host.seekTo(Math.min(outDur, start + Math.min(0.4, dur * 0.5)));
        this.noticeText = `已添加「${info.label}」动效贴纸。`;
        this.render();
      });
    });

    this.container.querySelectorAll('[data-select-motion]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-select-motion');
        const cur = host.getProject();
        if (!id || !cur) return;
        this.selectedClipId = id;
        const found = cur.timeline.animationClips.find((c) => c.id === id);
        if (found) {
          host.seekTo(found.timing.startTime + Math.min(0.4, found.timing.duration * 0.5));
        }
        this.render();
      });
    });

    if (!active) return;
    const tpl = templateIdOf(active);
    const tplInfo = HTML_MOTION_TEMPLATES.find((t) => t.id === tpl) ?? HTML_MOTION_TEMPLATES[2];
    const curAccent = propText(active, 'accent', tplInfo.defaultAccent);

    const patchClip = (
      updater: (clip: AnimationClip, outDur: number) => AnimationClip,
      skipRerender = true
    ) => {
      const cur = host.getProject();
      if (!cur) return;
      const outDur = Math.max(0.6, host.getOutputDuration());
      host.mutateProject(
        {
          ...cur,
          timeline: {
            ...cur.timeline,
            animationClips: cur.timeline.animationClips.map((c) =>
              c.id === active.id ? updater(c, outDur) : c
            ),
          },
        },
        { skipPanelRerender: skipRerender }
      );
    };

    this.container.querySelector('#motion-btn-delete')?.addEventListener('click', () => {
      const cur = host.getProject();
      if (!cur) return;
      const remaining = cur.timeline.animationClips.filter((c) => c.id !== active.id);
      this.selectedClipId = remaining[0]?.id ?? null;
      host.mutateProject(
        { ...cur, timeline: { ...cur.timeline, animationClips: remaining } },
        { immediate: true }
      );
      this.noticeText = '已移除该动效片段。';
      this.render();
    });

    this.container.querySelector('#motion-input-title')?.addEventListener('change', (ev) => {
      const val = (ev.target as HTMLInputElement).value;
      patchClip((c) => ({
        ...c,
        properties: { ...c.properties, title: { kind: 'string', value: val } },
      }));
    });

    this.container.querySelector('#motion-input-sub')?.addEventListener('change', (ev) => {
      const val = (ev.target as HTMLInputElement).value;
      patchClip((c) => ({
        ...c,
        properties: { ...c.properties, subtitle: { kind: 'string', value: val } },
      }));
    });

    mountStudioColorPicker('motion-input-accent', curAccent, (hex) => {
      patchClip((c) => ({
        ...c,
        properties: { ...c.properties, accent: { kind: 'string', value: hex } },
      }));
    });

    bindProRange(
      'motion-pos-x',
      (v) => patchClip((c) => ({ ...c, position: makeNormalizedPoint(clamp(v, 0.08, 0.92), c.position.y) })),
      (v) => `${Math.round(v * 100)}%`,
      tplInfo.defaultX
    );
    bindProRange(
      'motion-pos-y',
      (v) => patchClip((c) => ({ ...c, position: makeNormalizedPoint(c.position.x, clamp(v, 0.08, 0.92)) })),
      (v) => `${Math.round(v * 100)}%`,
      tplInfo.defaultY
    );
    bindProRange(
      'motion-width',
      (v) => patchClip((c) => ({ ...c, width: clamp(v, 0.16, 0.85) })),
      (v) => `${Math.round(v * 100)}%`,
      tplInfo.defaultWidth
    );
    bindProRange(
      'motion-opacity',
      (v) => patchClip((c) => ({ ...c, opacity: clamp(v, 0.1, 1) })),
      (v) => `${Math.round(v * 100)}%`,
      1
    );
    bindProRange(
      'motion-duration',
      (v) =>
        patchClip((c, outDur) => ({
          ...c,
          timing: makeOverlayTiming(
            c.timing.startTime,
            clamp(v, 0.5, Math.max(0.5, outDur - c.timing.startTime))
          ),
        })),
      (v) => `${v.toFixed(1)}s`,
      3.0
    );

    this.container.querySelector('#motion-export-dmhtml')?.addEventListener('click', () => {
      const doc = buildDmhtmlDocument(tpl, {
        title: propText(active, 'title', '动效卡片'),
        subtitle: propText(active, 'subtitle', ''),
        accent: propText(active, 'accent', '#da7a52'),
      });
      const blob = new Blob([doc], { type: 'text/html;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `motion-${tpl}.dmhtml`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }
}
