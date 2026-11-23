/**
 * web/studio/inspector.ts
 *
 * Real-time 6-tab inspector aligned with macOS EditorInspectorView:
 *   1. frame (画面)  2. zoom (运镜)  3. opening (开场)
 *   4. cursor (光标) 5. camera (摄像头) 6. audio (声音)
 * Upgraded with Frontend P0-P3 craft:
 *   - Unified SVG iconography (`icons.ts`)
 *   - Visual swatches & vector wireframe cards (`previews.ts`)
 *   - Custom HSV/HEX popover color picker (`colorPicker.ts`)
 *   - Scrubbable sliders + double-click default reset (`controls.ts`)
 *   - Zero full-DOM teardown during continuous slider/color dragging
 * Strictly ZERO node:* imports.
 */

import {
  BackgroundPatternPresetAllCases,
  backgroundPatternPresetDisplayName,
  DynamicBackgroundPresetAllCases,
  dynamicBackgroundPresetDisplayName,
  CameraShapeAllCases,
  ScreenMotionStyleAllCases,
  CursorMotionStyleAllCases,
  CursorAppearanceAllCases,
  cursorStyleAppearance,
  cursorStyleAssetIDForAppearance,
  CursorClickEffectStyleAllCases,
  cursorClickEffectStyleDisplayName,
  OpeningSequencePresetAllCases,
  makeCanvasStyle,
  makeCameraStyle,
  makeCursorStyle,
  makeAudioStyle,
  makeMotionStyle,
  makeOpeningSequence,
  type CanvasAspectRatio,
  type ScreenFrameStyle,
  type BackgroundSource,
  type CameraShape,
  type CursorAppearance,
  type CursorClickEffectStyle,
  type ScreenMotionStyle,
  type CursorMotionStyle,
  type OpeningSequencePreset,
} from '../../src/core/ProjectModel.ts';
import {
  ZoomEasingPresetAllCases,
  zoomEasingPresetShortName,
  type ZoomEasingPreset,
} from '../../src/core/ZoomAnimation.ts';
import { hexColorString, parseHexColor } from '../../src/core/HexColor.ts';
import { makeCameraBeautySettings } from '../../src/core/CameraBeauty.ts';
import type { StudioRuntimeContext } from './app.ts';
import {
  recomputeAutoZoomClips,
  updateZoomClipById,
  deleteZoomClipById,
  updateMosaicClipById,
  deleteMosaicClipById,
} from './state.ts';
import { svgIcon } from './icons.ts';
import { bindProRange, renderSliderRow, renderSwitchRow } from './controls.ts';
import {
  closeActiveColorPicker,
  mountStudioColorPicker,
  renderColorChipButton,
} from './colorPicker.ts';
import {
  renderBackgroundSwatchCard,
  renderCameraShapeCard,
  renderChromePreviewCard,
  renderCursorAppearanceCard,
  renderOpeningPresetCard,
} from './previews.ts';

const ASPECT_OPTIONS: readonly CanvasAspectRatio[] = ['适应', '16:9', '9:16', '1:1', '4:3'];
const CHROME_OPTIONS: ReadonlyArray<{ id: ScreenFrameStyle; label: string }> = [
  { id: 'none', label: '无外框' },
  { id: 'windowLight', label: '浅色窗口' },
  { id: 'windowDark', label: '深色窗口' },
  { id: 'browserLight', label: '浅色浏览' },
  { id: 'browserDark', label: '深色浏览' },
  { id: 'devicePhone', label: '手机壳' },
  { id: 'deviceTablet', label: '平板壳' },
];

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function backgroundOptionId(bg: BackgroundSource): string {
  if (bg.kind === 'pattern') return `pattern:${bg.preset}`;
  if (bg.kind === 'dynamicFlow') return `dynamicFlow:${bg.preset}`;
  return '';
}

export function renderStudioInspector(ctx: StudioRuntimeContext): void {
  const container = document.getElementById('studio-inspector-body');
  if (!container) return;
  closeActiveColorPicker();

  const detail = ctx.getDetail();
  const project = ctx.getProject();
  if (!detail || !project) {
    container.innerHTML =
      '<div class="insp-card"><div class="insp-card-title">属性检查器</div><p style="color:var(--ink-secondary);margin:0;">请选择或录制一段视频。</p></div>';
    return;
  }

  const tab = ctx.getInspectorTab();
  switch (tab) {
    case 'frame':
      renderFrameTab(container, ctx);
      break;
    case 'zoom':
      renderZoomTab(container, ctx);
      break;
    case 'opening':
      renderOpeningTab(container, ctx);
      break;
    case 'cursor':
      renderCursorTab(container, ctx);
      break;
    case 'camera':
      renderCameraTab(container, ctx);
      break;
    case 'audio':
      renderAudioTab(container, ctx);
      break;
  }
}

