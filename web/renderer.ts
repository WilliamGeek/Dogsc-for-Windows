/**
 * web/renderer.ts
 *
 * WebGL2 frame renderer for DogSC Windows.
 * Strictly adheres to docs/CONTRACTS.md §1 and §4 (browser ES module, NO node:* imports).
 */

import { makeFramePlan, type FramePlanResult } from '../src/render/FramePlan.ts';
import {
  decodeRecorderProject,
  makeRecorderProject,
  type RecorderProject,
} from '../src/core/ProjectMediaModel.ts';
import { makeProjectTimeline } from '../src/core/ProjectTimeline.ts';
import {
  makeZoomAnimationClip,
  makePointerEventRecord,
  makeNormalizedPoint,
  type PointerEventRecord,
  type PointerEventKind,
} from '../src/core/ZoomAnimation.ts';
import {
  projectedScreenQuadProjector,
  projectedScreenQuadProject,
  type ProjectedScreenQuad,
} from '../src/core/ScreenProjection.ts';
import {
  makeCompositionPoint,
  type CompositionPoint,
  type CompositionRect,
} from '../src/core/CompositionScene.ts';
import {
  frameCursorSceneEffectiveClickColor,
  type FrameScene,
  type FrameScreenScene,
  type FrameBackgroundScene,
  type FrameCursorScene,
} from '../src/core/FrameScene.ts';
import { hexColorComponents } from '../src/core/HexColor.ts';
import {
  CursorRenderGeometry,
  type CursorClickGeometryFrame,
} from '../src/core/CursorRenderGeometry.ts';
import { runExportLoop } from './exporter.ts';

export interface RendererPlanContext {
  fps: number;
  width: number;
  height: number;
  frameCount: number;
  sourceFrameCount: number;
  durationSeconds: number;
  framesBaseUrl: string | null;
  plan: FramePlanResult;
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
  const safeWidth = canvasWidth > 0 ? canvasWidth : 1920;
  const safeHeight = canvasHeight > 0 ? canvasHeight : 1080;

  const mapper = projectedScreenQuadProjector(quad, sourceRect);
  const px = mapper && Number.isFinite(mapper.perspectiveX) ? mapper.perspectiveX : 0;
  const py = mapper && Number.isFinite(mapper.perspectiveY) ? mapper.perspectiveY : 0;

  const w0 = 1.0;
  const w1 = Math.max(1.0 + px, 1e-4);
  const w2 = Math.max(1.0 + px + py, 1e-4);
  const w3 = Math.max(1.0 + py, 1e-4);

  const toNdcX = (x: number): number => (x / safeWidth) * 2 - 1;
  const toNdcY = (y: number): number => 1 - (y / safeHeight) * 2;

  const c0: [number, number, number, number, number] = [
    toNdcX(quad.topLeft.x),
    toNdcY(quad.topLeft.y),
    w0,
    0,
    0,
  ];
  const c1: [number, number, number, number, number] = [
    toNdcX(quad.topRight.x),
    toNdcY(quad.topRight.y),
    w1,
    1,
    0,
  ];
  const c2: [number, number, number, number, number] = [
    toNdcX(quad.bottomRight.x),
    toNdcY(quad.bottomRight.y),
    w2,
    1,
    1,
  ];
  const c3: [number, number, number, number, number] = [
    toNdcX(quad.bottomLeft.x),
    toNdcY(quad.bottomLeft.y),
    w3,
    0,
    1,
  ];

  return new Float32Array([
    ...c0,
    ...c1,
    ...c2,
    ...c0,
    ...c2,
    ...c3,
  ]);
}

export interface ScreenShaderUniforms {
  screenSize: [number, number];
  cornerRadius: number;
  effectiveBorderWidth: number;
  borderColor: [number, number, number, number];
}

/**
 * Pure function: extracts rounded-corner and anti-aliased border uniforms from FrameScreenScene.
 */
