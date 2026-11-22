/**
 * web/passes/stickers.ts
 *
 * WebGL2 Sticker overlay pass & Anti-Bleed BackdropBlurRelay offscreen FBO pipeline.
 * Browser ESM & Node 24 strip-types compatible (NO node:* imports, NO enum/namespace).
 */

import type { FrameScene, FrameStickerScene } from '../../src/core/FrameScene.ts';
import { hexColorComponents } from '../../src/core/HexColor.ts';
import type { FrameStickerBackdropScene } from '../../src/core/StickerTransition.ts';
import {
  FULLSCREEN_QUAD_VERTS,
  createOffscreenTarget,
  createProgram,
  createTexture2D,
  safeCanvasDimensions,
  type OffscreenRenderTarget,
} from './glUtils.ts';

export type StickerBlurStage = 'none' | 'beforeCamera' | 'beforeStickers';

export interface StickerDrawItem {
  id: string;
  relativePath: string;
  layerIndex: number;
  centerPx: [number, number];
  sizePx: [number, number];
  rotationRadians: number;
  opacity: number;
  cornerRadius: number;
  borderWidth: number;
  borderColor: [number, number, number, number];
  shadow: {
    opacity: number;
    radius: number;
    offset: [number, number];
  } | null;
}

export interface StickerRenderPlan {
  blurStage: StickerBlurStage;
  blurRadiusPx: number;
  items: StickerDrawItem[];
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Pure function: computes sorted sticker draw items & anti-bleed FBO blur stage
 * from FrameScene.stickers and FrameScene.stickerBackdrop.
 */
export function computeStickerRenderPlan(
  scene: Pick<FrameScene, 'stickers' | 'stickerBackdrop'>,
  canvasWidth: number,
  canvasHeight: number,
  aspectRatiosById?: Record<string, number>
): StickerRenderPlan {
  const { width, height } = safeCanvasDimensions(canvasWidth, canvasHeight);
  const styleScale = Math.max(Math.min(width, height), 1) / 1080;

  const backdrop: FrameStickerBackdropScene | undefined = scene.stickerBackdrop;
  const screenBlur = Number.isFinite(backdrop?.screenBlur)
    ? Math.max(backdrop!.screenBlur, 0)
    : 0;
  const cameraBlur = Number.isFinite(backdrop?.cameraBlur)
    ? Math.max(backdrop!.cameraBlur, 0)
    : 0;

  let blurStage: StickerBlurStage = 'none';
  let blurRadiusPx = 0;
  if (cameraBlur > 0.01) {
    blurStage = 'beforeStickers';
    blurRadiusPx = Math.max(screenBlur, cameraBlur) * styleScale;
  } else if (screenBlur > 0.01) {
    blurStage = 'beforeCamera';
    blurRadiusPx = screenBlur * styleScale;
  }

  const activeStickers = scene.stickers
    .filter((s: FrameStickerScene) => {
      const op = Number.isFinite(s.opacity) ? s.opacity : 0;
      const sc = Number.isFinite(s.scale) ? s.scale : 0;
      const wd = Number.isFinite(s.width) ? s.width : 0;
      return op > 0.001 && sc > 0.001 && wd > 0.001;
    })
    .slice()
    .sort((a, b) => {
      if (a.layerIndex !== b.layerIndex) {
        return a.layerIndex - b.layerIndex;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  const items: StickerDrawItem[] = activeStickers.map((s) => {
    const rawAspect =
      aspectRatiosById?.[s.id] ?? aspectRatiosById?.[s.relativePath] ?? 1.0;
    const safeAspect = Number.isFinite(rawAspect) ? Math.max(rawAspect, 0.05) : 1.0;
    const wPx = Math.max(s.width * width * s.scale, 1);
    const hPx = Math.max(wPx / safeAspect, 1);
    const shortEdge = Math.min(wPx, hPx);

    const cx = (s.position.x + s.offset.x) * width;
    const cy = (s.position.y + s.offset.y) * height;
    const cornerRadius = Math.min(
      Math.max(Number.isFinite(s.cornerRadius) ? s.cornerRadius * styleScale * s.scale : 0, 0),
      shortEdge * 0.5
    );
    const borderWidth = Math.max(
      Number.isFinite(s.borderWidth) ? s.borderWidth * styleScale * s.scale : 0,
      0
    );
    const bRgb = hexColorComponents(s.borderColor);
    const shadowOpacity = clamp(s.shadowOpacity, 0, 1);
    const shadow =
      shadowOpacity > 0.001
        ? {
            opacity: shadowOpacity,
            radius: Math.max(
              Number.isFinite(s.shadowRadius) ? s.shadowRadius * styleScale * s.scale : 0,
              0
            ),
            offset: [
              Number.isFinite(s.shadowOffset.x) ? s.shadowOffset.x * styleScale : 0,
              Number.isFinite(s.shadowOffset.y) ? s.shadowOffset.y * styleScale : 0,
            ] as [number, number],
          }
        : null;

    return {
      id: s.id,
      relativePath: s.relativePath,
      layerIndex: s.layerIndex,
      centerPx: [cx, cy],
      sizePx: [wPx, hPx],
      rotationRadians: Number.isFinite(s.rotationRadians) ? s.rotationRadians : 0,
      opacity: clamp(s.opacity, 0, 1),
      cornerRadius,
      borderWidth,
      borderColor: [bRgb.red, bRgb.green, bRgb.blue, borderWidth > 0 ? 1.0 : 0.0],
      shadow,
    };
  });

  return {
    blurStage,
    blurRadiusPx,
    items,
  };
}

/**
 * Pure function: builds interleaved [ndcX, ndcY, u, v] vertices (24 floats)
 * for a quad centered at `centerPx` and rotated by `rotationRadians`.
 * Optional `marginPx > 0` expands the quad for SDF shadow evaluation while keeping
 * un-margined card bounds mapped cleanly to `[0, 1]` UV space.
 */
export function buildRotatedQuadVertices(
  centerPx: [number, number],
  sizePx: [number, number],
  rotationRadians: number,
  canvasWidth: number,
  canvasHeight: number,
  marginPx: number = 0
): Float32Array {
  const { width: safeW, height: safeH } = safeCanvasDimensions(canvasWidth, canvasHeight);
  const w = Math.max(sizePx[0], 1);
  const h = Math.max(sizePx[1], 1);
  const margin = Number.isFinite(marginPx) ? Math.max(marginPx, 0) : 0;

  const hx = w * 0.5 + margin;
  const hy = h * 0.5 + margin;
  const u0 = -margin / w;
  const u1 = 1 + margin / w;
  const v0 = -margin / h;
  const v1 = 1 + margin / h;

  const rot = Number.isFinite(rotationRadians) ? rotationRadians : 0;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  const cx = centerPx[0];
  const cy = centerPx[1];

  const toNdc = (lx: number, ly: number): [number, number] => {
    const rx = lx * cosR - ly * sinR;
    const ry = lx * sinR + ly * cosR;
    const px = cx + rx;
    const py = cy + ry;
    return [(px / safeW) * 2 - 1, 1 - (py / safeH) * 2];
  };

  const p0 = toNdc(-hx, -hy);
  const p1 = toNdc(hx, -hy);
  const p2 = toNdc(hx, hy);
  const p3 = toNdc(-hx, hy);

  return new Float32Array([
    p0[0], p0[1], u0, v0,
    p1[0], p1[1], u1, v0,
    p2[0], p2[1], u1, v1,
    p0[0], p0[1], u0, v0,
    p2[0], p2[1], u1, v1,
    p3[0], p3[1], u0, v1,
  ]);
}

export const BLUR_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_uv = a_pos * 0.5 + 0.5;
}
`;

export const SEPARABLE_BLUR_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_direction;
uniform float u_blurRadius;
out vec4 fragColor;

void main() {
  float r = max(u_blurRadius, 0.0);
  if (r <= 0.01) {
    fragColor = texture(u_tex, v_uv);
    return;
  }
  vec2 stepUv = u_direction * (r / 4.0);
  vec3 sum = vec3(0.0);
  float weights[9] = float[9](0.048, 0.089, 0.135, 0.168, 0.180, 0.168, 0.135, 0.089, 0.048);
  float wSum = 0.0;
  for (int i = -4; i <= 4; i++) {
    float w = weights[i + 4];
    vec2 uv = clamp(v_uv + stepUv * float(i), vec2(0.0), vec2(1.0));
    sum += texture(u_tex, uv).rgb * w;
    wSum += w;
  }
  fragColor = vec4(sum / max(wSum, 0.0001), 1.0);
}
`;

/**
 * Two-pass separable Gaussian blur FBO relay so stickers can blur underlying
 * layers without background transparency bleed during transitions.
 */
export class BackdropBlurRelay {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;
  private readonly uTex: WebGLUniformLocation | null;
  private readonly uDirection: WebGLUniformLocation | null;
  private readonly uBlurRadius: WebGLUniformLocation | null;

  private sceneTarget: OffscreenRenderTarget | null = null;
  private tempTarget: OffscreenRenderTarget | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, BLUR_VERTEX_SHADER, SEPARABLE_BLUR_FRAGMENT_SHADER);
    this.uTex = gl.getUniformLocation(this.program, 'u_tex');
    this.uDirection = gl.getUniformLocation(this.program, 'u_direction');
    this.uBlurRadius = gl.getUniformLocation(this.program, 'u_blurRadius');

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    if (!vao || !vbo) {
      throw new Error('Failed to create BackdropBlurRelay vertex buffers');
    }
    this.vao = vao;
    this.vbo = vbo;

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_QUAD_VERTS, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 2 * 4, 0);
  }