function renderFrameTab(el: HTMLElement, ctx: StudioRuntimeContext): void {
  const project = ctx.getProject()!;
  const c = project.canvas;
  const activeBgId = backgroundOptionId(c.backgroundSource);
  const sel = ctx.getSelection();
  const selectedMosaic =
    sel?.kind === 'mosaic'
      ? project.timeline.mosaicClips.find((m) => m.id === sel.id) ?? null
      : null;

  const ratioPills = ASPECT_OPTIONS.map(
    (r) =>
      `<button class="pill-choice ${c.aspectRatio === r ? 'active' : ''}" data-aspect="${r}">${r}</button>`
  ).join('');

  const bgSwatches = [
    ...BackgroundPatternPresetAllCases.map((p) =>
      renderBackgroundSwatchCard(
        'pattern',
        p,
        backgroundPatternPresetDisplayName(p),
        activeBgId === `pattern:${p}`
      )
    ),
    ...DynamicBackgroundPresetAllCases.map((d) =>
      renderBackgroundSwatchCard(
        'dynamicFlow',
        d,
        dynamicBackgroundPresetDisplayName(d),
        activeBgId === `dynamicFlow:${d}`
      )
    ),
  ].join('');

  const chromeCards = CHROME_OPTIONS.map((opt) =>
    renderChromePreviewCard(opt.id, opt.label, c.screenFrame === opt.id)
  ).join('');

  const mosaicCard = selectedMosaic
    ? `
      <div class="insp-card" style="border-color:var(--t-region);">
        <div class="insp-row">
          <span class="insp-card-title" style="color:var(--t-region);">选中区域效果</span>
          <button id="insp-del-mosaic" class="insp-btn danger">${svgIcon('trash', 12)}<span>删除</span></button>
        </div>
        <div class="pill-grid">
          <button class="pill-choice ${selectedMosaic.style === 'blur' ? 'active' : ''}" data-mos-style="blur">${svgIcon('mosaic', 12)}<span>马赛克模糊</span></button>
          <button class="pill-choice ${selectedMosaic.style === 'spotlight' ? 'active' : ''}" data-mos-style="spotlight">${svgIcon('spotlight', 12)}<span>聚光灯聚焦</span></button>
        </div>
        ${renderSliderRow({ id: 'mos-intensity', label: '效果强度', min: 0.1, max: 1, step: 0.05, value: selectedMosaic.intensity, defaultValue: 0.85, display: `${Math.round(selectedMosaic.intensity * 100)}%` })}
        ${
          selectedMosaic.style === 'spotlight'
            ? renderSliderRow({ id: 'mos-dimming', label: '外部压暗', min: 0.05, max: 0.85, step: 0.05, value: selectedMosaic.spotlightDimming, defaultValue: 0.55, display: `${Math.round(selectedMosaic.spotlightDimming * 100)}%` })
            : ''
        }
      </div>`
    : '';

  el.innerHTML = `
    <div class="inspector-head"><h2 class="inspector-title">画面</h2><span class="inspector-scope">画布与外框</span></div>
    ${mosaicCard}
    <div class="insp-card">
      <div class="insp-card-title">画布比例与布局</div>
      <div class="pill-grid">${ratioPills}</div>
      ${renderSliderRow({ id: 'frame-padding', label: '四周留白', min: 0, max: 240, step: 2, value: c.padding, defaultValue: 64, display: `${Math.round(c.padding)}px` })}
      ${renderSliderRow({ id: 'frame-scale', label: '画面缩放', min: 0.5, max: 1.5, step: 0.02, value: c.contentScale, defaultValue: 1, display: `${Math.round(c.contentScale * 100)}%` })}
      ${renderSliderRow({ id: 'frame-radius', label: '画面圆角', min: 0, max: 64, step: 1, value: c.cornerRadius, defaultValue: 16, display: `${Math.round(c.cornerRadius)}px` })}
      ${renderSliderRow({ id: 'frame-shadow', label: '立体阴影', min: 0, max: 1, step: 0.02, value: c.shadowStrength, defaultValue: 0.45, display: `${Math.round(c.shadowStrength * 100)}%` })}
      ${renderSliderRow({ id: 'frame-border-w', label: '描边宽度', min: 0, max: 16, step: 0.5, value: c.borderWidth, defaultValue: 0, display: `${c.borderWidth.toFixed(1)}px` })}
      <div class="insp-row">
        <span class="insp-label">描边颜色</span>
        ${renderColorChipButton('frame-border-col', hexColorString(c.borderColor))}
      </div>
      <div class="insp-row">
        <span class="insp-label">画面裁剪 (${Math.round(c.crop.width * 100)}%×${Math.round(c.crop.height * 100)}%)</span>
        <button id="frame-btn-toggle-crop" class="chrome-btn subtle-well">${svgIcon('crop', 12)}<span>交互式裁剪</span></button>
      </div>
    </div>

    <div class="insp-card">
      <div class="insp-card-title">背景壁纸与流动纹理</div>
      <div class="swatch-grid">${bgSwatches}</div>
      ${renderSliderRow({ id: 'frame-bg-blur', label: '背景虚化', min: 0, max: 48, step: 1, value: c.backgroundBlur, defaultValue: 0, display: `${Math.round(c.backgroundBlur)}px` })}
      ${renderSliderRow({ id: 'frame-pat-op', label: '纹理强度', min: 0, max: 1, step: 0.05, value: c.patternOpacity, defaultValue: 1, display: `${Math.round(c.patternOpacity * 100)}%` })}
    </div>

    <div class="insp-card">
      <div class="insp-card-title">设备与窗口外框 (Chrome)</div>
      <div class="visual-opt-grid visual-grid-chrome">${chromeCards}</div>
      <input id="frame-chrome-title" class="insp-input" type="text" placeholder="窗口标题 (window 模式生效)" value="${escapeHtml(c.screenFrameTitle)}" />
      <input id="frame-chrome-url" class="insp-input" type="text" placeholder="浏览器地址栏 (browser 模式生效)" value="${escapeHtml(c.screenFrameBrowserAddress)}" />
    </div>
  `;

  const applyCanvas = (patch: Partial<typeof c>, recordHistory = true, keepDom = false) => {
    const cur = ctx.getProject()!;
    ctx.applyProjectMutation(
      { ...cur, canvas: makeCanvasStyle({ ...cur.canvas, ...patch }) },
      {
        recordHistory,
        skipInspectorRerender: keepDom,
        skipTimelineRerender: keepDom,
      }
    );
  };

  el.querySelectorAll('[data-aspect]').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyCanvas({ aspectRatio: btn.getAttribute('data-aspect') as CanvasAspectRatio });
    });
  });

  bindProRange('frame-padding', (v, rec) => applyCanvas({ padding: v }, rec, true), (v) => `${Math.round(v)}px`, 64);
  bindProRange('frame-scale', (v, rec) => applyCanvas({ contentScale: v }, rec, true), (v) => `${Math.round(v * 100)}%`, 1);
  bindProRange('frame-radius', (v, rec) => applyCanvas({ cornerRadius: v }, rec, true), (v) => `${Math.round(v)}px`, 16);
  bindProRange('frame-shadow', (v, rec) => applyCanvas({ shadowStrength: v }, rec, true), (v) => `${Math.round(v * 100)}%`, 0.45);
  bindProRange('frame-border-w', (v, rec) => applyCanvas({ borderWidth: v }, rec, true), (v) => `${v.toFixed(1)}px`, 0);

  mountStudioColorPicker('frame-border-col', hexColorString(c.borderColor), (hex, rec) => {
    const parsed = parseHexColor(hex);
    if (parsed) applyCanvas({ borderColor: parsed }, rec, true);
  });

  document.getElementById('frame-btn-toggle-crop')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('dogsc:toggle-crop'));
  });

  el.querySelectorAll('[data-bg-kind]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const kind = btn.getAttribute('data-bg-kind');
      const preset = btn.getAttribute('data-bg-preset');
      if (!preset) return;
      if (kind === 'pattern') {
        applyCanvas({ backgroundSource: { kind: 'pattern', preset: preset as any } });
      } else if (kind === 'dynamicFlow') {
        applyCanvas({ backgroundSource: { kind: 'dynamicFlow', preset: preset as any } });
      }
    });
  });

  bindProRange('frame-bg-blur', (v, rec) => applyCanvas({ backgroundBlur: v }, rec, true), (v) => `${Math.round(v)}px`, 0);
  bindProRange('frame-pat-op', (v, rec) => applyCanvas({ patternOpacity: v }, rec, true), (v) => `${Math.round(v * 100)}%`, 1);

  el.querySelectorAll('[data-chrome]').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyCanvas({ screenFrame: btn.getAttribute('data-chrome') as ScreenFrameStyle });
    });
  });

  document.getElementById('frame-chrome-title')?.addEventListener('change', (ev) => {
    applyCanvas({ screenFrameTitle: (ev.target as HTMLInputElement).value.slice(0, 120) }, true, true);
  });
  document.getElementById('frame-chrome-url')?.addEventListener('change', (ev) => {
    applyCanvas({ screenFrameBrowserAddress: (ev.target as HTMLInputElement).value.slice(0, 240) }, true, true);
  });

  if (selectedMosaic) {
    document.getElementById('insp-del-mosaic')?.addEventListener('click', () => {
      const res = deleteMosaicClipById(ctx.getProject()!, selectedMosaic.id);
      ctx.applyProjectMutation(res.project, { selection: null });
    });
    el.querySelectorAll('[data-mos-style]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const res = updateMosaicClipById(ctx.getProject()!, selectedMosaic.id, {
          style: btn.getAttribute('data-mos-style') as 'blur' | 'spotlight',
        });
        ctx.applyProjectMutation(res.project);
      });
    });
    bindProRange(
      'mos-intensity',
      (v, rec) => {
        const res = updateMosaicClipById(ctx.getProject()!, selectedMosaic.id, { intensity: v });
        ctx.applyProjectMutation(res.project, {
          recordHistory: rec,
          skipInspectorRerender: true,
          skipTimelineRerender: true,
        });
      },
      (v) => `${Math.round(v * 100)}%`,
      0.85
    );
    if (selectedMosaic.style === 'spotlight') {
      bindProRange(
        'mos-dimming',
        (v, rec) => {
          const res = updateMosaicClipById(ctx.getProject()!, selectedMosaic.id, { spotlightDimming: v });
          ctx.applyProjectMutation(res.project, {
            recordHistory: rec,
            skipInspectorRerender: true,
            skipTimelineRerender: true,
          });
        },
        (v) => `${Math.round(v * 100)}%`,
        0.55
      );
    }
  }
}

