/**
 * web/passes/spotlight.ts
 *
 * Pure uniform builders & CPU/WebGL2 evaluators for Screen Mosaic ('blur' pixelate/blur)
 * and 3D-perspective-aligned Spotlight dimming cutouts ('spotlight').
 * Browser ESM & Node 24 strip-types compatible (NO node:* imports, NO enum/namespace).
 */

import type {
  FrameScene,
  FrameScreenScene,
} from '../../src/core/FrameScene.ts';
import type { FrameStickerBackdropScene } from '../../src/core/StickerTransition.ts';
import {
  SCREEN_VERTEX_SHADER,
  buildProjectedQuadVertices,
  computeEffectiveScreenOpacity,
  computeScreenShaderUniforms,
  createProgram,
  safeCanvasDimensions,
} from './glUtils.ts';
import { computeChromePassGeometry } from './chrome.ts';

export const MAX_BLUR_MOSAICS = 8;
export const MAX_SPOTLIGHT_REGIONS = 8;

export interface BlurMosaicUniform {
  rect: [number, number, number, number];
  cornerRadius: number;
  intensity: number;
  transitionProgress: number;
  effectiveStrength: number;
}

export interface BlurMosaicUniformBatch {
  count: number;
  items: BlurMosaicUniform[];
  rectsFlat: Float32Array;
  paramsFlat: Float32Array;
}

export interface SpotlightRegionUniform {
  rect: [number, number, number, number];
  cornerRadius: number;
  dimming: number;
  transitionProgress: number;
}

export interface SpotlightPassUniforms {
  count: number;
  dimmingAlpha: number;
  opacity: number;
  screenSize: [number, number];
  cornerRadius: number;
  sourceCrop: [number, number, number, number];
  rectsFlat: Float32Array;
  paramsFlat: Float32Array;
  regions: SpotlightRegionUniform[];
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(Math.max(v, lo), hi);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function sdRoundedBox2D(px: number, py: number, bx: number, by: number, r: number): number {
  const clampedR = Math.min(r, Math.min(bx, by));
  const qx = Math.abs(px) - bx + clampedR;
  const qy = Math.abs(py) - by + clampedR;
  const inside = Math.min(Math.max(qx, qy), 0);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return inside + outside - clampedR;
}

/**
 * Pure function: extracts up to MAX_BLUR_MOSAICS active 'blur' mosaics into
 * GPU-ready typed uniform buffers.
 */
export function computeBlurMosaicUniforms(screen: FrameScreenScene): BlurMosaicUniformBatch {
  const items: BlurMosaicUniform[] = [];
  for (const m of screen.mosaics) {
    if (m.style !== 'blur') continue;
    const progress = clamp(m.transitionProgress, 0, 1);
    const intensity = clamp(m.intensity, 0, 1);
    if (progress <= 0.001 || intensity <= 0.001) continue;
    const rx = clamp(m.sourceRect.x, 0, 1);
    const ry = clamp(m.sourceRect.y, 0, 1);
    const rw = clamp(m.sourceRect.width, 0.001, 1 - rx);
    const rh = clamp(m.sourceRect.height, 0.001, 1 - ry);
    const cornerRadius = clamp(m.cornerRadius, 0, 0.5);
    items.push({
      rect: [rx, ry, rw, rh],
      cornerRadius,
      intensity,
      transitionProgress: progress,
      effectiveStrength: intensity * progress,
    });
    if (items.length >= MAX_BLUR_MOSAICS) break;
  }

  const rectsFlat = new Float32Array(MAX_BLUR_MOSAICS * 4);
  const paramsFlat = new Float32Array(MAX_BLUR_MOSAICS * 4);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    rectsFlat.set(it.rect, i * 4);
    paramsFlat[i * 4] = it.cornerRadius;
    paramsFlat[i * 4 + 1] = it.intensity;
    paramsFlat[i * 4 + 2] = it.transitionProgress;
    paramsFlat[i * 4 + 3] = it.effectiveStrength;
  }

  return {
    count: items.length,
    items,
    rectsFlat,
    paramsFlat,
  };
}

/**
 * Pure function: computes SpotlightPass uniforms from active 'spotlight' regions
 * on `screen` and sticker suppression on `backdrop`.
 * Returns null when no active spotlight or effective opacity/dimming is zero.
 */
