/**
 * web/passes/camera.ts
 *
 * WebGL2 Camera Picture-in-Picture pass:
 * horizontal mirroring, AspectFill UV cropping, SDF rounded/circle mask,
 * soft drop shadow & border, sticker suppression/opacity fade, and beauty shader.
 * Browser ESM & Node 24 strip-types compatible (NO node:* imports, NO enum/namespace).
 */

import type { CompositionRect } from '../../src/core/CompositionScene.ts';
import type {
  FrameCameraScene,
  FrameScene,
} from '../../src/core/FrameScene.ts';
import { hexColorComponents } from '../../src/core/HexColor.ts';
import type { FrameStickerBackdropScene } from '../../src/core/StickerTransition.ts';
import {
  buildAxisAlignedRectVertices,
  buildExpandedAxisAlignedShadowVertices,
  createProgram,
  createTexture2D,
  safeCanvasDimensions,
} from './glUtils.ts';

export interface CameraShaderUniforms {
  rect: CompositionRect;
  size: [number, number];
  cornerRadius: number;
  borderWidth: number;
  borderColor: [number, number, number, number];
  opacity: number;
  isMirrored: boolean;
  uvRect: [number, number, number, number];
  beautySmoothing: number;
  beautyWhitening: number;
  shadow: {
    color: [number, number, number, number];
    radius: number;
    offset: [number, number];
  } | null;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
}

/**
 * Pure function: computes CameraPass shader uniforms from FrameCameraScene
 * and optional FrameStickerBackdropScene suppression.
 * Returns null if camera is invisible or has non-positive dimensions.
 */
export function computeCameraShaderUniforms(
  camera: FrameCameraScene,
  backdrop?: FrameStickerBackdropScene | null
): CameraShaderUniforms | null {
  const { width, height } = camera.rect;
  if (
    !Number.isFinite(camera.rect.x) ||
    !Number.isFinite(camera.rect.y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  const baseOpacity = clamp01(camera.opacity);
  const suppression = clamp01(backdrop?.cameraSuppression ?? 0);
  const opacity = clamp01(baseOpacity * (1 - suppression));
  if (opacity <= 0.001) {
    return null;
  }

  const maxCorner = Math.min(width, height) * 0.5;
  const rawCorner = Number.isFinite(camera.cornerRadius) ? Math.max(camera.cornerRadius, 0) : 0;
  const cornerRadius = Math.min(rawCorner, maxCorner);

  const borderWidth = Number.isFinite(camera.borderWidth)
    ? Math.max(camera.borderWidth, 0)
    : 0;
  const bRgb = hexColorComponents(camera.borderColor);
  const borderColor: [number, number, number, number] = [
    bRgb.red,
    bRgb.green,
    bRgb.blue,
    borderWidth > 0 ? 1.0 : 0.0,
  ];

  let uvRect: [number, number, number, number] = [0, 0, 1, 1];
  const fill = camera.contentFill;
  if (
    fill &&
    fill.source.width > 0 &&
    fill.source.height > 0 &&
    fill.visibleSource.width > 0 &&
    fill.visibleSource.height > 0
  ) {
    const u0 = clamp01((fill.visibleSource.x - fill.source.x) / fill.source.width);
    const v0 = clamp01((fill.visibleSource.y - fill.source.y) / fill.source.height);
    const uW = Math.min(
      Math.max(fill.visibleSource.width / fill.source.width, 0.0001),
      Math.max(1 - u0, 0.0001)
    );
    const vH = Math.min(
      Math.max(fill.visibleSource.height / fill.source.height, 0.0001),
      Math.max(1 - v0, 0.0001)
    );
    uvRect = [u0, v0, uW, vH];
  }

  let shadow: CameraShaderUniforms['shadow'] = null;
  if (camera.shadow && Number.isFinite(camera.shadow.opacity) && camera.shadow.opacity > 0) {
    const sRgb = hexColorComponents(camera.shadow.color);
    shadow = {
      color: [
        sRgb.red,
        sRgb.green,
        sRgb.blue,
        clamp01(camera.shadow.opacity) * opacity,
      ],
      radius: Number.isFinite(camera.shadow.radius) ? Math.max(camera.shadow.radius, 0) : 0,
      offset: [
        Number.isFinite(camera.shadow.offset.x) ? camera.shadow.offset.x : 0,
        Number.isFinite(camera.shadow.offset.y) ? camera.shadow.offset.y : 0,
      ],
    };
  }

  return {
    rect: camera.rect,
    size: [width, height],
    cornerRadius,
    borderWidth,
    borderColor,
    opacity,
    isMirrored: Boolean(camera.isMirrored),
    uvRect,
    beautySmoothing: clamp01(camera.beauty?.smoothing ?? 0),
    beautyWhitening: clamp01(camera.beauty?.whitening ?? 0),
    shadow,
  };
}

/**
 * Pure function: maps normalized camera card UV (0..1) through horizontal mirror & AspectFill uvRect.
 */
export function sampleCameraUV(
  u: number,
  v: number,
  uvRect: [number, number, number, number],
  isMirrored: boolean
): [number, number] {
  const mu = isMirrored ? 1 - u : u;
  return [
    uvRect[0] + mu * uvRect[2],
    uvRect[1] + v * uvRect[3],
  ];
}

export function buildCameraQuadVertices(
  camera: FrameCameraScene,
  canvasWidth: number,
  canvasHeight: number
): Float32Array {
  return buildAxisAlignedRectVertices(camera.rect, canvasWidth, canvasHeight);
}

export function buildCameraShadowVertices(
  camera: FrameCameraScene,
  canvasWidth: number,
  canvasHeight: number
): Float32Array | null {
  return buildExpandedAxisAlignedShadowVertices(
    camera.rect,
    camera.shadow,
    canvasWidth,
    canvasHeight
  );
}

export const CAMERA_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_ndc;
layout(location = 1) in vec2 a_uv;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_ndc, 0.0, 1.0);
  v_uv = a_uv;
}
`;

export const CAMERA_SHADOW_FRAGMENT_SHADER = `#version 300 es
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