function renderZoomTab(el: HTMLElement, ctx: StudioRuntimeContext): void {
  const detail = ctx.getDetail()!;
  const project = ctx.getProject()!;
  const m = project.motion;
  const sel = ctx.getSelection();
  const clip =
    sel?.kind === 'zoom'
      ? project.timeline.zoomClips.find((z) => z.id === sel.id) ?? null
      : null;

  const screenMotionPills = ScreenMotionStyleAllCases.map(
    (s) =>
      `<button class="pill-choice ${m.screen === s ? 'active' : ''}" data-screen-motion="${s}">${s}</button>`
  ).join('');

  const easingPills = ZoomEasingPresetAllCases.filter((e) => e !== '自定义曲线')
    .map(
      (e) =>
        `<button class="pill-choice ${clip?.easing === e ? 'active' : ''}" data-zoom-easing="${e}">${zoomEasingPresetShortName(e)}</button>`
    )
    .join('');

  const clipCard = clip
    ? `
      <div class="insp-card" style="border-color:var(--t-zoom);">
        <div class="insp-row">
          <span class="insp-card-title" style="color:var(--t-zoom);">当前选中缩放 (${clip.startTime.toFixed(1)}s–${clip.endTime.toFixed(1)}s)</span>
          <button id="zoom-clip-del" class="insp-btn danger">${svgIcon('trash', 12)}<span>删除</span></button>
        </div>
        ${renderSliderRow({ id: 'zoom-clip-scale', label: '放大倍数', min: 1.1, max: 3.5, step: 0.05, value: clip.scale, defaultValue: 1.8, display: `${clip.scale.toFixed(2)}×` })}
        ${renderSliderRow({ id: 'zoom-clip-fx', label: '焦点横向 X', min: 0, max: 1, step: 0.01, value: clip.focus.x, defaultValue: 0.5, display: `${Math.round(clip.focus.x * 100)}%` })}
        ${renderSliderRow({ id: 'zoom-clip-fy', label: '焦点纵向 Y', min: 0, max: 1, step: 0.01, value: clip.focus.y, defaultValue: 0.5, display: `${Math.round(clip.focus.y * 100)}%` })}
        <div class="insp-card-title">缓动曲线</div>
        <div class="pill-grid">${easingPills}</div>
        <div style="font-size:11px;color:var(--ink-secondary);">提示：也可直接在左侧预览画布点击重设焦点</div>
      </div>`
    : '<div class="insp-card"><div class="insp-card-title">片段参数</div><div style="color:var(--ink-secondary);">在时间线点击任意绿色缩放条，可精调倍数、曲线与焦点。</div></div>';

  el.innerHTML = `
    <div class="inspector-head"><h2 class="inspector-title">运镜</h2><span class="inspector-scope">自动跟随与聚焦</span></div>
    ${clipCard}
    <div class="insp-card">
      <div class="insp-card-title">全局运镜风格</div>
      <div class="pill-grid">${screenMotionPills}</div>
      ${renderSliderRow({ id: 'motion-def-scale', label: '默认放大', min: 1.2, max: 3.0, step: 0.05, value: m.defaultZoomScale ?? 1.8, defaultValue: 1.8, display: `${(m.defaultZoomScale ?? 1.8).toFixed(2)}×` })}
      ${renderSliderRow({ id: 'motion-def-trans', label: '进出耗时', min: 0.2, max: 1.5, step: 0.05, value: m.defaultZoomTransitionDuration, defaultValue: 0.7, display: `${m.defaultZoomTransitionDuration.toFixed(2)}s` })}
      <button id="btn-recompute-zoom" class="insp-btn">${svgIcon('wand', 13)}<span>按鼠标点击重新生成自动缩放</span></button>
    </div>
  `;

  const applyMotion = (patch: Partial<typeof m>, rec = true, keepDom = false) => {
    const cur = ctx.getProject()!;
    ctx.applyProjectMutation(
      { ...cur, motion: makeMotionStyle({ ...cur.motion, ...patch }) },
      { recordHistory: rec, skipInspectorRerender: keepDom, skipTimelineRerender: keepDom }
    );
  };

  el.querySelectorAll('[data-screen-motion]').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyMotion({ screen: btn.getAttribute('data-screen-motion') as ScreenMotionStyle });
    });
  });

  bindProRange('motion-def-scale', (v, rec) => applyMotion({ defaultZoomScale: v }, rec, true), (v) => `${v.toFixed(2)}×`, 1.8);
  bindProRange('motion-def-trans', (v, rec) => applyMotion({ defaultZoomTransitionDuration: v }, rec, true), (v) => `${v.toFixed(2)}s`, 0.7);

  document.getElementById('btn-recompute-zoom')?.addEventListener('click', () => {
    const res = recomputeAutoZoomClips(ctx.getProject()!, detail.pointerEvents);
    ctx.applyProjectMutation(res.project, { selection: res.selection });
  });

  if (clip) {
    document.getElementById('zoom-clip-del')?.addEventListener('click', () => {
      const res = deleteZoomClipById(ctx.getProject()!, clip.id);
      ctx.applyProjectMutation(res.project, { selection: null });
    });
    bindProRange(
      'zoom-clip-scale',
      (v, rec) => {
        const res = updateZoomClipById(ctx.getProject()!, clip.id, { scale: v });
        ctx.applyProjectMutation(res.project, {
          recordHistory: rec,
          skipInspectorRerender: true,
          skipTimelineRerender: true,
        });
      },
      (v) => `${v.toFixed(2)}×`,
      1.8
    );
    bindProRange(
      'zoom-clip-fx',
      (v, rec) => {
        const cur = ctx.getProject()!.timeline.zoomClips.find((z) => z.id === clip.id);
        if (!cur) return;
        const res = updateZoomClipById(ctx.getProject()!, clip.id, { focus: { ...cur.focus, x: v } });
        ctx.applyProjectMutation(res.project, {
          recordHistory: rec,
          skipInspectorRerender: true,
          skipTimelineRerender: true,
        });
      },
      (v) => `${Math.round(v * 100)}%`,
      0.5
    );
    bindProRange(
      'zoom-clip-fy',
      (v, rec) => {
        const cur = ctx.getProject()!.timeline.zoomClips.find((z) => z.id === clip.id);
        if (!cur) return;
        const res = updateZoomClipById(ctx.getProject()!, clip.id, { focus: { ...cur.focus, y: v } });
        ctx.applyProjectMutation(res.project, {
          recordHistory: rec,
          skipInspectorRerender: true,
          skipTimelineRerender: true,
        });
      },
      (v) => `${Math.round(v * 100)}%`,
      0.5
    );
    el.querySelectorAll('[data-zoom-easing]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const res = updateZoomClipById(ctx.getProject()!, clip.id, {
          easing: btn.getAttribute('data-zoom-easing') as ZoomEasingPreset,
        });
        ctx.applyProjectMutation(res.project);
      });
    });
  }
}

