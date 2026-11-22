/**
 * web/passes/focus.ts
 *
 * WebGL2 offscreen FBO Focus Effect pass:
 * blurs and dims the screen exterior outside a radial circle or rotated linear band
 * while keeping the focal area crystal sharp on tilted 3D screen quads.
 * Browser ESM & Node 24 strip-types compatible (NO node:* imports, NO enum/namespace).
 */

import { FocusEffect } from '../../src/core/FocusEffect.ts';
import type { FrameScene, FrameScreenScene } from '../../src/core/FrameScene.ts';
import type { FrameStickerBackdropScene } from '../../src/core/StickerTransition.ts';
import { computeChromePassGeometry } from './chrome.ts';
import {
  FULLSCREEN_QUAD_VERTS,
  SCREEN_VERTEX_SHADER,
  buildProjectedQuadVertices,
  computeEffectiveScreenOpacity,
  computeScreenShaderUniforms,
  createOffscreenTarget,
  createProgram,
  safeCanvasDimensions,
  type OffscreenRenderTarget,
} from './glUtils.ts';
import { BLUR_VERTEX_SHADER, SEPARABLE_BLUR_FRAGMENT_SHADER } from './stickers.ts';

export interface FocusPassUniforms {
  shapeMode: number; // 0 = radial, 1 = linear
  center: [number, number];
  angleRadians: number;
  clearHalfWidthPx: number;
  featherWidthPx: number;
  blurRadiusPx: number;
  dimmingAlpha: number;
  progress: number;
  opacity: number;
  screenSize: [number, number];
  cornerRadius: number;
  sourceCrop: [number, number, number, number];
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(Math.max(v, lo), hi);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) {
    return x >= edge1 ? 1 : 0;
  }
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Pure function: computes FocusPass uniforms from FrameScreenScene.focusEffect.
 * Returns null if no active focus effect, suppressed opacity, or zero blur & dimming.
 */
export function computeFocusPassUniforms(
  screen: FrameScreenScene,
  backdrop?: FrameStickerBackdropScene | null
): FocusPassUniforms | null {
  const focus = screen.focusEffect;
  if (!focus) {
    return null;
  }

  const opacity = computeEffectiveScreenOpacity(screen, backdrop);
  const progress = clamp(focus.progress, 0, 1);
  if (opacity <= 0.001 || progress <= 0.001) {
    return null;
  }

  const effect = focus.effect;
  const blurRadiusPx = clamp(effect.blur, 0, 1) * 22 * progress;
  const dimmingAlpha = clamp(effect.dimming, 0, 1) * progress;
  if (blurRadiusPx <= 0.01 && dimmingAlpha <= 0.001) {
    return null;
  }

  let screenSize: [number, number];
  let cornerRadius: number;
  if (screen.decoration.kind === 'chrome') {
    const ch = screen.decoration.chrome;
    screenSize = [Math.max(ch.contentRect.width, 1), Math.max(ch.contentRect.height, 1)];
    cornerRadius = Math.max(ch.contentCornerRadius, 0);
  } else {
    const u = computeScreenShaderUniforms(screen);
    screenSize = u.screenSize;
    cornerRadius = u.cornerRadius;
  }

  const shortEdge = Math.min(screenSize[0], screenSize[1]);
  const clearHalfWidthPx = Math.max(FocusEffect.clearHalfWidth(effect, shortEdge), 1);
  const featherWidthPx = Math.max(FocusEffect.featherWidth(effect, shortEdge), 1);
  const shapeMode = effect.shape === 'linear' ? 1 : 0;
  const angleDegrees = FocusEffect.normalizedAngle(effect.angleDegrees ?? 0);
  const angleRadians = (angleDegrees * Math.PI) / 180;

  return {
    shapeMode,
    center: [clamp(focus.center.x, 0, 1), clamp(focus.center.y, 0, 1)],
    angleRadians,
    clearHalfWidthPx,
    featherWidthPx,
    blurRadiusPx,
    dimmingAlpha,
    progress,
    opacity,
    screenSize,
    cornerRadius,
    sourceCrop: [
      screen.sourceCrop.x,
      screen.sourceCrop.y,
      screen.sourceCrop.width,
      screen.sourceCrop.height,
    ],
  };
}