export function computeScreenShaderUniforms(screen: FrameScreenScene): ScreenShaderUniforms {
  const w = Number.isFinite(screen.finalRect.width) ? Math.max(screen.finalRect.width, 1) : 1;
  const h = Number.isFinite(screen.finalRect.height) ? Math.max(screen.finalRect.height, 1) : 1;
  const cornerRadius = Number.isFinite(screen.cornerRadius) ? Math.max(screen.cornerRadius, 0) : 0;
  const bw = Number.isFinite(screen.borderWidth) ? Math.max(screen.borderWidth, 0) : 0;
  const bo = Number.isFinite(screen.borderOpacity) ? Math.min(Math.max(screen.borderOpacity, 0), 1) : 0;

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

  const safeWidth = canvasWidth > 0 ? canvasWidth : 1920;
  const safeHeight = canvasHeight > 0 ? canvasHeight : 1080;
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

export interface BackgroundShaderParams {
  topLeftColor: [number, number, number];
  bottomRightColor: [number, number, number];
  accentColor: [number, number, number];
  gridColor: [number, number, number];
  patternMode: number; // 0=pure gradient, 1=orthogonal grid, 2=dot matrix, 3=isometric/flow
  patternScale: number;
  patternOpacity: number;
  time: number;
}

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
  const safeTime = Number.isFinite(time) ? time : 0;

  if (bg.source.kind === 'pattern') {
    switch (bg.source.preset) {
      case '黑曜石网格':
        return {
          topLeftColor: [0.06, 0.08, 0.12],
          bottomRightColor: [0.13, 0.16, 0.24],
          accentColor: [0.22, 0.34, 0.56],
          gridColor: [0.55, 0.65, 0.85],
          patternMode: 1,
          patternScale: safeScale,
          patternOpacity: safeOpacity,
          time: safeTime,
        };
      case '工程白网格':
        return {
          topLeftColor: [0.94, 0.95, 0.98],
          bottomRightColor: [0.84, 0.88, 0.94],
          accentColor: [0.72, 0.8, 0.95],
          gridColor: [0.35, 0.42, 0.55],
          patternMode: 1,
          patternScale: safeScale,
          patternOpacity: safeOpacity,
          time: safeTime,
        };
      case '暗夜星阵':
        return {
          topLeftColor: [0.04, 0.05, 0.1],
          bottomRightColor: [0.11, 0.09, 0.22],
          accentColor: [0.35, 0.22, 0.6],
          gridColor: [0.7, 0.78, 1.0],
          patternMode: 2,
          patternScale: safeScale,
          patternOpacity: safeOpacity,
          time: safeTime,
        };
      case '建筑极简点':
        return {
          topLeftColor: [0.92, 0.91, 0.89],
          bottomRightColor: [0.84, 0.83, 0.8],
          accentColor: [0.96, 0.94, 0.9],
          gridColor: [0.25, 0.25, 0.28],
          patternMode: 2,
          patternScale: safeScale,
          patternOpacity: safeOpacity,
          time: safeTime,
        };
      case '立体等角网':
        return {
          topLeftColor: [0.08, 0.12, 0.16],
          bottomRightColor: [0.14, 0.22, 0.28],
          accentColor: [0.16, 0.5, 0.55],
          gridColor: [0.45, 0.82, 0.88],
          patternMode: 3,
          patternScale: safeScale,
          patternOpacity: safeOpacity,
          time: safeTime,
        };
    }
  }

  if (bg.source.kind === 'dynamicFlow') {
    switch (bg.source.preset) {
      case '赛博微流网格':
        return {
          topLeftColor: [0.09, 0.07, 0.14],
          bottomRightColor: [0.2, 0.14, 0.08],
          accentColor: [0.78, 0.56, 0.2],
          gridColor: [0.95, 0.78, 0.35],
          patternMode: 3,
          patternScale: safeScale,
          patternOpacity: safeOpacity,
          time: safeTime,
        };
      case '星辉漫步点阵':
        return {
          topLeftColor: [0.07, 0.06, 0.12],
          bottomRightColor: [0.18, 0.12, 0.18],
          accentColor: [0.65, 0.38, 0.45],
          gridColor: [0.98, 0.86, 0.7],
          patternMode: 2,
          patternScale: safeScale,
          patternOpacity: safeOpacity,
          time: safeTime,
        };
      case '极光流体星云':
        return {
          topLeftColor: [0.05, 0.11, 0.18],
          bottomRightColor: [0.12, 0.25, 0.38],
          accentColor: [0.35, 0.68, 0.92],
          gridColor: [0.75, 0.92, 1.0],
          patternMode: 3,
          patternScale: safeScale,
          patternOpacity: safeOpacity,
          time: safeTime,
        };
    }
  }

  // Fallback for wallpaper images/videos
  return {
    topLeftColor: [0.07, 0.09, 0.14],
    bottomRightColor: [0.15, 0.19, 0.28],
    accentColor: [0.28, 0.38, 0.62],
    gridColor: [0.6, 0.7, 0.9],
    patternMode: 1,
    patternScale: safeScale,
    patternOpacity: safeOpacity * 0.6,
    time: safeTime,
  };
}

export interface CursorClickEffectPass {
  tipPx: CompositionPoint;
  clickGeo: CursorClickGeometryFrame | null;
  clickColor: [number, number, number];
}

/**
 * Pure function: maps cursor tip through 3D screen homography and computes click ripple geometry.
 */
export function computeCursorClickEffectPass(
  cursor: FrameCursorScene,
  screen: FrameScreenScene
): CursorClickEffectPass {
  const projected = projectedScreenQuadProject(
    screen.projectedQuad,
    cursor.layout.pointer,
    screen.finalRect
  );
  const tipPx = projected ?? cursor.layout.pointer;

  let clickGeo: CursorClickGeometryFrame | null = null;
  if (cursor.clickPhase !== null) {
    clickGeo = CursorRenderGeometry.clickGeometry(
      cursor.clickStyle,
      cursor.clickPhase.progress,
      cursor.layout.clickEffectHeight,
      cursor.clickOpacity,
      cursor.clickScale
    );
  }

  const rgb = hexColorComponents(frameCursorSceneEffectiveClickColor(cursor));
  return {
    tipPx,
    clickGeo,
    clickColor: [rgb.red, rgb.green, rgb.blue],
  };
}