export function computeSpotlightPassUniforms(
  screen: FrameScreenScene,
  backdrop?: FrameStickerBackdropScene | null
): SpotlightPassUniforms | null {
  const effectiveOpacity = computeEffectiveScreenOpacity(screen, backdrop);
  if (effectiveOpacity <= 0.001) {
    return null;
  }

  const regions: SpotlightRegionUniform[] = [];
  let maxDimmingAlpha = 0;

  for (const m of screen.mosaics) {
    if (m.style !== 'spotlight') continue;
    const progress = clamp(m.transitionProgress, 0, 1);
    if (progress <= 0.001) continue;
    const dimming = clamp(m.spotlightDimming, 0, 0.75);
    const rx = clamp(m.sourceRect.x, 0, 1);
    const ry = clamp(m.sourceRect.y, 0, 1);
    const rw = clamp(m.sourceRect.width, 0.001, 1 - rx);
    const rh = clamp(m.sourceRect.height, 0.001, 1 - ry);
    const cornerRadius = clamp(m.cornerRadius, 0, 0.5);

    maxDimmingAlpha = Math.max(maxDimmingAlpha, dimming * progress);
    regions.push({
      rect: [rx, ry, rw, rh],
      cornerRadius,
      dimming,
      transitionProgress: progress,
    });
    if (regions.length >= MAX_SPOTLIGHT_REGIONS) break;
  }

  if (regions.length === 0 || maxDimmingAlpha <= 0.001) {
    return null;
  }

  const chrome =
    screen.decoration.kind === 'chrome' ? screen.decoration.chrome : null;
  const screenUniforms = computeScreenShaderUniforms(screen);
  const screenSize: [number, number] = chrome
    ? [Math.max(chrome.contentRect.width, 1), Math.max(chrome.contentRect.height, 1)]
    : screenUniforms.screenSize;
  const cornerRadius = chrome
    ? Math.max(chrome.contentCornerRadius, 0)
    : screenUniforms.cornerRadius;
  const rectsFlat = new Float32Array(MAX_SPOTLIGHT_REGIONS * 4);
  const paramsFlat = new Float32Array(MAX_SPOTLIGHT_REGIONS * 4);
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    rectsFlat.set(r.rect, i * 4);
    paramsFlat[i * 4] = r.cornerRadius;
    paramsFlat[i * 4 + 1] = r.dimming;
    paramsFlat[i * 4 + 2] = r.transitionProgress;
    paramsFlat[i * 4 + 3] = 0;
  }

  return {
    count: regions.length,
    dimmingAlpha: maxDimmingAlpha,
    opacity: effectiveOpacity,
    screenSize,
    cornerRadius,
    sourceCrop: [
      screen.sourceCrop.x,
      screen.sourceCrop.y,
      screen.sourceCrop.width,
      screen.sourceCrop.height,
    ],
    rectsFlat,
    paramsFlat,
    regions,
  };
}

/**
 * Pure CPU mirror of the GLSL rounded-rect cutout union mask:
 * returns 0.0 inside any bright spotlight cutout and 1.0 strictly outside all cutouts,
 * with smooth anti-aliased edge transition matching the shader.
 */
export function evaluateSpotlightOutsideMask(
  u: number,
  v: number,
  screenSize: [number, number],
  regions: readonly SpotlightRegionUniform[]
): number {
  if (regions.length === 0) return 0;
  const sw = Math.max(Number.isFinite(screenSize[0]) ? screenSize[0] : 1, 1);
  const sh = Math.max(Number.isFinite(screenSize[1]) ? screenSize[1] : 1, 1);

  let outsideMask = 1.0;
  for (const region of regions) {
    const [rx, ry, rw, rh] = region.rect;
    const cx = rx + rw * 0.5;
    const cy = ry + rh * 0.5;
    const px = (u - cx) * sw;
    const py = (v - cy) * sh;
    const bx = 0.5 * rw * sw;
    const by = 0.5 * rh * sh;
    const radPx = region.cornerRadius * Math.min(rw * sw, rh * sh);
    const dist = sdRoundedBox2D(px, py, bx, by, radPx);
    const regionOutside = smoothstep(-0.75, 0.75, dist);
    outsideMask = Math.min(outsideMask, regionOutside);
  }
  return outsideMask;
}

export const SPOTLIGHT_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec2 u_screenSize;
uniform float u_cornerRadius;
uniform vec4 u_sourceCrop;
uniform float u_dimmingAlpha;
uniform float u_opacity;
uniform int u_spotlightCount;
uniform vec4 u_spotlightRects[${MAX_SPOTLIGHT_REGIONS}];
uniform vec4 u_spotlightParams[${MAX_SPOTLIGHT_REGIONS}];
out vec4 fragColor;

float sdRoundedBox(vec2 p, vec2 b, float r) {
  float clampedR = min(r, min(b.x, b.y));
  vec2 q = abs(p) - b + clampedR;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - clampedR;
}

