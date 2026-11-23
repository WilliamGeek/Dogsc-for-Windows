/**
 * web/passes/htmlMotion.ts
 *
 * WebGL2 HTML/SVG Motion Stickers (`.dmhtml` & built-in templates) Pass for DogSC Windows.
 * Windows counterpart of macOS SpriteKit / WKWebView motion templates:
 * - 5 built-in presets: `lower-third`, `keycap`, `callout`, `chapter`, `pill`
 * - Parses `.dmhtml` documents embedding `<!-- dogsc-motion-meta:{...} -->`
 * - Rasterizes glassmorphic vector cards to offscreen Canvas2D & composites in WebGL2 layerOrder
 * Strictly ZERO node:* imports and stripTypeScriptTypes compatible.
 */

import type { FrameAnimationScene, FrameScene } from '../../src/core/FrameScene.ts';
import type { AnimationPropertyValue } from '../../src/core/OverlayTimeline.ts';
import { createProgram, createTexture2D, safeCanvasDimensions } from './glUtils.ts';

export type HtmlMotionTemplateId = 'lower-third' | 'keycap' | 'callout' | 'chapter' | 'pill';

export interface HtmlMotionTemplateInfo {
  id: HtmlMotionTemplateId;
  label: string;
  defaultTitle: string;
  defaultSubtitle: string;
  defaultAccent: string;
  defaultX: number;
  defaultY: number;
  defaultWidth: number;
}

export const HTML_MOTION_TEMPLATES: readonly HtmlMotionTemplateInfo[] = Object.freeze([
  {
    id: 'lower-third',
    label: '左下标题条',
    defaultTitle: '关键功能演示',
    defaultSubtitle: 'DogSC Studio Windows',
    defaultAccent: '#da7a52',
    defaultX: 0.28,
    defaultY: 0.84,
    defaultWidth: 0.42,
  },
  {
    id: 'keycap',
    label: '快捷键徽章',
    defaultTitle: 'Ctrl + K',
    defaultSubtitle: '唤醒 AI 编辑助手',
    defaultAccent: '#6ea8fe',
    defaultX: 0.5,
    defaultY: 0.82,
    defaultWidth: 0.3,
  },
  {
    id: 'callout',
    label: '重点提示卡',
    defaultTitle: '性能提升 3.2×',
    defaultSubtitle: '端到端硬件直出编码',
    defaultAccent: '#48b878',
    defaultX: 0.5,
    defaultY: 0.22,
    defaultWidth: 0.4,
  },
  {
    id: 'chapter',
    label: '章节幕封卡',
    defaultTitle: 'PART 01 · 工作流架构',
    defaultSubtitle: '多轨协同与自动镜头追踪',
    defaultAccent: '#f59e0b',
    defaultX: 0.5,
    defaultY: 0.5,
    defaultWidth: 0.54,
  },
  {
    id: 'pill',
    label: '极简胶囊标签',
    defaultTitle: '60 FPS 实时渲染',
    defaultSubtitle: '',
    defaultAccent: '#da7a52',
    defaultX: 0.8,
    defaultY: 0.14,
    defaultWidth: 0.28,
  },
]);

export interface DmhtmlMeta {
  templateId: HtmlMotionTemplateId;
  title: string;
  subtitle: string;
  accent: string;
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(Math.max(v, lo), hi);
}

function escapeXml(str: string): string {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function normalizeTemplateId(raw: string | undefined): HtmlMotionTemplateId {
  switch (raw) {
    case 'lower-third':
    case 'keycap':
    case 'callout':
    case 'chapter':
    case 'pill':
      return raw;
    default:
      return 'callout';
  }
}

export function buildDmhtmlDocument(
  templateId: HtmlMotionTemplateId,
  props: { title: string; subtitle?: string; accent?: string }
): string {
  const safeTemplate = normalizeTemplateId(templateId);
  const tmpl = HTML_MOTION_TEMPLATES.find((t) => t.id === safeTemplate) ?? HTML_MOTION_TEMPLATES[2];
  const meta: DmhtmlMeta = {
    templateId: safeTemplate,
    title: props.title.trim() || tmpl.defaultTitle,
    subtitle: (props.subtitle ?? tmpl.defaultSubtitle).trim(),
    accent: (props.accent ?? tmpl.defaultAccent).trim() || tmpl.defaultAccent,
  };
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head><meta charset="utf-8" /></head>',
    `<!-- dogsc-motion-meta:${JSON.stringify(meta)} -->`,
    '<body>',
    `<div class="dogsc-motion" data-template="${escapeXml(meta.templateId)}">`,
    `  <span class="accent" style="background:${escapeXml(meta.accent)}"></span>`,
    `  <h1>${escapeXml(meta.title)}</h1>`,
    meta.subtitle ? `  <p>${escapeXml(meta.subtitle)}</p>` : '',
    '</div>',
    '</body></html>',
  ]
    .filter(Boolean)
    .join('\n');
}

