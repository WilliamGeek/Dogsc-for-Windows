/**
 * web/passes/cursor.ts
 *
 * WebGL2 vector cursor (arrow, pointingHand, crosshair), velocity tilt, pressScale,
 * idle hiding, and 4 click effects (ripple, glow, pulse, burst).
 * Browser ESM & Node 24 strip-types compatible (NO node:* imports, NO enum/namespace).
 */

import type { CompositionPoint } from '../../src/core/CompositionScene.ts';
import {
  CursorRenderGeometry,
  type CursorClickGeometryFrame,
} from '../../src/core/CursorRenderGeometry.ts';
import {
  frameCursorSceneEffectiveClickColor,
  type FrameCursorScene,
  type FrameScene,
  type FrameScreenScene,
} from '../../src/core/FrameScene.ts';
import { hexColorComponents } from '../../src/core/HexColor.ts';
import type { CursorAssetID } from '../../src/core/ProjectModel.ts';
import { projectedScreenQuadProject } from '../../src/core/ScreenProjection.ts';
import { createProgram, safeCanvasDimensions } from './glUtils.ts';

export type NormalizedCursorShape = 'arrow' | 'pointingHand' | 'crosshair' | 'hidden';

export interface CursorClickEffectPass {
  tipPx: CompositionPoint;
  clickGeo: CursorClickGeometryFrame | null;
  clickColor: [number, number, number];
}

export interface CursorRenderParams {
  shape: Exclude<NormalizedCursorShape, 'hidden'>;
  tipPx: CompositionPoint;
  heightPx: number;
  rotationRadians: number;
  pressScale: number;
  opacity: number;
  clickPass: CursorClickEffectPass;
}

export interface ClickShaderUniforms {
  primaryRadius: number;
  primaryLineWidth: number;
  primaryOpacity: number;
  primaryIsFilled: 0 | 1;
  primaryGlowRadius: number;
  secondaryRadius: number;
  secondaryLineWidth: number;
  secondaryOpacity: number;
  secondaryIsFilled: 0 | 1;
  secondaryGlowRadius: number;
  accentOffset: number;
  accentSize: number;
  accentOpacity: number;
  maxFootprintRadius: number;
}

/**
 * Pure function: maps upstream / normalized CursorAssetID strings into 4 canonical cursor shapes.
 */
export function resolveCursorShape(assetID: CursorAssetID | string): NormalizedCursorShape {
  switch (assetID) {
    case 'hidden':
    case 'system.hidden':
      return 'hidden';
    case 'systemPointingHand':
    case 'system.pointingHand':
      return 'pointingHand';
    case 'systemCrosshair':
    case 'system.crosshair':
      return 'crosshair';
    default:
      return 'arrow';
  }
}

/**
 * Pure function: maps cursor tip through 3D screen homography and computes click ripple geometry.
 */
