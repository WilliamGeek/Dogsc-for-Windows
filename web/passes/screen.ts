/**
 * web/passes/screen.ts
 *
 * WebGL2 3D perspective-projected screen card + SDF shadow pass.
 * Browser ESM & Node 24 strip-types compatible (NO node:* imports, NO enum/namespace).
 */

import {
  makeCompositionPoint,
  type CompositionRect,
} from '../../src/core/CompositionScene.ts';
import type {
  FrameScene,
  FrameScreenScene,
} from '../../src/core/FrameScene.ts';
import { hexColorComponents } from '../../src/core/HexColor.ts';
import {
  projectedScreenQuadProject,
  projectedScreenQuadProjector,
  type ProjectedScreenQuad,
} from '../../src/core/ScreenProjection.ts';
import type { FrameStickerBackdropScene } from '../../src/core/StickerTransition.ts';
import { createProgram, safeCanvasDimensions } from './glUtils.ts';

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

export const SCREEN_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_screenTex;
uniform vec4 u_sourceCrop;
uniform float u_opacity;
uniform vec2 u_screenSize;
uniform float u_cornerRadius;
uniform float u_borderWidth;
uniform vec4 u_borderColor;
out vec4 fragColor;

float sdRoundedBox(vec2 p, vec2 b, float r) {
  float clampedR = min(r, min(b.x, b.y));
  vec2 q = abs(p) - b + clampedR;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - clampedR;
}

void main() {
  vec2 p = v_uv * u_screenSize - 0.5 * u_screenSize;
  vec2 b = 0.5 * u_screenSize;
  float dist = sdRoundedBox(p, b, u_cornerRadius);
  float outerAlpha = 1.0 - smoothstep(-0.75, 0.75, dist);
  if (outerAlpha <= 0.001) {
    discard;
  }

  vec2 croppedUV = u_sourceCrop.xy + clamp(v_uv, 0.0, 1.0) * u_sourceCrop.zw;
  vec3 texColor = texture(u_screenTex, croppedUV).rgb;

  vec3 outColor = texColor;
  if (u_borderWidth > 0.0 && u_borderColor.a > 0.0) {
    float borderMask = smoothstep(-u_borderWidth - 0.75, -u_borderWidth + 0.75, dist);
    outColor = mix(texColor, u_borderColor.rgb, borderMask * u_borderColor.a);
  }

  fragColor = vec4(outColor, outerAlpha * u_opacity);
}
`;

export const SHADOW_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec2 u_screenSize;
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
  vec2 localPos = v_uv * u_screenSize - u_shadowOffset;
  float dist = sdRoundedBox(localPos - 0.5 * u_screenSize, 0.5 * u_screenSize, u_cornerRadius);
  float alpha = u_shadowColor.a * (1.0 - smoothstep(-u_shadowRadius * 0.25, max(u_shadowRadius * 1.35, 1.0), dist));
  if (alpha <= 0.001) {
    discard;
  }
  fragColor = vec4(u_shadowColor.rgb, alpha);
}
`;

export class ScreenPass {
  private readonly gl: WebGL2RenderingContext;
  private readonly screenProgram: WebGLProgram;
  private readonly shadowProgram: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;

  private readonly uScreenTex: WebGLUniformLocation | null;
  private readonly uSourceCrop: WebGLUniformLocation | null;
  private readonly uOpacity: WebGLUniformLocation | null;
  private readonly uScreenSize: WebGLUniformLocation | null;
  private readonly uCornerRadius: WebGLUniformLocation | null;
  private readonly uBorderWidth: WebGLUniformLocation | null;
  private readonly uBorderColor: WebGLUniformLocation | null;