  private ensureTargets(width: number, height: number): void {
    const { width: safeW, height: safeH } = safeCanvasDimensions(width, height);
    if (!this.sceneTarget) {
      this.sceneTarget = createOffscreenTarget(this.gl, safeW, safeH);
    } else {
      this.sceneTarget.resize(safeW, safeH);
    }
    if (!this.tempTarget) {
      this.tempTarget = createOffscreenTarget(this.gl, safeW, safeH);
    } else {
      this.tempTarget.resize(safeW, safeH);
    }
  }

  beginCapture(width: number, height: number): void {
    const gl = this.gl;
    this.ensureTargets(width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneTarget!.fbo);
    gl.viewport(0, 0, this.sceneTarget!.width, this.sceneTarget!.height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  flushBlurredToScreen(width: number, height: number, blurRadiusPx: number): void {
    const gl = this.gl;
    if (!this.sceneTarget || !this.tempTarget) return;
    const { width: safeW, height: safeH } = safeCanvasDimensions(width, height);
    const radius = Number.isFinite(blurRadiusPx) ? Math.max(blurRadiusPx, 0) : 0;

    gl.disable(gl.BLEND);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.uTex, 0);
    gl.uniform1f(this.uBlurRadius, radius);

    // Horizontal pass: sceneTarget -> tempTarget
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.tempTarget.fbo);
    gl.viewport(0, 0, this.tempTarget.width, this.tempTarget.height);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTarget.texture);
    gl.uniform2f(this.uDirection, 1 / Math.max(this.sceneTarget.width, 1), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Vertical pass: tempTarget -> default framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, safeW, safeH);
    gl.bindTexture(gl.TEXTURE_2D, this.tempTarget.texture);
    gl.uniform2f(this.uDirection, 0, 1 / Math.max(this.tempTarget.height, 1));
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  dispose(): void {
    this.sceneTarget?.dispose();
    this.tempTarget?.dispose();
    this.gl.deleteBuffer(this.vbo);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.program);
  }
}

