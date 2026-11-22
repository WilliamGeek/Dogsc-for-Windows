/**
 * web/passes/glUtils.ts
 *
 * Shared WebGL2 shader/target helpers and pure geometry/layer-dispatch utilities.
 * Browser ESM & Node 24 strip-types compatible (NO node:* imports, NO enum/namespace).
 */

import {
  makeCompositionPoint,
  type CompositionRect,
} from '../../src/core/CompositionScene.ts';
import type {
  FrameLayerRole,
  FrameScene,
  FrameScreenScene,
  FrameShadow,
} from '../../src/core/FrameScene.ts';
import { hexColorComponents } from '../../src/core/HexColor.ts';
import {
  projectedScreenQuadProject,
  projectedScreenQuadProjector,
  type ProjectedScreenQuad,
} from '../../src/core/ScreenProjection.ts';
import type { FrameStickerBackdropScene } from '../../src/core/StickerTransition.ts';

export const DEFAULT_LAYER_ORDER: readonly FrameLayerRole[] = Object.freeze([
  'background',
  'screen',
  'cursor',
  'spotlight',
  'camera',
  'stickers',
  'animations',
  'subtitles',
  'videos',
]);

export const FULLSCREEN_QUAD_VERTS = new Float32Array([
  -1, -1,
   1, -1,
   1,  1,
  -1, -1,
   1,  1,
  -1,  1,
]);

/**
 * Pure function: resolves deduplicated layer draw order for a FrameScene,
 * falling back to DEFAULT_LAYER_ORDER when scene.layerOrder is empty.
 */
export function resolveLayerRenderOrder(
  scene: Pick<FrameScene, 'layerOrder'>
): FrameLayerRole[] {
  const input = scene.layerOrder;
  if (!Array.isArray(input) || input.length === 0) {
    return DEFAULT_LAYER_ORDER.slice();
  }
  const seen = new Set<FrameLayerRole>();
  const resolved: FrameLayerRole[] = [];
  for (const role of input) {
    if (!seen.has(role)) {
      seen.add(role);
      resolved.push(role);
    }
  }
  return resolved.length > 0 ? resolved : DEFAULT_LAYER_ORDER.slice();
}

/**
 * Pure function: invokes registered pass callbacks in the scene's resolved layerOrder
 * and returns the ordered list of executed roles.
 */
export function dispatchSceneLayers(
  scene: Pick<FrameScene, 'layerOrder'>,
  handlers: Partial<Record<FrameLayerRole, () => void>>
): FrameLayerRole[] {
  const executed: FrameLayerRole[] = [];
  const order = resolveLayerRenderOrder(scene);
  for (const role of order) {
    const fn = handlers[role];
    if (typeof fn === 'function') {
      fn();
      executed.push(role);
    }
  }
  return executed;
}

export function safeCanvasDimensions(
  canvasWidth: number,
  canvasHeight: number
): { width: number; height: number } {
  return {
    width: Number.isFinite(canvasWidth) && canvasWidth > 0 ? canvasWidth : 1920,
    height: Number.isFinite(canvasHeight) && canvasHeight > 0 ? canvasHeight : 1080,
  };
}

export function toNdcX(x: number, canvasWidth: number): number {
  const safeW = Number.isFinite(canvasWidth) && canvasWidth > 0 ? canvasWidth : 1920;
  return (x / safeW) * 2 - 1;
}

export function toNdcY(y: number, canvasHeight: number): number {
  const safeH = Number.isFinite(canvasHeight) && canvasHeight > 0 ? canvasHeight : 1080;
  return 1 - (y / safeH) * 2;
}

/**
 * Pure function: builds interleaved [ndcX, ndcY, u, v] vertices (24 floats)
 * for an axis-aligned rectangle in top-left canvas pixel coordinates.
 */