/**
 * Pure CPU mirror of GLSL focus outside factor:
 * 0.0 strictly inside the sharp focal region, 1.0 outside clearHalfWidth + featherWidth.
 */
export function evaluateFocusOutsideFactor(
  u: number,
  v: number,
  uniforms: FocusPassUniforms
): number {
  const dx = (u - uniforms.center[0]) * uniforms.screenSize[0];
  const dy = (v - uniforms.center[1]) * uniforms.screenSize[1];
  const dist =
    uniforms.shapeMode === 1
      ? Math.abs(-dx * Math.sin(uniforms.angleRadians) + dy * Math.cos(uniforms.angleRadians))
      : Math.hypot(dx, dy);

  return smoothstep(
    uniforms.clearHalfWidthPx,
    uniforms.clearHalfWidthPx + uniforms.featherWidthPx,
    dist
  );
}

export const FOCUS_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_blurredTex;
uniform vec4 u_sourceCrop;
uniform vec2 u_screenSize;
uniform float u_cornerRadius;
uniform int u_shapeMode;
uniform vec2 u_center;
uniform float u_angleRadians;
uniform float u_clearHalfWidthPx;
uniform float u_featherWidthPx;
uniform float u_blurRadiusPx;
uniform float u_dimmingAlpha;
uniform float u_progress;
uniform float u_opacity;
out vec4 fragColor;

float sdRoundedBox(vec2 p, vec2 b, float r) {
  float clampedR = min(r, min(b.x, b.y));
  vec2 q = abs(p) - b + clampedR;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - clampedR;
}

