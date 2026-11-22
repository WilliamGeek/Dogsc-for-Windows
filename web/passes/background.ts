/**
 * web/passes/background.ts
 *
 * WebGL2 procedural gradient & pattern background pass + pure shader uniform mapping.
 * Browser ESM & Node 24 strip-types compatible (NO node:* imports, NO enum/namespace).
 */

import type {
  FrameBackgroundScene,
  FrameScene,
} from '../../src/core/FrameScene.ts';
import {
  FULLSCREEN_QUAD_VERTS,
  createProgram,
  safeCanvasDimensions,
} from './glUtils.ts';

export interface BackgroundShaderParams {
  topLeftColor: [number, number, number];
  bottomRightColor: [number, number, number];
  accentColor: [number, number, number];
  gridColor: [number, number, number];
  patternMode: number; // 0=pure gradient, 1=orthogonal grid, 2=dot matrix, 3=isometric/flow
  patternScale: number;
  patternOpacity: number;
  blurRadius: number;
  time: number;
}

const PATTERN_PALETTE: Record<
  string,
  Pick<
    BackgroundShaderParams,
    'topLeftColor' | 'bottomRightColor' | 'accentColor' | 'gridColor' | 'patternMode'
  >
> = {
  '黑曜石网格': {
    topLeftColor: [0.06, 0.08, 0.12],
    bottomRightColor: [0.13, 0.16, 0.24],
    accentColor: [0.22, 0.34, 0.56],
    gridColor: [0.55, 0.65, 0.85],
    patternMode: 1,
  },
  '工程白网格': {
    topLeftColor: [0.94, 0.95, 0.98],
    bottomRightColor: [0.84, 0.88, 0.94],
    accentColor: [0.72, 0.8, 0.95],
    gridColor: [0.35, 0.42, 0.55],
    patternMode: 1,
  },
  '暗夜星阵': {
    topLeftColor: [0.04, 0.05, 0.1],
    bottomRightColor: [0.11, 0.09, 0.22],
    accentColor: [0.35, 0.22, 0.6],
    gridColor: [0.7, 0.78, 1.0],
    patternMode: 2,
  },
  '建筑极简点': {
    topLeftColor: [0.92, 0.91, 0.89],
    bottomRightColor: [0.84, 0.83, 0.8],
    accentColor: [0.96, 0.94, 0.9],
    gridColor: [0.25, 0.25, 0.28],
    patternMode: 2,
  },
  '立体等角网': {
    topLeftColor: [0.08, 0.12, 0.16],
    bottomRightColor: [0.14, 0.22, 0.28],
    accentColor: [0.16, 0.5, 0.55],
    gridColor: [0.45, 0.82, 0.88],
    patternMode: 3,
  },
};

const DYNAMIC_FLOW_PALETTE: Record<
  string,
  Pick<
    BackgroundShaderParams,
    'topLeftColor' | 'bottomRightColor' | 'accentColor' | 'gridColor' | 'patternMode'
  >
> = {
  '赛博微流网格': {
    topLeftColor: [0.09, 0.07, 0.14],
    bottomRightColor: [0.2, 0.14, 0.08],
    accentColor: [0.78, 0.56, 0.2],
    gridColor: [0.95, 0.78, 0.35],
    patternMode: 3,
  },
  '星辉漫步点阵': {
    topLeftColor: [0.07, 0.06, 0.12],
    bottomRightColor: [0.18, 0.12, 0.18],
    accentColor: [0.65, 0.38, 0.45],
    gridColor: [0.98, 0.86, 0.7],
    patternMode: 2,
  },
  '极光流体星云': {
    topLeftColor: [0.05, 0.11, 0.18],
    bottomRightColor: [0.12, 0.25, 0.38],
    accentColor: [0.35, 0.68, 0.92],
    gridColor: [0.75, 0.92, 1.0],
    patternMode: 3,
  },
};

/**
 * Pure function: maps FrameBackgroundScene presets into shader uniforms for gradients and procedural patterns.
 */
export function resolveBackgroundShaderParams(
  bg: FrameBackgroundScene,
  time: number
): BackgroundShaderParams {
  const safeScale = Number.isFinite(bg.patternScale) ? Math.max(bg.patternScale, 0.1) : 1.0;
  const safeOpacity = Number.isFinite(bg.patternOpacity)
    ? Math.min(Math.max(bg.patternOpacity, 0), 1)
    : 1.0;
  const blurRadius = Number.isFinite(bg.blurRadius) ? Math.max(bg.blurRadius, 0) : 0;
  const safeTime = Number.isFinite(time) ? time : 0;

  if (bg.source.kind === 'pattern') {
    const entry = PATTERN_PALETTE[bg.source.preset];
    if (entry) {
      return {
        ...entry,
        patternScale: safeScale,
        patternOpacity: safeOpacity,
        blurRadius,
        time: safeTime,
      };
    }
  }

  if (bg.source.kind === 'dynamicFlow') {
    const entry = DYNAMIC_FLOW_PALETTE[bg.source.preset];
    if (entry) {
      return {
        ...entry,
        patternScale: safeScale,
        patternOpacity: safeOpacity,
        blurRadius,
        time: safeTime,
      };
    }
  }

  return {
    topLeftColor: [0.07, 0.09, 0.14],
    bottomRightColor: [0.15, 0.19, 0.28],
    accentColor: [0.28, 0.38, 0.62],
    gridColor: [0.6, 0.7, 0.9],
    patternMode: 1,
    patternScale: safeScale,
    patternOpacity: safeOpacity * 0.6,
    blurRadius,
    time: safeTime,
  };
}