function renderOpeningTab(el: HTMLElement, ctx: StudioRuntimeContext): void {
  const op = ctx.getProject()!.openingSequence;
  const presetCards = OpeningSequencePresetAllCases.map((p) =>
    renderOpeningPresetCard(p, op.preset === p)
  ).join('');

  el.innerHTML = `
    <div class="inspector-head"><h2 class="inspector-title">开场</h2><span class="inspector-scope">3D 透视序列</span></div>
    <div class="insp-card">
      ${renderSwitchRow({ id: 'op-enabled', label: '启用开场透视动画', checked: op.isEnabled })}
      <div class="insp-card-title">动效预设</div>
      <div class="visual-opt-grid visual-grid-3">${presetCards}</div>
      ${renderSliderRow({ id: 'op-duration', label: '开场时长', min: 0.4, max: 5.0, step: 0.1, value: op.duration, defaultValue: 1.8, display: `${op.duration.toFixed(1)}s` })}
      ${renderSliderRow({ id: 'op-stagger', label: '图层错峰', min: 0, max: 0.8, step: 0.02, value: op.stagger, defaultValue: 0.12, display: `${op.stagger.toFixed(2)}s` })}
    </div>
  `;

  const applyOpening = (patch: Partial<typeof op>, rec = true, keepDom = false) => {
    const cur = ctx.getProject()!;
    ctx.applyProjectMutation(
      { ...cur, openingSequence: makeOpeningSequence({ ...cur.openingSequence, ...patch }) },
      { recordHistory: rec, skipInspectorRerender: keepDom, skipTimelineRerender: keepDom }
    );
  };

  document.getElementById('op-enabled')?.addEventListener('change', (ev) => {
    applyOpening({ isEnabled: (ev.target as HTMLInputElement).checked });
  });
  el.querySelectorAll('[data-op-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyOpening({ preset: btn.getAttribute('data-op-preset') as OpeningSequencePreset });
    });
  });
  bindProRange('op-duration', (v, rec) => applyOpening({ duration: v }, rec, true), (v) => `${v.toFixed(1)}s`, 1.8);
  bindProRange('op-stagger', (v, rec) => applyOpening({ stagger: v }, rec, true), (v) => `${v.toFixed(2)}s`, 0.12);
}

