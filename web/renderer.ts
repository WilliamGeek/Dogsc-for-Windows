/**
 * web/renderer.ts
 *
 * WebGL2 frame renderer orchestrator for DogSC Windows.
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
import { runExportLoop } from './exporter.ts';
import {
  BackgroundPass,
  resolveBackgroundShaderParams,
  type BackgroundShaderParams,
} from './passes/background.ts';
import {
  ScreenPass,
  buildProjectedQuadVertices,
  computeScreenShaderUniforms,
  buildShadowQuadVertices,
  computeEffectiveScreenOpacity,
  type ScreenShaderUniforms,
} from './passes/screen.ts';
import {
  CursorPass,
  computeCursorClickEffectPass,
  buildCursorArrowTriangles,
  resolveCursorShape,
  computeCursorRenderParams,
  buildCursorShapeTriangles,
  computeClickShaderUniforms,
  type CursorClickEffectPass,
  type NormalizedCursorShape,
  type CursorRenderParams,
  type ClickShaderUniforms,
} from './passes/cursor.ts';
import {
  CameraPass,
  computeCameraShaderUniforms,
  sampleCameraUV,
  buildCameraQuadVertices,
  buildCameraShadowVertices,
  type CameraShaderUniforms,
} from './passes/camera.ts';
import {
  SpotlightPass,
  computeBlurMosaicUniforms,
  computeSpotlightPassUniforms,
  evaluateSpotlightOutsideMask,
  type BlurMosaicUniform,
  type BlurMosaicUniformBatch,
  type SpotlightRegionUniform,
  type SpotlightPassUniforms,
} from './passes/spotlight.ts';
import {
  BackdropBlurRelay,
  StickerPass,
  computeStickerRenderPlan,
  buildRotatedQuadVertices,
  type StickerBlurStage,
  type StickerDrawItem,
  type StickerRenderPlan,
} from './passes/stickers.ts';
import {
  ChromePass,
  computeChromePassGeometry,
  type ChromePassGeometry,
} from './passes/chrome.ts';
import {
  FocusPass,
  computeFocusPassUniforms,
  evaluateFocusOutsideFactor,
  type FocusPassUniforms,
} from './passes/focus.ts';
import {
  createTexture2D,
  resolveLayerRenderOrder,
  dispatchSceneLayers,
} from './passes/glUtils.ts';

export {
  resolveBackgroundShaderParams,
  buildProjectedQuadVertices,
  computeScreenShaderUniforms,
  buildShadowQuadVertices,
  computeEffectiveScreenOpacity,
  computeCursorClickEffectPass,
  buildCursorArrowTriangles,
  resolveCursorShape,
  computeCursorRenderParams,
  buildCursorShapeTriangles,
  computeClickShaderUniforms,
  computeCameraShaderUniforms,
  sampleCameraUV,
  buildCameraQuadVertices,
  buildCameraShadowVertices,
  computeBlurMosaicUniforms,
  computeSpotlightPassUniforms,
  evaluateSpotlightOutsideMask,
  computeStickerRenderPlan,
  buildRotatedQuadVertices,
  computeChromePassGeometry,
  computeFocusPassUniforms,
  evaluateFocusOutsideFactor,
  resolveLayerRenderOrder,
  dispatchSceneLayers,
};
export type {
  BackgroundShaderParams,
  ScreenShaderUniforms,
  CursorClickEffectPass,
  NormalizedCursorShape,
  CursorRenderParams,
  ClickShaderUniforms,
  CameraShaderUniforms,
  BlurMosaicUniform,
  BlurMosaicUniformBatch,
  SpotlightRegionUniform,
  SpotlightPassUniforms,
  StickerBlurStage,
  StickerDrawItem,
  StickerRenderPlan,
  ChromePassGeometry,
  FocusPassUniforms,
};

export interface RendererPlanContext {
  fps: number;
  width: number;
  height: number;
  frameCount: number;
  sourceFrameCount: number;
  durationSeconds: number;
  framesBaseUrl: string | null;
  cameraFramesBaseUrl?: string | null;
  plan: FramePlanResult;
}

// ---------------------------------------------------------------------------
// Browser Runtime Helpers (never called in Node tests)
// ---------------------------------------------------------------------------

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
      const sourceFps = Number(payload.sourceFps) || fps;
      const width = Number(payload.width) || 1920;
      const height = Number(payload.height) || 1080;
      const durationSeconds = Number(payload.durationSeconds) || 1;
      const sourceFrameCount = Number(payload.sourceFrameCount) || 1;
      const plan = makeFramePlan({
        project,
        pointerEvents,
        fps,
        sourceFps,
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
        cameraFramesBaseUrl:
          typeof payload.cameraFramesBaseUrl === 'string' ? payload.cameraFramesBaseUrl : null,
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

  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#0f172a');
  grad.addColorStop(0.5, '#1e293b');
  grad.addColorStop(1, '#312e81');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  const wx = width * 0.12;
  const wy = height * 0.1;
  const ww = width * 0.76;
  const wh = height * 0.78;
  ctx.fillStyle = '#18181b';
  ctx.fillRect(wx, wy, ww, wh);
  ctx.strokeStyle = '#3f3f46';
  ctx.lineWidth = 3;
  ctx.strokeRect(wx, wy, ww, wh);

  ctx.fillStyle = '#27272a';
  ctx.fillRect(wx, wy, ww, 48);
  const colors = ['#ef4444', '#f59e0b', '#10b981'];
  colors.forEach((col, idx) => {
    ctx.beginPath();
    ctx.arc(wx + 28 + idx * 24, wy + 24, 7, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
  });

  const lineColors = ['#38bdf8', '#a855f7', '#34d399', '#f472b6', '#94a3b8'];
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = lineColors[i % lineColors.length];
    const lw = ((i * 137) % 450) + 180;
    ctx.fillRect(wx + 60, wy + 100 + i * 44, lw, 16);
  }

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

  const bgPass = new BackgroundPass(gl);
  const screenPass = new ScreenPass(gl);
  const chromePass = new ChromePass(gl);
  const focusPass = new FocusPass(gl);
  const spotlightPass = new SpotlightPass(gl);
  const cursorPass = new CursorPass(gl);
  const cameraPass = new CameraPass(gl);
  const blurRelay = new BackdropBlurRelay(gl);
  const stickerPass = new StickerPass(gl);
  const screenTex = createTexture2D(gl, true);
  let cameraTex: WebGLTexture | null = null;

  let cachedFileNum = -1;
  let cachedCameraFileNum = -1;

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

    if (scene.camera && ctx.cameraFramesBaseUrl && sourceFrameFile !== cachedCameraFileNum) {
      const padded = String(sourceFrameFile).padStart(6, '0');
      const camUrl = `${ctx.cameraFramesBaseUrl}/${padded}.jpg`;
      const camImg = await loadFrameBitmap(camUrl);
      if (camImg) {
        try {
          if (!cameraTex) {
            cameraTex = createTexture2D(gl, true);
          }
          gl.bindTexture(gl.TEXTURE_2D, cameraTex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, camImg);
        } finally {
          if ('close' in camImg && typeof camImg.close === 'function') {
            camImg.close();
          }
        }
      }
      cachedCameraFileNum = sourceFrameFile;
    }

    const stickerPlan = computeStickerRenderPlan(scene, ctx.width, ctx.height);
    let blurPending = stickerPlan.blurStage !== 'none';
    const flushBlurIfDue = (stage: 'beforeCamera' | 'beforeStickers'): void => {
      if (blurPending && stickerPlan.blurStage === stage) {
        blurRelay.flushBlurredToScreen(ctx.width, ctx.height, stickerPlan.blurRadiusPx);
        blurPending = false;
      }
    };

    if (blurPending) {
      blurRelay.beginCapture(ctx.width, ctx.height);
    } else {
      gl.viewport(0, 0, ctx.width, ctx.height);
      gl.clearColor(0.0, 0.0, 0.0, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    dispatchSceneLayers(scene, {
      background: () => bgPass.render(scene, ctx.width, ctx.height),
      screen: () => {
        screenPass.renderShadow(scene, ctx.width, ctx.height);
        chromePass.render(scene, ctx.width, ctx.height);
        screenPass.renderContent(scene, screenTex, ctx.width, ctx.height);
        focusPass.render(scene, screenTex, ctx.width, ctx.height);
      },
      cursor: () => cursorPass.render(scene, ctx.width, ctx.height),
      spotlight: () => spotlightPass.render(scene, ctx.width, ctx.height),
      camera: () => {
        flushBlurIfDue('beforeCamera');
        cameraPass.render(scene, cameraTex, ctx.width, ctx.height);
      },
      stickers: () => {
        flushBlurIfDue('beforeStickers');
        stickerPass.render(scene, ctx.width, ctx.height);
      },
    });

    if (blurPending) {
      blurRelay.flushBlurredToScreen(ctx.width, ctx.height, stickerPlan.blurRadiusPx);
      blurPending = false;
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