export const STICKER_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_ndc;
layout(location = 1) in vec2 a_uv;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_ndc, 0.0, 1.0);
  v_uv = a_uv;
}
`;

export const STICKER_SHADOW_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec2 u_size;
uniform float u_cornerRadius;
uniform vec2 u_shadowOffset;
uniform float u_shadowRadius;
uniform vec4 u_shadowColor;
out vec4 fragColor;

float sdRoundedBox(vec2 p, vec2 b, float r) {
  float clampedR = min(r, min(b.x, b.y));
  vec2 q = abs(p) - b + clampedR;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - clampedR;
}

void main() {
  vec2 localPos = v_uv * u_size - u_shadowOffset;
  float dist = sdRoundedBox(localPos - 0.5 * u_size, 0.5 * u_size, u_cornerRadius);
  float alpha = u_shadowColor.a * (1.0 - smoothstep(-u_shadowRadius * 0.25, max(u_shadowRadius * 1.35, 1.0), dist));
  if (alpha <= 0.001) {
    discard;
  }
  fragColor = vec4(u_shadowColor.rgb, alpha);
}
`;

export const STICKER_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_stickerTex;
uniform vec2 u_size;
uniform float u_cornerRadius;
uniform float u_borderWidth;
uniform vec4 u_borderColor;
uniform float u_opacity;
out vec4 fragColor;

