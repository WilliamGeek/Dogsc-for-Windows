/**
 * web/studio/player.ts
 *
 * Interactive WebGL2 real-time preview engine for DogSC Studio.
 * Uses the exact same FramePlan + FrameSceneEvaluator + modular WebGL2 passes
 * as headless export (`web/renderer.ts`) so preview == exported MP4 pixel-for-pixel.
 * Strictly ZERO node:* imports.
 */

import { makeFramePlan, type FramePlanResult } from '../../src/render/FramePlan.ts';
import type { FrameScene } from '../../src/core/FrameScene.ts';
import {
  canvasStylePixelDimensions,
  type CanvasDimensions,
} from '../../src/core/ProjectModel.ts';
import type { RecorderProject } from '../../src/core/ProjectMediaModel.ts';
import type { PointerEventRecord } from '../../src/core/ZoomAnimation.ts';
import { BackgroundPass } from '../passes/background.ts';
import { ScreenPass } from '../passes/screen.ts';
import { ChromePass } from '../passes/chrome.ts';
import { FocusPass } from '../passes/focus.ts';
import { SpotlightPass } from '../passes/spotlight.ts';
import { CursorPass } from '../passes/cursor.ts';
import { CameraPass } from '../passes/camera.ts';
import { BackdropBlurRelay, StickerPass, computeStickerRenderPlan } from '../passes/stickers.ts';
import { createTexture2D, dispatchSceneLayers } from '../passes/glUtils.ts';

export type PreviewQualityMode = 'low' | 'full';

export interface StudioPlayerSessionInput {
  project: RecorderProject;
  pointerEvents: PointerEventRecord[];
  fps: number;
  sourceWidth: number;
  sourceHeight: number;
  durationSeconds: number;
  sourceFrameCount: number;
  framesBaseUrl: string | null;
  cameraFramesBaseUrl: string | null;
}

interface FrameCacheEntry {
  url: string;
  image: ImageBitmap | HTMLImageElement;
}

export class StudioWebGLPlayer {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly bgPass: BackgroundPass;
  private readonly screenPass: ScreenPass;
  private readonly chromePass: ChromePass;
  private readonly focusPass: FocusPass;
  private readonly spotlightPass: SpotlightPass;
  private readonly cursorPass: CursorPass;
  private readonly cameraPass: CameraPass;
  private readonly blurRelay: BackdropBlurRelay;
  private readonly stickerPass: StickerPass;
  private readonly screenTex: WebGLTexture | null;
  private cameraTex: WebGLTexture | null = null;

  private readonly cache = new Map<string, FrameCacheEntry>();
  private readonly maxCacheEntries = 36;

  private session: StudioPlayerSessionInput | null = null;
  private plan: FramePlanResult | null = null;
  private renderDims: CanvasDimensions = { width: 1280, height: 720 };
  private qualityMode: PreviewQualityMode = 'low';
  private lastScene: FrameScene | null = null;
  private lastUploadedScreenUrl = '';
  private lastUploadedCameraUrl = '';

  private currentTime = 0;
  private playbackSpeed = 1;
  private playing = false;
  private rafId = 0;
  private lastRafMs = 0;
  private renderToken = 0;

  private onTimeUpdate?: (time: number) => void;
  private onPlayStateChange?: (playing: boolean) => void;

  constructor(
    canvas: HTMLCanvasElement,
    callbacks?: {
      onTimeUpdate?: (time: number) => void;
      onPlayStateChange?: (playing: boolean) => void;
    }
  ) {
    this.canvas = canvas;
    this.onTimeUpdate = callbacks?.onTimeUpdate;
    this.onPlayStateChange = callbacks?.onPlayStateChange;

    const gl = canvas.getContext('webgl2', {
      preserveDrawingBuffer: true,
      alpha: false,
      antialias: true,
    });
    if (!gl) {
      throw new Error('当前浏览器不支持 WebGL2 实时渲染上下文');
    }
    this.gl = gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this.bgPass = new BackgroundPass(gl);
    this.screenPass = new ScreenPass(gl);
    this.chromePass = new ChromePass(gl);
    this.focusPass = new FocusPass(gl);
    this.spotlightPass = new SpotlightPass(gl);
    this.cursorPass = new CursorPass(gl);
    this.cameraPass = new CameraPass(gl);
    this.blurRelay = new BackdropBlurRelay(gl);
    this.stickerPass = new StickerPass(gl);
    this.screenTex = createTexture2D(gl, true);
  }

  private computeCanvasDims(input: StudioPlayerSessionInput): CanvasDimensions {
    const srcW = Math.max(input.sourceWidth, 2);
    const srcH = Math.max(input.sourceHeight, 2);
    const crop = input.project.canvas.crop;
    const aspect = (srcW / srcH) * (crop.width / Math.max(crop.height, 0.01));
    const full = canvasStylePixelDimensions(
      input.project.canvas,
      input.project.exportSettings.resolution,
      aspect,
      { width: srcW, height: srcH }
    );
    const maxEdge = this.qualityMode === 'low' ? 960 : 2560;
    const longest = Math.max(full.width, full.height);
    if (longest <= maxEdge) {
      return {
        width: Math.max(2, Math.trunc(full.width / 2) * 2),
        height: Math.max(2, Math.trunc(full.height / 2) * 2),
      };
    }
    const scale = maxEdge / longest;
    return {
      width: Math.max(2, Math.round((full.width * scale) / 2) * 2),
      height: Math.max(2, Math.round((full.height * scale) / 2) * 2),
    };
  }

