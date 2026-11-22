/**
 * web/passes/screen.ts
 *
 * WebGL2 3D perspective-projected screen card + SDF shadow + blur mosaic pass.
 * Browser ESM & Node 24 strip-types compatible (NO node:* imports, NO enum/namespace).
 */

import type { FrameScene } from '../../src/core/FrameScene.ts';
import { hexColorComponents } from '../../src/core/HexColor.ts';
import {
  SCREEN_VERTEX_SHADER,
  buildProjectedQuadVertices,
  buildShadowQuadVertices,
  computeEffectiveScreenOpacity,
  computeScreenShaderUniforms,
  createProgram,
  safeCanvasDimensions,
  type ScreenShaderUniforms,
} from './glUtils.ts';
import {
  MAX_BLUR_MOSAICS,
  computeBlurMosaicUniforms,
} from './spotlight.ts';
import { computeChromePassGeometry } from './chrome.ts';

export {
  SCREEN_VERTEX_SHADER,
  buildProjectedQuadVertices,
  buildShadowQuadVertices,
  computeEffectiveScreenOpacity,
  computeScreenShaderUniforms,
};
export type { ScreenShaderUniforms };

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
uniform int u_blurMosaicCount;
uniform vec4 u_blurMosaicRects[${MAX_BLUR_MOSAICS}];
uniform vec4 u_blurMosaicParams[${MAX_BLUR_MOSAICS}];
out vec4 fragColor;

float sdRoundedBox(vec2 p, vec2 b, float r) {
  float clampedR = min(r, min(b.x, b.y));
  vec2 q = abs(p) - b + clampedR;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - clampedR;
}

vec3 samplePixelBlurMosaic(vec2 uv, vec4 rect, float intensity, vec2 sourceSize) {
  float cellPx = mix(6.0, 28.0, clamp(intensity, 0.0, 1.0));
  vec2 cellUV = max(vec2(cellPx) / max(sourceSize, vec2(1.0)), vec2(0.0005));
  vec2 rMin = max(rect.xy, u_sourceCrop.xy);
  vec2 rMax = min(rect.xy + rect.zw, u_sourceCrop.xy + u_sourceCrop.zw);
  vec2 snapped = (floor(uv / cellUV) + 0.5) * cellUV;
  vec2 spread = cellUV * (0.45 + 0.65 * intensity);

  vec3 acc = vec3(0.0);
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 tap = clamp(snapped + vec2(float(dx), float(dy)) * spread, rMin, rMax);
      acc += texture(u_screenTex, tap).rgb;
    }
  }
  return acc / 9.0;
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

  if (u_blurMosaicCount > 0) {
    vec2 sourceSize = u_screenSize / max(u_sourceCrop.zw, vec2(0.001));
    for (int i = 0; i < ${MAX_BLUR_MOSAICS}; i++) {
      if (i >= u_blurMosaicCount) break;
      vec4 r = u_blurMosaicRects[i];
      vec4 param = u_blurMosaicParams[i];
      vec2 center = r.xy + 0.5 * r.zw;
      vec2 localP = (croppedUV - center) * sourceSize;
      vec2 halfB = 0.5 * r.zw * sourceSize;
      float radPx = param.x * min(r.z * sourceSize.x, r.w * sourceSize.y);
      float mDist = sdRoundedBox(localP, halfB, radPx);
      float mask = 1.0 - smoothstep(-0.75, 0.75, mDist);
      if (mask > 0.001) {
        vec3 mosaicCol = samplePixelBlurMosaic(croppedUV, r, param.y, sourceSize);
        texColor = mix(texColor, mosaicCol, mask * param.z);
      }
    }
  }

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
  private readonly uBlurMosaicCount: WebGLUniformLocation | null;
  private readonly uBlurMosaicRects: WebGLUniformLocation | null;
  private readonly uBlurMosaicParams: WebGLUniformLocation | null;

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
    this.uBlurMosaicCount = gl.getUniformLocation(this.screenProgram, 'u_blurMosaicCount');
    this.uBlurMosaicRects =
      gl.getUniformLocation(this.screenProgram, 'u_blurMosaicRects[0]') ??
      gl.getUniformLocation(this.screenProgram, 'u_blurMosaicRects');
    this.uBlurMosaicParams =
      gl.getUniformLocation(this.screenProgram, 'u_blurMosaicParams[0]') ??
      gl.getUniformLocation(this.screenProgram, 'u_blurMosaicParams');

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

  renderShadow(scene: FrameScene, canvasWidth: number, canvasHeight: number): void {
    const effectiveOpacity = computeEffectiveScreenOpacity(scene.screen, scene.stickerBackdrop);
    if (effectiveOpacity <= 0.001 || !scene.screen.shadow) {
      return;
    }

    const gl = this.gl;
    const { width, height } = safeCanvasDimensions(canvasWidth, canvasHeight);
    const chrome =
      scene.screen.decoration.kind === 'chrome' ? scene.screen.decoration.chrome : null;
    const shadowScreen = chrome
      ? {
          ...scene.screen,
          finalRect: chrome.outerRect,
          cornerRadius: chrome.outerCornerRadius,
        }
      : scene.screen;
    const screenUniforms = computeScreenShaderUniforms(shadowScreen);

    const shadowVerts = buildShadowQuadVertices(shadowScreen, width, height);
    if (shadowVerts) {
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
  }

  renderContent(
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
    const chromeGeo = computeChromePassGeometry(scene.screen, width, height);
    const screenUniforms = computeScreenShaderUniforms(scene.screen);
    const vertices = chromeGeo
      ? chromeGeo.contentVertices
      : buildProjectedQuadVertices(
          scene.screen.projectedQuad,
          scene.screen.finalRect,
          width,
          height
        );
    const screenSize: [number, number] = chromeGeo
      ? [chromeGeo.chrome.contentRect.width, chromeGeo.chrome.contentRect.height]
      : screenUniforms.screenSize;
    const cornerRadius = chromeGeo
      ? chromeGeo.contentCornerRadius
      : screenUniforms.cornerRadius;
    const blurBatch = computeBlurMosaicUniforms(scene.screen);

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
    gl.uniform2f(this.uScreenSize, screenSize[0], screenSize[1]);
    gl.uniform1f(this.uCornerRadius, cornerRadius);
    gl.uniform1f(this.uBorderWidth, chromeGeo ? 0 : screenUniforms.effectiveBorderWidth);
    gl.uniform4f(
      this.uBorderColor,
      screenUniforms.borderColor[0],
      screenUniforms.borderColor[1],
      screenUniforms.borderColor[2],
      chromeGeo ? 0 : screenUniforms.borderColor[3]
    );
    gl.uniform1i(this.uBlurMosaicCount, blurBatch.count);
    gl.uniform4fv(this.uBlurMosaicRects, blurBatch.rectsFlat);
    gl.uniform4fv(this.uBlurMosaicParams, blurBatch.paramsFlat);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  render(
    scene: FrameScene,
    screenTex: WebGLTexture,
    canvasWidth: number,
    canvasHeight: number
  ): void {
    this.renderShadow(scene, canvasWidth, canvasHeight);
    this.renderContent(scene, screenTex, canvasWidth, canvasHeight);
  }

  dispose(): void {
    this.gl.deleteBuffer(this.vbo);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.screenProgram);
    this.gl.deleteProgram(this.shadowProgram);
  }
}