const ARROW_LOCAL_VERTS: ReadonlyArray<[number, number]> = [
  [0.0, 0.0],   // A: tip
  [0.0, 1.0],   // B: left vertical bottom
  [0.28, 0.72], // C: left inner fold
  [0.46, 1.08], // D: tail bottom-left
  [0.6, 1.01],  // E: tail bottom-right
  [0.42, 0.66], // F: right inner fold
  [0.72, 0.66], // G: right wing tip
];

const ARROW_TRI_INDICES: ReadonlyArray<[number, number, number]> = [
  [0, 1, 2], // A, B, C
  [0, 2, 5], // A, C, F
  [0, 5, 6], // A, F, G
  [2, 3, 4], // C, D, E
  [2, 4, 5], // C, E, F
];

/**
 * Pure function: generates 5 triangles (15 2D vertices, 30 floats in canvas pixels)
 * forming a sharp arrow cursor polygon with its tip anchored at `tip`.
 */
export function buildCursorArrowTriangles(
  tip: CompositionPoint,
  height: number,
  rotationRadians: number,
  isClicking: boolean,
  scaleMultiplier: number = 1.0,
  offset?: CompositionPoint
): Float32Array {
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 32;
  const clickFactor = isClicking ? 0.92 : 1.0;
  const rot = Number.isFinite(rotationRadians) ? rotationRadians : 0;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  const ox = offset?.x ?? 0;
  const oy = offset?.y ?? 0;
  const scale = Number.isFinite(scaleMultiplier) && scaleMultiplier > 0 ? scaleMultiplier : 1.0;

  // Pivot around visual centroid when outlining so tip also receives outline expansion
  const cx = 0.26;
  const cy = 0.54;

  const out = new Float32Array(30);
  let ptr = 0;

  for (const [i0, i1, i2] of ARROW_TRI_INDICES) {
    for (const idx of [i0, i1, i2]) {
      const [lx, ly] = ARROW_LOCAL_VERTS[idx];
      const sx = scale === 1.0 ? lx : cx + (lx - cx) * scale;
      const sy = scale === 1.0 ? ly : cy + (ly - cy) * scale;
      const pxLocal = sx * safeHeight * clickFactor;
      const pyLocal = sy * safeHeight * clickFactor;

      const rx = pxLocal * cosR - pyLocal * sinR;
      const ry = pxLocal * sinR + pyLocal * cosR;

      out[ptr++] = tip.x + ox + rx;
      out[ptr++] = tip.y + oy + ry;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Shaders (T11.4 + T11.5a/b/c/d Background, Shadow, Screen, Click & Cursor)
// ---------------------------------------------------------------------------

const BG_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_uv = a_pos * 0.5 + 0.5;
}
`;

const BG_FRAGMENT_SHADER = `#version 300 es
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
  float patternMask = 0.0;

  if (u_patternMode == 1) {
    // Orthogonal grid
    vec2 cell = abs(fract(px / spacing - 0.5) - 0.5) * spacing;
    float dLine = min(cell.x, cell.y);
    patternMask = (1.0 - smoothstep(0.4, 1.4, dLine)) * 0.16;
  } else if (u_patternMode == 2) {
    // Dot matrix
    vec2 drift = vec2(u_time * 6.0, u_time * 4.0);
    vec2 cell = (fract((px + drift) / spacing) - 0.5) * spacing;
    float dDot = length(cell);
    patternMask = (1.0 - smoothstep(1.2, 2.4, dDot)) * 0.24;
  } else if (u_patternMode == 3) {
    // Isometric / diagonal flow grid
    float angle = 0.52359877; // 30 deg
    mat2 rotA = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
    mat2 rotB = mat2(cos(-angle), -sin(-angle), sin(-angle), cos(-angle));
    vec2 pA = rotA * (px + vec2(u_time * 10.0, 0.0));
    vec2 pB = rotB * (px - vec2(0.0, u_time * 8.0));
    vec2 cA = abs(fract(pA / spacing - 0.5) - 0.5) * spacing;
    vec2 cB = abs(fract(pB / spacing - 0.5) - 0.5) * spacing;
    float dIso = min(cA.x, cB.x);
    patternMask = (1.0 - smoothstep(0.4, 1.5, dIso)) * 0.18;
  }

  col = mix(col, u_gridColor, clamp(patternMask * u_patternOpacity, 0.0, 0.45));
  fragColor = vec4(col, 1.0);
}
`;

const SCREEN_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_ndc;
layout(location = 1) in float a_w;
layout(location = 2) in vec2 a_uv;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_ndc.x * a_w, a_ndc.y * a_w, 0.0, a_w);
  v_uv = a_uv;
}
`;

const SCREEN_FRAGMENT_SHADER = `#version 300 es
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

const SHADOW_FRAGMENT_SHADER = `#version 300 es
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

const CLICK_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_localPos;
uniform vec2 u_resolution;
out vec2 v_localPos;
void main() {
  vec2 ndc = vec2(
    (a_pos.x / u_resolution.x) * 2.0 - 1.0,
    1.0 - (a_pos.y / u_resolution.y) * 2.0
  );
  gl_Position = vec4(ndc, 0.0, 1.0);
  v_localPos = a_localPos;
}
`;

const CLICK_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_localPos;
uniform vec3 u_clickColor;
uniform float u_primaryRadius;
uniform float u_primaryLineWidth;
uniform float u_primaryOpacity;
uniform int u_primaryIsFilled;
uniform float u_secondaryRadius;
uniform float u_secondaryOpacity;
uniform int u_secondaryIsFilled;
out vec4 fragColor;

void main() {
  float dist = length(v_localPos);
  float alpha = 0.0;

  if (u_primaryRadius > 0.0 && u_primaryOpacity > 0.0) {
    if (u_primaryIsFilled == 1) {
      float fillMask = 1.0 - smoothstep(u_primaryRadius - 1.5, u_primaryRadius + 2.0, dist);
      alpha = max(alpha, fillMask * u_primaryOpacity);
    } else {
      float halfW = max(u_primaryLineWidth * 0.5, 0.75);
      float ringDist = abs(dist - u_primaryRadius);
      float ringMask = 1.0 - smoothstep(halfW - 0.8, halfW + 0.8, ringDist);
      alpha = max(alpha, ringMask * u_primaryOpacity);
    }
  }

  if (u_secondaryRadius > 0.0 && u_secondaryOpacity > 0.0) {
    if (u_secondaryIsFilled == 1) {
      float innerMask = 1.0 - smoothstep(u_secondaryRadius - 1.0, u_secondaryRadius + 1.5, dist);
      alpha = max(alpha, innerMask * u_secondaryOpacity);
    } else {
      float ringDist2 = abs(dist - u_secondaryRadius);
      float ringMask2 = 1.0 - smoothstep(0.6, 1.8, ringDist2);
      alpha = max(alpha, ringMask2 * u_secondaryOpacity);
    }
  }

  if (alpha <= 0.001) {
    discard;
  }
  fragColor = vec4(u_clickColor, alpha);
}
`;

const CURSOR_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_pos;
uniform vec2 u_resolution;
void main() {
  vec2 ndc = vec2(
    (a_pos.x / u_resolution.x) * 2.0 - 1.0,
    1.0 - (a_pos.y / u_resolution.y) * 2.0
  );
  gl_Position = vec4(ndc, 0.0, 1.0);
}
`;

const CURSOR_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 fragColor;
void main() {
  fragColor = u_color;
}
`;

// ---------------------------------------------------------------------------
// Browser Helpers (never called in Node tests)
// ---------------------------------------------------------------------------

function compileShader(
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

function createProgram(
  gl: WebGL2RenderingContext,
  vertexSrc: string,
  fragmentSrc: string
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc);
  const program = gl.createProgram();
  if (!program) {
    throw new Error('Failed to create WebGL2 program');
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown link error';
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return program;
}

function parsePointerJsonlInline(text: string, offsetSeconds: number): PointerEventRecord[] {
  const lines = text.split(/\r?\n/);
  let screen: { x: number; y: number; w: number; h: number } | null = null;
  let startIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    try {
      const hdr = JSON.parse(trimmed);
      if (hdr && hdr.hdr === 1 && hdr.screen && hdr.screen.w > 0 && hdr.screen.h > 0) {
        screen = hdr.screen;
        startIdx = i + 1;
      }
    } catch {
      // ignore
    }
    break;
  }

  if (!screen) return [];
  const validKinds = new Set<PointerEventKind>(['move', 'leftClick', 'rightClick']);
  const events: PointerEventRecord[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    try {
      const item = JSON.parse(trimmed);
      if (!item || !validKinds.has(item.k)) continue;
      if (typeof item.t !== 'number' || typeof item.x !== 'number' || typeof item.y !== 'number') {
        continue;
      }
      const nx = Math.min(Math.max((item.x - screen.x) / screen.w, 0), 1);
      const ny = Math.min(Math.max((item.y - screen.y) / screen.h, 0), 1);
      events.push(
        makePointerEventRecord({
          time: item.t + offsetSeconds,
          location: makeNormalizedPoint(nx, ny),
          kind: item.k,
        })
      );
    } catch {
      continue;
    }
  }
  events.sort((a, b) => a.time - b.time);
  return events;
}

function buildFallbackDemoContext(): RendererPlanContext {
  const zoomClip = makeZoomAnimationClip({
    id: 'demo-zoom-1',
    startTime: 0.5,
    duration: 2.0,
    scale: 1.5,
    focus: makeNormalizedPoint(0.45, 0.45),
  });
  const timeline = makeProjectTimeline({ zoomClips: [zoomClip] });
  const project = makeRecorderProject({
    timeline,
    zoomAnimations: [zoomClip],
  });
  const pointerEvents: PointerEventRecord[] = [
    makePointerEventRecord({ time: 0.0, location: makeNormalizedPoint(0.25, 0.3), kind: 'move' }),
    makePointerEventRecord({ time: 0.7, location: makeNormalizedPoint(0.45, 0.45), kind: 'leftClick' }),
    makePointerEventRecord({ time: 2.5, location: makeNormalizedPoint(0.7, 0.6), kind: 'move' }),
  ];

  const fps = 60;
  const durationSeconds = 3.0;
  const width = 1920;
  const height = 1080;
  const sourceFrameCount = 180;

  const plan = makeFramePlan({
    project,
    pointerEvents,
    fps,
    durationSeconds,
    sourceFrameCount,
    canvas: { width, height },
  });

  return {
    fps,
    width,
    height,
    frameCount: plan.frameCount,
    sourceFrameCount,
    durationSeconds,
    framesBaseUrl: null,
    plan,
  };
}

async function loadPlanContext(params: URLSearchParams): Promise<RendererPlanContext> {
  // 1. Try /api/plan (used by ExportServer)
  try {
    const planRes = await fetch('/api/plan', { cache: 'no-store' });
    if (planRes.ok) {
      const payload = await planRes.json();
      const project: RecorderProject = decodeRecorderProject(payload.project);
      const pointerEvents: PointerEventRecord[] = Array.isArray(payload.pointerEvents)
        ? payload.pointerEvents
        : [];
      const fps = Number(payload.fps) || 60;
      const width = Number(payload.width) || 1920;
      const height = Number(payload.height) || 1080;
      const durationSeconds = Number(payload.durationSeconds) || 1;
      const sourceFrameCount = Number(payload.sourceFrameCount) || 1;
      const plan = makeFramePlan({
        project,
        pointerEvents,
        fps,
        durationSeconds,
        sourceFrameCount,
        canvas: { width, height },
      });
      return {
        fps,
        width,
        height,
        frameCount: Number(payload.frameCount) || plan.frameCount,
        sourceFrameCount,
        durationSeconds,
        framesBaseUrl: typeof payload.framesBaseUrl === 'string' ? payload.framesBaseUrl : '/frames',
        plan,
      };
    }
  } catch {
    // /api/plan not available on pure DevServer, fall back below
  }

  // 2. Try ?dir=/recordings/<id> on DevServer
  const dir = params.get('dir');
  if (dir) {
    try {
      const normalizedDir = dir.endsWith('/') ? dir.slice(0, -1) : dir;
      const [metaRes, projRes] = await Promise.all([
        fetch(`${normalizedDir}/meta.json`),
        fetch(`${normalizedDir}/project.json`),
      ]);
      if (metaRes.ok && projRes.ok) {
        const meta = await metaRes.json();
        const projJson = await projRes.json();
        const project = decodeRecorderProject(projJson);
        let pointerEvents: PointerEventRecord[] = [];
        try {
          const ptrRes = await fetch(`${normalizedDir}/pointer.jsonl`);
          if (ptrRes.ok) {
            const text = await ptrRes.text();
            pointerEvents = parsePointerJsonlInline(text, Number(meta.pointerOffsetSeconds) || 0);
          }
        } catch {
          // ignore
        }
        const fps = Number(meta.fps) || 60;
        const width = Number(meta.width) || 1920;
        const height = Number(meta.height) || 1080;
        const durationSeconds = Number(meta.durationSeconds) || 3;
        const sourceFrameCount = Math.max(Math.round(durationSeconds * fps), 1);
        const plan = makeFramePlan({
          project,
          pointerEvents,
          fps,
          durationSeconds,
          sourceFrameCount,
          canvas: { width, height },
        });
        return {
          fps,
          width,
          height,
          frameCount: plan.frameCount,
          sourceFrameCount,
          durationSeconds,
          framesBaseUrl: `${normalizedDir}/frames`,
          plan,
        };
      }
    } catch {
      // fall back to demo
    }
  }

  return buildFallbackDemoContext();
}

function createProceduralFallbackCanvas(
  width: number,
  height: number,
  frameFileNumber: number
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  if (!ctx) return c;

  // Desktop wallpaper gradient
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#0f172a');
  grad.addColorStop(0.5, '#1e293b');
  grad.addColorStop(1, '#312e81');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Mock desktop window frame
  const wx = width * 0.12;
  const wy = height * 0.1;
  const ww = width * 0.76;
  const wh = height * 0.78;
  ctx.fillStyle = '#18181b';
  ctx.fillRect(wx, wy, ww, wh);
  ctx.strokeStyle = '#3f3f46';
  ctx.lineWidth = 3;
  ctx.strokeRect(wx, wy, ww, wh);

  // Title bar
  ctx.fillStyle = '#27272a';
  ctx.fillRect(wx, wy, ww, 48);
  const colors = ['#ef4444', '#f59e0b', '#10b981'];
  colors.forEach((col, idx) => {
    ctx.beginPath();
    ctx.arc(wx + 28 + idx * 24, wy + 24, 7, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
  });

  // Code lines inside mock editor
  const lineColors = ['#38bdf8', '#a855f7', '#34d399', '#f472b6', '#94a3b8'];
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = lineColors[i % lineColors.length];
    const lw = ((i * 137) % 450) + 180;
    ctx.fillRect(wx + 60, wy + 100 + i * 44, lw, 16);
  }

  // Frame indicator
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 36px monospace';
  ctx.fillText(`DogSC Frame #${String(frameFileNumber).padStart(6, '0')}`, wx + 60, wy + wh - 50);

  return c;
}

async function loadImage(url: string): Promise<HTMLImageElement | null> {
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      img.src = url;
    });
    return img;
  } catch {
    return null;
  }
}

