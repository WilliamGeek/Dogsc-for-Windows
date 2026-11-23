/**
 * web/passes/subtitles.ts
 *
 * WebGL2 Bilingual Subtitle Pass for DogSC Windows.
 * Supports all 5 SubtitleEntrance modes ('none' | 'fade' | 'rise' | 'pop' | 'typewriter'),
 * custom font scales, bottom margin, translucent rounded pill background, and primary + secondary text.
 * Strictly ZERO node:* imports and stripTypeScriptTypes compatible.
 */

import type { FrameScene, FrameSubtitleScene } from '../../src/core/FrameScene.ts';
import type { SubtitleFont } from '../../src/core/PostProductionModel.ts';
import { hexColorComponents } from '../../src/core/HexColor.ts';
import { createProgram, createTexture2D, safeCanvasDimensions } from './glUtils.ts';

export interface SubtitleRenderState {
  cueID: string;
  visibleText: string;
  secondaryText: string | null;
  fontCssFamily: string;
  fontSizePx: number;
  secondaryFontSizePx: number;
  bold: boolean;
  bottomMarginPx: number;
  textColorRgb: [number, number, number];
  backgroundOpacity: number;
  opacity: number;
  offsetYPx: number;
  scale: number;
  maxWidthPx: number;
  cornerRadiusPx: number;
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(Math.max(v, lo), hi);
}

export function resolveSubtitleFontFamily(font: SubtitleFont, customFamily?: string): string {
  const custom = typeof customFamily === 'string' && customFamily.trim().length > 0
    ? `"${customFamily.trim().replace(/"/g, '')}", `
    : '';
  switch (font) {
    case 'rounded':
      return `${custom}ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "Microsoft YaHei UI", sans-serif`;
    case 'serif':
      return `${custom}Georgia, "Noto Serif SC", "Songti SC", "SimSun", serif`;
    case 'mono':
      return `${custom}ui-monospace, "Cascadia Mono", Consolas, monospace`;
    case 'system':
    default:
      return `${custom}"Inter", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif`;
  }
}

/**
 * Pure function: computes subtitle entrance transform, typewriter codepoint slicing,
 * typography metrics, and normalized pill color parameters for one FrameScene.
 */