export function buildAxisAlignedRectVertices(
  rect: CompositionRect,
  canvasWidth: number,
  canvasHeight: number
): Float32Array {
  const { width: safeW, height: safeH } = safeCanvasDimensions(canvasWidth, canvasHeight);
  const x0 = rect.x;
  const y0 = rect.y;
  const x1 = rect.x + rect.width;
  const y1 = rect.y + rect.height;

  const nx0 = (x0 / safeW) * 2 - 1;
  const ny0 = 1 - (y0 / safeH) * 2;
  const nx1 = (x1 / safeW) * 2 - 1;
  const ny1 = 1 - (y1 / safeH) * 2;

  return new Float32Array([
    nx0, ny0, 0, 0,
    nx1, ny0, 1, 0,
    nx1, ny1, 1, 1,
    nx0, ny0, 0, 0,
    nx1, ny1, 1, 1,
    nx0, ny1, 0, 1,
  ]);
}

/**
 * Pure function: builds expanded [ndcX, ndcY, u, v] vertices (24 floats)
 * for an axis-aligned SDF soft shadow quad around `rect`.
 * Returns null if shadow is disabled/transparent or rect has non-positive area.
 */
export function buildExpandedAxisAlignedShadowVertices(
  rect: CompositionRect,
  shadow: FrameShadow | null | undefined,
  canvasWidth: number,
  canvasHeight: number
): Float32Array | null {
  if (
    !shadow ||
    !Number.isFinite(shadow.opacity) ||
    shadow.opacity <= 0 ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return null;
  }

  const { width: safeW, height: safeH } = safeCanvasDimensions(canvasWidth, canvasHeight);
  const safeRadius = Number.isFinite(shadow.radius) ? Math.max(shadow.radius, 0) : 0;
  const offX = Number.isFinite(shadow.offset.x) ? shadow.offset.x : 0;
  const offY = Number.isFinite(shadow.offset.y) ? shadow.offset.y : 0;
  const margin = safeRadius * 2.5 + Math.max(Math.abs(offX), Math.abs(offY)) + 8;

  const u0 = -margin / rect.width;
  const u1 = 1 + margin / rect.width;
  const v0 = -margin / rect.height;
  const v1 = 1 + margin / rect.height;

  const x0 = rect.x - margin;
  const y0 = rect.y - margin;
  const x1 = rect.x + rect.width + margin;
  const y1 = rect.y + rect.height + margin;

  const nx0 = (x0 / safeW) * 2 - 1;
  const ny0 = 1 - (y0 / safeH) * 2;
  const nx1 = (x1 / safeW) * 2 - 1;
  const ny1 = 1 - (y1 / safeH) * 2;

  return new Float32Array([
    nx0, ny0, u0, v0,
    nx1, ny0, u1, v0,
    nx1, ny1, u1, v1,
    nx0, ny0, u0, v0,
    nx1, ny1, u1, v1,
    nx0, ny1, u0, v1,
  ]);
}

export interface ScreenShaderUniforms {
  screenSize: [number, number];
  cornerRadius: number;
  effectiveBorderWidth: number;
  borderColor: [number, number, number, number];
}

/**
 * Pure function: computes effective screen card opacity after applying
 * sticker-backdrop screen suppression (0..1).
 */
export function computeEffectiveScreenOpacity(
  screen: FrameScreenScene,
  backdrop?: FrameStickerBackdropScene | null
): number {
  const baseOpacity = Number.isFinite(screen.opacity)
    ? Math.min(Math.max(screen.opacity, 0), 1)
    : 1;
  const rawSup = backdrop?.screenSuppression ?? 0;
  const suppression = Number.isFinite(rawSup) ? Math.min(Math.max(rawSup, 0), 1) : 0;
  return Math.min(Math.max(baseOpacity * (1 - suppression), 0), 1);
}

/**
 * Pure function: builds interleaved [ndcX, ndcY, w, u, v] vertices for two triangles
 * forming the projected screen quad with perspective-correct homogeneous weights (1/w).
 * Returns Float32Array of length 30 (6 vertices * 5 floats).
 */