  setSession(input: StudioPlayerSessionInput, preserveTime: boolean = true): void {
    const sameMediaRoot =
      this.session?.framesBaseUrl === input.framesBaseUrl &&
      this.session?.cameraFramesBaseUrl === input.cameraFramesBaseUrl;
    if (!sameMediaRoot) {
      this.clearCache();
      this.lastUploadedScreenUrl = '';
      this.lastUploadedCameraUrl = '';
    }

    this.session = input;
    this.renderDims = this.computeCanvasDims(input);
    this.canvas.width = this.renderDims.width;
    this.canvas.height = this.renderDims.height;

    this.plan = makeFramePlan({
      project: input.project,
      pointerEvents: input.pointerEvents,
      fps: input.fps,
      durationSeconds: input.durationSeconds,
      sourceFrameCount: Math.max(input.sourceFrameCount, 1),
      canvas: this.renderDims,
    });

    const maxTime = Math.max(0, input.durationSeconds);
    if (!preserveTime) {
      this.currentTime = 0;
    } else {
      this.currentTime = Math.min(Math.max(this.currentTime, 0), maxTime);
    }
    void this.renderAtTime(this.currentTime);
  }

  updateProject(project: RecorderProject): void {
    if (!this.session) return;
    this.setSession({ ...this.session, project }, true);
  }

  setQualityMode(mode: PreviewQualityMode): void {
    if (this.qualityMode === mode) return;
    this.qualityMode = mode;
    if (this.session) {
      this.setSession(this.session, true);
    }
  }

  getQualityMode(): PreviewQualityMode {
    return this.qualityMode;
  }

  setPlaybackSpeed(speed: number): void {
    this.playbackSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  }

  getPlaybackSpeed(): number {
    return this.playbackSpeed;
  }

  getCurrentTime(): number {
    return this.currentTime;
  }

  getDuration(): number {
    return this.session?.durationSeconds ?? 0;
  }

  getLastScene(): FrameScene | null {
    return this.lastScene;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  play(): void {
    if (!this.session || this.playing) return;
    if (this.currentTime >= Math.max(0, this.session.durationSeconds - 0.02)) {
      this.currentTime = 0;
    }
    this.playing = true;
    this.lastRafMs = performance.now();
    this.onPlayStateChange?.(true);

    const tick = (nowMs: number) => {
      if (!this.playing || !this.session) return;
      const dt = Math.min(0.1, Math.max(0, (nowMs - this.lastRafMs) / 1000));
      this.lastRafMs = nowMs;
      let nextTime = this.currentTime + dt * this.playbackSpeed;
      const dur = this.session.durationSeconds;
      if (nextTime >= dur) {
        nextTime = dur;
        this.currentTime = nextTime;
        this.onTimeUpdate?.(nextTime);
        void this.renderAtTime(nextTime);
        this.pause();
        return;
      }
      this.currentTime = nextTime;
      this.onTimeUpdate?.(nextTime);
      void this.renderAtTime(nextTime);
      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.onPlayStateChange?.(false);
  }

  togglePlay(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  stepFrame(deltaFrames: number): void {
    if (!this.session) return;
    this.pause();
    const fps = this.session.fps > 0 ? this.session.fps : 60;
    const nextTime = Math.min(
      Math.max(0, this.currentTime + deltaFrames / fps),
      this.session.durationSeconds
    );
    this.seek(nextTime);
  }

  seek(outputTime: number): void {
    if (!this.session) return;
    const clamped = Math.min(Math.max(0, outputTime), this.session.durationSeconds);
    this.currentTime = clamped;
    this.onTimeUpdate?.(clamped);
    void this.renderAtTime(clamped);
  }

  canvasClientPointToNormalizedScreen(
    clientX: number,
    clientY: number
  ): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || !this.lastScene) return null;
    const cx = ((clientX - rect.left) / rect.width) * this.renderDims.width;
    const cy = ((clientY - rect.top) / rect.height) * this.renderDims.height;
    const cr = this.lastScene.screen.contentRect;
    if (!cr || cr.width <= 0 || cr.height <= 0) {
      return {
        x: Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1),
        y: Math.min(Math.max((clientY - rect.top) / rect.height, 0), 1),
      };
    }
    return {
      x: Math.min(Math.max((cx - cr.x) / cr.width, 0), 1),
      y: Math.min(Math.max((cy - cr.y) / cr.height, 0), 1),
    };
  }