export function parseDmhtmlMeta(html: string): DmhtmlMeta | null {
  const match = /<!--\s*dogsc-motion-meta:(\{[\s\S]*?\})\s*-->/.exec(html);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as Partial<DmhtmlMeta>;
    const templateId = normalizeTemplateId(parsed.templateId);
    const fallback = HTML_MOTION_TEMPLATES.find((t) => t.id === templateId)!;
    return {
      templateId,
      title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : fallback.defaultTitle,
      subtitle: typeof parsed.subtitle === 'string' ? parsed.subtitle.trim() : '',
      accent: typeof parsed.accent === 'string' && parsed.accent.trim() ? parsed.accent.trim() : fallback.defaultAccent,
    };
  } catch {
    return null;
  }
}

export function computeMotionEnvelope(
  localTime: number,
  durationHint: number = 3.0
): { opacity: number; scale: number; translateYNorm: number; progress: number } {
  const t = Math.max(0, Number.isFinite(localTime) ? localTime : 0);
  const enterT = clamp(t / 0.32, 0, 1);
  const eased = 1 - Math.pow(1 - enterT, 3);
  const total = Math.max(0.5, Number.isFinite(durationHint) ? durationHint : 3.0);
  return {
    opacity: clamp(eased, 0, 1),
    scale: 0.92 + 0.08 * eased,
    translateYNorm: (1 - eased) * 0.025,
    progress: clamp(t / total, 0, 1),
  };
}

function readStringProp(
  props: Record<string, AnimationPropertyValue>,
  key: string
): string | null {
  const v = props[key];
  if (v && v.kind === 'string' && v.value.trim().length > 0) {
    return v.value.trim();
  }
  return null;
}

export interface MotionClipRenderSpec {
  id: string;
  templateId: HtmlMotionTemplateId;
  title: string;
  subtitle: string;
  accent: string;
  centerPx: [number, number];
  widthPx: number;
  heightPx: number;
  opacity: number;
  scale: number;
}

export function resolveMotionClipRenderSpec(
  clip: FrameAnimationScene,
  canvasWidth: number,
  canvasHeight: number,
  dmhtmlOverride?: DmhtmlMeta | null
): MotionClipRenderSpec {
  const { width, height } = safeCanvasDimensions(canvasWidth, canvasHeight);
  const pathTpl = clip.sourcePath.startsWith('builtin://')
    ? clip.sourcePath.slice('builtin://'.length)
    : undefined;
  const templateId = normalizeTemplateId(
    dmhtmlOverride?.templateId ?? readStringProp(clip.properties, 'template') ?? pathTpl
  );
  const info = HTML_MOTION_TEMPLATES.find((t) => t.id === templateId) ?? HTML_MOTION_TEMPLATES[2];

  const title =
    readStringProp(clip.properties, 'title') ??
    clip.elementEdits?.title?.text ??
    dmhtmlOverride?.title ??
    info.defaultTitle;
  const subtitle =
    readStringProp(clip.properties, 'subtitle') ??
    clip.elementEdits?.subtitle?.text ??
    dmhtmlOverride?.subtitle ??
    '';
  const accent =
    readStringProp(clip.properties, 'accent') ??
    dmhtmlOverride?.accent ??
    info.defaultAccent;

  const env = computeMotionEnvelope(clip.localTime);
  const widthPx = Math.max(160, Math.round(clamp(clip.width, 0.12, 0.95) * width));
  const aspect =
    templateId === 'chapter'
      ? 2.8
      : templateId === 'pill'
        ? 4.6
        : templateId === 'keycap'
          ? 3.1
          : 3.6;
  const heightPx = Math.max(48, Math.round(widthPx / aspect));

  const cx = clamp(clip.position.x, 0.05, 0.95) * width;
  const cy = (clamp(clip.position.y, 0.05, 0.95) + env.translateYNorm) * height;

  return {
    id: clip.id,
    templateId,
    title,
    subtitle,
    accent,
    centerPx: [cx, cy],
    widthPx,
    heightPx,
    opacity: clamp(clip.opacity, 0, 1) * env.opacity,
    scale: env.scale,
  };
}