void main() {
  if (u_spotlightCount <= 0 || u_dimmingAlpha <= 0.001 || u_opacity <= 0.001) {
    discard;
  }

  vec2 p = v_uv * u_screenSize - 0.5 * u_screenSize;
  vec2 b = 0.5 * u_screenSize;
  float screenDist = sdRoundedBox(p, b, u_cornerRadius);
  float screenMask = 1.0 - smoothstep(-0.75, 0.75, screenDist);
  if (screenMask <= 0.001) {
    discard;
  }

  vec2 croppedUV = u_sourceCrop.xy + clamp(v_uv, 0.0, 1.0) * u_sourceCrop.zw;
  vec2 sourceSize = u_screenSize / max(u_sourceCrop.zw, vec2(0.001));

  float outsideMask = 1.0;
  for (int i = 0; i < ${MAX_SPOTLIGHT_REGIONS}; i++) {
    if (i >= u_spotlightCount) break;
    vec4 r = u_spotlightRects[i];
    vec4 param = u_spotlightParams[i];
    vec2 center = r.xy + 0.5 * r.zw;
    vec2 localP = (croppedUV - center) * sourceSize;
    vec2 halfB = 0.5 * r.zw * sourceSize;
    float radPx = param.x * min(r.z * sourceSize.x, r.w * sourceSize.y);
    float dist = sdRoundedBox(localP, halfB, radPx);
    float regionOutside = smoothstep(-0.75, 0.75, dist);
    outsideMask = min(outsideMask, regionOutside);
  }

  float finalAlpha = u_dimmingAlpha * outsideMask * screenMask * u_opacity;
  if (finalAlpha <= 0.001) {
    discard;
  }
  fragColor = vec4(0.0, 0.0, 0.0, finalAlpha);
}
`;

export class SpotlightPass {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;

  private readonly uScreenSize: WebGLUniformLocation | null;
  private readonly uCornerRadius: WebGLUniformLocation | null;
  private readonly uSourceCrop: WebGLUniformLocation | null;
  private readonly uDimmingAlpha: WebGLUniformLocation | null;
  private readonly uOpacity: WebGLUniformLocation | null;
  private readonly uSpotlightCount: WebGLUniformLocation | null;
  private readonly uSpotlightRects: WebGLUniformLocation | null;
  private readonly uSpotlightParams: WebGLUniformLocation | null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, SCREEN_VERTEX_SHADER, SPOTLIGHT_FRAGMENT_SHADER);
    this.uScreenSize = gl.getUniformLocation(this.program, 'u_screenSize');
    this.uCornerRadius = gl.getUniformLocation(this.program, 'u_cornerRadius');
    this.uSourceCrop = gl.getUniformLocation(this.program, 'u_sourceCrop');
    this.uDimmingAlpha = gl.getUniformLocation(this.program, 'u_dimmingAlpha');
    this.uOpacity = gl.getUniformLocation(this.program, 'u_opacity');
    this.uSpotlightCount = gl.getUniformLocation(this.program, 'u_spotlightCount');
    this.uSpotlightRects =
      gl.getUniformLocation(this.program, 'u_spotlightRects[0]') ??
      gl.getUniformLocation(this.program, 'u_spotlightRects');
    this.uSpotlightParams =
      gl.getUniformLocation(this.program, 'u_spotlightParams[0]') ??
      gl.getUniformLocation(this.program, 'u_spotlightParams');

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    if (!vao || !vbo) {
      throw new Error('Failed to create SpotlightPass vertex buffers');
    }
    this.vao = vao;
    this.vbo = vbo;

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, 30 * 4, gl.DYNAMIC_DRAW);
    const stride = 5 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 2 * 4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 3 * 4);
  }

  render(scene: FrameScene, canvasWidth: number, canvasHeight: number): void {
    const uniforms = computeSpotlightPassUniforms(scene.screen, scene.stickerBackdrop);
    if (!uniforms) {
      return;
    }

    const gl = this.gl;
    const { width, height } = safeCanvasDimensions(canvasWidth, canvasHeight);
    const chromeGeo = computeChromePassGeometry(scene.screen, width, height);
    const vertices =
      chromeGeo?.contentVertices ??
      buildProjectedQuadVertices(
        scene.screen.projectedQuad,
        scene.screen.finalRect,
        width,
        height
      );

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices);

    gl.uniform2f(this.uScreenSize, uniforms.screenSize[0], uniforms.screenSize[1]);
    gl.uniform1f(this.uCornerRadius, uniforms.cornerRadius);
    gl.uniform4f(this.uSourceCrop, ...uniforms.sourceCrop);
    gl.uniform1f(this.uDimmingAlpha, uniforms.dimmingAlpha);
    gl.uniform1f(this.uOpacity, uniforms.opacity);
    gl.uniform1i(this.uSpotlightCount, uniforms.count);
    gl.uniform4fv(this.uSpotlightRects, uniforms.rectsFlat);
    gl.uniform4fv(this.uSpotlightParams, uniforms.paramsFlat);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    this.gl.deleteBuffer(this.vbo);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.program);
  }
}