void main() {
  vec2 p = v_uv * u_screenSize - 0.5 * u_screenSize;
  vec2 b = 0.5 * u_screenSize;
  float screenDist = sdRoundedBox(p, b, u_cornerRadius);
  float screenMask = 1.0 - smoothstep(-0.75, 0.75, screenDist);
  if (screenMask <= 0.001) {
    discard;
  }

  vec2 croppedUV = u_sourceCrop.xy + clamp(v_uv, 0.0, 1.0) * u_sourceCrop.zw;
  vec2 d = (croppedUV - u_center) * u_screenSize;
  float focusDist = u_shapeMode == 1
    ? abs(-d.x * sin(u_angleRadians) + d.y * cos(u_angleRadians))
    : length(d);

  float outside = smoothstep(
    u_clearHalfWidthPx,
    u_clearHalfWidthPx + max(u_featherWidthPx, 1.0),
    focusDist
  );
  if (outside <= 0.001) {
    discard;
  }

  float blurWeight = u_blurRadiusPx > 0.01 ? outside * u_progress : 0.0;
  float dimWeight = u_dimmingAlpha * outside;
  float blendAlpha = clamp(max(blurWeight, dimWeight), 0.0, 1.0);

  vec3 blurredColor = texture(u_blurredTex, croppedUV).rgb;
  vec3 darkened = mix(blurredColor, vec3(0.0), clamp(dimWeight, 0.0, 0.92));

  fragColor = vec4(darkened, blendAlpha * screenMask * u_opacity);
}
`;

export class FocusPass {
  private readonly gl: WebGL2RenderingContext;
  private readonly blurProgram: WebGLProgram;
  private readonly focusProgram: WebGLProgram;
  private readonly blurVao: WebGLVertexArrayObject;
  private readonly blurVbo: WebGLBuffer;
  private readonly quadVao: WebGLVertexArrayObject;
  private readonly quadVbo: WebGLBuffer;

  private readonly uBlurTex: WebGLUniformLocation | null;
  private readonly uBlurDirection: WebGLUniformLocation | null;
  private readonly uBlurRadius: WebGLUniformLocation | null;

  private readonly uBlurredTex: WebGLUniformLocation | null;
  private readonly uSourceCrop: WebGLUniformLocation | null;
  private readonly uScreenSize: WebGLUniformLocation | null;
  private readonly uCornerRadius: WebGLUniformLocation | null;
  private readonly uShapeMode: WebGLUniformLocation | null;
  private readonly uCenter: WebGLUniformLocation | null;
  private readonly uAngleRadians: WebGLUniformLocation | null;
  private readonly uClearHalfWidthPx: WebGLUniformLocation | null;
  private readonly uFeatherWidthPx: WebGLUniformLocation | null;
  private readonly uBlurRadiusPx: WebGLUniformLocation | null;
  private readonly uDimmingAlpha: WebGLUniformLocation | null;
  private readonly uProgress: WebGLUniformLocation | null;
  private readonly uOpacity: WebGLUniformLocation | null;

  private tempTarget: OffscreenRenderTarget | null = null;
  private blurredTarget: OffscreenRenderTarget | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.blurProgram = createProgram(gl, BLUR_VERTEX_SHADER, SEPARABLE_BLUR_FRAGMENT_SHADER);
    this.uBlurTex = gl.getUniformLocation(this.blurProgram, 'u_tex');
    this.uBlurDirection = gl.getUniformLocation(this.blurProgram, 'u_direction');
    this.uBlurRadius = gl.getUniformLocation(this.blurProgram, 'u_blurRadius');

    const blurVao = gl.createVertexArray();
    const blurVbo = gl.createBuffer();
    if (!blurVao || !blurVbo) {
      throw new Error('Failed to create FocusPass blur buffers');
    }
    this.blurVao = blurVao;
    this.blurVbo = blurVbo;
    gl.bindVertexArray(this.blurVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.blurVbo);
    gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_QUAD_VERTS, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 2 * 4, 0);

    this.focusProgram = createProgram(gl, SCREEN_VERTEX_SHADER, FOCUS_FRAGMENT_SHADER);
    this.uBlurredTex = gl.getUniformLocation(this.focusProgram, 'u_blurredTex');
    this.uSourceCrop = gl.getUniformLocation(this.focusProgram, 'u_sourceCrop');
    this.uScreenSize = gl.getUniformLocation(this.focusProgram, 'u_screenSize');
    this.uCornerRadius = gl.getUniformLocation(this.focusProgram, 'u_cornerRadius');
    this.uShapeMode = gl.getUniformLocation(this.focusProgram, 'u_shapeMode');
    this.uCenter = gl.getUniformLocation(this.focusProgram, 'u_center');
    this.uAngleRadians = gl.getUniformLocation(this.focusProgram, 'u_angleRadians');
    this.uClearHalfWidthPx = gl.getUniformLocation(this.focusProgram, 'u_clearHalfWidthPx');
    this.uFeatherWidthPx = gl.getUniformLocation(this.focusProgram, 'u_featherWidthPx');
    this.uBlurRadiusPx = gl.getUniformLocation(this.focusProgram, 'u_blurRadiusPx');
    this.uDimmingAlpha = gl.getUniformLocation(this.focusProgram, 'u_dimmingAlpha');
    this.uProgress = gl.getUniformLocation(this.focusProgram, 'u_progress');
    this.uOpacity = gl.getUniformLocation(this.focusProgram, 'u_opacity');

    const quadVao = gl.createVertexArray();
    const quadVbo = gl.createBuffer();
    if (!quadVao || !quadVbo) {
      throw new Error('Failed to create FocusPass quad buffers');
    }
    this.quadVao = quadVao;
    this.quadVbo = quadVbo;
    gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, 30 * 4, gl.DYNAMIC_DRAW);
    const stride = 5 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 2 * 4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 3 * 4);
  }

  private ensureBlurTargets(width: number, height: number): void {
    const targetW = Math.max(Math.round(width * 0.5), 16);
    const targetH = Math.max(Math.round(height * 0.5), 16);
    if (!this.tempTarget) {
      this.tempTarget = createOffscreenTarget(this.gl, targetW, targetH);
    } else {
      this.tempTarget.resize(targetW, targetH);
    }
    if (!this.blurredTarget) {
      this.blurredTarget = createOffscreenTarget(this.gl, targetW, targetH);
    } else {
      this.blurredTarget.resize(targetW, targetH);
    }
  }

  render(
    scene: FrameScene,
    screenTex: WebGLTexture,
    canvasWidth: number,
    canvasHeight: number
  ): void {
    const uniforms = computeFocusPassUniforms(scene.screen, scene.stickerBackdrop);
    if (!uniforms) {
      return;
    }

    const gl = this.gl;
    const { width, height } = safeCanvasDimensions(canvasWidth, canvasHeight);
    this.ensureBlurTargets(width, height);

    const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const prevViewport = gl.getParameter(gl.VIEWPORT) as Int32Array | null;

    if (uniforms.blurRadiusPx > 0.01) {
      const scaledBlur = Math.max(uniforms.blurRadiusPx * 0.5, 0.5);
      gl.disable(gl.BLEND);
      gl.useProgram(this.blurProgram);
      gl.bindVertexArray(this.blurVao);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(this.uBlurTex, 0);
      gl.uniform1f(this.uBlurRadius, scaledBlur);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.tempTarget!.fbo);
      gl.viewport(0, 0, this.tempTarget!.width, this.tempTarget!.height);
      gl.bindTexture(gl.TEXTURE_2D, screenTex);
      gl.uniform2f(this.uBlurDirection, 1 / this.tempTarget!.width, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurredTarget!.fbo);
      gl.viewport(0, 0, this.blurredTarget!.width, this.blurredTarget!.height);
      gl.bindTexture(gl.TEXTURE_2D, this.tempTarget!.texture);
      gl.uniform2f(this.uBlurDirection, 0, 1 / this.blurredTarget!.height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
    if (prevViewport && prevViewport.length === 4) {
      gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
    } else {
      gl.viewport(0, 0, width, height);
    }

    const chromeGeo = computeChromePassGeometry(scene.screen, width, height);
    const vertices =
      chromeGeo?.contentVertices ??
      buildProjectedQuadVertices(scene.screen.projectedQuad, scene.screen.finalRect, width, height);

    gl.useProgram(this.focusProgram);
    gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(
      gl.TEXTURE_2D,
      uniforms.blurRadiusPx > 0.01 ? this.blurredTarget!.texture : screenTex
    );
    gl.uniform1i(this.uBlurredTex, 0);
    gl.uniform4f(this.uSourceCrop, ...uniforms.sourceCrop);
    gl.uniform2f(this.uScreenSize, uniforms.screenSize[0], uniforms.screenSize[1]);
    gl.uniform1f(this.uCornerRadius, uniforms.cornerRadius);
    gl.uniform1i(this.uShapeMode, uniforms.shapeMode);
    gl.uniform2f(this.uCenter, uniforms.center[0], uniforms.center[1]);
    gl.uniform1f(this.uAngleRadians, uniforms.angleRadians);
    gl.uniform1f(this.uClearHalfWidthPx, uniforms.clearHalfWidthPx);
    gl.uniform1f(this.uFeatherWidthPx, uniforms.featherWidthPx);
    gl.uniform1f(this.uBlurRadiusPx, uniforms.blurRadiusPx);
    gl.uniform1f(this.uDimmingAlpha, uniforms.dimmingAlpha);
    gl.uniform1f(this.uProgress, uniforms.progress);
    gl.uniform1f(this.uOpacity, uniforms.opacity);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    this.tempTarget?.dispose();
    this.blurredTarget?.dispose();
    this.gl.deleteBuffer(this.blurVbo);
    this.gl.deleteVertexArray(this.blurVao);
    this.gl.deleteBuffer(this.quadVbo);
    this.gl.deleteVertexArray(this.quadVao);
    this.gl.deleteProgram(this.blurProgram);
    this.gl.deleteProgram(this.focusProgram);
  }
}