const MOTION_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_uv;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_uv = a_uv;
}
`;

const MOTION_FRAGMENT_SHADER = `#version 300 es
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

function roundedCardPath(
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

export class HtmlMotionPass {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;
  private readonly uTex: WebGLUniformLocation | null;
  private readonly uOpacity: WebGLUniformLocation | null;
  private readonly texCache = new Map<string, { key: string; tex: WebGLTexture }>();
  private scratchCanvas: HTMLCanvasElement | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, MOTION_VERTEX_SHADER, MOTION_FRAGMENT_SHADER);
    this.uTex = gl.getUniformLocation(this.program, 'u_tex');
    this.uOpacity = gl.getUniformLocation(this.program, 'u_opacity');

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    if (!vao || !vbo) {
      throw new Error('Failed to create HtmlMotionPass buffers');
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

  private getOrBuildTexture(spec: MotionClipRenderSpec): WebGLTexture | null {
    const key = `${spec.templateId}|${spec.title}|${spec.subtitle}|${spec.accent}|${spec.widthPx}x${spec.heightPx}`;
    const existing = this.texCache.get(spec.id);
    if (existing && existing.key === key) {
      return existing.tex;
    }

    if (!this.scratchCanvas && typeof document !== 'undefined') {
      this.scratchCanvas = document.createElement('canvas');
    }
    const c = this.scratchCanvas;
    if (!c) return null;
    const ctx = c.getContext('2d');
    if (!ctx) return null;

    const w = Math.max(64, spec.widthPx);
    const h = Math.max(32, spec.heightPx);
    c.width = w;
    c.height = h;
    ctx.clearRect(0, 0, w, h);

    const pad = Math.max(6, Math.round(h * 0.08));
    const iw = w - pad * 2;
    const ih = h - pad * 2;
    const rad = spec.templateId === 'pill' ? ih * 0.5 : Math.max(12, Math.round(ih * 0.16));

    // Drop shadow card base
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.42)';
    ctx.shadowBlur = Math.max(8, h * 0.12);
    ctx.shadowOffsetY = Math.max(3, h * 0.04);
    roundedCardPath(ctx, pad, pad, iw, ih, rad);
    ctx.fillStyle =
      spec.templateId === 'chapter'
        ? 'rgba(22, 22, 24, 0.92)'
        : 'rgba(28, 28, 30, 0.88)';
    ctx.fill();
    ctx.restore();

    // Subtle hairline highlight border
    roundedCardPath(ctx, pad, pad, iw, ih, rad);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = Math.max(1.5, h * 0.015);
    ctx.stroke();

    const titlePx = Math.max(14, Math.round(ih * (spec.subtitle ? 0.32 : 0.38)));
    const subPx = Math.max(11, Math.round(ih * 0.2));

    if (spec.templateId === 'lower-third') {
      const barW = Math.max(5, Math.round(w * 0.016));
      roundedCardPath(ctx, pad + 14, pad + ih * 0.18, barW, ih * 0.64, barW * 0.5);
      ctx.fillStyle = spec.accent;
      ctx.fill();

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${titlePx}px "Inter", "Microsoft YaHei UI", sans-serif`;
      ctx.fillStyle = '#f5f5f4';
      const tx = pad + 26 + barW;
      ctx.fillText(spec.title, tx, pad + ih * (spec.subtitle ? 0.38 : 0.5), iw - tx);

      if (spec.subtitle) {
        ctx.font = `500 ${subPx}px "Inter", "Microsoft YaHei UI", sans-serif`;
        ctx.fillStyle = 'rgba(228, 228, 224, 0.78)';
        ctx.fillText(spec.subtitle, tx, pad + ih * 0.68, iw - tx);
      }
    } else if (spec.templateId === 'keycap') {
      const keyW = Math.min(iw * 0.44, Math.max(ih * 0.9, spec.title.length * titlePx * 0.68 + 26));
      const keyH = ih * 0.64;
      const kx = pad + Math.round(ih * 0.22);
      const ky = pad + (ih - keyH) * 0.5;
      roundedCardPath(ctx, kx, ky, keyW, keyH, Math.max(8, keyH * 0.18));
      ctx.fillStyle = '#383836';
      ctx.fill();
      ctx.strokeStyle = spec.accent;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${Math.round(titlePx * 0.86)}px ui-monospace, Consolas, monospace`;
      ctx.fillStyle = '#fafaf9';
      ctx.fillText(spec.title, kx + keyW * 0.5, ky + keyH * 0.5, keyW - 12);

      if (spec.subtitle) {
        ctx.textAlign = 'left';
        ctx.font = `600 ${Math.round(subPx * 1.15)}px "Inter", "Microsoft YaHei UI", sans-serif`;
        ctx.fillStyle = '#e7e5e4';
        const sx = kx + keyW + 16;
        ctx.fillText(spec.subtitle, sx, pad + ih * 0.5, pad + iw - sx - 12);
      }
    } else {
      // callout, chapter, pill
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (spec.templateId === 'pill') {
        const dotR = Math.max(4, Math.round(ih * 0.14));
        ctx.beginPath();
        ctx.arc(pad + ih * 0.42, pad + ih * 0.5, dotR, 0, Math.PI * 2);
        ctx.fillStyle = spec.accent;
        ctx.fill();
      } else {
        const pillBarW = Math.min(iw * 0.24, 72);
        roundedCardPath(ctx, pad + (iw - pillBarW) * 0.5, pad + 8, pillBarW, 4, 2);
        ctx.fillStyle = spec.accent;
        ctx.fill();
      }

      ctx.font = `700 ${titlePx}px "Inter", "Microsoft YaHei UI", sans-serif`;
      ctx.fillStyle = '#fafaf9';
      const titleY = pad + ih * (spec.subtitle ? 0.42 : 0.52);
      ctx.fillText(spec.title, w * 0.5, titleY, iw - 28);

      if (spec.subtitle) {
        ctx.font = `500 ${subPx}px "Inter", "Microsoft YaHei UI", sans-serif`;
        ctx.fillStyle = 'rgba(228, 228, 224, 0.8)';
        ctx.fillText(spec.subtitle, w * 0.5, pad + ih * 0.72, iw - 28);
      }
    }

    const gl = this.gl;
    const tex = existing?.tex ?? createTexture2D(gl, true);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    this.texCache.set(spec.id, { key, tex });
    return tex;
  }

  render(
    scene: FrameScene,
    canvasWidth: number,
    canvasHeight: number,
    dmhtmlDocsByPath?: ReadonlyMap<string, string>
  ): void {
    const clips = scene.animations;
    if (!Array.isArray(clips) || clips.length === 0) return;

    const gl = this.gl;
    const { width, height } = safeCanvasDimensions(canvasWidth, canvasHeight);
    const ordered = clips.slice().sort((a, b) => a.layerIndex - b.layerIndex);

    for (const clip of ordered) {
      const docHtml = dmhtmlDocsByPath?.get(clip.sourcePath);
      const dmMeta = docHtml ? parseDmhtmlMeta(docHtml) : null;
      const spec = resolveMotionClipRenderSpec(clip, width, height, dmMeta);
      if (spec.opacity <= 0.002) continue;

      const tex = this.getOrBuildTexture(spec);
      if (!tex) continue;

      const drawW = spec.widthPx * spec.scale;
      const drawH = spec.heightPx * spec.scale;
      const [cx, cy] = spec.centerPx;

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

      gl.useProgram(this.program);
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(this.uTex, 0);
      gl.uniform1f(this.uOpacity, spec.opacity);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  dispose(): void {
    for (const entry of this.texCache.values()) {
      this.gl.deleteTexture(entry.tex);
    }
    this.texCache.clear();
    this.gl.deleteBuffer(this.vbo);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.program);
  }
}