export function buildProjectedQuadVertices(
  quad: ProjectedScreenQuad,
  sourceRect: CompositionRect,
  canvasWidth: number,
  canvasHeight: number
): Float32Array {
  const { width: safeWidth, height: safeHeight } = safeCanvasDimensions(canvasWidth, canvasHeight);

  const mapper = projectedScreenQuadProjector(quad, sourceRect);
  const px = mapper && Number.isFinite(mapper.perspectiveX) ? mapper.perspectiveX : 0;
  const py = mapper && Number.isFinite(mapper.perspectiveY) ? mapper.perspectiveY : 0;

  const w0 = 1.0;
  const w1 = Math.max(1.0 + px, 1e-4);
  const w2 = Math.max(1.0 + px + py, 1e-4);
  const w3 = Math.max(1.0 + py, 1e-4);

  const toNdcX = (x: number): number => (x / safeWidth) * 2 - 1;
  const toNdcY = (y: number): number => 1 - (y / safeHeight) * 2;

  const c0: [number, number, number, number, number] = [toNdcX(quad.topLeft.x), toNdcY(quad.topLeft.y), w0, 0, 0];
  const c1: [number, number, number, number, number] = [toNdcX(quad.topRight.x), toNdcY(quad.topRight.y), w1, 1, 0];
  const c2: [number, number, number, number, number] = [toNdcX(quad.bottomRight.x), toNdcY(quad.bottomRight.y), w2, 1, 1];
  const c3: [number, number, number, number, number] = [toNdcX(quad.bottomLeft.x), toNdcY(quad.bottomLeft.y), w3, 0, 1];

  return new Float32Array([
    ...c0,
    ...c1,
    ...c2,
    ...c0,
    ...c2,
    ...c3,
  ]);
}

/**
 * Pure function: extracts rounded-corner and anti-aliased border uniforms from FrameScreenScene.
 */
export function computeScreenShaderUniforms(screen: FrameScreenScene): ScreenShaderUniforms {
  const w = Number.isFinite(screen.finalRect.width) ? Math.max(screen.finalRect.width, 1) : 1;
  const h = Number.isFinite(screen.finalRect.height) ? Math.max(screen.finalRect.height, 1) : 1;
  const cornerRadius = Number.isFinite(screen.cornerRadius) ? Math.max(screen.cornerRadius, 0) : 0;
  const bw = Number.isFinite(screen.borderWidth) ? Math.max(screen.borderWidth, 0) : 0;
  const bo = Number.isFinite(screen.borderOpacity)
    ? Math.min(Math.max(screen.borderOpacity, 0), 1)
    : 0;

  let effectiveBorderWidth = 0;
  let borderAlpha = 0;
  if (bw > 0) {
    effectiveBorderWidth = bw;
    borderAlpha = Math.max(bo, 0.85);
  } else if (bo > 0) {
    effectiveBorderWidth = 1.5;
    borderAlpha = bo;
  }

  const rgb = hexColorComponents(screen.borderColor);
  return {
    screenSize: [w, h],
    cornerRadius,
    effectiveBorderWidth,
    borderColor: [rgb.red, rgb.green, rgb.blue, borderAlpha],
  };
}

/**
 * Pure function: builds expanded perspective-projected vertices for the screen shadow quad.
 * Returns null if shadow is disabled or zero-opacity.
 */
