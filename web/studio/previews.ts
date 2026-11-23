/**
 * web/studio/previews.ts
 *
 * Visual thumbnail swatch/wireframe card renderers for DogSC Studio (Frontend P1).
 * Matches shader palettes in `web/passes/background.ts` and built-in HTML motion templates.
 * Strictly ZERO node:* imports and stripTypeScriptTypes compatible.
 */

import type {
  CameraShape,
  CursorAppearance,
  OpeningSequencePreset,
  ScreenFrameStyle,
} from '../../src/core/ProjectModel.ts';
import type { HtmlMotionTemplateMeta } from '../passes/htmlMotion.ts';
import { svgIcon } from './icons.ts';

function esc(text: string): string {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

interface BgSwatchVisual {
  bgCss: string;
  overlayClass: string;
  isDynamic: boolean;
}

const BG_SWATCH_MAP: Record<string, BgSwatchVisual> = {
  'pattern:黑曜石网格': {
    bgCss: 'radial-gradient(circle at 75% 25%, #38578f 0%, transparent 58%), linear-gradient(135deg, #0f141f, #21293d)',
    overlayClass: 'swatch-pat-grid',
    isDynamic: false,
  },
  'pattern:工程白网格': {
    bgCss: 'radial-gradient(circle at 75% 25%, #b8ccf2 0%, transparent 58%), linear-gradient(135deg, #f0f2f9, #d6e0f0)',
    overlayClass: 'swatch-pat-grid-dark',
    isDynamic: false,
  },
  'pattern:暗夜星阵': {
    bgCss: 'radial-gradient(circle at 75% 25%, #593899 0%, transparent 60%), linear-gradient(135deg, #0a0d19, #1c1738)',
    overlayClass: 'swatch-pat-dots',
    isDynamic: false,
  },
  'pattern:建筑极简点': {
    bgCss: 'radial-gradient(circle at 75% 25%, #f5efe5 0%, transparent 58%), linear-gradient(135deg, #ebe8e3, #d6d3cc)',
    overlayClass: 'swatch-pat-dots-dark',
    isDynamic: false,
  },
  'pattern:立体等角网': {
    bgCss: 'radial-gradient(circle at 75% 25%, #29808c 0%, transparent 60%), linear-gradient(135deg, #141e29, #243847)',
    overlayClass: 'swatch-pat-iso',
    isDynamic: false,
  },
  'dynamicFlow:赛博微流网格': {
    bgCss: 'radial-gradient(circle at 72% 28%, #c78f33 0%, transparent 60%), linear-gradient(135deg, #171224, #332414)',
    overlayClass: 'swatch-pat-iso',
    isDynamic: true,
  },
  'dynamicFlow:星辉漫步点阵': {
    bgCss: 'radial-gradient(circle at 72% 28%, #a66173 0%, transparent 60%), linear-gradient(135deg, #120f1f, #2e1f2e)',
    overlayClass: 'swatch-pat-dots',
    isDynamic: true,
  },
  'dynamicFlow:极光流体星云': {
    bgCss: 'radial-gradient(circle at 72% 28%, #59adeb 0%, transparent 60%), linear-gradient(135deg, #0d1c2e, #1f4061)',
    overlayClass: 'swatch-pat-iso',
    isDynamic: true,
  },
};

export function renderBackgroundSwatchCard(
  kind: 'pattern' | 'dynamicFlow',
  preset: string,
  label: string,
  active: boolean
): string {
  const key = `${kind}:${preset}`;
  const vis = BG_SWATCH_MAP[key] ?? {
    bgCss: 'linear-gradient(135deg, #1a2130, #2c384d)',
    overlayClass: 'swatch-pat-grid',
    isDynamic: kind === 'dynamicFlow',
  };
  return `
    <button class="swatch-card ${active ? 'active' : ''}" data-bg-kind="${kind}" data-bg-preset="${esc(preset)}" title="${esc(label)}">
      <div class="swatch-thumb" style="background:${vis.bgCss}">
        <span class="swatch-overlay ${vis.overlayClass}"></span>
        <span class="swatch-mini-screen"></span>
        ${vis.isDynamic ? '<span class="swatch-dyn-badge" title="动态流体">流</span>' : ''}
      </div>
      <span class="swatch-label">${esc(label)}</span>
    </button>`;
}

function chromePreviewSvg(id: ScreenFrameStyle): string {
  switch (id) {
    case 'none':
      return `<svg viewBox="0 0 46 28" width="46" height="28"><rect x="4" y="4" width="38" height="20" rx="3" fill="var(--panel-raised)" stroke="currentColor" stroke-opacity="0.38" stroke-width="1.2"/></svg>`;
    case 'windowLight':
      return `<svg viewBox="0 0 46 28" width="46" height="28"><rect x="3" y="3" width="40" height="22" rx="3.5" fill="#f3f3f1" stroke="#b9b8b4" stroke-width="1"/><path d="M3 8.5h40" stroke="#d5d4cf" stroke-width="1"/><circle cx="6.5" cy="5.8" r="1" fill="#ec6a5e"/><circle cx="9.5" cy="5.8" r="1" fill="#f5bf4f"/><circle cx="12.5" cy="5.8" r="1" fill="#61c554"/></svg>`;
    case 'windowDark':
      return `<svg viewBox="0 0 46 28" width="46" height="28"><rect x="3" y="3" width="40" height="22" rx="3.5" fill="#1e1e1d" stroke="#454442" stroke-width="1"/><path d="M3 8.5h40" stroke="#333330" stroke-width="1"/><circle cx="6.5" cy="5.8" r="1" fill="#ec6a5e"/><circle cx="9.5" cy="5.8" r="1" fill="#f5bf4f"/><circle cx="12.5" cy="5.8" r="1" fill="#61c554"/></svg>`;
    case 'browserLight':
      return `<svg viewBox="0 0 46 28" width="46" height="28"><rect x="3" y="3" width="40" height="22" rx="3.5" fill="#f5f5f3" stroke="#b9b8b4" stroke-width="1"/><rect x="13" y="4.7" width="23" height="3.2" rx="1.5" fill="#e2e2de"/><path d="M3 9.5h40" stroke="#d5d4cf" stroke-width="1"/><circle cx="6.5" cy="6.3" r="0.9" fill="#9a9894"/><circle cx="9.2" cy="6.3" r="0.9" fill="#9a9894"/></svg>`;
    case 'browserDark':
      return `<svg viewBox="0 0 46 28" width="46" height="28"><rect x="3" y="3" width="40" height="22" rx="3.5" fill="#1f1f1e" stroke="#454442" stroke-width="1"/><rect x="13" y="4.7" width="23" height="3.2" rx="1.5" fill="#323230"/><path d="M3 9.5h40" stroke="#343432" stroke-width="1"/><circle cx="6.5" cy="6.3" r="0.9" fill="#777672"/><circle cx="9.2" cy="6.3" r="0.9" fill="#777672"/></svg>`;
    case 'devicePhone':
      return `<svg viewBox="0 0 46 28" width="46" height="28"><rect x="15" y="2" width="16" height="24" rx="3.5" fill="#181818" stroke="currentColor" stroke-opacity="0.5" stroke-width="1.3"/><rect x="17" y="4" width="12" height="20" rx="2" fill="var(--panel-raised)"/><rect x="20.5" y="4.8" width="5" height="1.4" rx="0.7" fill="#181818"/></svg>`;
    case 'deviceTablet':
      return `<svg viewBox="0 0 46 28" width="46" height="28"><rect x="6" y="3" width="34" height="22" rx="3.2" fill="#1b1b1a" stroke="currentColor" stroke-opacity="0.5" stroke-width="1.3"/><rect x="8.5" y="5" width="29" height="18" rx="1.5" fill="var(--panel-raised)"/></svg>`;
  }
}

export function renderChromePreviewCard(
  id: ScreenFrameStyle,
  label: string,
  active: boolean
): string {
  return `
    <button class="visual-opt-card ${active ? 'active' : ''}" data-chrome="${id}" title="${esc(label)}">
      <div class="visual-opt-preview">${chromePreviewSvg(id)}</div>
      <span class="visual-opt-label">${esc(label)}</span>
    </button>`;
}

export function renderCursorAppearanceCard(ap: CursorAppearance, active: boolean): string {
  let glyph = '';
  switch (ap) {
    case '系统箭头':
      glyph = `<svg viewBox="0 0 28 28" width="24" height="24"><path d="M7 4l13 8-5.5 1.8-2 5.7L7 4Z" fill="var(--ink)" stroke="var(--bg-deep)" stroke-width="1.2"/></svg>`;
      break;
    case '指向手势':
      glyph = `<svg viewBox="0 0 28 28" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12V6a1.6 1.6 0 0 1 3.2 0v5.5"/><path d="M15.2 10.5a1.5 1.5 0 0 1 3 0v2"/><path d="M18.2 11.5a1.5 1.5 0 0 1 3 0V16a6 6 0 0 1-6 6h-2a5 5 0 0 1-4.3-2.5l-2.4-4a1.5 1.5 0 0 1 2.3-1.8L12 16v-4Z"/></svg>`;
      break;
    case '十字准星':
      glyph = `<svg viewBox="0 0 28 28" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="14" cy="14" r="6"/><path d="M14 4v5M14 19v5M4 14h5M19 14h5"/></svg>`;
      break;
    case '隐藏':
      glyph = svgIcon('eyeOff', 20);
      break;
  }
  return `
    <button class="visual-opt-card ${active ? 'active' : ''}" data-cur-shape="${esc(ap)}">
      <div class="visual-opt-preview">${glyph}</div>
      <span class="visual-opt-label">${esc(ap)}</span>
    </button>`;
}

export function renderCameraShapeCard(shape: CameraShape, active: boolean): string {
  let box = '';
  switch (shape) {
    case '圆形':
      box = '<circle cx="16" cy="14" r="10" fill="var(--panel-raised)" stroke="currentColor" stroke-width="1.3"/>';
      break;
    case '横向':
      box = '<rect x="3" y="6" width="26" height="16" rx="4" fill="var(--panel-raised)" stroke="currentColor" stroke-width="1.3"/>';
      break;
    case '纵向':
      box = '<rect x="8" y="2" width="16" height="24" rx="4" fill="var(--panel-raised)" stroke="currentColor" stroke-width="1.3"/>';
      break;
    case '原始比例':
      box = '<rect x="4" y="5" width="24" height="18" rx="1.5" fill="var(--panel-raised)" stroke="currentColor" stroke-width="1.3"/>';
      break;
    default:
      box = '<rect x="5" y="3" width="22" height="22" rx="5" fill="var(--panel-raised)" stroke="currentColor" stroke-width="1.3"/>';
      break;
  }
  const svg = `<svg viewBox="0 0 32 28" width="32" height="28">${box}<circle cx="16" cy="11.5" r="2.6" fill="currentColor" opacity="0.55"/><path d="M11 20a5 4 0 0 1 10 0" fill="currentColor" opacity="0.45"/></svg>`;
  return `
    <button class="visual-opt-card ${active ? 'active' : ''}" data-cam-shape="${esc(shape)}">
      <div class="visual-opt-preview">${svg}</div>
      <span class="visual-opt-label">${esc(shape)}</span>
    </button>`;
}

export function renderOpeningPresetCard(preset: OpeningSequencePreset, active: boolean): string {
  let svg = '';
  if (preset === '聚拢') {
    svg = `<svg viewBox="0 0 38 26" width="38" height="26" fill="none"><rect x="10" y="6" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M3 3l5 4M35 3l-5 4M3 23l5-4M35 23l-5-4" stroke="var(--accent)" stroke-width="1.4" stroke-linecap="round"/></svg>`;
  } else if (preset === '侧滑') {
    svg = `<svg viewBox="0 0 38 26" width="38" height="26" fill="none"><rect x="13" y="5" width="19" height="16" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M4 13h7m-3-3 3 3-3 3" stroke="var(--accent)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  } else {
    svg = `<svg viewBox="0 0 38 26" width="38" height="26" fill="none"><path d="M9 5l20 3v12l-20 2V5Z" stroke="currentColor" stroke-width="1.4" fill="var(--panel-raised)"/><path d="M5 9l4 1m-4 6 4-1" stroke="var(--accent)" stroke-width="1.3" stroke-linecap="round"/></svg>`;
  }
  return `
    <button class="visual-opt-card ${active ? 'active' : ''}" data-op-preset="${esc(preset)}">
      <div class="visual-opt-preview">${svg}</div>
      <span class="visual-opt-label">${esc(preset)}</span>
    </button>`;
}

export function renderMotionTemplateCard(t: HtmlMotionTemplateMeta): string {
  const accent = esc(t.defaultAccent);
  let miniHtml = '';
  switch (t.id) {
    case 'lower-third':
      miniHtml = `<div class="mt-prev-lt"><span class="mt-bar" style="background:${accent}"></span><div><b>${esc(t.defaultTitle.slice(0, 6))}</b><i></i></div></div>`;
      break;
    case 'keycap':
      miniHtml = `<div class="mt-prev-key"><span style="border-color:${accent}">⌘</span><span>+</span><span>K</span></div>`;
      break;
    case 'callout':
      miniHtml = `<div class="mt-prev-call" style="border-left-color:${accent}"><span>!</span><i style="background:${accent}"></i></div>`;
      break;
    case 'chapter':
      miniHtml = `<div class="mt-prev-chap"><span style="color:${accent}">01</span><b></b></div>`;
      break;
    default:
      miniHtml = `<div class="mt-prev-pill" style="background:${accent}"></div>`;
      break;
  }
  return `
    <button class="motion-tpl-card" data-insert-tpl="${t.id}" title="在当前播放头插入「${esc(t.label)}」">
      <div class="motion-tpl-stage">${miniHtml}</div>
      <div class="motion-tpl-meta">
        <span class="motion-tpl-dot" style="background:${accent}"></span>
        <span class="motion-tpl-name">${esc(t.label)}</span>
      </div>
    </button>`;
}