async function loadFrameBitmap(url: string): Promise<ImageBitmap | HTMLImageElement | null> {
  if (typeof fetch === 'function' && typeof createImageBitmap === 'function') {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return null;
      const blob = await res.blob();
      return await createImageBitmap(blob);
    } catch {
      return null;
    }
  }
  return loadImage(url);
}

async function bootstrapBrowser(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode') ?? 'preview';
  const frameParam = Number.parseInt(params.get('frame') ?? '0', 10);
  const initialFrame = Number.isFinite(frameParam) && frameParam >= 0 ? frameParam : 0;

  const ctx = await loadPlanContext(params);

  const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
  if (!canvas) {
    throw new Error('Missing canvas#stage element');
  }
  canvas.width = ctx.width;
  canvas.height = ctx.height;

  const gl = canvas.getContext('webgl2', {
    preserveDrawingBuffer: true,
    alpha: false,
    antialias: true,
  });
  if (!gl) {
    throw new Error('WebGL2 context unavailable');
  }

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const bgProgram = createProgram(gl, BG_VERTEX_SHADER, BG_FRAGMENT_SHADER);
  const uBgResolution = gl.getUniformLocation(bgProgram, 'u_resolution');
  const uBgTopLeft = gl.getUniformLocation(bgProgram, 'u_topLeftColor');
  const uBgBottomRight = gl.getUniformLocation(bgProgram, 'u_bottomRightColor');
  const uBgAccent = gl.getUniformLocation(bgProgram, 'u_accentColor');
  const uBgGrid = gl.getUniformLocation(bgProgram, 'u_gridColor');
  const uBgPatternMode = gl.getUniformLocation(bgProgram, 'u_patternMode');
  const uBgPatternScale = gl.getUniformLocation(bgProgram, 'u_patternScale');
  const uBgPatternOpacity = gl.getUniformLocation(bgProgram, 'u_patternOpacity');
  const uBgTime = gl.getUniformLocation(bgProgram, 'u_time');

  const bgVao = gl.createVertexArray();
  const bgVbo = gl.createBuffer();
  gl.bindVertexArray(bgVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, bgVbo);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]),
    gl.STATIC_DRAW
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 2 * 4, 0);

  const program = createProgram(gl, SCREEN_VERTEX_SHADER, SCREEN_FRAGMENT_SHADER);
  const uScreenTex = gl.getUniformLocation(program, 'u_screenTex');
  const uSourceCrop = gl.getUniformLocation(program, 'u_sourceCrop');
  const uOpacity = gl.getUniformLocation(program, 'u_opacity');
  const uScreenSize = gl.getUniformLocation(program, 'u_screenSize');
  const uCornerRadius = gl.getUniformLocation(program, 'u_cornerRadius');
  const uBorderWidth = gl.getUniformLocation(program, 'u_borderWidth');
  const uBorderColor = gl.getUniformLocation(program, 'u_borderColor');

  const shadowProgram = createProgram(gl, SCREEN_VERTEX_SHADER, SHADOW_FRAGMENT_SHADER);
  const uShadowScreenSize = gl.getUniformLocation(shadowProgram, 'u_screenSize');
  const uShadowCornerRadius = gl.getUniformLocation(shadowProgram, 'u_cornerRadius');
  const uShadowOffset = gl.getUniformLocation(shadowProgram, 'u_shadowOffset');
  const uShadowRadius = gl.getUniformLocation(shadowProgram, 'u_shadowRadius');
  const uShadowColor = gl.getUniformLocation(shadowProgram, 'u_shadowColor');

  const clickProgram = createProgram(gl, CLICK_VERTEX_SHADER, CLICK_FRAGMENT_SHADER);
  const uClickResolution = gl.getUniformLocation(clickProgram, 'u_resolution');
  const uClickColor = gl.getUniformLocation(clickProgram, 'u_clickColor');
  const uClickPrimaryRadius = gl.getUniformLocation(clickProgram, 'u_primaryRadius');
  const uClickPrimaryLineWidth = gl.getUniformLocation(clickProgram, 'u_primaryLineWidth');
  const uClickPrimaryOpacity = gl.getUniformLocation(clickProgram, 'u_primaryOpacity');
  const uClickPrimaryIsFilled = gl.getUniformLocation(clickProgram, 'u_primaryIsFilled');
  const uClickSecondaryRadius = gl.getUniformLocation(clickProgram, 'u_secondaryRadius');
  const uClickSecondaryOpacity = gl.getUniformLocation(clickProgram, 'u_secondaryOpacity');
  const uClickSecondaryIsFilled = gl.getUniformLocation(clickProgram, 'u_secondaryIsFilled');

  const clickVao = gl.createVertexArray();
  const clickVbo = gl.createBuffer();
  gl.bindVertexArray(clickVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, clickVbo);
  gl.bufferData(gl.ARRAY_BUFFER, 24 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 4 * 4, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 4 * 4, 2 * 4);

  const cursorProgram = createProgram(gl, CURSOR_VERTEX_SHADER, CURSOR_FRAGMENT_SHADER);
  const uCursorResolution = gl.getUniformLocation(cursorProgram, 'u_resolution');
  const uCursorColor = gl.getUniformLocation(cursorProgram, 'u_color');

  const cursorVao = gl.createVertexArray();
  const cursorVbo = gl.createBuffer();
  gl.bindVertexArray(cursorVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, cursorVbo);
  gl.bufferData(gl.ARRAY_BUFFER, 30 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 2 * 4, 0);

  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, 30 * 4, gl.DYNAMIC_DRAW);

  const stride = 5 * 4;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 2 * 4);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 3 * 4);

  const screenTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, screenTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  let cachedFileNum = -1;

  const renderFrameAt = async (n: number): Promise<void> => {
    const { scene, sourceFrameFile } = ctx.plan.frameAt(n);

    if (sourceFrameFile !== cachedFileNum) {
      let uploaded = false;
      if (ctx.framesBaseUrl) {
        const padded = String(sourceFrameFile).padStart(6, '0');
        const imgUrl = `${ctx.framesBaseUrl}/${padded}.jpg`;
        const sourceImg = await loadFrameBitmap(imgUrl);
        if (sourceImg) {
          try {
            gl.bindTexture(gl.TEXTURE_2D, screenTex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceImg);
            uploaded = true;
          } finally {
            if ('close' in sourceImg && typeof sourceImg.close === 'function') {
              sourceImg.close();
            }
          }
        }
      }
      if (!uploaded) {
        const fallbackCanvas = createProceduralFallbackCanvas(ctx.width, ctx.height, sourceFrameFile);
        gl.bindTexture(gl.TEXTURE_2D, screenTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, fallbackCanvas);
      }
      cachedFileNum = sourceFrameFile;
    }

    gl.viewport(0, 0, ctx.width, ctx.height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Background pass
    const bgParams = resolveBackgroundShaderParams(scene.background, scene.time);
    gl.useProgram(bgProgram);
    gl.bindVertexArray(bgVao);
    gl.uniform2f(uBgResolution, ctx.width, ctx.height);
    gl.uniform3f(uBgTopLeft, ...bgParams.topLeftColor);
    gl.uniform3f(uBgBottomRight, ...bgParams.bottomRightColor);
    gl.uniform3f(uBgAccent, ...bgParams.accentColor);
    gl.uniform3f(uBgGrid, ...bgParams.gridColor);
    gl.uniform1i(uBgPatternMode, bgParams.patternMode);
    gl.uniform1f(uBgPatternScale, bgParams.patternScale);
    gl.uniform1f(uBgPatternOpacity, bgParams.patternOpacity);
    gl.uniform1f(uBgTime, bgParams.time);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    const screenUniforms = computeScreenShaderUniforms(scene.screen);

    // Shadow pass (rendered behind screen)
    const shadowVerts = buildShadowQuadVertices(scene.screen, ctx.width, ctx.height);
    if (shadowVerts && scene.screen.shadow) {
      const sRgb = hexColorComponents(scene.screen.shadow.color);
      gl.useProgram(shadowProgram);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, shadowVerts);

      gl.uniform2f(uShadowScreenSize, screenUniforms.screenSize[0], screenUniforms.screenSize[1]);
      gl.uniform1f(uShadowCornerRadius, screenUniforms.cornerRadius);
      gl.uniform2f(uShadowOffset, scene.screen.shadow.offset.x, scene.screen.shadow.offset.y);
      gl.uniform1f(uShadowRadius, scene.screen.shadow.radius);
      gl.uniform4f(
        uShadowColor,
        sRgb.red,
        sRgb.green,
        sRgb.blue,
        scene.screen.shadow.opacity * scene.screen.opacity
      );
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    const vertices = buildProjectedQuadVertices(
      scene.screen.projectedQuad,
      scene.screen.finalRect,
      ctx.width,
      ctx.height
    );

    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, screenTex);
    gl.uniform1i(uScreenTex, 0);
    gl.uniform4f(
      uSourceCrop,
      scene.screen.sourceCrop.x,
      scene.screen.sourceCrop.y,
      scene.screen.sourceCrop.width,
      scene.screen.sourceCrop.height
    );
    gl.uniform1f(uOpacity, scene.screen.opacity);

    gl.uniform2f(uScreenSize, screenUniforms.screenSize[0], screenUniforms.screenSize[1]);
    gl.uniform1f(uCornerRadius, screenUniforms.cornerRadius);
    gl.uniform1f(uBorderWidth, screenUniforms.effectiveBorderWidth);
    gl.uniform4f(
      uBorderColor,
      screenUniforms.borderColor[0],
      screenUniforms.borderColor[1],
      screenUniforms.borderColor[2],
      screenUniforms.borderColor[3]
    );

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Cursor & click ripple pass (T11.5d)
    if (scene.cursor && scene.cursor.assetID !== 'system.hidden') {
      const clickPass = computeCursorClickEffectPass(scene.cursor, scene.screen);

      if (clickPass.clickGeo) {
        const geo = clickPass.clickGeo;
        const rBound = Math.max(geo.maxFootprintDiameter * 0.65, 32);
        const cx = clickPass.tipPx.x;
        const cy = clickPass.tipPx.y;
        const clickVerts = new Float32Array([
          cx - rBound, cy - rBound, -rBound, -rBound,
          cx + rBound, cy - rBound,  rBound, -rBound,
          cx + rBound, cy + rBound,  rBound,  rBound,
          cx - rBound, cy - rBound, -rBound, -rBound,
          cx + rBound, cy + rBound,  rBound,  rBound,
          cx - rBound, cy + rBound, -rBound,  rBound,
        ]);

        gl.useProgram(clickProgram);
        gl.bindVertexArray(clickVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, clickVbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, clickVerts);

        gl.uniform2f(uClickResolution, ctx.width, ctx.height);
        gl.uniform3f(uClickColor, ...clickPass.clickColor);
        gl.uniform1f(uClickPrimaryRadius, geo.primaryDiameter * 0.5);
        gl.uniform1f(uClickPrimaryLineWidth, geo.primaryLineWidth);
        gl.uniform1f(uClickPrimaryOpacity, geo.primaryOpacity);
        gl.uniform1i(uClickPrimaryIsFilled, geo.primaryIsFilled ? 1 : 0);
        gl.uniform1f(uClickSecondaryRadius, geo.secondaryDiameter * 0.5);
        gl.uniform1f(uClickSecondaryOpacity, geo.secondaryOpacity);
        gl.uniform1i(uClickSecondaryIsFilled, geo.secondaryIsFilled ? 1 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }

      const cursorHeight = scene.cursor.layout.size.height;
      gl.useProgram(cursorProgram);
      gl.bindVertexArray(cursorVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, cursorVbo);
      gl.uniform2f(uCursorResolution, ctx.width, ctx.height);

      // 1. Cursor drop shadow
      if (scene.cursor.shadow && scene.cursor.shadow.opacity > 0) {
        const sVerts = buildCursorArrowTriangles(
          clickPass.tipPx,
          cursorHeight,
          scene.cursor.rotationRadians,
          scene.cursor.isClicking,
          1.08,
          scene.cursor.shadow.offset
        );
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, sVerts);
        gl.uniform4f(uCursorColor, 0, 0, 0, scene.cursor.shadow.opacity * 0.7);
        gl.drawArrays(gl.TRIANGLES, 0, 15);
      }

      // 2. Dark outline (scaleMultiplier = 1.12)
      const outlineVerts = buildCursorArrowTriangles(
        clickPass.tipPx,
        cursorHeight,
        scene.cursor.rotationRadians,
        scene.cursor.isClicking,
        1.12
      );
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, outlineVerts);
      gl.uniform4f(uCursorColor, 0.06, 0.08, 0.12, 0.95);
      gl.drawArrays(gl.TRIANGLES, 0, 15);

      // 3. White fill (scaleMultiplier = 1.0)
      const fillVerts = buildCursorArrowTriangles(
        clickPass.tipPx,
        cursorHeight,
        scene.cursor.rotationRadians,
        scene.cursor.isClicking,
        1.0
      );
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, fillVerts);
      gl.uniform4f(uCursorColor, 0.99, 0.99, 1.0, 1.0);
      gl.drawArrays(gl.TRIANGLES, 0, 15);
    }

    gl.finish();
  };

  if (mode === 'export') {
    await runExportLoop(renderFrameAt, gl, ctx);
  } else {
    await renderFrameAt(initialFrame);
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  await bootstrapBrowser();
}