  private async fetchCachedBitmap(url: string): Promise<ImageBitmap | HTMLImageElement | null> {
    const hit = this.cache.get(url);
    if (hit) {
      // Refresh LRU order
      this.cache.delete(url);
      this.cache.set(url, hit);
      return hit.image;
    }

    try {
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) return null;
      const blob = await res.blob();
      const image = await createImageBitmap(blob);
      if (this.cache.size >= this.maxCacheEntries) {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey !== undefined) {
          const oldest = this.cache.get(oldestKey);
          this.cache.delete(oldestKey);
          if (oldest && 'close' in oldest.image && typeof oldest.image.close === 'function') {
            oldest.image.close();
          }
        }
      }
      this.cache.set(url, { url, image });
      return image;
    } catch {
      return null;
    }
  }

  private createFallbackCanvas(frameNumber: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.renderDims.width;
    c.height = this.renderDims.height;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#1b1b1a';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#da7a52';
      ctx.font = 'bold 28px monospace';
      ctx.fillText(`DogSC Preview #${String(frameNumber).padStart(6, '0')}`, 48, 84);
    }
    return c;
  }

  async renderAtTime(outputTime: number): Promise<FrameScene | null> {
    if (!this.plan || !this.session) return null;
    const myToken = ++this.renderToken;
    const fps = this.session.fps > 0 ? this.session.fps : 60;
    const frameIndex = Math.min(
      Math.max(Math.round(outputTime * fps), 0),
      Math.max(this.plan.frameCount - 1, 0)
    );
    const { scene, sourceFrameFile } = this.plan.frameAt(frameIndex);
    this.lastScene = scene;

    const padded = String(sourceFrameFile).padStart(6, '0');
    const screenUrl =
      this.session.framesBaseUrl && this.session.sourceFrameCount > 0
        ? `${this.session.framesBaseUrl}/${padded}.jpg`
        : '';

    if (screenUrl && screenUrl !== this.lastUploadedScreenUrl) {
      const bmp = await this.fetchCachedBitmap(screenUrl);
      if (myToken !== this.renderToken) return scene;
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.screenTex);
      if (bmp) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
        this.lastUploadedScreenUrl = screenUrl;
      } else {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          this.createFallbackCanvas(sourceFrameFile)
        );
      }
    } else if (!screenUrl && this.lastUploadedScreenUrl !== 'fallback') {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.screenTex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.createFallbackCanvas(sourceFrameFile)
      );
      this.lastUploadedScreenUrl = 'fallback';
    }

    if (scene.camera && this.session.cameraFramesBaseUrl) {
      const camUrl = `${this.session.cameraFramesBaseUrl}/${padded}.jpg`;
      if (camUrl !== this.lastUploadedCameraUrl) {
        const camBmp = await this.fetchCachedBitmap(camUrl);
        if (myToken !== this.renderToken) return scene;
        if (camBmp) {
          const gl = this.gl;
          if (!this.cameraTex) {
            this.cameraTex = createTexture2D(gl, true);
          }
          gl.bindTexture(gl.TEXTURE_2D, this.cameraTex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, camBmp);
          this.lastUploadedCameraUrl = camUrl;
        }
      }
    }

    const gl = this.gl;
    const w = this.renderDims.width;
    const h = this.renderDims.height;

    const stickerPlan = computeStickerRenderPlan(scene, w, h);
    let blurPending = stickerPlan.blurStage !== 'none';
    const flushBlurIfDue = (stage: 'beforeCamera' | 'beforeStickers'): void => {
      if (blurPending && stickerPlan.blurStage === stage) {
        this.blurRelay.flushBlurredToScreen(w, h, stickerPlan.blurRadiusPx);
        blurPending = false;
      }
    };

    if (blurPending) {
      this.blurRelay.beginCapture(w, h);
    } else {
      gl.viewport(0, 0, w, h);
      gl.clearColor(0.0, 0.0, 0.0, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    dispatchSceneLayers(scene, {
      background: () => this.bgPass.render(scene, w, h),
      screen: () => {
        this.screenPass.renderShadow(scene, w, h);
        this.chromePass.render(scene, w, h);
        this.screenPass.renderContent(scene, this.screenTex, w, h);
        this.focusPass.render(scene, this.screenTex, w, h);
      },
      cursor: () => this.cursorPass.render(scene, w, h),
      spotlight: () => this.spotlightPass.render(scene, w, h),
      camera: () => {
        flushBlurIfDue('beforeCamera');
        this.cameraPass.render(scene, this.cameraTex, w, h);
      },
      stickers: () => {
        flushBlurIfDue('beforeStickers');
        this.stickerPass.render(scene, w, h);
      },
    });

    if (blurPending) {
      this.blurRelay.flushBlurredToScreen(w, h, stickerPlan.blurRadiusPx);
    }
    gl.flush();
    return scene;
  }

  clearCache(): void {
    for (const entry of this.cache.values()) {
      if ('close' in entry.image && typeof entry.image.close === 'function') {
        entry.image.close();
      }
    }
    this.cache.clear();
  }

  destroy(): void {
    this.pause();
    this.clearCache();
  }
}