export function computeCursorClickEffectPass(
  cursor: FrameCursorScene,
  screen: FrameScreenScene
): CursorClickEffectPass {
  const projectionRect =
    screen.decoration.kind === 'chrome'
      ? screen.decoration.chrome.outerRect
      : screen.finalRect;
  const projected = projectedScreenQuadProject(
    screen.projectedQuad,
    cursor.layout.pointer,
    projectionRect
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

/**
 * Pure function: resolves complete cursor render state (shape, pressScale, motion tilt, opacity, click effect).
 * Returns null when cursor is idle-hidden or explicitly set to 'hidden'.
 */
export function computeCursorRenderParams(
  cursor: FrameCursorScene | null,
  screen: FrameScreenScene
): CursorRenderParams | null {
  if (!cursor) {
    return null;
  }
  const shape = resolveCursorShape(cursor.assetID);
  if (shape === 'hidden') {
    return null;
  }

  const rawPress = cursor.pressScale;
  const pressScale =
    typeof rawPress === 'number' && Number.isFinite(rawPress) && rawPress > 0 && rawPress !== 1
      ? rawPress
      : cursor.isClicking
        ? 0.92
        : 1.0;

  return {
    shape,
    tipPx: computeCursorClickEffectPass(cursor, screen).tipPx,
    heightPx:
      Number.isFinite(cursor.layout.size.height) && cursor.layout.size.height > 0
        ? cursor.layout.size.height
        : 32,
    rotationRadians: Number.isFinite(cursor.rotationRadians) ? cursor.rotationRadians : 0,
    pressScale,
    opacity: 1,
    clickPass: computeCursorClickEffectPass(cursor, screen),
  };
}

/**
 * Pure function: converts CursorClickGeometryFrame into exact GLSL shader uniforms for all 4 click styles.
 */
export function computeClickShaderUniforms(geo: CursorClickGeometryFrame): ClickShaderUniforms {
  return {
    primaryRadius: geo.primaryDiameter * 0.5,
    primaryLineWidth: geo.primaryLineWidth,
    primaryOpacity: geo.primaryOpacity,
    primaryIsFilled: geo.primaryIsFilled ? 1 : 0,
    primaryGlowRadius: geo.primaryGlowRadius,
    secondaryRadius: geo.secondaryDiameter * 0.5,
    secondaryLineWidth: geo.secondaryLineWidth,
    secondaryOpacity: geo.secondaryOpacity,
    secondaryIsFilled: geo.secondaryIsFilled ? 1 : 0,
    secondaryGlowRadius: geo.secondaryGlowRadius,
    accentOffset: geo.accentOffset,
    accentSize: geo.accentSize,
    accentOpacity: geo.accentOpacity,
    maxFootprintRadius: Math.max(geo.maxFootprintDiameter * 0.65, 32),
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
  [0, 1, 2],
  [0, 2, 5],
  [0, 5, 6],
  [2, 3, 4],
  [2, 4, 5],
];

const POINTING_HAND_LOCAL_VERTS: ReadonlyArray<[number, number]> = [
  [0.0, 0.0],    // 0: index fingertip hotspot
  [-0.08, 0.07], // 1: tip left shoulder
  [0.08, 0.07],  // 2: tip right shoulder
  [-0.09, 0.45], // 3: index base left
  [0.09, 0.45],  // 4: index base right
  [0.22, 0.42],  // 5: middle top
  [0.22, 0.54],  // 6: middle joint
  [0.34, 0.48],  // 7: ring top
  [0.34, 0.62],  // 8: ring joint
  [0.44, 0.55],  // 9: pinky top
  [0.41, 0.82],  // 10: outer palm right
  [-0.28, 0.58], // 11: thumb tip
  [-0.22, 0.76], // 12: thumb base
  [-0.14, 0.84], // 13: wrist left
  [0.32, 0.96],  // 14: wrist right
  [-0.10, 0.98], // 15: wrist bottom left
];

const POINTING_HAND_TRI_INDICES: ReadonlyArray<[number, number, number]> = [
  [0, 1, 2],
  [1, 3, 4],
  [1, 4, 2],
  [11, 12, 3],
  [12, 13, 3],
  [3, 13, 14],
  [3, 14, 4],
  [13, 15, 14],
  [4, 14, 6],
  [4, 6, 5],
  [6, 14, 8],
  [6, 8, 7],
  [8, 14, 10],
  [8, 10, 9],
];

const CROSSHAIR_LOCAL_VERTS: ReadonlyArray<[number, number]> = [
  // Top arm
  [-0.045, -0.48], [0.045, -0.48], [0.045, -0.11], [-0.045, -0.11],
  // Bottom arm
  [-0.045, 0.11], [0.045, 0.11], [0.045, 0.48], [-0.045, 0.48],
  // Left arm
  [-0.48, -0.045], [-0.11, -0.045], [-0.11, 0.045], [-0.48, 0.045],
  // Right arm
  [0.11, -0.045], [0.48, -0.045], [0.48, 0.045], [0.11, 0.045],
];

const CROSSHAIR_TRI_INDICES: ReadonlyArray<[number, number, number]> = [
  [0, 1, 2], [0, 2, 3],
  [4, 5, 6], [4, 6, 7],
  [8, 9, 10], [8, 10, 11],
  [12, 13, 14], [12, 14, 15],
];

function transformCursorMesh(
  verts: ReadonlyArray<[number, number]>,
  tris: ReadonlyArray<[number, number, number]>,
  centroid: [number, number],
  tip: CompositionPoint,
  height: number,
  rotationRadians: number,
  pressFactor: number,
  scaleMultiplier: number,
  offset?: CompositionPoint
): Float32Array {
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 32;
  const rot = Number.isFinite(rotationRadians) ? rotationRadians : 0;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);
  const ox = offset?.x ?? 0;
  const oy = offset?.y ?? 0;
  const scale = Number.isFinite(scaleMultiplier) && scaleMultiplier > 0 ? scaleMultiplier : 1.0;
  const [cx, cy] = centroid;

  const out = new Float32Array(tris.length * 6);
  let ptr = 0;

  for (const [i0, i1, i2] of tris) {
    for (const idx of [i0, i1, i2]) {
      const [lx, ly] = verts[idx];
      const sx = scale === 1.0 ? lx : cx + (lx - cx) * scale;
      const sy = scale === 1.0 ? ly : cy + (ly - cy) * scale;
      const pxLocal = sx * safeHeight * pressFactor;
      const pyLocal = sy * safeHeight * pressFactor;

      const rx = pxLocal * cosR - pyLocal * sinR;
      const ry = pxLocal * sinR + pyLocal * cosR;

      out[ptr++] = tip.x + ox + rx;
      out[ptr++] = tip.y + oy + ry;
    }
  }

  return out;
}

/**
 * Pure function: generates 2D cursor polygon triangles for 'arrow', 'pointingHand', or 'crosshair',
 * scaled by pressScale and rotated by velocity tilt `rotationRadians` around `tip`.
 */
export function buildCursorShapeTriangles(
  shape: Exclude<NormalizedCursorShape, 'hidden'>,
  tip: CompositionPoint,
  height: number,
  rotationRadians: number,
  pressScale: number,
  scaleMultiplier: number = 1.0,
  offset?: CompositionPoint
): Float32Array {
  const safePress = Number.isFinite(pressScale) && pressScale > 0 ? pressScale : 1.0;
  switch (shape) {
    case 'arrow':
      return transformCursorMesh(
        ARROW_LOCAL_VERTS,
        ARROW_TRI_INDICES,
        [0.26, 0.54],
        tip,
        height,
        rotationRadians,
        safePress,
        scaleMultiplier,
        offset
      );
    case 'pointingHand':
      return transformCursorMesh(
        POINTING_HAND_LOCAL_VERTS,
        POINTING_HAND_TRI_INDICES,
        [0.08, 0.56],
        tip,
        height,
        rotationRadians,
        safePress,
        scaleMultiplier,
        offset
      );
    case 'crosshair':
      return transformCursorMesh(
        CROSSHAIR_LOCAL_VERTS,
        CROSSHAIR_TRI_INDICES,
        [0.0, 0.0],
        tip,
        height,
        rotationRadians,
        safePress,
        scaleMultiplier,
        offset
      );
  }
}

/**
 * Pure function (legacy compatibility for T11.5d): generates 5 triangles (30 floats)
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
  return buildCursorShapeTriangles(
    'arrow',
    tip,
    height,
    rotationRadians,
    isClicking ? 0.92 : 1.0,
    scaleMultiplier,
    offset
  );
}

export const CLICK_VERTEX_SHADER = `#version 300 es
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

export const CLICK_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_localPos;
uniform vec3 u_clickColor;
uniform float u_primaryRadius;
uniform float u_primaryLineWidth;
uniform float u_primaryOpacity;
uniform int u_primaryIsFilled;
uniform float u_primaryGlowRadius;
uniform float u_secondaryRadius;
uniform float u_secondaryLineWidth;
uniform float u_secondaryOpacity;
uniform int u_secondaryIsFilled;
uniform float u_secondaryGlowRadius;
uniform float u_accentOffset;
uniform float u_accentSize;
uniform float u_accentOpacity;
out vec4 fragColor;

void main() {
  float dist = length(v_localPos);
  float alpha = 0.0;

  if (u_primaryRadius > 0.0 && u_primaryOpacity > 0.0) {
    float g1 = max(u_primaryGlowRadius, 1.5);
    if (u_primaryIsFilled == 1) {
      float fillMask = 1.0 - smoothstep(u_primaryRadius - 1.5, u_primaryRadius + g1, dist);
      alpha = max(alpha, fillMask * u_primaryOpacity);
    } else {
      float halfW = max(u_primaryLineWidth * 0.5, 0.75);
      float ringDist = abs(dist - u_primaryRadius);
      float ringMask = 1.0 - smoothstep(halfW - 0.8, halfW + 0.8, ringDist);
      float glowMask = u_primaryGlowRadius > 0.0
        ? exp(-ringDist * 2.0 / g1) * 0.35
        : 0.0;
      alpha = max(alpha, max(ringMask, glowMask) * u_primaryOpacity);
    }
  }

  if (u_secondaryRadius > 0.0 && u_secondaryOpacity > 0.0) {
    float g2 = max(u_secondaryGlowRadius, 1.2);
    if (u_secondaryIsFilled == 1) {
      float innerMask = 1.0 - smoothstep(u_secondaryRadius - 1.0, u_secondaryRadius + g2, dist);
      alpha = max(alpha, innerMask * u_secondaryOpacity);
    } else {
      float halfW2 = max(u_secondaryLineWidth * 0.5, 0.65);
      float ringDist2 = abs(dist - u_secondaryRadius);
      float ringMask2 = 1.0 - smoothstep(halfW2 - 0.6, halfW2 + 0.8, ringDist2);
      float glow2 = u_secondaryGlowRadius > 0.0
        ? exp(-ringDist2 * 2.0 / g2) * 0.30
        : 0.0;
      alpha = max(alpha, max(ringMask2, glow2) * u_secondaryOpacity);
    }
  }

  if (u_accentOpacity > 0.0 && u_accentSize > 0.0 && u_accentOffset > 0.0) {
    float dotR = max(u_accentSize * 0.5, 0.75);
    for (int k = 0; k < 8; k++) {
      float a = float(k) * 0.78539816339;
      vec2 center = vec2(cos(a), sin(a)) * u_accentOffset;
      float dSpark = length(v_localPos - center) - dotR;
      float sparkMask = 1.0 - smoothstep(-0.7, 0.9, dSpark);
      alpha = max(alpha, sparkMask * u_accentOpacity);
    }
  }

  if (alpha <= 0.001) {
    discard;
  }
  fragColor = vec4(u_clickColor, alpha);
}
`;

export const CURSOR_VERTEX_SHADER = `#version 300 es
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

export const CURSOR_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 fragColor;
void main() {
  fragColor = u_color;
}
`;

const MAX_CURSOR_BUFFER_FLOATS = 120;

export class CursorPass {
  private readonly gl: WebGL2RenderingContext;
  private readonly clickProgram: WebGLProgram;
  private readonly cursorProgram: WebGLProgram;
  private readonly clickVao: WebGLVertexArrayObject;
  private readonly clickVbo: WebGLBuffer;
  private readonly cursorVao: WebGLVertexArrayObject;
  private readonly cursorVbo: WebGLBuffer;

  private readonly uClickResolution: WebGLUniformLocation | null;
  private readonly uClickColor: WebGLUniformLocation | null;
  private readonly uClickPrimaryRadius: WebGLUniformLocation | null;
  private readonly uClickPrimaryLineWidth: WebGLUniformLocation | null;
  private readonly uClickPrimaryOpacity: WebGLUniformLocation | null;
  private readonly uClickPrimaryIsFilled: WebGLUniformLocation | null;
  private readonly uClickPrimaryGlowRadius: WebGLUniformLocation | null;
  private readonly uClickSecondaryRadius: WebGLUniformLocation | null;
  private readonly uClickSecondaryLineWidth: WebGLUniformLocation | null;
  private readonly uClickSecondaryOpacity: WebGLUniformLocation | null;
  private readonly uClickSecondaryIsFilled: WebGLUniformLocation | null;
  private readonly uClickSecondaryGlowRadius: WebGLUniformLocation | null;
  private readonly uClickAccentOffset: WebGLUniformLocation | null;
  private readonly uClickAccentSize: WebGLUniformLocation | null;
  private readonly uClickAccentOpacity: WebGLUniformLocation | null;

  private readonly uCursorResolution: WebGLUniformLocation | null;
  private readonly uCursorColor: WebGLUniformLocation | null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.clickProgram = createProgram(gl, CLICK_VERTEX_SHADER, CLICK_FRAGMENT_SHADER);
    this.uClickResolution = gl.getUniformLocation(this.clickProgram, 'u_resolution');
    this.uClickColor = gl.getUniformLocation(this.clickProgram, 'u_clickColor');
    this.uClickPrimaryRadius = gl.getUniformLocation(this.clickProgram, 'u_primaryRadius');
    this.uClickPrimaryLineWidth = gl.getUniformLocation(this.clickProgram, 'u_primaryLineWidth');
    this.uClickPrimaryOpacity = gl.getUniformLocation(this.clickProgram, 'u_primaryOpacity');
    this.uClickPrimaryIsFilled = gl.getUniformLocation(this.clickProgram, 'u_primaryIsFilled');
    this.uClickPrimaryGlowRadius = gl.getUniformLocation(this.clickProgram, 'u_primaryGlowRadius');
    this.uClickSecondaryRadius = gl.getUniformLocation(this.clickProgram, 'u_secondaryRadius');
    this.uClickSecondaryLineWidth = gl.getUniformLocation(this.clickProgram, 'u_secondaryLineWidth');
    this.uClickSecondaryOpacity = gl.getUniformLocation(this.clickProgram, 'u_secondaryOpacity');
    this.uClickSecondaryIsFilled = gl.getUniformLocation(this.clickProgram, 'u_secondaryIsFilled');
    this.uClickSecondaryGlowRadius = gl.getUniformLocation(this.clickProgram, 'u_secondaryGlowRadius');
    this.uClickAccentOffset = gl.getUniformLocation(this.clickProgram, 'u_accentOffset');
    this.uClickAccentSize = gl.getUniformLocation(this.clickProgram, 'u_accentSize');
    this.uClickAccentOpacity = gl.getUniformLocation(this.clickProgram, 'u_accentOpacity');

    const clickVao = gl.createVertexArray();
    const clickVbo = gl.createBuffer();
    if (!clickVao || !clickVbo) {
      throw new Error('Failed to create CursorPass click buffers');
    }
    this.clickVao = clickVao;
    this.clickVbo = clickVbo;
    gl.bindVertexArray(this.clickVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.clickVbo);
    gl.bufferData(gl.ARRAY_BUFFER, 24 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 4 * 4, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 4 * 4, 2 * 4);

    this.cursorProgram = createProgram(gl, CURSOR_VERTEX_SHADER, CURSOR_FRAGMENT_SHADER);
    this.uCursorResolution = gl.getUniformLocation(this.cursorProgram, 'u_resolution');
    this.uCursorColor = gl.getUniformLocation(this.cursorProgram, 'u_color');

    const cursorVao = gl.createVertexArray();
    const cursorVbo = gl.createBuffer();
    if (!cursorVao || !cursorVbo) {
      throw new Error('Failed to create CursorPass arrow buffers');
    }
    this.cursorVao = cursorVao;
    this.cursorVbo = cursorVbo;
    gl.bindVertexArray(this.cursorVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cursorVbo);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_CURSOR_BUFFER_FLOATS * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 2 * 4, 0);
  }

  render(scene: FrameScene, canvasWidth: number, canvasHeight: number): void {
    const params = computeCursorRenderParams(scene.cursor, scene.screen);
    if (!params || !scene.cursor) {
      return;
    }

    const gl = this.gl;
    const { width, height } = safeCanvasDimensions(canvasWidth, canvasHeight);
    const { clickPass } = params;

    if (clickPass.clickGeo) {
      const cu = computeClickShaderUniforms(clickPass.clickGeo);
      const rBound = cu.maxFootprintRadius;
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

      gl.useProgram(this.clickProgram);
      gl.bindVertexArray(this.clickVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.clickVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, clickVerts);

      gl.uniform2f(this.uClickResolution, width, height);
      gl.uniform3f(this.uClickColor, ...clickPass.clickColor);
      gl.uniform1f(this.uClickPrimaryRadius, cu.primaryRadius);
      gl.uniform1f(this.uClickPrimaryLineWidth, cu.primaryLineWidth);
      gl.uniform1f(this.uClickPrimaryOpacity, cu.primaryOpacity);
      gl.uniform1i(this.uClickPrimaryIsFilled, cu.primaryIsFilled);
      gl.uniform1f(this.uClickPrimaryGlowRadius, cu.primaryGlowRadius);
      gl.uniform1f(this.uClickSecondaryRadius, cu.secondaryRadius);
      gl.uniform1f(this.uClickSecondaryLineWidth, cu.secondaryLineWidth);
      gl.uniform1f(this.uClickSecondaryOpacity, cu.secondaryOpacity);
      gl.uniform1i(this.uClickSecondaryIsFilled, cu.secondaryIsFilled);
      gl.uniform1f(this.uClickSecondaryGlowRadius, cu.secondaryGlowRadius);
      gl.uniform1f(this.uClickAccentOffset, cu.accentOffset);
      gl.uniform1f(this.uClickAccentSize, cu.accentSize);
      gl.uniform1f(this.uClickAccentOpacity, cu.accentOpacity);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    gl.useProgram(this.cursorProgram);
    gl.bindVertexArray(this.cursorVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cursorVbo);
    gl.uniform2f(this.uCursorResolution, width, height);

    if (scene.cursor.shadow && scene.cursor.shadow.opacity > 0) {
      const sVerts = buildCursorShapeTriangles(
        params.shape,
        params.tipPx,
        params.heightPx,
        params.rotationRadians,
        params.pressScale,
        1.08,
        scene.cursor.shadow.offset
      );
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, sVerts);
      gl.uniform4f(this.uCursorColor, 0, 0, 0, scene.cursor.shadow.opacity * 0.7);
      gl.drawArrays(gl.TRIANGLES, 0, sVerts.length / 2);
    }

    const outlineVerts = buildCursorShapeTriangles(
      params.shape,
      params.tipPx,
      params.heightPx,
      params.rotationRadians,
      params.pressScale,
      1.12
    );
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, outlineVerts);
    gl.uniform4f(this.uCursorColor, 0.06, 0.08, 0.12, 0.95);
    gl.drawArrays(gl.TRIANGLES, 0, outlineVerts.length / 2);

    const fillVerts = buildCursorShapeTriangles(
      params.shape,
      params.tipPx,
      params.heightPx,
      params.rotationRadians,
      params.pressScale,
      1.0
    );
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, fillVerts);
    gl.uniform4f(this.uCursorColor, 0.99, 0.99, 1.0, params.opacity);
    gl.drawArrays(gl.TRIANGLES, 0, fillVerts.length / 2);
  }

  dispose(): void {
    this.gl.deleteBuffer(this.clickVbo);
    this.gl.deleteVertexArray(this.clickVao);
    this.gl.deleteProgram(this.clickProgram);
    this.gl.deleteBuffer(this.cursorVbo);
    this.gl.deleteVertexArray(this.cursorVao);
    this.gl.deleteProgram(this.cursorProgram);
  }
}
