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
  type CompositionRect,
} from '../src/core/CompositionScene.ts';
import type { FrameScene, FrameScreenScene } from '../src/core/FrameScene.ts';
import { hexColorComponents } from '../src/core/HexColor.ts';

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

// ---------------------------------------------------------------------------
// Shaders (T11.4 + T11.5a + T11.5b Screen & Shadow Shaders)
// ---------------------------------------------------------------------------

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
        const img = await loadImage(imgUrl);
        if (img) {
          gl.bindTexture(gl.TEXTURE_2D, screenTex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
          uploaded = true;
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
    gl.clearColor(0.08, 0.1, 0.14, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

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
    gl.finish();
  };

  if (mode === 'preview') {
    await renderFrameAt(initialFrame);
  } else {
    // Export mode will be hooked up in T11.6
    await renderFrameAt(initialFrame);
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  await bootstrapBrowser();
}