export const BG_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_uv = a_pos * 0.5 + 0.5;
}
`;

export const BG_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec2 u_resolution;
uniform vec3 u_topLeftColor;
uniform vec3 u_bottomRightColor;
uniform vec3 u_accentColor;
uniform vec3 u_gridColor;
uniform int u_patternMode;
uniform float u_patternScale;
uniform float u_patternOpacity;
uniform float u_blurRadius;
uniform float u_time;
out vec4 fragColor;

void main() {
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
  float diag = clamp(uv.x * 0.55 + uv.y * 0.45, 0.0, 1.0);
  vec3 base = mix(u_topLeftColor, u_bottomRightColor, diag);

  // Subtle accent radial glow
  vec2 glowCenter = vec2(0.72 + 0.05 * sin(u_time * 0.5), 0.28 + 0.05 * cos(u_time * 0.4));
  float dGlow = length(uv - glowCenter);
  float glow = exp(-dGlow * 2.4) * 0.28;
  vec3 col = mix(base, u_accentColor, glow);

  float spacing = 48.0 * max(u_patternScale, 0.1);
  vec2 px = uv * u_resolution;
  float blurSoft = clamp(u_blurRadius, 0.0, 24.0) * 0.12;
  float blurDamp = 1.0 - clamp(u_blurRadius / 24.0, 0.0, 1.0) * 0.65;
  float patternMask = 0.0;

  if (u_patternMode == 1) {
    vec2 cell = abs(fract(px / spacing - 0.5) - 0.5) * spacing;
    float dLine = min(cell.x, cell.y);
    patternMask = (1.0 - smoothstep(0.4, 1.4 + blurSoft, dLine)) * 0.16;
  } else if (u_patternMode == 2) {
    vec2 drift = vec2(u_time * 6.0, u_time * 4.0);
    vec2 cell = (fract((px + drift) / spacing) - 0.5) * spacing;
    float dDot = length(cell);
    patternMask = (1.0 - smoothstep(1.2, 2.4 + blurSoft, dDot)) * 0.24;
  } else if (u_patternMode == 3) {
    float angle = 0.52359877; // 30 deg
    mat2 rotA = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
    mat2 rotB = mat2(cos(-angle), -sin(-angle), sin(-angle), cos(-angle));
    vec2 pA = rotA * (px + vec2(u_time * 10.0, 0.0));
    vec2 pB = rotB * (px - vec2(0.0, u_time * 8.0));
    vec2 cA = abs(fract(pA / spacing - 0.5) - 0.5) * spacing;
    vec2 cB = abs(fract(pB / spacing - 0.5) - 0.5) * spacing;
    float dIso = min(cA.x, cB.x);
    patternMask = (1.0 - smoothstep(0.4, 1.5 + blurSoft, dIso)) * 0.18;
  }

  col = mix(col, u_gridColor, clamp(patternMask * u_patternOpacity * blurDamp, 0.0, 0.45));
  fragColor = vec4(col, 1.0);
}
`;

export class BackgroundPass {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;
  private readonly uResolution: WebGLUniformLocation | null;
  private readonly uTopLeft: WebGLUniformLocation | null;
  private readonly uBottomRight: WebGLUniformLocation | null;
  private readonly uAccent: WebGLUniformLocation | null;
  private readonly uGrid: WebGLUniformLocation | null;
  private readonly uPatternMode: WebGLUniformLocation | null;
  private readonly uPatternScale: WebGLUniformLocation | null;
  private readonly uPatternOpacity: WebGLUniformLocation | null;
  private readonly uBlurRadius: WebGLUniformLocation | null;
  private readonly uTime: WebGLUniformLocation | null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, BG_VERTEX_SHADER, BG_FRAGMENT_SHADER);
    this.uResolution = gl.getUniformLocation(this.program, 'u_resolution');
    this.uTopLeft = gl.getUniformLocation(this.program, 'u_topLeftColor');
    this.uBottomRight = gl.getUniformLocation(this.program, 'u_bottomRightColor');
    this.uAccent = gl.getUniformLocation(this.program, 'u_accentColor');
    this.uGrid = gl.getUniformLocation(this.program, 'u_gridColor');
    this.uPatternMode = gl.getUniformLocation(this.program, 'u_patternMode');
    this.uPatternScale = gl.getUniformLocation(this.program, 'u_patternScale');
    this.uPatternOpacity = gl.getUniformLocation(this.program, 'u_patternOpacity');
    this.uBlurRadius = gl.getUniformLocation(this.program, 'u_blurRadius');
    this.uTime = gl.getUniformLocation(this.program, 'u_time');

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    if (!vao || !vbo) {
      throw new Error('Failed to create BackgroundPass vertex buffers');
    }
    this.vao = vao;
    this.vbo = vbo;

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_QUAD_VERTS, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 2 * 4, 0);
  }

  render(scene: FrameScene, canvasWidth: number, canvasHeight: number): void {
    const gl = this.gl;
    const { width, height } = safeCanvasDimensions(canvasWidth, canvasHeight);
    const params = resolveBackgroundShaderParams(scene.background, scene.time);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(this.uResolution, width, height);
    gl.uniform3f(this.uTopLeft, ...params.topLeftColor);
    gl.uniform3f(this.uBottomRight, ...params.bottomRightColor);
    gl.uniform3f(this.uAccent, ...params.accentColor);
    gl.uniform3f(this.uGrid, ...params.gridColor);
    gl.uniform1i(this.uPatternMode, params.patternMode);
    gl.uniform1f(this.uPatternScale, params.patternScale);
    gl.uniform1f(this.uPatternOpacity, params.patternOpacity);
    gl.uniform1f(this.uBlurRadius, params.blurRadius);
    gl.uniform1f(this.uTime, params.time);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    this.gl.deleteBuffer(this.vbo);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.program);
  }
}