export function buildShadowQuadVertices(
  screen: FrameScreenScene,
  canvasWidth: number,
  canvasHeight: number
): Float32Array | null {
  if (!screen.shadow || screen.shadow.opacity <= 0) {
    return null;
  }

  const { width: safeWidth, height: safeHeight } = safeCanvasDimensions(canvasWidth, canvasHeight);
  const w = Math.max(screen.finalRect.width, 1);
  const h = Math.max(screen.finalRect.height, 1);

  const margin =
    screen.shadow.radius * 2.5 +
    Math.max(Math.abs(screen.shadow.offset.x), Math.abs(screen.shadow.offset.y)) +
    8;

  const u0 = -margin / w;
  const u1 = 1 + margin / w;
  const v0 = -margin / h;
  const v1 = 1 + margin / h;

  const p0 = makeCompositionPoint(screen.finalRect.x - margin, screen.finalRect.y - margin);
  const p1 = makeCompositionPoint(screen.finalRect.x + w + margin, screen.finalRect.y - margin);
  const p2 = makeCompositionPoint(screen.finalRect.x + w + margin, screen.finalRect.y + h + margin);
  const p3 = makeCompositionPoint(screen.finalRect.x - margin, screen.finalRect.y + h + margin);

  const q0 = projectedScreenQuadProject(screen.projectedQuad, p0, screen.finalRect) ?? p0;
  const q1 = projectedScreenQuadProject(screen.projectedQuad, p1, screen.finalRect) ?? p1;
  const q2 = projectedScreenQuadProject(screen.projectedQuad, p2, screen.finalRect) ?? p2;
  const q3 = projectedScreenQuadProject(screen.projectedQuad, p3, screen.finalRect) ?? p3;

  const mapper = projectedScreenQuadProjector(screen.projectedQuad, screen.finalRect);
  const px = mapper && Number.isFinite(mapper.perspectiveX) ? mapper.perspectiveX : 0;
  const py = mapper && Number.isFinite(mapper.perspectiveY) ? mapper.perspectiveY : 0;

  const w0 = Math.max(1 + px * u0 + py * v0, 1e-4);
  const w1 = Math.max(1 + px * u1 + py * v0, 1e-4);
  const w2 = Math.max(1 + px * u1 + py * v1, 1e-4);
  const w3 = Math.max(1 + px * u0 + py * v1, 1e-4);

  const toNdcX = (x: number): number => (x / safeWidth) * 2 - 1;
  const toNdcY = (y: number): number => 1 - (y / safeHeight) * 2;

  const c0: [number, number, number, number, number] = [toNdcX(q0.x), toNdcY(q0.y), w0, u0, v0];
  const c1: [number, number, number, number, number] = [toNdcX(q1.x), toNdcY(q1.y), w1, u1, v0];
  const c2: [number, number, number, number, number] = [toNdcX(q2.x), toNdcY(q2.y), w2, u1, v1];
  const c3: [number, number, number, number, number] = [toNdcX(q3.x), toNdcY(q3.y), w3, u0, v1];

  return new Float32Array([
    ...c0,
    ...c1,
    ...c2,
    ...c0,
    ...c2,
    ...c3,
  ]);
}

export const SCREEN_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_ndc;
layout(location = 1) in float a_w;
layout(location = 2) in vec2 a_uv;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_ndc.x * a_w, a_ndc.y * a_w, 0.0, a_w);
  v_uv = a_uv;
}
`;

// ---------------------------------------------------------------------------
// Browser WebGL2 Resource Helpers (never invoked in Node unit tests)
// ---------------------------------------------------------------------------

export function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('Failed to create WebGL2 shader');
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown shader error';
    gl.deleteShader(shader);
    throw new Error(`Shader compilation failed: ${log}`);
  }
  return shader;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSrc: string,
  fragmentSrc: string
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error('Failed to create WebGL2 program');
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown link error';
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error(`Program link failed: ${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return program;
}

export function createTexture2D(
  gl: WebGL2RenderingContext,
  linear: boolean = true
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) {
    throw new Error('Failed to create WebGL2 texture');
  }
  const filter = linear ? gl.LINEAR : gl.NEAREST;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  return tex;
}

export interface OffscreenRenderTarget {
  fbo: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
  resize(w: number, h: number): void;
  dispose(): void;
}

export function createOffscreenTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number
): OffscreenRenderTarget {
  const fbo = gl.createFramebuffer();
  if (!fbo) {
    throw new Error('Failed to create WebGL2 framebuffer');
  }
  const texture = createTexture2D(gl, true);
  let currentWidth = Math.max(Math.round(width), 1);
  let currentHeight = Math.max(Math.round(height), 1);

  const allocate = (w: number, h: number): void => {
    currentWidth = Math.max(Math.round(w), 1);
    currentHeight = Math.max(Math.round(h), 1);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      currentWidth,
      currentHeight,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  allocate(currentWidth, currentHeight);

  return {
    fbo,
    texture,
    get width(): number {
      return currentWidth;
    },
    get height(): number {
      return currentHeight;
    },
    resize(w: number, h: number): void {
      const nextW = Math.max(Math.round(w), 1);
      const nextH = Math.max(Math.round(h), 1);
      if (nextW !== currentWidth || nextH !== currentHeight) {
        allocate(nextW, nextH);
      }
    },
    dispose(): void {
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(texture);
    },
  };
}