export function resolveActiveSubtitleState(
  subtitle: FrameSubtitleScene | null | undefined,
  canvasWidth: number,
  canvasHeight: number
): SubtitleRenderState | null {
  if (!subtitle || typeof subtitle.text !== 'string' || subtitle.text.trim().length === 0) {
    return null;
  }

  const { width, height } = safeCanvasDimensions(canvasWidth, canvasHeight);
  const shortEdge = Math.min(width, height);
  const style = subtitle.style;
  const elapsed = Math.max(0, Number.isFinite(subtitle.elapsed) ? subtitle.elapsed : 0);
  const remaining = Math.max(0, Number.isFinite(subtitle.remaining) ? subtitle.remaining : 1);
  const totalDur = Math.max(0.05, elapsed + remaining);

  let opacity = 1;
  let offsetYPx = 0;
  let scale = 1;
  let visibleText = subtitle.text;

  const outFade = clamp(remaining / 0.16, 0, 1);

  switch (style.entrance) {
    case 'none': {
      opacity = 1;
      break;
    }
    case 'fade': {
      const inAlpha = clamp(elapsed / 0.22, 0, 1);
      opacity = Math.min(inAlpha, outFade);
      break;
    }
    case 'rise': {
      const t = clamp(elapsed / 0.26, 0, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      opacity = Math.min(eased, outFade);
      offsetYPx = (1 - eased) * Math.max(14, shortEdge * 0.026);
      break;
    }
    case 'pop': {
      const t = clamp(elapsed / 0.28, 0, 1);
      scale =
        t < 0.6
          ? 0.78 + (1.06 - 0.78) * (t / 0.6)
          : 1.06 - 0.06 * ((t - 0.6) / 0.4);
      opacity = Math.min(clamp(elapsed / 0.12, 0, 1), outFade);
      break;
    }
    case 'typewriter': {
      const chars = Array.from(subtitle.text);
      const revealDur = Math.min(0.65, totalDur * 0.6);
      const ratio = clamp(elapsed / Math.max(revealDur, 0.08), 0, 1);
      const visibleCount = Math.max(1, Math.ceil(chars.length * ratio));
      visibleText = chars.slice(0, visibleCount).join('');
      opacity = clamp(remaining / 0.14, 0, 1);
      break;
    }
  }

  const fontScale = clamp(Number.isFinite(style.fontScale) ? style.fontScale : 1, 0.5, 2.5);
  const fontSizePx = Math.max(14, Math.round(shortEdge * 0.036 * fontScale));
  const secondaryFontSizePx = Math.max(12, Math.round(fontSizePx * 0.74));
  const bottomMarginPx = clamp(Number.isFinite(style.bottomMargin) ? style.bottomMargin : 0.08, 0.02, 0.4) * height;
  const rgb = hexColorComponents(style.textColor);
  const secondaryText =
    style.showsSecondary && subtitle.secondaryText && subtitle.secondaryText.trim().length > 0
      ? subtitle.secondaryText.trim()
      : null;

  return {
    cueID: subtitle.cueID,
    visibleText,
    secondaryText,
    fontCssFamily: resolveSubtitleFontFamily(style.font, style.fontFamily),
    fontSizePx,
    secondaryFontSizePx,
    bold: Boolean(style.bold),
    bottomMarginPx,
    textColorRgb: [rgb.red, rgb.green, rgb.blue],
    backgroundOpacity: clamp(
      Number.isFinite(style.backgroundOpacity) ? style.backgroundOpacity : 0.62,
      0,
      1
    ),
    opacity: clamp(opacity, 0, 1),
    offsetYPx,
    scale,
    maxWidthPx: Math.round(width * 0.84),
    cornerRadiusPx: Math.max(10, Math.round(fontSizePx * 0.48)),
  };
}

const SUB_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_uv;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_uv = a_uv;
}
`;

const SUB_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_opacity;
out vec4 fragColor;
void main() {
  vec4 c = texture(u_tex, v_uv);
  fragColor = vec4(c.rgb, c.a * u_opacity);
}
`;

function wrapCanvasLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const paragraphs = text.split(/\r?\n/);
  const lines: string[] = [];
  for (const para of paragraphs) {
    if (!para) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const ch of Array.from(para)) {
      const candidate = current + ch;
      if (current.length > 0 && ctx.measureText(candidate).width > maxWidth) {
        lines.push(current);
        current = ch;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines.length > 0 ? lines : [text];
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rad = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

export class SubtitlePass {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;
  private readonly tex: WebGLTexture;
  private readonly uTex: WebGLUniformLocation | null;
  private readonly uOpacity: WebGLUniformLocation | null;
  private scratchCanvas: HTMLCanvasElement | null = null;
  private lastCacheKey = '';
  private cachedTexW = 1;
  private cachedTexH = 1;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, SUB_VERTEX_SHADER, SUB_FRAGMENT_SHADER);
    this.uTex = gl.getUniformLocation(this.program, 'u_tex');
    this.uOpacity = gl.getUniformLocation(this.program, 'u_opacity');
    this.tex = createTexture2D(gl, true);

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    if (!vao || !vbo) {
      throw new Error('Failed to create SubtitlePass buffers');
    }
    this.vao = vao;
    this.vbo = vbo;

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, 24 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 4 * 4, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 4 * 4, 2 * 4);
  }

  private ensureRasterized(state: SubtitleRenderState): void {
    const key = [
      state.cueID,
      state.visibleText,
      state.secondaryText ?? '',
      state.fontSizePx,
      state.fontCssFamily,
      state.bold ? '1' : '0',
      state.maxWidthPx,
      state.backgroundOpacity.toFixed(3),
      state.textColorRgb.map((c) => Math.round(c * 255)).join(','),
    ].join('|');

    if (key === this.lastCacheKey) {
      return;
    }

    if (!this.scratchCanvas && typeof document !== 'undefined') {
      this.scratchCanvas = document.createElement('canvas');
    }
    const c = this.scratchCanvas;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    const padX = Math.round(state.fontSizePx * 0.72);
    const padY = Math.round(state.fontSizePx * 0.42);
    const innerMaxW = Math.max(120, state.maxWidthPx - padX * 2);

    const primaryFont = `${state.bold ? '700 ' : '600 '}${state.fontSizePx}px ${state.fontCssFamily}`;
    const secondaryFont = `500 ${state.secondaryFontSizePx}px ${state.fontCssFamily}`;

    ctx.font = primaryFont;
    const primaryLines = wrapCanvasLines(ctx, state.visibleText, innerMaxW);
    const primaryLineH = Math.round(state.fontSizePx * 1.28);
    let maxLineW = 0;
    for (const ln of primaryLines) {
      maxLineW = Math.max(maxLineW, ctx.measureText(ln).width);
    }

    let secondaryLines: string[] = [];
    const secondaryLineH = Math.round(state.secondaryFontSizePx * 1.25);
    if (state.secondaryText) {
      ctx.font = secondaryFont;
      secondaryLines = wrapCanvasLines(ctx, state.secondaryText, innerMaxW);
      for (const ln of secondaryLines) {
        maxLineW = Math.max(maxLineW, ctx.measureText(ln).width);
      }
    }

    const gapY = secondaryLines.length > 0 ? Math.round(state.fontSizePx * 0.2) : 0;
    const boxW = Math.min(state.maxWidthPx, Math.ceil(maxLineW) + padX * 2);
    const boxH =
      padY * 2 +
      primaryLines.length * primaryLineH +
      gapY +
      secondaryLines.length * secondaryLineH;

    c.width = Math.max(4, boxW);
    c.height = Math.max(4, boxH);

    ctx.clearRect(0, 0, c.width, c.height);
    if (state.backgroundOpacity > 0.01) {
      drawRoundedRectPath(ctx, 0, 0, c.width, c.height, state.cornerRadiusPx);
      ctx.fillStyle = `rgba(18, 18, 20, ${state.backgroundOpacity.toFixed(3)})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(255, 255, 255, ${(state.backgroundOpacity * 0.16).toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    const [r, g, b] = state.textColorRgb.map((v) => Math.round(clamp(v, 0, 1) * 255));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;

    ctx.font = primaryFont;
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    let curY = padY;
    for (const ln of primaryLines) {
      ctx.fillText(ln, c.width * 0.5, curY);
      curY += primaryLineH;
    }

    if (secondaryLines.length > 0) {
      curY += gapY;
      ctx.font = secondaryFont;
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.84)`;
      for (const ln of secondaryLines) {
        ctx.fillText(ln, c.width * 0.5, curY);
        curY += secondaryLineH;
      }
    }

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);

    this.cachedTexW = c.width;
    this.cachedTexH = c.height;
    this.lastCacheKey = key;
  }

  render(scene: FrameScene, canvasWidth: number, canvasHeight: number): void {
    const state = resolveActiveSubtitleState(scene.subtitle, canvasWidth, canvasHeight);
    if (!state || state.opacity <= 0.002) return;

    this.ensureRasterized(state);
    if (this.cachedTexW <= 1 || this.cachedTexH <= 1) return;

    const { width, height } = safeCanvasDimensions(canvasWidth, canvasHeight);
    const drawW = this.cachedTexW * state.scale;
    const drawH = this.cachedTexH * state.scale;
    const cx = width * 0.5;
    const cy = height - state.bottomMarginPx - drawH * 0.5 + state.offsetYPx;

    const x0 = ((cx - drawW * 0.5) / width) * 2 - 1;
    const x1 = ((cx + drawW * 0.5) / width) * 2 - 1;
    const yTop = 1 - ((cy - drawH * 0.5) / height) * 2;
    const yBot = 1 - ((cy + drawH * 0.5) / height) * 2;

    const verts = new Float32Array([
      x0, yTop, 0, 0,
      x1, yTop, 1, 0,
      x1, yBot, 1, 1,
      x0, yTop, 0, 0,
      x1, yBot, 1, 1,
      x0, yBot, 0, 1,
    ]);

    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.uTex, 0);
    gl.uniform1f(this.uOpacity, state.opacity);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    this.gl.deleteTexture(this.tex);
    this.gl.deleteBuffer(this.vbo);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.program);
  }
}