float sdRoundedBox(vec2 p, vec2 b, float r) {
  float clampedR = min(r, min(b.x, b.y));
  vec2 q = abs(p) - b + clampedR;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - clampedR;
}

void main() {
  vec2 p = v_uv * u_size - 0.5 * u_size;
  vec2 b = 0.5 * u_size;
  float dist = sdRoundedBox(p, b, u_cornerRadius);
  float outerAlpha = 1.0 - smoothstep(-0.75, 0.75, dist);
  if (outerAlpha <= 0.001) {
    discard;
  }

  vec4 sampled = texture(u_stickerTex, clamp(v_uv, 0.0, 1.0));
  vec3 outColor = sampled.rgb;
  if (u_borderWidth > 0.0 && u_borderColor.a > 0.0) {
    float borderMask = smoothstep(-u_borderWidth - 0.75, -u_borderWidth + 0.75, dist);
    outColor = mix(outColor, u_borderColor.rgb, borderMask * u_borderColor.a);
  }

  fragColor = vec4(outColor, outerAlpha * sampled.a * u_opacity);
}
`;

function createFallbackStickerData(size: number): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const ny = y / (size - 1);
    for (let x = 0; x < size; x++) {
      const nx = x / (size - 1);
      const r = Math.round(56 + nx * 136);
      const g = Math.round(130 + (1 - ny) * 80);
      const b = Math.round(215 + ny * 35);
      const idx = (y * size + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  return data;
}

export class StickerPass {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly shadowProgram: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;
  private readonly fallbackTex: WebGLTexture;

  private readonly uStickerTex: WebGLUniformLocation | null;
  private readonly uSize: WebGLUniformLocation | null;
  private readonly uCornerRadius: WebGLUniformLocation | null;
  private readonly uBorderWidth: WebGLUniformLocation | null;
  private readonly uBorderColor: WebGLUniformLocation | null;
  private readonly uOpacity: WebGLUniformLocation | null;

  private readonly uShadowSize: WebGLUniformLocation | null;
  private readonly uShadowCornerRadius: WebGLUniformLocation | null;
  private readonly uShadowOffset: WebGLUniformLocation | null;
  private readonly uShadowRadius: WebGLUniformLocation | null;
  private readonly uShadowColor: WebGLUniformLocation | null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, STICKER_VERTEX_SHADER, STICKER_FRAGMENT_SHADER);
    this.uStickerTex = gl.getUniformLocation(this.program, 'u_stickerTex');
    this.uSize = gl.getUniformLocation(this.program, 'u_size');
    this.uCornerRadius = gl.getUniformLocation(this.program, 'u_cornerRadius');
    this.uBorderWidth = gl.getUniformLocation(this.program, 'u_borderWidth');
    this.uBorderColor = gl.getUniformLocation(this.program, 'u_borderColor');
    this.uOpacity = gl.getUniformLocation(this.program, 'u_opacity');

    this.shadowProgram = createProgram(gl, STICKER_VERTEX_SHADER, STICKER_SHADOW_FRAGMENT_SHADER);
    this.uShadowSize = gl.getUniformLocation(this.shadowProgram, 'u_size');
    this.uShadowCornerRadius = gl.getUniformLocation(this.shadowProgram, 'u_cornerRadius');
    this.uShadowOffset = gl.getUniformLocation(this.shadowProgram, 'u_shadowOffset');
    this.uShadowRadius = gl.getUniformLocation(this.shadowProgram, 'u_shadowRadius');
    this.uShadowColor = gl.getUniformLocation(this.shadowProgram, 'u_shadowColor');

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    if (!vao || !vbo) {
      throw new Error('Failed to create StickerPass vertex buffers');
    }
    this.vao = vao;
    this.vbo = vbo;

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, 24 * 4, gl.DYNAMIC_DRAW);
    const stride = 4 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 2 * 4);

    const fbSize = 64;
    this.fallbackTex = createTexture2D(gl, true);
    gl.bindTexture(gl.TEXTURE_2D, this.fallbackTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      fbSize,
      fbSize,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      createFallbackStickerData(fbSize)
    );
  }

  render(
    scene: FrameScene,
    canvasWidth: number,
    canvasHeight: number,
    texturesByPath?: ReadonlyMap<string, WebGLTexture>,
    aspectRatiosById?: Record<string, number>
  ): void {
    const plan = computeStickerRenderPlan(
      scene,
      canvasWidth,
      canvasHeight,
      aspectRatiosById
    );
    if (plan.items.length === 0) {
      return;
    }

    const gl = this.gl;
    const { width, height } = safeCanvasDimensions(canvasWidth, canvasHeight);

    for (const item of plan.items) {
      if (item.shadow && item.shadow.opacity > 0.001) {
        const margin =
          item.shadow.radius * 2.5 +
          Math.max(Math.abs(item.shadow.offset[0]), Math.abs(item.shadow.offset[1])) +
          8;
        const shadowVerts = buildRotatedQuadVertices(
          item.centerPx,
          item.sizePx,
          item.rotationRadians,
          width,
          height,
          margin
        );
        gl.useProgram(this.shadowProgram);
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, shadowVerts);

        gl.uniform2f(this.uShadowSize, item.sizePx[0], item.sizePx[1]);
        gl.uniform1f(this.uShadowCornerRadius, item.cornerRadius);
        gl.uniform2f(this.uShadowOffset, item.shadow.offset[0], item.shadow.offset[1]);
        gl.uniform1f(this.uShadowRadius, item.shadow.radius);
        gl.uniform4f(this.uShadowColor, 0, 0, 0, item.shadow.opacity * item.opacity);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }

      const quadVerts = buildRotatedQuadVertices(
        item.centerPx,
        item.sizePx,
        item.rotationRadians,
        width,
        height
      );
      const tex =
        texturesByPath?.get(item.id) ??
        texturesByPath?.get(item.relativePath) ??
        this.fallbackTex;

      gl.useProgram(this.program);
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, quadVerts);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(this.uStickerTex, 0);
      gl.uniform2f(this.uSize, item.sizePx[0], item.sizePx[1]);
      gl.uniform1f(this.uCornerRadius, item.cornerRadius);
      gl.uniform1f(this.uBorderWidth, item.borderWidth);
      gl.uniform4f(this.uBorderColor, ...item.borderColor);
      gl.uniform1f(this.uOpacity, item.opacity);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  dispose(): void {
    this.gl.deleteTexture(this.fallbackTex);
    this.gl.deleteBuffer(this.vbo);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.program);
    this.gl.deleteProgram(this.shadowProgram);
  }
}
