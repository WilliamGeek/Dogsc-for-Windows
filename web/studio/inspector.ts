/**
 * web/studio/inspector.ts
 *
 * Real-time 6-tab inspector aligned with macOS EditorInspectorView:
 *   1. frame (画面)  2. zoom (运镜)  3. opening (开场)
 *   4. cursor (光标) 5. camera (摄像头) 6. audio (声音)
 * Strict zero-fake-switch invariant: every control directly mutates RecorderProject
 * and re-renders live WebGL2 preview immediately.
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

const ASPECT_OPTIONS: readonly CanvasAspectRatio[] = ['适应', '16:9', '9:16', '1:1', '4:3'];
const CHROME_OPTIONS: ReadonlyArray<{ id: ScreenFrameStyle; label: string }> = [
  { id: 'none', label: '无外框' },
  { id: 'windowLight', label: '浅色窗口' },
  { id: 'windowDark', label: '深色窗口' },
  { id: 'browserLight', label: '浅色浏览器' },
  { id: 'browserDark', label: '深色浏览器' },
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

function sliderRow(
  id: string,
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  display: string
): string {
  return `
    <div class="insp-row">
      <span class="insp-label" style="min-width:74px;">${label}</span>
      <input id="${id}" class="insp-slider" type="range" min="${min}" max="${max}" step="${step}" value="${value}" />
      <span id="${id}-val" class="insp-val">${display}</span>
    </div>`;
}

function backgroundOptionId(bg: BackgroundSource): string {
  if (bg.kind === 'pattern') return `pattern:${bg.preset}`;
  if (bg.kind === 'dynamicFlow') return `dynamicFlow:${bg.preset}`;
  return '';
}

export function renderStudioInspector(ctx: StudioRuntimeContext): void {
  const container = document.getElementById('studio-inspector-body');
  if (!container) return;

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

  const bgPills = [
    ...BackgroundPatternPresetAllCases.map(
      (p) =>
        `<button class="pill-choice ${activeBgId === `pattern:${p}` ? 'active' : ''}" data-bg-kind="pattern" data-bg-preset="${p}">${backgroundPatternPresetDisplayName(p)}</button>`
    ),
    ...DynamicBackgroundPresetAllCases.map(
      (d) =>
        `<button class="pill-choice ${activeBgId === `dynamicFlow:${d}` ? 'active' : ''}" data-bg-kind="dynamicFlow" data-bg-preset="${d}">${dynamicBackgroundPresetDisplayName(d)}</button>`
    ),
  ].join('');

  const chromePills = CHROME_OPTIONS.map(
    (opt) =>
      `<button class="pill-choice ${c.screenFrame === opt.id ? 'active' : ''}" data-chrome="${opt.id}">${opt.label}</button>`
  ).join('');

  const mosaicCard = selectedMosaic
    ? `
      <div class="insp-card" style="border-color:var(--t-region);">
        <div class="insp-row">
          <span class="insp-card-title" style="color:var(--t-region);">选中区域效果</span>
          <button id="insp-del-mosaic" class="insp-btn danger">删除</button>
        </div>
        <div class="pill-grid">
          <button class="pill-choice ${selectedMosaic.style === 'blur' ? 'active' : ''}" data-mos-style="blur">马赛克模糊</button>
          <button class="pill-choice ${selectedMosaic.style === 'spotlight' ? 'active' : ''}" data-mos-style="spotlight">聚光灯聚焦</button>
        </div>
        ${sliderRow('mos-intensity', '效果强度', 0.1, 1, 0.05, selectedMosaic.intensity, `${Math.round(selectedMosaic.intensity * 100)}%`)}
        ${
          selectedMosaic.style === 'spotlight'
            ? sliderRow('mos-dimming', '外部压暗', 0.05, 0.85, 0.05, selectedMosaic.spotlightDimming, `${Math.round(selectedMosaic.spotlightDimming * 100)}%`)
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
      ${sliderRow('frame-padding', '四周留白', 0, 240, 2, c.padding, `${Math.round(c.padding)}px`)}
      ${sliderRow('frame-scale', '画面缩放', 0.5, 1.5, 0.02, c.contentScale, `${Math.round(c.contentScale * 100)}%`)}
      ${sliderRow('frame-radius', '画面圆角', 0, 64, 1, c.cornerRadius, `${Math.round(c.cornerRadius)}px`)}
      ${sliderRow('frame-shadow', '立体阴影', 0, 1, 0.02, c.shadowStrength, `${Math.round(c.shadowStrength * 100)}%`)}
      ${sliderRow('frame-border-w', '描边宽度', 0, 16, 0.5, c.borderWidth, `${c.borderWidth.toFixed(1)}px`)}
      <div class="insp-row">
        <span class="insp-label">描边颜色</span>
        <input id="frame-border-col" type="color" value="${hexColorString(c.borderColor)}" />
      </div>
    </div>

    <div class="insp-card">
      <div class="insp-card-title">背景壁纸与流动纹理</div>
      <div class="pill-grid">${bgPills}</div>
      ${sliderRow('frame-bg-blur', '背景虚化', 0, 48, 1, c.backgroundBlur, `${Math.round(c.backgroundBlur)}px`)}
      ${sliderRow('frame-pat-op', '纹理强度', 0, 1, 0.05, c.patternOpacity, `${Math.round(c.patternOpacity * 100)}%`)}
    </div>

    <div class="insp-card">
      <div class="insp-card-title">设备与窗口外框 (Chrome)</div>
      <div class="pill-grid">${chromePills}</div>
      <input id="frame-chrome-title" class="insp-input" type="text" placeholder="窗口标题 (window 模式生效)" value="${escapeHtml(c.screenFrameTitle)}" />
      <input id="frame-chrome-url" class="insp-input" type="text" placeholder="浏览器地址栏 (browser 模式生效)" value="${escapeHtml(c.screenFrameBrowserAddress)}" />
    </div>
  `;

  const applyCanvas = (patch: Partial<typeof c>, recordHistory = true) => {
    const cur = ctx.getProject()!;
    ctx.applyProjectMutation(
      { ...cur, canvas: makeCanvasStyle({ ...cur.canvas, ...patch }) },
      { recordHistory }
    );
  };

  el.querySelectorAll('[data-aspect]').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyCanvas({ aspectRatio: btn.getAttribute('data-aspect') as CanvasAspectRatio });
    });
  });

  bindRange('frame-padding', (v, rec) => applyCanvas({ padding: v }, rec), (v) => `${Math.round(v)}px`);
  bindRange('frame-scale', (v, rec) => applyCanvas({ contentScale: v }, rec), (v) => `${Math.round(v * 100)}%`);
  bindRange('frame-radius', (v, rec) => applyCanvas({ cornerRadius: v }, rec), (v) => `${Math.round(v)}px`);
  bindRange('frame-shadow', (v, rec) => applyCanvas({ shadowStrength: v }, rec), (v) => `${Math.round(v * 100)}%`);
  bindRange('frame-border-w', (v, rec) => applyCanvas({ borderWidth: v }, rec), (v) => `${v.toFixed(1)}px`);

  document.getElementById('frame-border-col')?.addEventListener('change', (ev) => {
    const parsed = parseHexColor((ev.target as HTMLInputElement).value);
    if (parsed) applyCanvas({ borderColor: parsed });
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

  bindRange('frame-bg-blur', (v, rec) => applyCanvas({ backgroundBlur: v }, rec), (v) => `${Math.round(v)}px`);
  bindRange('frame-pat-op', (v, rec) => applyCanvas({ patternOpacity: v }, rec), (v) => `${Math.round(v * 100)}%`);

  el.querySelectorAll('[data-chrome]').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyCanvas({ screenFrame: btn.getAttribute('data-chrome') as ScreenFrameStyle });
    });
  });

  document.getElementById('frame-chrome-title')?.addEventListener('change', (ev) => {
    applyCanvas({ screenFrameTitle: (ev.target as HTMLInputElement).value.slice(0, 120) });
  });
  document.getElementById('frame-chrome-url')?.addEventListener('change', (ev) => {
    applyCanvas({ screenFrameBrowserAddress: (ev.target as HTMLInputElement).value.slice(0, 240) });
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
    bindRange(
      'mos-intensity',
      (v, rec) => {
        const res = updateMosaicClipById(ctx.getProject()!, selectedMosaic.id, { intensity: v });
        ctx.applyProjectMutation(res.project, { recordHistory: rec });
      },
      (v) => `${Math.round(v * 100)}%`
    );
    if (selectedMosaic.style === 'spotlight') {
      bindRange(
        'mos-dimming',
        (v, rec) => {
          const res = updateMosaicClipById(ctx.getProject()!, selectedMosaic.id, { spotlightDimming: v });
          ctx.applyProjectMutation(res.project, { recordHistory: rec });
        },
        (v) => `${Math.round(v * 100)}%`
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
          <button id="zoom-clip-del" class="insp-btn danger">删除</button>
        </div>
        ${sliderRow('zoom-clip-scale', '放大倍数', 1.1, 3.5, 0.05, clip.scale, `${clip.scale.toFixed(2)}×`)}
        ${sliderRow('zoom-clip-fx', '焦点横向 X', 0, 1, 0.01, clip.focus.x, `${Math.round(clip.focus.x * 100)}%`)}
        ${sliderRow('zoom-clip-fy', '焦点纵向 Y', 0, 1, 0.01, clip.focus.y, `${Math.round(clip.focus.y * 100)}%`)}
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
      ${sliderRow('motion-def-scale', '默认放大', 1.2, 3.0, 0.05, m.defaultZoomScale ?? 1.8, `${(m.defaultZoomScale ?? 1.8).toFixed(2)}×`)}
      ${sliderRow('motion-def-trans', '进出耗时', 0.2, 1.5, 0.05, m.defaultZoomTransitionDuration, `${m.defaultZoomTransitionDuration.toFixed(2)}s`)}
      <button id="btn-recompute-zoom" class="insp-btn">按鼠标点击重新生成自动缩放</button>
    </div>
  `;

  const applyMotion = (patch: Partial<typeof m>, rec = true) => {
    const cur = ctx.getProject()!;
    ctx.applyProjectMutation(
      { ...cur, motion: makeMotionStyle({ ...cur.motion, ...patch }) },
      { recordHistory: rec }
    );
  };

  el.querySelectorAll('[data-screen-motion]').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyMotion({ screen: btn.getAttribute('data-screen-motion') as ScreenMotionStyle });
    });
  });

  bindRange('motion-def-scale', (v, rec) => applyMotion({ defaultZoomScale: v }, rec), (v) => `${v.toFixed(2)}×`);
  bindRange('motion-def-trans', (v, rec) => applyMotion({ defaultZoomTransitionDuration: v }, rec), (v) => `${v.toFixed(2)}s`);

  document.getElementById('btn-recompute-zoom')?.addEventListener('click', () => {
    const res = recomputeAutoZoomClips(ctx.getProject()!, detail.pointerEvents);
    ctx.applyProjectMutation(res.project, { selection: res.selection });
  });

  if (clip) {
    document.getElementById('zoom-clip-del')?.addEventListener('click', () => {
      const res = deleteZoomClipById(ctx.getProject()!, clip.id);
      ctx.applyProjectMutation(res.project, { selection: null });
    });
    bindRange(
      'zoom-clip-scale',
      (v, rec) => {
        const res = updateZoomClipById(ctx.getProject()!, clip.id, { scale: v });
        ctx.applyProjectMutation(res.project, { recordHistory: rec });
      },
      (v) => `${v.toFixed(2)}×`
    );
    bindRange(
      'zoom-clip-fx',
      (v, rec) => {
        const cur = ctx.getProject()!.timeline.zoomClips.find((z) => z.id === clip.id);
        if (!cur) return;
        const res = updateZoomClipById(ctx.getProject()!, clip.id, { focus: { ...cur.focus, x: v } });
        ctx.applyProjectMutation(res.project, { recordHistory: rec });
      },
      (v) => `${Math.round(v * 100)}%`
    );
    bindRange(
      'zoom-clip-fy',
      (v, rec) => {
        const cur = ctx.getProject()!.timeline.zoomClips.find((z) => z.id === clip.id);
        if (!cur) return;
        const res = updateZoomClipById(ctx.getProject()!, clip.id, { focus: { ...cur.focus, y: v } });
        ctx.applyProjectMutation(res.project, { recordHistory: rec });
      },
      (v) => `${Math.round(v * 100)}%`
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
  const presetPills = OpeningSequencePresetAllCases.map(
    (p) => `<button class="pill-choice ${op.preset === p ? 'active' : ''}" data-op-preset="${p}">${p}</button>`
  ).join('');

  el.innerHTML = `
    <div class="inspector-head"><h2 class="inspector-title">开场</h2><span class="inspector-scope">3D 透视序列</span></div>
    <div class="insp-card">
      <div class="insp-row">
        <span class="insp-label">启用开场透视动画</span>
        <input id="op-enabled" type="checkbox" ${op.isEnabled ? 'checked' : ''} />
      </div>
      <div class="insp-card-title">动效预设</div>
      <div class="pill-grid">${presetPills}</div>
      ${sliderRow('op-duration', '开场时长', 0.4, 5.0, 0.1, op.duration, `${op.duration.toFixed(1)}s`)}
      ${sliderRow('op-stagger', '图层错峰', 0, 0.8, 0.02, op.stagger, `${op.stagger.toFixed(2)}s`)}
    </div>
  `;

  const applyOpening = (patch: Partial<typeof op>, rec = true) => {
    const cur = ctx.getProject()!;
    ctx.applyProjectMutation(
      { ...cur, openingSequence: makeOpeningSequence({ ...cur.openingSequence, ...patch }) },
      { recordHistory: rec }
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
  bindRange('op-duration', (v, rec) => applyOpening({ duration: v }, rec), (v) => `${v.toFixed(1)}s`);
  bindRange('op-stagger', (v, rec) => applyOpening({ stagger: v }, rec), (v) => `${v.toFixed(2)}s`);
}

function renderCursorTab(el: HTMLElement, ctx: StudioRuntimeContext): void {
  const project = ctx.getProject()!;
  const curStyle = project.cursorStyle;
  const activeAppearance = cursorStyleAppearance(curStyle);

  const shapePills = CursorAppearanceAllCases.map(
    (ap) =>
      `<button class="pill-choice ${activeAppearance === ap ? 'active' : ''}" data-cur-shape="${ap}">${ap}</button>`
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
      <div class="pill-grid">${shapePills}</div>
      ${sliderRow('cur-size', '光标倍率', 0.5, 3.0, 0.05, curStyle.size, `${curStyle.size.toFixed(2)}×`)}
      ${sliderRow('cur-tilt', '速度倾斜', 2, 4, 0.1, curStyle.motionTiltStrength, `${curStyle.motionTiltStrength.toFixed(1)}`)}
      <div class="insp-row">
        <span class="insp-label">静止自动隐藏</span>
        <input id="cur-idle-hide" type="checkbox" ${curStyle.hideWhenIdle ? 'checked' : ''} />
      </div>
      <div class="insp-row">
        <span class="insp-label">点击按压缩放</span>
        <input id="cur-press-scale" type="checkbox" ${curStyle.pressesOnClick ? 'checked' : ''} />
      </div>
    </div>

    <div class="insp-card">
      <div class="insp-card-title">平滑物理阻尼</div>
      <div class="pill-grid">${smoothPills}</div>
    </div>

    <div class="insp-card">
      <div class="insp-card-title">点击波纹与反馈动效</div>
      <div class="pill-grid">${clickPills}</div>
      ${sliderRow('cur-click-op', '波纹不透明', 0.1, 1.0, 0.05, curStyle.clickOpacity, `${Math.round(curStyle.clickOpacity * 100)}%`)}
      ${sliderRow('cur-click-sc', '波纹尺度', 0.5, 2.5, 0.05, curStyle.clickScale, `${curStyle.clickScale.toFixed(2)}×`)}
    </div>
  `;

  const applyCursor = (patch: Partial<typeof curStyle>, rec = true) => {
    const cur = ctx.getProject()!;
    ctx.applyProjectMutation(
      { ...cur, cursorStyle: makeCursorStyle({ ...cur.cursorStyle, ...patch }) },
      { recordHistory: rec }
    );
  };

  el.querySelectorAll('[data-cur-shape]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ap = btn.getAttribute('data-cur-shape') as CursorAppearance;
      applyCursor({ assetID: cursorStyleAssetIDForAppearance(ap) });
    });
  });

  bindRange('cur-size', (v, rec) => applyCursor({ size: v }, rec), (v) => `${v.toFixed(2)}×`);
  bindRange('cur-tilt', (v, rec) => applyCursor({ motionTiltStrength: v }, rec), (v) => `${v.toFixed(1)}`);

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
  bindRange('cur-click-op', (v, rec) => applyCursor({ clickOpacity: v }, rec), (v) => `${Math.round(v * 100)}%`);
  bindRange('cur-click-sc', (v, rec) => applyCursor({ clickScale: v }, rec), (v) => `${v.toFixed(2)}×`);
}

function renderCameraTab(el: HTMLElement, ctx: StudioRuntimeContext): void {
  const detail = ctx.getDetail()!;
  const cam = ctx.getProject()!.camera;
  const shapePills = CameraShapeAllCases.map(
    (s) => `<button class="pill-choice ${cam.shape === s ? 'active' : ''}" data-cam-shape="${s}">${s}</button>`
  ).join('');

  el.innerHTML = `
    <div class="inspector-head">
      <h2 class="inspector-title">摄像头</h2>
      <span class="insp-badge ${detail.hasCamera ? 'ok' : ''}">${detail.hasCamera ? '已录制摄像头' : '无摄像头文件'}</span>
    </div>
    <div class="insp-card">
      <div class="insp-row">
        <span class="insp-label">隐藏摄像头画中画</span>
        <input id="cam-hidden" type="checkbox" ${cam.isHidden ? 'checked' : ''} />
      </div>
      <div class="insp-row">
        <span class="insp-label">水平镜像翻转</span>
        <input id="cam-mirrored" type="checkbox" ${cam.isMirrored ? 'checked' : ''} />
      </div>
      <div class="insp-card-title">裁切形态</div>
      <div class="pill-grid">${shapePills}</div>
      ${sliderRow('cam-size', '窗口尺寸', 0.12, 0.55, 0.01, cam.size, `${Math.round(cam.size * 100)}%`)}
      ${sliderRow('cam-round', '圆角平滑', 0, 1, 0.02, cam.roundness, `${Math.round(cam.roundness * 100)}%`)}
      ${sliderRow('cam-px', '横向锚点 X', 0, 1, 0.01, cam.position.x, `${Math.round(cam.position.x * 100)}%`)}
      ${sliderRow('cam-py', '纵向锚点 Y', 0, 1, 0.01, cam.position.y, `${Math.round(cam.position.y * 100)}%`)}
      ${sliderRow('cam-dodge', '放大时避让', 0.3, 1.2, 0.02, cam.scaleDuringZoom, `${Math.round(cam.scaleDuringZoom * 100)}%`)}
    </div>

    <div class="insp-card">
      <div class="insp-card-title">人像美颜增强 (Shader)</div>
      ${sliderRow('cam-smooth', '肤质磨皮', 0, 1, 0.02, cam.beauty.smoothing, `${Math.round(cam.beauty.smoothing * 100)}%`)}
      ${sliderRow('cam-whiten', '自然提亮', 0, 1, 0.02, cam.beauty.whitening, `${Math.round(cam.beauty.whitening * 100)}%`)}
    </div>
  `;

  const applyCamera = (patch: Partial<typeof cam>, rec = true) => {
    const cur = ctx.getProject()!;
    ctx.applyProjectMutation(
      { ...cur, camera: makeCameraStyle({ ...cur.camera, ...patch }) },
      { recordHistory: rec }
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

  bindRange('cam-size', (v, rec) => applyCamera({ size: v }, rec), (v) => `${Math.round(v * 100)}%`);
  bindRange('cam-round', (v, rec) => applyCamera({ roundness: v }, rec), (v) => `${Math.round(v * 100)}%`);
  bindRange(
    'cam-px',
    (v, rec) => applyCamera({ position: { ...ctx.getProject()!.camera.position, x: v } }, rec),
    (v) => `${Math.round(v * 100)}%`
  );
  bindRange(
    'cam-py',
    (v, rec) => applyCamera({ position: { ...ctx.getProject()!.camera.position, y: v } }, rec),
    (v) => `${Math.round(v * 100)}%`
  );
  bindRange('cam-dodge', (v, rec) => applyCamera({ scaleDuringZoom: v }, rec), (v) => `${Math.round(v * 100)}%`);

  bindRange(
    'cam-smooth',
    (v, rec) =>
      applyCamera(
        { beauty: makeCameraBeautySettings({ ...ctx.getProject()!.camera.beauty, smoothing: v }) },
        rec
      ),
    (v) => `${Math.round(v * 100)}%`
  );
  bindRange(
    'cam-whiten',
    (v, rec) =>
      applyCamera(
        { beauty: makeCameraBeautySettings({ ...ctx.getProject()!.camera.beauty, whitening: v }) },
        rec
      ),
    (v) => `${Math.round(v * 100)}%`
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
      <div class="insp-row">
        <span class="insp-label">静音系统声</span>
        <input id="aud-sys-mute" type="checkbox" ${aud.isSystemMuted ? 'checked' : ''} />
      </div>
      ${sliderRow('aud-sys-vol', '系统音量', 0, 1, 0.02, aud.systemVolume, `${Math.round(aud.systemVolume * 100)}%`)}
    </div>

    <div class="insp-card">
      <div class="insp-row">
        <span class="insp-card-title">麦克风音轨 (DirectShow)</span>
        <span class="insp-badge ${detail.hasMicAudio ? 'ok' : ''}">${detail.hasMicAudio ? 'mic-audio.wav 就绪' : '未录制麦克风'}</span>
      </div>
      <div class="insp-row">
        <span class="insp-label">静音麦克风</span>
        <input id="aud-mic-mute" type="checkbox" ${aud.isMicrophoneMuted ? 'checked' : ''} />
      </div>
      ${sliderRow('aud-mic-vol', '人声音量', 0, 1, 0.02, aud.microphoneVolume, `${Math.round(aud.microphoneVolume * 100)}%`)}
    </div>
  `;

  const applyAudio = (patch: Partial<typeof aud>, rec = true) => {
    const cur = ctx.getProject()!;
    ctx.applyProjectMutation(
      { ...cur, audio: makeAudioStyle({ ...cur.audio, ...patch }) },
      { recordHistory: rec }
    );
  };

  document.getElementById('aud-sys-mute')?.addEventListener('change', (ev) => {
    applyAudio({ isSystemMuted: (ev.target as HTMLInputElement).checked });
  });
  bindRange('aud-sys-vol', (v, rec) => applyAudio({ systemVolume: v }, rec), (v) => `${Math.round(v * 100)}%`);

  document.getElementById('aud-mic-mute')?.addEventListener('change', (ev) => {
    applyAudio({ isMicrophoneMuted: (ev.target as HTMLInputElement).checked });
  });
  bindRange('aud-mic-vol', (v, rec) => applyAudio({ microphoneVolume: v }, rec), (v) => `${Math.round(v * 100)}%`);
}

function bindRange(
  id: string,
  onApply: (value: number, recordHistory: boolean) => void,
  formatVal: (v: number) => string
): void {
  const slider = document.getElementById(id) as HTMLInputElement | null;
  const valEl = document.getElementById(`${id}-val`);
  if (!slider) return;
  let pushed = false;
  slider.addEventListener('input', () => {
    const num = Number(slider.value);
    if (valEl) valEl.textContent = formatVal(num);
    onApply(num, !pushed);
    pushed = true;
  });
  slider.addEventListener('change', () => {
    pushed = false;
  });
}
