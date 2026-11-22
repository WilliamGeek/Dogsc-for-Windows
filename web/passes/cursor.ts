/**
 * web/passes/cursor.ts
 *
 * WebGL2 vector cursor + click ripple effect pass.
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
import { projectedScreenQuadProject } from '../../src/core/ScreenProjection.ts';
import { createProgram, safeCanvasDimensions } from './glUtils.ts';

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
  private readonly uClickSecondaryRadius: WebGLUniformLocation | null;
  private readonly uClickSecondaryOpacity: WebGLUniformLocation | null;
  private readonly uClickSecondaryIsFilled: WebGLUniformLocation | null;

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
    this.uClickSecondaryRadius = gl.getUniformLocation(this.clickProgram, 'u_secondaryRadius');
    this.uClickSecondaryOpacity = gl.getUniformLocation(this.clickProgram, 'u_secondaryOpacity');
    this.uClickSecondaryIsFilled = gl.getUniformLocation(this.clickProgram, 'u_secondaryIsFilled');

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
    gl.bufferData(gl.ARRAY_BUFFER, 30 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 2 * 4, 0);
  }

  render(scene: FrameScene, canvasWidth: number, canvasHeight: number): void {
    const cursor = scene.cursor;
    if (!cursor || cursor.assetID === 'system.hidden') {
      return;
    }

    const gl = this.gl;
    const { width, height } = safeCanvasDimensions(canvasWidth, canvasHeight);
    const clickPass = computeCursorClickEffectPass(cursor, scene.screen);

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

      gl.useProgram(this.clickProgram);
      gl.bindVertexArray(this.clickVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.clickVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, clickVerts);

      gl.uniform2f(this.uClickResolution, width, height);
      gl.uniform3f(this.uClickColor, ...clickPass.clickColor);
      gl.uniform1f(this.uClickPrimaryRadius, geo.primaryDiameter * 0.5);
      gl.uniform1f(this.uClickPrimaryLineWidth, geo.primaryLineWidth);
      gl.uniform1f(this.uClickPrimaryOpacity, geo.primaryOpacity);
      gl.uniform1i(this.uClickPrimaryIsFilled, geo.primaryIsFilled ? 1 : 0);
      gl.uniform1f(this.uClickSecondaryRadius, geo.secondaryDiameter * 0.5);
      gl.uniform1f(this.uClickSecondaryOpacity, geo.secondaryOpacity);
      gl.uniform1i(this.uClickSecondaryIsFilled, geo.secondaryIsFilled ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    const cursorHeight = cursor.layout.size.height;
    gl.useProgram(this.cursorProgram);
    gl.bindVertexArray(this.cursorVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cursorVbo);
    gl.uniform2f(this.uCursorResolution, width, height);

    if (cursor.shadow && cursor.shadow.opacity > 0) {
      const sVerts = buildCursorArrowTriangles(
        clickPass.tipPx,
        cursorHeight,
        cursor.rotationRadians,
        cursor.isClicking,
        1.08,
        cursor.shadow.offset
      );
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, sVerts);
      gl.uniform4f(this.uCursorColor, 0, 0, 0, cursor.shadow.opacity * 0.7);
      gl.drawArrays(gl.TRIANGLES, 0, 15);
    }

    const outlineVerts = buildCursorArrowTriangles(
      clickPass.tipPx,
      cursorHeight,
      cursor.rotationRadians,
      cursor.isClicking,
      1.12
    );
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, outlineVerts);
    gl.uniform4f(this.uCursorColor, 0.06, 0.08, 0.12, 0.95);
    gl.drawArrays(gl.TRIANGLES, 0, 15);

    const fillVerts = buildCursorArrowTriangles(
      clickPass.tipPx,
      cursorHeight,
      cursor.rotationRadians,
      cursor.isClicking,
      1.0
    );
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, fillVerts);
    gl.uniform4f(this.uCursorColor, 0.99, 0.99, 1.0, 1.0);
    gl.drawArrays(gl.TRIANGLES, 0, 15);
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
