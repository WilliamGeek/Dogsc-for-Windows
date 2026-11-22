/**
 * web/passes/glUtils.ts
 *
 * Shared WebGL2 shader/target helpers and pure geometry/layer-dispatch utilities.
 * Browser ESM & Node 24 strip-types compatible (NO node:* imports, NO enum/namespace).
 */

import type { CompositionRect } from '../../src/core/CompositionScene.ts';
import type {
  FrameLayerRole,
  FrameScene,
  FrameShadow,
} from '../../src/core/FrameScene.ts';

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