export const CAMERA_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_cameraTex;
uniform vec4 u_uvRect;
uniform int u_isMirrored;
uniform vec2 u_size;
uniform float u_cornerRadius;
uniform float u_borderWidth;
uniform vec4 u_borderColor;
uniform float u_opacity;
uniform float u_beautySmoothing;
uniform float u_beautyWhitening;
out vec4 fragColor;

float sdRoundedBox(vec2 p, vec2 b, float r) {
  float clampedR = min(r, min(b.x, b.y));
  vec2 q = abs(p) - b + clampedR;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - clampedR;
}

vec3 sampleClamped(vec2 uv) {
  vec2 hi = u_uvRect.xy + u_uvRect.zw;
  return texture(u_cameraTex, clamp(uv, u_uvRect.xy, hi)).rgb;
}

void main() {
  vec2 p = v_uv * u_size - 0.5 * u_size;
  vec2 b = 0.5 * u_size;
  float dist = sdRoundedBox(p, b, u_cornerRadius);
  float outerAlpha = 1.0 - smoothstep(-0.75, 0.75, dist);
  if (outerAlpha <= 0.001) {
    discard;
  }

  float mu = u_isMirrored == 1 ? (1.0 - v_uv.x) : v_uv.x;
  vec2 texUV = u_uvRect.xy + vec2(mu, clamp(v_uv.y, 0.0, 1.0)) * u_uvRect.zw;
  vec3 col = sampleClamped(texUV);

  if (u_beautySmoothing > 0.001) {
    vec2 stepUV = vec2(2.5) / max(u_size, vec2(1.0)) * u_uvRect.zw;
    vec3 c1 = sampleClamped(texUV + vec2( stepUV.x,  stepUV.y));
    vec3 c2 = sampleClamped(texUV + vec2(-stepUV.x,  stepUV.y));
    vec3 c3 = sampleClamped(texUV + vec2( stepUV.x, -stepUV.y));
    vec3 c4 = sampleClamped(texUV + vec2(-stepUV.x, -stepUV.y));
    float w0 = 1.0;
    float w1 = exp(-dot(c1 - col, c1 - col) * 18.0);
    float w2 = exp(-dot(c2 - col, c2 - col) * 18.0);
    float w3 = exp(-dot(c3 - col, c3 - col) * 18.0);
    float w4 = exp(-dot(c4 - col, c4 - col) * 18.0);
    vec3 smoothed = (col * w0 + c1 * w1 + c2 * w2 + c3 * w3 + c4 * w4) / (w0 + w1 + w2 + w3 + w4);
    col = mix(col, smoothed, clamp(u_beautySmoothing * 0.72, 0.0, 0.8));
  }

  if (u_beautyWhitening > 0.001) {
    vec3 lifted = 1.0 - (1.0 - col) * (1.0 - col * 0.35);
    col = mix(col, lifted, clamp(u_beautyWhitening * 0.48, 0.0, 0.55));
  }

  if (u_borderWidth > 0.0 && u_borderColor.a > 0.0) {
    float borderMask = smoothstep(-u_borderWidth - 0.75, -u_borderWidth + 0.75, dist);
    col = mix(col, u_borderColor.rgb, borderMask * u_borderColor.a);
  }

  fragColor = vec4(col, outerAlpha * u_opacity);
}
`;

function createProceduralPortraitData(size: number): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const ny = y / (size - 1);
    for (let x = 0; x < size; x++) {
      const nx = x / (size - 1);
      // Warm-cool gradient backdrop with soft centered silhouette
      const bgR = Math.round(32 + nx * 26);
      const bgG = Math.round(44 + (1 - ny) * 38);
      const bgB = Math.round(78 + ny * 36);

      const headDx = (nx - 0.5) / 0.19;
      const headDy = (ny - 0.36) / 0.22;
      const headDist = Math.hypot(headDx, headDy);

      const bodyDx = (nx - 0.5) / 0.36;
      const bodyDy = (ny - 0.88) / 0.32;
      const bodyDist = Math.hypot(bodyDx, bodyDy);

      const sil = Math.min(headDist, bodyDist);
      const blend = Math.min(Math.max(1 - (sil - 0.92) / 0.16, 0), 1);

      const fgR = Math.round(145 + (1 - ny) * 40);
      const fgG = Math.round(170 + nx * 25);
      const fgB = Math.round(215);

      const idx = (y * size + x) * 4;
      data[idx] = Math.round(bgR * (1 - blend) + fgR * blend);
      data[idx + 1] = Math.round(bgG * (1 - blend) + fgG * blend);
      data[idx + 2] = Math.round(bgB * (1 - blend) + fgB * blend);
      data[idx + 3] = 255;
    }
  }
  return data;
}

export class CameraPass {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly shadowProgram: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;
  private readonly fallbackTex: WebGLTexture;

  private readonly uCameraTex: WebGLUniformLocation | null;
  private readonly uUvRect: WebGLUniformLocation | null;
  private readonly uIsMirrored: WebGLUniformLocation | null;
  private readonly uSize: WebGLUniformLocation | null;
  private readonly uCornerRadius: WebGLUniformLocation | null;
  private readonly uBorderWidth: WebGLUniformLocation | null;
  private readonly uBorderColor: WebGLUniformLocation | null;
  private readonly uOpacity: WebGLUniformLocation | null;
  private readonly uBeautySmoothing: WebGLUniformLocation | null;
  private readonly uBeautyWhitening: WebGLUniformLocation | null;

  private readonly uShadowSize: WebGLUniformLocation | null;
  private readonly uShadowCornerRadius: WebGLUniformLocation | null;
  private readonly uShadowOffset: WebGLUniformLocation | null;
  private readonly uShadowRadius: WebGLUniformLocation | null;
  private readonly uShadowColor: WebGLUniformLocation | null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, CAMERA_VERTEX_SHADER, CAMERA_FRAGMENT_SHADER);
    this.uCameraTex = gl.getUniformLocation(this.program, 'u_cameraTex');
    this.uUvRect = gl.getUniformLocation(this.program, 'u_uvRect');
    this.uIsMirrored = gl.getUniformLocation(this.program, 'u_isMirrored');
    this.uSize = gl.getUniformLocation(this.program, 'u_size');
    this.uCornerRadius = gl.getUniformLocation(this.program, 'u_cornerRadius');
    this.uBorderWidth = gl.getUniformLocation(this.program, 'u_borderWidth');
    this.uBorderColor = gl.getUniformLocation(this.program, 'u_borderColor');
    this.uOpacity = gl.getUniformLocation(this.program, 'u_opacity');
    this.uBeautySmoothing = gl.getUniformLocation(this.program, 'u_beautySmoothing');
    this.uBeautyWhitening = gl.getUniformLocation(this.program, 'u_beautyWhitening');

    this.shadowProgram = createProgram(gl, CAMERA_VERTEX_SHADER, CAMERA_SHADOW_FRAGMENT_SHADER);
    this.uShadowSize = gl.getUniformLocation(this.shadowProgram, 'u_size');
    this.uShadowCornerRadius = gl.getUniformLocation(this.shadowProgram, 'u_cornerRadius');
    this.uShadowOffset = gl.getUniformLocation(this.shadowProgram, 'u_shadowOffset');
    this.uShadowRadius = gl.getUniformLocation(this.shadowProgram, 'u_shadowRadius');
    this.uShadowColor = gl.getUniformLocation(this.shadowProgram, 'u_shadowColor');

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    if (!vao || !vbo) {
      throw new Error('Failed to create CameraPass vertex buffers');
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
      createProceduralPortraitData(fbSize)
    );
  }

  render(
    scene: FrameScene,
    cameraTex: WebGLTexture | null,
    canvasWidth: number,
    canvasHeight: number
  ): void {
    const camera = scene.camera;
    if (!camera) {
      return;
    }

    const uniforms = computeCameraShaderUniforms(camera, scene.stickerBackdrop);
    if (!uniforms) {
      return;
    }

    const gl = this.gl;
    const { width, height } = safeCanvasDimensions(canvasWidth, canvasHeight);

    const shadowVerts = buildCameraShadowVertices(camera, width, height);
    if (shadowVerts && uniforms.shadow) {
      gl.useProgram(this.shadowProgram);
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, shadowVerts);

      gl.uniform2f(this.uShadowSize, uniforms.size[0], uniforms.size[1]);
      gl.uniform1f(this.uShadowCornerRadius, uniforms.cornerRadius);
      gl.uniform2f(this.uShadowOffset, uniforms.shadow.offset[0], uniforms.shadow.offset[1]);
      gl.uniform1f(this.uShadowRadius, uniforms.shadow.radius);
      gl.uniform4f(this.uShadowColor, ...uniforms.shadow.color);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    const quadVerts = buildCameraQuadVertices(camera, width, height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, quadVerts);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cameraTex ?? this.fallbackTex);
    gl.uniform1i(this.uCameraTex, 0);
    gl.uniform4f(this.uUvRect, ...uniforms.uvRect);
    gl.uniform1i(this.uIsMirrored, uniforms.isMirrored ? 1 : 0);
    gl.uniform2f(this.uSize, uniforms.size[0], uniforms.size[1]);
    gl.uniform1f(this.uCornerRadius, uniforms.cornerRadius);
    gl.uniform1f(this.uBorderWidth, uniforms.borderWidth);
    gl.uniform4f(this.uBorderColor, ...uniforms.borderColor);
    gl.uniform1f(this.uOpacity, uniforms.opacity);
    gl.uniform1f(this.uBeautySmoothing, uniforms.beautySmoothing);
    gl.uniform1f(this.uBeautyWhitening, uniforms.beautyWhitening);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    this.gl.deleteTexture(this.fallbackTex);
    this.gl.deleteBuffer(this.vbo);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.program);
    this.gl.deleteProgram(this.shadowProgram);
  }
}