function renderCursorTab(el: HTMLElement, ctx: StudioRuntimeContext): void {
  const project = ctx.getProject()!;
  const curStyle = project.cursorStyle;
  const activeAppearance = cursorStyleAppearance(curStyle);

  const shapeCards = CursorAppearanceAllCases.map((ap) =>
    renderCursorAppearanceCard(ap, activeAppearance === ap)
  ).join('');

  const clickPills = CursorClickEffectStyleAllCases.map(
    (st) =>
      `<button class="pill-choice ${curStyle.clickEffectStyle === st ? 'active' : ''}" data-click-style="${st}">${cursorClickEffectStyleDisplayName(st)}</button>`
  ).join('');

  const smoothPills = CursorMotionStyleAllCases.map(
    (ms) =>
      `<button class="pill-choice ${project.motion.cursor === ms ? 'active' : ''}" data-cur-motion="${ms}">${ms}</button>`
  ).join('');

  el.innerHTML = `
    <div class="inspector-head"><h2 class="inspector-title">光标</h2><span class="inspector-scope">矢量渲染与动效</span></div>
    <div class="insp-card">
      <div class="insp-card-title">光标形态</div>
      <div class="visual-opt-grid visual-grid-4">${shapeCards}</div>
      ${renderSliderRow({ id: 'cur-size', label: '光标倍率', min: 0.5, max: 3.0, step: 0.05, value: curStyle.size, defaultValue: 1, display: `${curStyle.size.toFixed(2)}×` })}
      ${renderSliderRow({ id: 'cur-tilt', label: '速度倾斜', min: 2, max: 4, step: 0.1, value: curStyle.motionTiltStrength, defaultValue: 3, display: `${curStyle.motionTiltStrength.toFixed(1)}` })}
      ${renderSwitchRow({ id: 'cur-idle-hide', label: '静止自动隐藏', checked: curStyle.hideWhenIdle })}
      ${renderSwitchRow({ id: 'cur-press-scale', label: '点击按压缩放', checked: curStyle.pressesOnClick })}
    </div>

    <div class="insp-card">
      <div class="insp-card-title">平滑物理阻尼</div>
      <div class="pill-grid">${smoothPills}</div>
    </div>

    <div class="insp-card">
      <div class="insp-card-title">点击波纹与反馈动效</div>
      <div class="pill-grid">${clickPills}</div>
      ${renderSliderRow({ id: 'cur-click-op', label: '波纹不透明', min: 0.1, max: 1.0, step: 0.05, value: curStyle.clickOpacity, defaultValue: 0.85, display: `${Math.round(curStyle.clickOpacity * 100)}%` })}
      ${renderSliderRow({ id: 'cur-click-sc', label: '波纹尺度', min: 0.5, max: 2.5, step: 0.05, value: curStyle.clickScale, defaultValue: 1, display: `${curStyle.clickScale.toFixed(2)}×` })}
    </div>
  `;

  const applyCursor = (patch: Partial<typeof curStyle>, rec = true, keepDom = false) => {
    const cur = ctx.getProject()!;
    ctx.applyProjectMutation(
      { ...cur, cursorStyle: makeCursorStyle({ ...cur.cursorStyle, ...patch }) },
      { recordHistory: rec, skipInspectorRerender: keepDom, skipTimelineRerender: keepDom }
    );
  };

  el.querySelectorAll('[data-cur-shape]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ap = btn.getAttribute('data-cur-shape') as CursorAppearance;
      applyCursor({ assetID: cursorStyleAssetIDForAppearance(ap) });
    });
  });

  bindProRange('cur-size', (v, rec) => applyCursor({ size: v }, rec, true), (v) => `${v.toFixed(2)}×`, 1);
  bindProRange('cur-tilt', (v, rec) => applyCursor({ motionTiltStrength: v }, rec, true), (v) => `${v.toFixed(1)}`, 3);

  document.getElementById('cur-idle-hide')?.addEventListener('change', (ev) => {
    applyCursor({ hideWhenIdle: (ev.target as HTMLInputElement).checked });
  });
  document.getElementById('cur-press-scale')?.addEventListener('change', (ev) => {
    applyCursor({ pressesOnClick: (ev.target as HTMLInputElement).checked });
  });

  el.querySelectorAll('[data-cur-motion]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cur = ctx.getProject()!;
      ctx.applyProjectMutation({
        ...cur,
        motion: makeMotionStyle({
          ...cur.motion,
          cursor: btn.getAttribute('data-cur-motion') as CursorMotionStyle,
        }),
      });
    });
  });

  el.querySelectorAll('[data-click-style]').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyCursor({ clickEffectStyle: btn.getAttribute('data-click-style') as CursorClickEffectStyle });
    });
  });
  bindProRange('cur-click-op', (v, rec) => applyCursor({ clickOpacity: v }, rec, true), (v) => `${Math.round(v * 100)}%`, 0.85);
  bindProRange('cur-click-sc', (v, rec) => applyCursor({ clickScale: v }, rec, true), (v) => `${v.toFixed(2)}×`, 1);
}

