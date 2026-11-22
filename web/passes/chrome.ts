/**
 * web/passes/chrome.ts
 *
 * WebGL2 3D-projected Window / Browser / Phone / Tablet Chrome frame pass.
 * Browser ESM & Node 24 strip-types compatible (NO node:* imports, NO enum/namespace).
 */

import { makeCompositionPoint } from '../../src/core/CompositionScene.ts';
import type {
  FrameScene,
  FrameScreenChromeKind,
  FrameScreenChromeScene,
  FrameScreenScene,
} from '../../src/core/FrameScene.ts';
import { hexColorComponents } from '../../src/core/HexColor.ts';
import {
  makeProjectedScreenQuad,
  projectedScreenQuadProject,
  type ProjectedScreenQuad,
} from '../../src/core/ScreenProjection.ts';
import {
  SCREEN_VERTEX_SHADER,
  buildProjectedQuadVertices,
  computeEffectiveScreenOpacity,
  createProgram,
  safeCanvasDimensions,
} from './glUtils.ts';

export interface ChromePassGeometry {
  chrome: FrameScreenChromeScene;
  kindCode: number;
  outerVertices: Float32Array;
  contentQuad: ProjectedScreenQuad;
  contentVertices: Float32Array;
  outerSize: [number, number];
  outerCornerRadius: number;
  contentCornerRadius: number;
  contentInsetUV: [number, number, number, number];
  toolbarHeightFrac: number;
  surfaceColor: [number, number, number];
  toolbarColor: [number, number, number];
  separatorColor: [number, number, number];
  fieldColor: [number, number, number];
  glyphColor: [number, number, number];
}

export function chromeKindToCode(kind: FrameScreenChromeKind): number {
  switch (kind) {
    case 'window':
      return 0;
    case 'browser':
      return 1;
    case 'devicePhonePortrait':
      return 2;
    case 'devicePhoneLandscape':
      return 3;
    case 'deviceTabletPortrait':
      return 4;
    case 'deviceTabletLandscape':
      return 5;
  }
}

/**
 * Pure function: computes projected outer chrome geometry & inset screen content quad/vertices
 * when FrameScreenScene.decoration.kind === 'chrome'. Returns null for 'none'.
 */
export function computeChromePassGeometry(
  screen: FrameScreenScene,
  canvasWidth: number,
  canvasHeight: number
): ChromePassGeometry | null {
  if (screen.decoration.kind !== 'chrome') {
    return null;
  }

  const chrome = screen.decoration.chrome;
  const oRect = chrome.outerRect;
  const cRect = chrome.contentRect;
  if (
    !Number.isFinite(oRect.width) ||
    !Number.isFinite(oRect.height) ||
    !Number.isFinite(cRect.width) ||
    !Number.isFinite(cRect.height) ||
    oRect.width <= 0 ||
    oRect.height <= 0 ||
    cRect.width <= 0 ||
    cRect.height <= 0
  ) {
    return null;
  }

  const outerVertices = buildProjectedQuadVertices(
    screen.projectedQuad,
    oRect,
    canvasWidth,
    canvasHeight
  );

  const tlSrc = makeCompositionPoint(cRect.x, cRect.y);
  const trSrc = makeCompositionPoint(cRect.x + cRect.width, cRect.y);
  const brSrc = makeCompositionPoint(cRect.x + cRect.width, cRect.y + cRect.height);
  const blSrc = makeCompositionPoint(cRect.x, cRect.y + cRect.height);

  const tl = projectedScreenQuadProject(screen.projectedQuad, tlSrc, oRect) ?? tlSrc;
  const tr = projectedScreenQuadProject(screen.projectedQuad, trSrc, oRect) ?? trSrc;
  const br = projectedScreenQuadProject(screen.projectedQuad, brSrc, oRect) ?? brSrc;
  const bl = projectedScreenQuadProject(screen.projectedQuad, blSrc, oRect) ?? blSrc;

  const contentQuad = makeProjectedScreenQuad(tl, tr, br, bl);
  const contentVertices = buildProjectedQuadVertices(
    contentQuad,
    cRect,
    canvasWidth,
    canvasHeight
  );

  const leftFrac = Math.min(Math.max((cRect.x - oRect.x) / oRect.width, 0), 1);
  const topFrac = Math.min(Math.max((cRect.y - oRect.y) / oRect.height, 0), 1);
  const rightFrac = Math.min(
    Math.max((oRect.x + oRect.width - (cRect.x + cRect.width)) / oRect.width, 0),
    1
  );
  const bottomFrac = Math.min(
    Math.max((oRect.y + oRect.height - (cRect.y + cRect.height)) / oRect.height, 0),
    1
  );
  const toolbarHeightFrac = Math.min(Math.max(chrome.toolbarRect.height / oRect.height, 0), 1);

  const surf = hexColorComponents(chrome.surfaceColor);
  const tool = hexColorComponents(chrome.toolbarColor);
  const sep = hexColorComponents(chrome.separatorColor);
  const field = hexColorComponents(chrome.fieldColor);
  const glyph = hexColorComponents(chrome.glyphColor);

  return {
    chrome,
    kindCode: chromeKindToCode(chrome.kind),
    outerVertices,
    contentQuad,
    contentVertices,
    outerSize: [oRect.width, oRect.height],
    outerCornerRadius: Math.max(chrome.outerCornerRadius, 0),
    contentCornerRadius: Math.max(chrome.contentCornerRadius, 0),
    contentInsetUV: [leftFrac, topFrac, rightFrac, bottomFrac],
    toolbarHeightFrac,
    surfaceColor: [surf.red, surf.green, surf.blue],
    toolbarColor: [tool.red, tool.green, tool.blue],
    separatorColor: [sep.red, sep.green, sep.blue],
    fieldColor: [field.red, field.green, field.blue],
    glyphColor: [glyph.red, glyph.green, glyph.blue],
  };
}