  private readonly uShadowScreenSize: WebGLUniformLocation | null;
  private readonly uShadowCornerRadius: WebGLUniformLocation | null;
  private readonly uShadowOffset: WebGLUniformLocation | null;
  private readonly uShadowRadius: WebGLUniformLocation | null;
  private readonly uShadowColor: WebGLUniformLocation | null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.screenProgram = createProgram(gl, SCREEN_VERTEX_SHADER, SCREEN_FRAGMENT_SHADER);
    this.uScreenTex = gl.getUniformLocation(this.screenProgram, 'u_screenTex');
    this.uSourceCrop = gl.getUniformLocation(this.screenProgram, 'u_sourceCrop');
    this.uOpacity = gl.getUniformLocation(this.screenProgram, 'u_opacity');
    this.uScreenSize = gl.getUniformLocation(this.screenProgram, 'u_screenSize');
    this.uCornerRadius = gl.getUniformLocation(this.screenProgram, 'u_cornerRadius');
    this.uBorderWidth = gl.getUniformLocation(this.screenProgram, 'u_borderWidth');
    this.uBorderColor = gl.getUniformLocation(this.screenProgram, 'u_borderColor');

    this.shadowProgram = createProgram(gl, SCREEN_VERTEX_SHADER, SHADOW_FRAGMENT_SHADER);
    this.uShadowScreenSize = gl.getUniformLocation(this.shadowProgram, 'u_screenSize');
    this.uShadowCornerRadius = gl.getUniformLocation(this.shadowProgram, 'u_cornerRadius');
    this.uShadowOffset = gl.getUniformLocation(this.shadowProgram, 'u_shadowOffset');
    this.uShadowRadius = gl.getUniformLocation(this.shadowProgram, 'u_shadowRadius');
    this.uShadowColor = gl.getUniformLocation(this.shadowProgram, 'u_shadowColor');

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    if (!vao || !vbo) {
      throw new Error('Failed to create ScreenPass vertex buffers');
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

  render(
    scene: FrameScene,
    screenTex: WebGLTexture,
    canvasWidth: number,
    canvasHeight: number
  ): void {
    const effectiveOpacity = computeEffectiveScreenOpacity(scene.screen, scene.stickerBackdrop);
    if (effectiveOpacity <= 0.001) {
      return;
    }

    const gl = this.gl;
    const { width, height } = safeCanvasDimensions(canvasWidth, canvasHeight);
    const screenUniforms = computeScreenShaderUniforms(scene.screen);

    const shadowVerts = buildShadowQuadVertices(scene.screen, width, height);
    if (shadowVerts && scene.screen.shadow) {
      const sRgb = hexColorComponents(scene.screen.shadow.color);
      gl.useProgram(this.shadowProgram);
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, shadowVerts);

      gl.uniform2f(this.uShadowScreenSize, screenUniforms.screenSize[0], screenUniforms.screenSize[1]);
      gl.uniform1f(this.uShadowCornerRadius, screenUniforms.cornerRadius);
      gl.uniform2f(this.uShadowOffset, scene.screen.shadow.offset.x, scene.screen.shadow.offset.y);
      gl.uniform1f(this.uShadowRadius, scene.screen.shadow.radius);
      gl.uniform4f(
        this.uShadowColor,
        sRgb.red,
        sRgb.green,
        sRgb.blue,
        scene.screen.shadow.opacity * effectiveOpacity
      );
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    const vertices = buildProjectedQuadVertices(
      scene.screen.projectedQuad,
      scene.screen.finalRect,
      width,
      height
    );

    gl.useProgram(this.screenProgram);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, screenTex);
    gl.uniform1i(this.uScreenTex, 0);
    gl.uniform4f(
      this.uSourceCrop,
      scene.screen.sourceCrop.x,
      scene.screen.sourceCrop.y,
      scene.screen.sourceCrop.width,
      scene.screen.sourceCrop.height
    );
    gl.uniform1f(this.uOpacity, effectiveOpacity);
    gl.uniform2f(this.uScreenSize, screenUniforms.screenSize[0], screenUniforms.screenSize[1]);
    gl.uniform1f(this.uCornerRadius, screenUniforms.cornerRadius);
    gl.uniform1f(this.uBorderWidth, screenUniforms.effectiveBorderWidth);
    gl.uniform4f(
      this.uBorderColor,
      screenUniforms.borderColor[0],
      screenUniforms.borderColor[1],
      screenUniforms.borderColor[2],
      screenUniforms.borderColor[3]
    );

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    this.gl.deleteBuffer(this.vbo);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.screenProgram);
    this.gl.deleteProgram(this.shadowProgram);
  }
}