function renderCameraTab(el: HTMLElement, ctx: StudioRuntimeContext): void {
  const detail = ctx.getDetail()!;
  const cam = ctx.getProject()!.camera;
  const shapeCards = CameraShapeAllCases.map((s) =>
    renderCameraShapeCard(s, cam.shape === s)
  ).join('');

  el.innerHTML = `
    <div class="inspector-head">
      <h2 class="inspector-title">摄像头</h2>
      <span class="insp-badge ${detail.hasCamera ? 'ok' : ''}">${detail.hasCamera ? '已录制摄像头' : '无摄像头文件'}</span>
    </div>
    <div class="insp-card">
      ${renderSwitchRow({ id: 'cam-hidden', label: '隐藏摄像头画中画', checked: cam.isHidden })}
      ${renderSwitchRow({ id: 'cam-mirrored', label: '水平镜像翻转', checked: cam.isMirrored })}
      <div class="insp-card-title">裁切形态</div>
      <div class="visual-opt-grid visual-grid-5">${shapeCards}</div>
      ${renderSliderRow({ id: 'cam-size', label: '窗口尺寸', min: 0.12, max: 0.55, step: 0.01, value: cam.size, defaultValue: 0.22, display: `${Math.round(cam.size * 100)}%` })}
      ${renderSliderRow({ id: 'cam-round', label: '圆角平滑', min: 0, max: 1, step: 0.02, value: cam.roundness, defaultValue: 1, display: `${Math.round(cam.roundness * 100)}%` })}
      ${renderSliderRow({ id: 'cam-px', label: '横向锚点 X', min: 0, max: 1, step: 0.01, value: cam.position.x, defaultValue: 0.86, display: `${Math.round(cam.position.x * 100)}%` })}
      ${renderSliderRow({ id: 'cam-py', label: '纵向锚点 Y', min: 0, max: 1, step: 0.01, value: cam.position.y, defaultValue: 0.82, display: `${Math.round(cam.position.y * 100)}%` })}
      ${renderSliderRow({ id: 'cam-dodge', label: '放大时避让', min: 0.3, max: 1.2, step: 0.02, value: cam.scaleDuringZoom, defaultValue: 0.72, display: `${Math.round(cam.scaleDuringZoom * 100)}%` })}
    </div>

    <div class="insp-card">
      <div class="insp-card-title">人像美颜增强 (Shader)</div>
      ${renderSliderRow({ id: 'cam-smooth', label: '肤质磨皮', min: 0, max: 1, step: 0.02, value: cam.beauty.smoothing, defaultValue: 0, display: `${Math.round(cam.beauty.smoothing * 100)}%` })}
      ${renderSliderRow({ id: 'cam-whiten', label: '自然提亮', min: 0, max: 1, step: 0.02, value: cam.beauty.whitening, defaultValue: 0, display: `${Math.round(cam.beauty.whitening * 100)}%` })}
    </div>
  `;

  const applyCamera = (patch: Partial<typeof cam>, rec = true, keepDom = false) => {
    const cur = ctx.getProject()!;
    ctx.applyProjectMutation(
      { ...cur, camera: makeCameraStyle({ ...cur.camera, ...patch }) },
      { recordHistory: rec, skipInspectorRerender: keepDom, skipTimelineRerender: keepDom }
    );
  };

  document.getElementById('cam-hidden')?.addEventListener('change', (ev) => {
    applyCamera({ isHidden: (ev.target as HTMLInputElement).checked });
  });
  document.getElementById('cam-mirrored')?.addEventListener('change', (ev) => {
    applyCamera({ isMirrored: (ev.target as HTMLInputElement).checked });
  });
  el.querySelectorAll('[data-cam-shape]').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyCamera({ shape: btn.getAttribute('data-cam-shape') as CameraShape });
    });
  });

  bindProRange('cam-size', (v, rec) => applyCamera({ size: v }, rec, true), (v) => `${Math.round(v * 100)}%`, 0.22);
  bindProRange('cam-round', (v, rec) => applyCamera({ roundness: v }, rec, true), (v) => `${Math.round(v * 100)}%`, 1);
  bindProRange(
    'cam-px',
    (v, rec) => applyCamera({ position: { ...ctx.getProject()!.camera.position, x: v } }, rec, true),
    (v) => `${Math.round(v * 100)}%`,
    0.86
  );
  bindProRange(
    'cam-py',
    (v, rec) => applyCamera({ position: { ...ctx.getProject()!.camera.position, y: v } }, rec, true),
    (v) => `${Math.round(v * 100)}%`,
    0.82
  );
  bindProRange('cam-dodge', (v, rec) => applyCamera({ scaleDuringZoom: v }, rec, true), (v) => `${Math.round(v * 100)}%`, 0.72);

  bindProRange(
    'cam-smooth',
    (v, rec) =>
      applyCamera(
        { beauty: makeCameraBeautySettings({ ...ctx.getProject()!.camera.beauty, smoothing: v }) },
        rec,
        true
      ),
    (v) => `${Math.round(v * 100)}%`,
    0
  );
  bindProRange(
    'cam-whiten',
    (v, rec) =>
      applyCamera(
        { beauty: makeCameraBeautySettings({ ...ctx.getProject()!.camera.beauty, whitening: v }) },
        rec,
        true
      ),
    (v) => `${Math.round(v * 100)}%`,
    0
  );
}