export const CHROME_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform int u_kindCode;
uniform vec2 u_outerSize;
uniform float u_outerCornerRadius;
uniform float u_toolbarHeightFrac;
uniform vec3 u_surfaceColor;
uniform vec3 u_toolbarColor;
uniform vec3 u_separatorColor;
uniform vec3 u_fieldColor;
uniform vec3 u_glyphColor;
uniform float u_opacity;
out vec4 fragColor;

float sdRoundedBox(vec2 p, vec2 b, float r) {
  float clampedR = min(r, min(b.x, b.y));
  vec2 q = abs(p) - b + clampedR;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - clampedR;
}

void main() {
  vec2 px = v_uv * u_outerSize;
  vec2 p = px - 0.5 * u_outerSize;
  vec2 b = 0.5 * u_outerSize;
  float outerDist = sdRoundedBox(p, b, u_outerCornerRadius);
  float outerAlpha = 1.0 - smoothstep(-0.75, 0.75, outerDist);
  if (outerAlpha <= 0.001) {
    discard;
  }

  vec3 col = u_surfaceColor;

  if (u_kindCode <= 1) {
    // Window (0) / Browser (1) title toolbar
    float tbHeight = max(u_toolbarHeightFrac * u_outerSize.y, 1.0);
    float inToolbar = 1.0 - smoothstep(tbHeight - 0.75, tbHeight + 0.75, px.y);
    col = mix(col, u_toolbarColor, inToolbar);

    // 1px bottom separator line
    float sepDist = abs(px.y - tbHeight);
    float sepMask = 1.0 - smoothstep(0.4, 1.4, sepDist);
    col = mix(col, u_separatorColor, sepMask);

    // 3 macOS traffic light dots
    float dotRadius = clamp(tbHeight * 0.145, 3.0, 8.0);
    float dotY = tbHeight * 0.5;
    float startX = clamp(tbHeight * 0.45, 10.0, 26.0);
    float stepX = dotRadius * 3.1;
    vec3 dotColors[3] = vec3[3](
      vec3(1.0, 0.373, 0.341),
      vec3(0.996, 0.737, 0.180),
      vec3(0.157, 0.784, 0.251)
    );
    for (int i = 0; i < 3; i++) {
      vec2 dotPos = vec2(startX + float(i) * stepX, dotY);
      float d = length(px - dotPos) - dotRadius;
      float dMask = 1.0 - smoothstep(-0.6, 0.6, d);
      col = mix(col, dotColors[i], dMask);
    }

    if (u_kindCode == 1 && u_outerSize.x > tbHeight * 4.5) {
      // Browser address pill + glyph bar
      float pillW = min(u_outerSize.x * 0.42, 460.0);
      float pillH = clamp(tbHeight * 0.56, 10.0, 32.0);
      vec2 pillCenter = vec2(u_outerSize.x * 0.5, tbHeight * 0.5);
      float pillDist = sdRoundedBox(px - pillCenter, vec2(pillW * 0.5, pillH * 0.5), pillH * 0.42);
      float pillMask = 1.0 - smoothstep(-0.6, 0.6, pillDist);
      col = mix(col, u_fieldColor, pillMask);

      float glyphDist = sdRoundedBox(
        px - pillCenter,
        vec2(pillW * 0.22, max(pillH * 0.10, 1.5)),
        max(pillH * 0.10, 1.5)
      );
      float glyphMask = 1.0 - smoothstep(-0.6, 0.6, glyphDist);
      col = mix(col, u_glyphColor, glyphMask * 0.55);
    }
  } else if (u_kindCode == 2 || u_kindCode == 3) {
    // Device Phone bezel accent (Dynamic Island cutout & home indicator pill)
    float shortEdge = min(u_outerSize.x, u_outerSize.y);
    vec2 islandCenter = u_kindCode == 2
      ? vec2(u_outerSize.x * 0.5, shortEdge * 0.056)
      : vec2(shortEdge * 0.056, u_outerSize.y * 0.5);
    vec2 islandHalf = u_kindCode == 2
      ? vec2(shortEdge * 0.085, shortEdge * 0.013)
      : vec2(shortEdge * 0.013, shortEdge * 0.085);
    float islandDist = sdRoundedBox(px - islandCenter, islandHalf, min(islandHalf.x, islandHalf.y));
    float islandMask = 1.0 - smoothstep(-0.6, 0.6, islandDist);
    col = mix(col, vec3(0.05, 0.05, 0.06), islandMask * 0.9);
  } else {
    // Device Tablet subtle camera lens dot
    float shortEdge = min(u_outerSize.x, u_outerSize.y);
    vec2 camCenter = u_kindCode == 4
      ? vec2(u_outerSize.x * 0.5, shortEdge * 0.023)
      : vec2(shortEdge * 0.023, u_outerSize.y * 0.5);
    float camDist = length(px - camCenter) - max(shortEdge * 0.006, 2.5);
    float camMask = 1.0 - smoothstep(-0.6, 0.6, camDist);
    col = mix(col, vec3(0.06, 0.07, 0.09), camMask);
  }

  // Crisp subtle 1.5px metallic rim highlight on outer silhouette
  float rimMask = smoothstep(-2.0, -0.5, outerDist);
  col = mix(col, u_glyphColor, rimMask * 0.16);

  fragColor = vec4(col, outerAlpha * u_opacity);
}
`;

export class ChromePass {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;

  private readonly uKindCode: WebGLUniformLocation | null;
  private readonly uOuterSize: WebGLUniformLocation | null;
  private readonly uOuterCornerRadius: WebGLUniformLocation | null;
  private readonly uToolbarHeightFrac: WebGLUniformLocation | null;
  private readonly uSurfaceColor: WebGLUniformLocation | null;
  private readonly uToolbarColor: WebGLUniformLocation | null;
  private readonly uSeparatorColor: WebGLUniformLocation | null;
  private readonly uFieldColor: WebGLUniformLocation | null;
  private readonly uGlyphColor: WebGLUniformLocation | null;
  private readonly uOpacity: WebGLUniformLocation | null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, SCREEN_VERTEX_SHADER, CHROME_FRAGMENT_SHADER);
    this.uKindCode = gl.getUniformLocation(this.program, 'u_kindCode');
    this.uOuterSize = gl.getUniformLocation(this.program, 'u_outerSize');
    this.uOuterCornerRadius = gl.getUniformLocation(this.program, 'u_outerCornerRadius');
    this.uToolbarHeightFrac = gl.getUniformLocation(this.program, 'u_toolbarHeightFrac');
    this.uSurfaceColor = gl.getUniformLocation(this.program, 'u_surfaceColor');
    this.uToolbarColor = gl.getUniformLocation(this.program, 'u_toolbarColor');
    this.uSeparatorColor = gl.getUniformLocation(this.program, 'u_separatorColor');
    this.uFieldColor = gl.getUniformLocation(this.program, 'u_fieldColor');
    this.uGlyphColor = gl.getUniformLocation(this.program, 'u_glyphColor');
    this.uOpacity = gl.getUniformLocation(this.program, 'u_opacity');

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    if (!vao || !vbo) {
      throw new Error('Failed to create ChromePass vertex buffers');
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
    const effectiveOpacity = computeEffectiveScreenOpacity(scene.screen, scene.stickerBackdrop);
    if (effectiveOpacity <= 0.001) {
      return;
    }

    const { width, height } = safeCanvasDimensions(canvasWidth, canvasHeight);
    const geo = computeChromePassGeometry(scene.screen, width, height);
    if (!geo) {
      return;
    }

    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, geo.outerVertices);

    gl.uniform1i(this.uKindCode, geo.kindCode);
    gl.uniform2f(this.uOuterSize, geo.outerSize[0], geo.outerSize[1]);
    gl.uniform1f(this.uOuterCornerRadius, geo.outerCornerRadius);
    gl.uniform1f(this.uToolbarHeightFrac, geo.toolbarHeightFrac);
    gl.uniform3f(this.uSurfaceColor, ...geo.surfaceColor);
    gl.uniform3f(this.uToolbarColor, ...geo.toolbarColor);
    gl.uniform3f(this.uSeparatorColor, ...geo.separatorColor);
    gl.uniform3f(this.uFieldColor, ...geo.fieldColor);
    gl.uniform3f(this.uGlyphColor, ...geo.glyphColor);
    gl.uniform1f(this.uOpacity, effectiveOpacity);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    this.gl.deleteBuffer(this.vbo);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.program);
  }
}