function renderAudioTab(el: HTMLElement, ctx: StudioRuntimeContext): void {
  const detail = ctx.getDetail()!;
  const aud = ctx.getProject()!.audio;

  el.innerHTML = `
    <div class="inspector-head"><h2 class="inspector-title">声音</h2><span class="inspector-scope">多轨混音过滤</span></div>
    <div class="insp-card">
      <div class="insp-row">
        <span class="insp-card-title">系统音频 (WASAPI)</span>
        <span class="insp-badge ${detail.hasSystemAudio ? 'ok' : ''}">${detail.hasSystemAudio ? 'system-audio.wav 就绪' : '未录制系统音'}</span>
      </div>
      ${renderSwitchRow({ id: 'aud-sys-mute', label: '静音系统声', checked: aud.isSystemMuted })}
      ${renderSliderRow({ id: 'aud-sys-vol', label: '系统音量', min: 0, max: 1, step: 0.02, value: aud.systemVolume, defaultValue: 1, display: `${Math.round(aud.systemVolume * 100)}%` })}
    </div>

    <div class="insp-card">
      <div class="insp-row">
        <span class="insp-card-title">麦克风音轨 (DirectShow)</span>
        <span class="insp-badge ${detail.hasMicAudio ? 'ok' : ''}">${detail.hasMicAudio ? 'mic-audio.wav 就绪' : '未录制麦克风'}</span>
      </div>
      ${renderSwitchRow({ id: 'aud-mic-mute', label: '静音麦克风', checked: aud.isMicrophoneMuted })}
      ${renderSliderRow({ id: 'aud-mic-vol', label: '人声音量', min: 0, max: 1, step: 0.02, value: aud.microphoneVolume, defaultValue: 1, display: `${Math.round(aud.microphoneVolume * 100)}%` })}
    </div>
  `;

  const applyAudio = (patch: Partial<typeof aud>, rec = true, keepDom = false) => {
    const cur = ctx.getProject()!;
    ctx.applyProjectMutation(
      { ...cur, audio: makeAudioStyle({ ...cur.audio, ...patch }) },
      { recordHistory: rec, skipInspectorRerender: keepDom, skipTimelineRerender: keepDom }
    );
  };

  document.getElementById('aud-sys-mute')?.addEventListener('change', (ev) => {
    applyAudio({ isSystemMuted: (ev.target as HTMLInputElement).checked });
  });
  bindProRange('aud-sys-vol', (v, rec) => applyAudio({ systemVolume: v }, rec, true), (v) => `${Math.round(v * 100)}%`, 1);

  document.getElementById('aud-mic-mute')?.addEventListener('change', (ev) => {
    applyAudio({ isMicrophoneMuted: (ev.target as HTMLInputElement).checked });
  });
  bindProRange('aud-mic-vol', (v, rec) => applyAudio({ microphoneVolume: v }, rec, true), (v) => `${Math.round(v * 100)}%`, 1);
}
