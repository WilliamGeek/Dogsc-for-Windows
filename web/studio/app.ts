/**
 * web/studio/app.ts
 *
 * Main controller wiring StudioServer HTTP API, StudioHistory + mutators,
 * StudioWebGLPlayer, and modular Timeline / Inspector / Export / Recording Island views.
 * Strictly ZERO node:* imports.
 */

import {
  decodeRecorderProject,
  encodeRecorderProject,
  type RecorderProject,
} from '../../src/core/ProjectMediaModel.ts';
import type { PointerEventRecord } from '../../src/core/ZoomAnimation.ts';
import type { CanvasAspectRatio } from '../../src/core/ProjectModel.ts';
import { StudioWebGLPlayer, type PreviewQualityMode } from './player.ts';
import {
  StudioHistory,
  computeTimelineOutputDuration,
  splitSegmentAtTime,
  deleteSegmentById,
  updateZoomClipById,
  deleteZoomClipById,
  deleteMosaicClipById,
  type StudioInspectorTab,
  type StudioSaveState,
  type StudioSelection,
  type StudioTool,
} from './state.ts';

export interface RecordingSummary {
  id: string;
  title: string;
  createdAt: string | null;
  durationSeconds: number;
  fps: number;
  width: number;
  height: number;
  frameCount: number;
  hasFrames: boolean;
  hasCamera: boolean;
  hasSystemAudio: boolean;
  hasMicAudio: boolean;
  hasExport: boolean;
}

export interface StudioSessionDetail {
  id: string;
  meta: Record<string, any>;
  project: RecorderProject;
  pointerEvents: PointerEventRecord[];
  sourceFrameCount: number;
  cameraFrameCount: number;
  hasCamera: boolean;
  hasSystemAudio: boolean;
  hasMicAudio: boolean;
  hasExport: boolean;
}

export interface StudioRuntimeContext {
  getDetail(): StudioSessionDetail | null;
  getProject(): RecorderProject | null;
  getSelection(): StudioSelection;
  setSelection(sel: StudioSelection): void;
  getTool(): StudioTool;
  setTool(tool: StudioTool): void;
  getInspectorTab(): StudioInspectorTab;
  setInspectorTab(tab: StudioInspectorTab): void;
  getTimelineZoom(): number;
  setTimelineZoom(zoom: number): void;
  getOutputDuration(): number;
  getPlayer(): StudioWebGLPlayer;
  applyProjectMutation(
    nextProject: RecorderProject,
    options?: {
      recordHistory?: boolean;
      selection?: StudioSelection;
      immediateSave?: boolean;
    }
  ): void;
  reloadRecordings(selectId?: string): Promise<void>;
  closeModal(): void;
}

function formatTimecode(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const mins = Math.floor(s / 60);
  const rem = s - mins * 60;
  return `${String(mins).padStart(2, '0')}:${rem.toFixed(2).padStart(5, '0')}`;
}

export class StudioApp {
  private readonly history = new StudioHistory();
  private readonly player: StudioWebGLPlayer;

  private recordings: RecordingSummary[] = [];
  private detail: StudioSessionDetail | null = null;
  private selection: StudioSelection = null;
  private tool: StudioTool = 'select';
  private inspectorTab: StudioInspectorTab = 'frame';
  private timelineZoom = 1;
  private saveTimer: number | null = null;

  private timelineRenderer: ((ctx: StudioRuntimeContext) => void) | null = null;
  private inspectorRenderer: ((ctx: StudioRuntimeContext) => void) | null = null;
  private exportModalOpener: ((ctx: StudioRuntimeContext) => void) | null = null;
  private recordModalOpener: ((ctx: StudioRuntimeContext) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.player = new StudioWebGLPlayer(canvas, {
      onTimeUpdate: (t) => {
        this.updatePlayheadUI(t);
        this.syncStageFocusOverlay();
      },
      onPlayStateChange: (playing) => {
        const btn = document.getElementById('btn-play-toggle');
        if (btn) btn.textContent = playing ? '⏸' : '▶';
      },
    });
  }

  registerPlugins(plugins: {
    renderTimeline?: (ctx: StudioRuntimeContext) => void;
    renderInspector?: (ctx: StudioRuntimeContext) => void;
    openExportModal?: (ctx: StudioRuntimeContext) => void;
    openRecordModal?: (ctx: StudioRuntimeContext) => void;
  }): void {
    if (plugins.renderTimeline) this.timelineRenderer = plugins.renderTimeline;
    if (plugins.renderInspector) this.inspectorRenderer = plugins.renderInspector;
    if (plugins.openExportModal) this.exportModalOpener = plugins.openExportModal;
    if (plugins.openRecordModal) this.recordModalOpener = plugins.openRecordModal;
  }

  private setInspectorTab(tab: StudioInspectorTab): void {
    this.inspectorTab = tab;
    this.syncRailTabs();
    this.renderInspectorView();
  }

  getContext(): StudioRuntimeContext {
    return {
      getDetail: () => this.detail,
      getProject: () => this.detail?.project ?? null,
      getSelection: () => this.selection,
      setSelection: (sel) => {
        this.selection = sel;
        if (sel?.kind === 'zoom') {
          this.inspectorTab = 'zoom';
          this.syncRailTabs();
        }
        this.renderSubViews();
        this.syncStageFocusOverlay();
      },
      getTool: () => this.tool,
      setTool: (tool) => {
        this.tool = tool;
        this.renderSubViews();
      },
      getInspectorTab: () => this.inspectorTab,
      setInspectorTab: (tab) => this.setInspectorTab(tab),
      getTimelineZoom: () => this.timelineZoom,
      setTimelineZoom: (z) => {
        this.timelineZoom = Math.min(4, Math.max(0.5, z));
        this.renderTimelineView();
      },
      getOutputDuration: () => {
        if (!this.detail) return 0;
        const srcDur = Math.max(Number(this.detail.meta?.durationSeconds) || 1, 0.05);
        return computeTimelineOutputDuration(this.detail.project, srcDur);
      },
      getPlayer: () => this.player,
      applyProjectMutation: (nextProject, options) => {
        if (!this.detail) return;
        const recordHistory = options?.recordHistory ?? true;
        if (recordHistory) {
          this.history.push(this.detail.project);
        }
        this.detail = { ...this.detail, project: nextProject };
        if (options?.selection !== undefined) {
          this.selection = options.selection;
        }
        this.player.updateProject(nextProject);
        this.syncHeaderAndTransport();
        this.renderSubViews();
        this.syncStageFocusOverlay();
        this.scheduleSave(Boolean(options?.immediateSave));
      },
      reloadRecordings: (selectId) => this.loadRecordingsList(selectId),
      closeModal: () => {
        const bd = document.getElementById('studio-modal-backdrop');
        bd?.classList.remove('open');
      },
    };
  }

  private setSaveState(state: StudioSaveState, msg?: string): void {
    const pill = document.getElementById('save-status-pill');
    if (!pill) return;
    pill.classList.remove('is-dirty', 'is-error');
    switch (state) {
      case 'saved':
        pill.textContent = '已保存';
        break;
      case 'dirty':
        pill.textContent = '待保存…';
        pill.classList.add('is-dirty');
        break;
      case 'saving':
        pill.textContent = '保存中…';
        pill.classList.add('is-dirty');
        break;
      case 'error':
        pill.textContent = msg ? `保存失败: ${msg}` : '保存失败';
        pill.classList.add('is-error');
        break;
    }
  }

  private scheduleSave(immediate: boolean): void {
    this.setSaveState('dirty');
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (immediate) {
      void this.persistCurrentProject();
      return;
    }
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.persistCurrentProject();
    }, 350);
  }

  async persistCurrentProject(): Promise<boolean> {
    if (!this.detail) return false;
    this.setSaveState('saving');
    try {
      const encoded = encodeRecorderProject(this.detail.project);
      const res = await fetch(`/api/recordings/${encodeURIComponent(this.detail.id)}/project`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: encoded,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        this.setSaveState('error', err.error ?? `HTTP ${res.status}`);
        return false;
      }
      this.setSaveState('saved');
      return true;
    } catch (err: any) {
      this.setSaveState('error', err?.message ?? String(err));
      return false;
    }
  }

  async init(): Promise<void> {
    this.bindChromeControls();
    this.bindTransportControls();
    this.bindKeyboardShortcuts();

    // Load optional modular Studio views dynamically if available
    await this.loadOptionalViews();

    const params = new URLSearchParams(window.location.search);
    const requestedDir = params.get('dir') ?? undefined;
    await this.loadRecordingsList(requestedDir);

    if (params.get('action') === 'record' && this.recordModalOpener) {
      this.recordModalOpener(this.getContext());
      const cleanQuery = requestedDir ? `?dir=${encodeURIComponent(requestedDir)}` : '';
      window.history.replaceState(null, '', `${window.location.pathname}${cleanQuery}`);
    }
  }

  private async loadOptionalViews(): Promise<void> {
    try {
      const [tlMod, inspMod] = await Promise.all([
        import('./timeline.ts').catch(() => null),
        import('./inspector.ts').catch(() => null),
      ]);
      const plugins: Parameters<StudioApp['registerPlugins']>[0] = {};
      if (tlMod && typeof (tlMod as any).renderStudioTimeline === 'function') {
        plugins.renderTimeline = (tlMod as any).renderStudioTimeline;
      }
      if (inspMod && typeof (inspMod as any).renderStudioInspector === 'function') {
        plugins.renderInspector = (inspMod as any).renderStudioInspector;
      }
      const [recMod, expMod] = await Promise.all([
        import('./recorderIsland.ts').catch(() => null),
        import('./exportSheet.ts').catch(() => null),
      ]);
      if (recMod && typeof (recMod as any).openRecordingIslandModal === 'function') {
        plugins.openRecordModal = (recMod as any).openRecordingIslandModal;
      }
      if (expMod && typeof (expMod as any).openExportSheetModal === 'function') {
        plugins.openExportModal = (expMod as any).openExportSheetModal;
      }
      this.registerPlugins(plugins);
    } catch {
      // Initial baseline runs cleanly even before optional views are imported
    }
  }

  private libraryShellInstance: {
    render(host: any): void;
    focusAiComposer(host?: any): void;
    toggleOpen(host?: any): void;
    setActiveTab(tab: any, host?: any): void;
    registerPanelRenderer(tab: any, fn: any): void;
  } | null = null;
  private libraryShellLoading: Promise<void> | null = null;

  private buildLibraryHost() {
    return {
      getSessionId: () => this.detail?.id ?? null,
      getProject: () => this.detail?.project ?? null,
      getRawDuration: () => Math.max(Number(this.detail?.meta?.durationSeconds) || 1, 0.05),
      getCurrentTime: () => this.player.getCurrentTime(),
      getOutputDuration: () => this.player.getDuration(),
      seekTo: (sec: number) => {
        this.player.pause();
        this.player.seek(sec);
      },
      persistProject: () => this.persistCurrentProject(),
      applyExternalProject: (rawProject: unknown, pushUndo = true) => {
        this.applyExternalProject(rawProject, pushUndo);
      },
      mutateProject: (next: RecorderProject, opts?: { immediate?: boolean }) => {
        this.getContext().applyProjectMutation(next, opts);
      },
      reloadRecording: async () => {
        if (this.detail?.id) {
          await this.loadSession(this.detail.id);
        }
      },
      refreshViews: () => this.renderSubViews(),
    };
  }

  private syncLibraryView(): void {
    const host = this.buildLibraryHost();
    if (this.libraryShellInstance) {
      this.libraryShellInstance.render(host);
      return;
    }
    if (!this.libraryShellLoading) {
      this.libraryShellLoading = import('./libraryShell.ts')
        .then(({ StudioLibraryShell }) => {
          this.libraryShellInstance = new StudioLibraryShell();
          this.libraryShellInstance.render(this.buildLibraryHost());
        })
        .catch(() => {
          // Ignore optional module load failure in headless contexts
        });
    }
  }

  private applyExternalProject(rawProjectPayload: unknown, pushUndo: boolean = true): void {
    if (!this.detail) return;
    const project = decodeRecorderProject(rawProjectPayload);
    if (pushUndo) {
      this.history.push(this.detail.project);
    }
    this.detail = { ...this.detail, project };
    const fps = Number(this.detail.meta?.fps) || 60;
    const srcW = Number(this.detail.meta?.width) || 1920;
    const srcH = Number(this.detail.meta?.height) || 1080;
    const srcDur = Math.max(Number(this.detail.meta?.durationSeconds) || 1, 0.05);
    const outDur = computeTimelineOutputDuration(project, srcDur);

    this.player.setSession(
      {
        project,
        pointerEvents: this.detail.pointerEvents,
        fps,
        sourceFps: fps,
        sourceWidth: srcW,
        sourceHeight: srcH,
        durationSeconds: outDur,
        sourceFrameCount: this.detail.sourceFrameCount,
        framesBaseUrl: `/recordings/${encodeURIComponent(this.detail.id)}/frames`,
        cameraFramesBaseUrl:
          this.detail.cameraFrameCount > 0
            ? `/recordings/${encodeURIComponent(this.detail.id)}/camera_frames`
            : null,
        assetsBaseUrl: `/recordings/${encodeURIComponent(this.detail.id)}/assets`,
      },
      true
    );
    this.setSaveState('saved');
    this.syncHeaderAndTransport();
    this.renderSubViews();
  }

  private focusAiAssistant(): void {
    const host = this.buildLibraryHost();
    if (this.libraryShellInstance) {
      this.libraryShellInstance.focusAiComposer(host);
    } else {
      this.syncLibraryView();
      void this.libraryShellLoading?.then(() => this.libraryShellInstance?.focusAiComposer(this.buildLibraryHost()));
    }
  }

  private toggleLibraryDrawer(): void {
    const host = this.buildLibraryHost();
    if (this.libraryShellInstance) {
      this.libraryShellInstance.toggleOpen(host);
    } else {
      this.syncLibraryView();
    }
  }

  private cropOverlayController: {
    isActive(): boolean;
    setActive(next: boolean): void;
    toggle(): boolean;
    sync(container: HTMLElement | null, getCrop: () => any, onChangeCrop: (next: any, rec: boolean) => void, onDone: () => void): void;
  } | null = null;
  private cropOverlayLoading: Promise<void> | null = null;

  private syncCropOverlayView(): void {
    const container = document.getElementById('stage-crop-overlay');
    const getCrop = () => this.detail?.project.canvas.crop ?? null;
    const onChange = (nextCrop: any, recHistory: boolean) => {
      if (!this.detail) return;
      this.getContext().applyProjectMutation(
        {
          ...this.detail.project,
          canvas: { ...this.detail.project.canvas, crop: nextCrop },
        },
        { recordHistory: recHistory }
      );
    };
    const onDone = () => {
      this.cropOverlayController?.setActive(false);
      this.syncCropOverlayView();
    };
    if (this.cropOverlayController) {
      this.cropOverlayController.sync(container, getCrop, onChange, onDone);
      return;
    }
    if (!this.cropOverlayLoading) {
      this.cropOverlayLoading = import('./cropOverlay.ts')
        .then(({ StudioCropOverlayController }) => {
          this.cropOverlayController = new StudioCropOverlayController();
          this.cropOverlayController.sync(container, getCrop, onChange, onDone);
        })
        .catch(() => {});
    }
  }

  private toggleCropMode(): void {
    if (this.cropOverlayController) {
      this.cropOverlayController.toggle();
      this.syncCropOverlayView();
    } else {
      this.syncCropOverlayView();
      void this.cropOverlayLoading?.then(() => {
        this.cropOverlayController?.toggle();
        this.syncCropOverlayView();
      });
    }
  }

  async loadRecordingsList(preferredId?: string): Promise<void> {
    const res = await fetch('/api/recordings', { cache: 'no-store' });
    const data = await res.json();
    this.recordings = Array.isArray(data.recordings) ? data.recordings : [];

    const picker = document.getElementById('recording-picker') as HTMLSelectElement | null;
    if (picker) {
      picker.innerHTML = '';
      if (this.recordings.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '暂无录制（点击新建录制）';
        picker.appendChild(opt);
      } else {
        for (const r of this.recordings) {
          const opt = document.createElement('option');
          opt.value = r.id;
          opt.textContent = `${r.id} · ${r.title} (${r.durationSeconds.toFixed(1)}s)`;
          picker.appendChild(opt);
        }
      }
    }

    const targetId =
      preferredId && this.recordings.some((r) => r.id === preferredId)
        ? preferredId
        : this.recordings[0]?.id;

    if (targetId) {
      if (picker) picker.value = targetId;
      await this.loadSession(targetId);
    } else {
      this.setSaveState('saved');
      this.renderSubViews();
    }
  }

  async loadSession(id: string): Promise<void> {
    this.player.pause();
    const res = await fetch(`/api/recordings/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!res.ok) return;
    const raw = await res.json();

    if (raw.sourceFrameCount === 0) {
      this.setSaveState('dirty');
      const prep = await fetch(`/api/recordings/${encodeURIComponent(id)}/prepare-frames`, {
        method: 'POST',
      });
      if (prep.ok) {
        const p = await prep.json();
        raw.sourceFrameCount = p.sourceFrameCount;
        raw.cameraFrameCount = p.cameraFrameCount;
      }
    }

    const project = decodeRecorderProject(raw.project);
    this.history.reset();
    this.selection = null;
    this.detail = {
      id: raw.id,
      meta: raw.meta,
      project,
      pointerEvents: Array.isArray(raw.pointerEvents) ? raw.pointerEvents : [],
      sourceFrameCount: Number(raw.sourceFrameCount) || 0,
      cameraFrameCount: Number(raw.cameraFrameCount) || 0,
      hasCamera: Boolean(raw.hasCamera),
      hasSystemAudio: Boolean(raw.hasSystemAudio),
      hasMicAudio: Boolean(raw.hasMicAudio),
      hasExport: Boolean(raw.hasExport),
    };

    const fps = Number(raw.meta?.fps) || 60;
    const srcW = Number(raw.meta?.width) || 1920;
    const srcH = Number(raw.meta?.height) || 1080;
    const srcDur = Math.max(Number(raw.meta?.durationSeconds) || 1, 0.05);
    const outDur = computeTimelineOutputDuration(project, srcDur);

    this.player.setSession(
      {
        project,
        pointerEvents: this.detail.pointerEvents,
        fps,
        sourceFps: fps,
        sourceWidth: srcW,
        sourceHeight: srcH,
        durationSeconds: outDur,
        sourceFrameCount: this.detail.sourceFrameCount,
        framesBaseUrl: `/recordings/${encodeURIComponent(id)}/frames`,
        cameraFramesBaseUrl:
          this.detail.cameraFrameCount > 0
            ? `/recordings/${encodeURIComponent(id)}/camera_frames`
            : null,
        assetsBaseUrl: `/recordings/${encodeURIComponent(id)}/assets`,
      },
      false
    );

    this.setSaveState('saved');
    this.syncHeaderAndTransport();
    this.updatePlayheadUI(0);
    this.renderSubViews();
  }

  private syncHeaderAndTransport(): void {
    const titleInput = document.getElementById('project-title-input') as HTMLInputElement | null;
    if (titleInput && this.detail) {
      titleInput.value = this.detail.project.title;
    }

    const undoBtn = document.getElementById('btn-undo') as HTMLButtonElement | null;
    const redoBtn = document.getElementById('btn-redo') as HTMLButtonElement | null;
    if (undoBtn) undoBtn.disabled = !this.history.canUndo();
    if (redoBtn) redoBtn.disabled = !this.history.canRedo();

    const ratioBtns = document.querySelectorAll('#quick-ratio-switch .seg-opt');
    ratioBtns.forEach((btn) => {
      const r = btn.getAttribute('data-ratio');
      btn.classList.toggle('active', r === this.detail?.project.canvas.aspectRatio);
    });

    const tcTotal = document.getElementById('tc-total');
    if (tcTotal) {
      tcTotal.textContent = formatTimecode(this.player.getDuration());
    }
  }

  private updatePlayheadUI(time: number): void {
    const tcCurrent = document.getElementById('tc-current');
    if (tcCurrent) tcCurrent.textContent = formatTimecode(time);

    const dur = Math.max(this.player.getDuration(), 0.001);
    const pct = Math.min(100, Math.max(0, (time / dur) * 100));
    const fill = document.getElementById('monitor-progress-fill');
    if (fill) fill.style.width = `${pct}%`;

    const playhead = document.getElementById('timeline-playhead-line');
    if (playhead) {
      playhead.style.left = `${pct}%`;
    }
  }

  private syncRailTabs(): void {
    document.querySelectorAll('#studio-inspector-rail .rail-tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === this.inspectorTab);
    });
  }

  private syncStageFocusOverlay(): void {
    const stage = document.getElementById('studio-stage');
    const hint = document.getElementById('stage-focus-hint');
    const marker = document.getElementById('focus-target-marker');
    const isZoomSelected = this.selection?.kind === 'zoom';

    stage?.classList.toggle('is-focus-pick', isZoomSelected);
    hint?.classList.toggle('visible', isZoomSelected);

    if (marker && isZoomSelected && this.detail) {
      const clip = this.detail.project.timeline.zoomClips.find(
        (c) => c.id === (this.selection as { kind: 'zoom'; id: string }).id
      );
      if (clip) {
        const stageCanvas = stage as HTMLCanvasElement | null;
        const cr = this.player.getRenderedScreenContentRect();
        const cw = stageCanvas && stageCanvas.width > 0 ? stageCanvas.width : 0;
        const ch = stageCanvas && stageCanvas.height > 0 ? stageCanvas.height : 0;
        const pctX =
          cr && cr.width > 0 && cw > 0
            ? ((cr.x + clip.focus.x * cr.width) / cw) * 100
            : clip.focus.x * 100;
        const pctY =
          cr && cr.height > 0 && ch > 0
            ? ((cr.y + clip.focus.y * cr.height) / ch) * 100
            : clip.focus.y * 100;
        marker.style.left = `${Math.min(100, Math.max(0, pctX))}%`;
        marker.style.top = `${Math.min(100, Math.max(0, pctY))}%`;
        marker.classList.add('visible');
        return;
      }
    }
    marker?.classList.remove('visible');
  }

  private renderTimelineView(): void {
    if (this.timelineRenderer) {
      this.timelineRenderer(this.getContext());
    } else {
      const dock = document.getElementById('studio-timeline');
      if (dock) {
        dock.innerHTML = `<div style="padding:14px 16px;color:var(--ink-secondary);">多轨时间线模块将在 T16.3 加载 · 当前总时长 ${formatTimecode(this.player.getDuration())}</div>`;
      }
    }
  }

  private renderInspectorView(): void {
    if (this.inspectorRenderer) {
      this.inspectorRenderer(this.getContext());
    } else {
      const body = document.getElementById('studio-inspector-body');
      if (body && this.detail) {
        body.innerHTML = `
          <div class="inspector-head"><h2 class="inspector-title">画面</h2><span class="inspector-scope">全片</span></div>
          <div class="insp-card">
            <div class="insp-card-title">实时参数摘要</div>
            <div class="insp-row"><span class="insp-label">画布比例</span><span class="insp-val">${this.detail.project.canvas.aspectRatio}</span></div>
            <div class="insp-row"><span class="insp-label">背景模式</span><span class="insp-val">${this.detail.project.canvas.backgroundSource.kind}</span></div>
            <div class="insp-row"><span class="insp-label">缩放片段</span><span class="insp-val">${this.detail.project.timeline.zoomClips.length} 段</span></div>
          </div>`;
      }
    }
  }

  private renderSubViews(): void {
    this.syncRailTabs();
    this.renderTimelineView();
    this.renderInspectorView();
    this.syncLibraryView();
    this.syncCropOverlayView();
    this.updatePlayheadUI(this.player.getCurrentTime());
  }

  private performUndo(): void {
    if (!this.detail) return;
    const prev = this.history.undo(this.detail.project);
    if (!prev) return;
    this.getContext().applyProjectMutation(prev, { recordHistory: false, selection: null });
  }

  private performRedo(): void {
    if (!this.detail) return;
    const next = this.history.redo(this.detail.project);
    if (!next) return;
    this.getContext().applyProjectMutation(next, { recordHistory: false, selection: null });
  }

  private bindChromeControls(): void {
    const picker = document.getElementById('recording-picker') as HTMLSelectElement | null;
    picker?.addEventListener('change', () => {
      if (picker.value) void this.loadSession(picker.value);
    });

    const titleInput = document.getElementById('project-title-input') as HTMLInputElement | null;
    titleInput?.addEventListener('change', () => {
      if (!this.detail) return;
      const trimmed = titleInput.value.trim() || this.detail.id;
      this.getContext().applyProjectMutation({
        ...this.detail.project,
        title: trimmed,
      });
    });

    document.getElementById('btn-undo')?.addEventListener('click', () => this.performUndo());
    document.getElementById('btn-redo')?.addEventListener('click', () => this.performRedo());

    const themeBtn = document.getElementById('btn-theme-toggle');
    themeBtn?.addEventListener('click', () => {
      const root = document.documentElement;
      const isLight = root.getAttribute('data-theme') === 'light';
      root.setAttribute('data-theme', isLight ? 'dark' : 'light');
      if (themeBtn) themeBtn.textContent = isLight ? '浅色' : '深色';
    });

    document.getElementById('btn-new-record')?.addEventListener('click', () => {
      if (this.recordModalOpener) {
        this.recordModalOpener(this.getContext());
      } else {
        this.openFallbackModal(
          '新建录制',
          '<p>请在交互终端运行 <code>node scripts/record.ts --seconds 8</code>，或在 T16.4 录制岛弹窗就绪后一键录制。</p>'
        );
      }
    });

    document.getElementById('btn-open-export')?.addEventListener('click', () => {
      void this.persistCurrentProject().then(() => {
        if (this.exportModalOpener) {
          this.exportModalOpener(this.getContext());
        } else {
          this.openFallbackModal(
            '导出成片',
            '<p>当前已同步保存工程修改。多规格可视化导出弹窗将在 T16.5 完成接线。</p>'
          );
        }
      });
    });

    document.querySelectorAll('#studio-inspector-rail .rail-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab') as StudioInspectorTab | null;
        if (tab) this.getContext().setInspectorTab(tab);
      });
    });

    document.getElementById('studio-modal-backdrop')?.addEventListener('click', (ev) => {
      if (ev.target === ev.currentTarget) {
        this.getContext().closeModal();
      }
    });
  }

  private openFallbackModal(title: string, bodyHtml: string): void {
    const bd = document.getElementById('studio-modal-backdrop');
    const card = document.getElementById('studio-modal-card');
    if (!bd || !card) return;
    card.className = 'modal-card';
    card.innerHTML = `
      <div class="modal-header"><h3 class="modal-title">${title}</h3><button id="modal-close-x" class="chrome-btn">✕</button></div>
      <div class="modal-body">${bodyHtml}</div>
      <div class="modal-footer"><span></span><button id="modal-close-ok" class="primary-export-btn">知道了</button></div>`;
    bd.classList.add('open');
    document.getElementById('modal-close-x')?.addEventListener('click', () => bd.classList.remove('open'));
    document.getElementById('modal-close-ok')?.addEventListener('click', () => bd.classList.remove('open'));
  }

  private openShortcutsModal(): void {
    this.openFallbackModal(
      '键盘快捷键速查',
      `
      <div class="shortcuts-grid">
        <div class="shortcuts-col">
          <div class="shortcuts-cat">播放与检视</div>
          <div class="sc-row"><span>播放 / 暂停</span><kbd>Space</kbd></div>
          <div class="sc-row"><span>上一帧 / 下一帧</span><kbd>←</kbd> <kbd>→</kbd></div>
          <div class="sc-row"><span>撤销 / 重做</span><kbd>Ctrl+Z</kbd> <kbd>Ctrl+Y</kbd></div>
          <div class="sc-row"><span>快捷键速查表</span><kbd>?</kbd></div>
        </div>
        <div class="shortcuts-col">
          <div class="shortcuts-cat">剪辑与 AI 助手</div>
          <div class="sc-row"><span>选择 / 剪刀分割工具</span><kbd>A</kbd> <kbd>B</kbd></div>
          <div class="sc-row"><span>从播放头拆分主片段</span><kbd>S</kbd></div>
          <div class="sc-row"><span>删除选中片段 / 字幕 / 动效</span><kbd>Del</kbd></div>
          <div class="sc-row"><span>聚焦 AI 编辑对话</span><kbd>Ctrl+K</kbd></div>
          <div class="sc-row"><span>展开 / 收起左侧面板</span><kbd>Ctrl+Alt+L</kbd></div>
        </div>
      </div>`
    );
  }

  private bindTransportControls(): void {
    document.getElementById('btn-play-toggle')?.addEventListener('click', () => this.player.togglePlay());
    document.getElementById('btn-step-back')?.addEventListener('click', () => this.player.stepFrame(-1));
    document.getElementById('btn-step-fwd')?.addEventListener('click', () => this.player.stepFrame(1));

    const speedSel = document.getElementById('preview-speed-select') as HTMLSelectElement | null;
    speedSel?.addEventListener('change', () => {
      this.player.setPlaybackSpeed(Number(speedSel.value) || 1);
    });

    document.querySelectorAll('#quality-mode-toggle .seg-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        const q = btn.getAttribute('data-quality') as PreviewQualityMode | null;
        if (!q) return;
        this.player.setQualityMode(q);
        document.querySelectorAll('#quality-mode-toggle .seg-opt').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-quality') === q);
        });
      });
    });

    document.querySelectorAll('#quick-ratio-switch .seg-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.detail) return;
        const ratio = btn.getAttribute('data-ratio') as CanvasAspectRatio | null;
        if (!ratio) return;
        this.getContext().applyProjectMutation({
          ...this.detail.project,
          canvas: { ...this.detail.project.canvas, aspectRatio: ratio },
        });
      });
    });

    document.getElementById('btn-toggle-crop')?.addEventListener('click', () => {
      this.toggleCropMode();
    });
    window.addEventListener('dogsc:toggle-crop', () => {
      this.toggleCropMode();
    });
    window.addEventListener('dogsc:open-library-tab', (ev) => {
      const tab = (ev as CustomEvent).detail;
      if (tab === 'ai' || tab === 'assets' || tab === 'subtitles' || tab === 'motion') {
        const host = this.buildLibraryHost();
        if (this.libraryShellInstance) {
          this.libraryShellInstance.setActiveTab(tab, host);
        } else {
          this.syncLibraryView();
        }
      }
    });
    document.getElementById('btn-shortcuts-help')?.addEventListener('click', () => {
      this.openShortcutsModal();
    });

    // Monitor progress bar scrub
    const track = document.getElementById('monitor-progress-track');
    const scrubFromClientX = (clientX: number) => {
      if (!track) return;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return;
      const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      this.player.pause();
      this.player.seek(frac * this.player.getDuration());
    };
    track?.addEventListener('pointerdown', (ev) => {
      track.setPointerCapture(ev.pointerId);
      scrubFromClientX(ev.clientX);
    });
    track?.addEventListener('pointermove', (ev) => {
      if (ev.buttons === 1) scrubFromClientX(ev.clientX);
    });

    // Click stage to update selected zoom clip focus point
    const stage = document.getElementById('studio-stage');
    stage?.addEventListener('click', (ev) => {
      if (!this.detail || this.selection?.kind !== 'zoom') return;
      const norm = this.player.canvasClientPointToNormalizedScreen(ev.clientX, ev.clientY);
      if (!norm) return;
      const res = updateZoomClipById(this.detail.project, this.selection.id, { focus: norm });
      this.getContext().applyProjectMutation(res.project, { selection: res.selection });
    });
  }

  private bindKeyboardShortcuts(): void {
    window.addEventListener('keydown', (ev) => {
      const target = ev.target as HTMLElement | null;
      const isEditingText =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT';

      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
        ev.preventDefault();
        this.focusAiAssistant();
        return;
      }

      if ((ev.ctrlKey || ev.metaKey) && ev.altKey && ev.key.toLowerCase() === 'l') {
        ev.preventDefault();
        this.toggleLibraryDrawer();
        return;
      }

      if ((ev.ctrlKey || ev.metaKey) && !isEditingText) {
        if (ev.key.toLowerCase() === 'z' && !ev.shiftKey) {
          ev.preventDefault();
          this.performUndo();
          return;
        }
        if (ev.key.toLowerCase() === 'y' || (ev.key.toLowerCase() === 'z' && ev.shiftKey)) {
          ev.preventDefault();
          this.performRedo();
          return;
        }
      }

      if (isEditingText) return;

      if (ev.code === 'Space') {
        ev.preventDefault();
        this.player.togglePlay();
      } else if (ev.key === 'ArrowLeft') {
        ev.preventDefault();
        this.player.stepFrame(-1);
      } else if (ev.key === 'ArrowRight') {
        ev.preventDefault();
        this.player.stepFrame(1);
      } else if (ev.key.toLowerCase() === 'a') {
        this.getContext().setTool('select');
      } else if (ev.key.toLowerCase() === 'b') {
        this.getContext().setTool('cut');
      } else if (ev.key.toLowerCase() === 's' && this.detail) {
        try {
          const srcDur = Math.max(Number(this.detail.meta?.durationSeconds) || 1, 0.05);
          const res = splitSegmentAtTime(this.detail.project, srcDur, this.player.getCurrentTime());
          this.getContext().applyProjectMutation(res.project, { selection: res.selection });
        } catch {
          // Ignore split outside valid interior bounds
        }
      } else if (ev.key === '?' || (ev.key === '/' && ev.shiftKey)) {
        ev.preventDefault();
        this.openShortcutsModal();
      } else if (ev.key === 'Escape') {
        this.getContext().closeModal();
        if (this.cropOverlayController?.isActive()) {
          this.cropOverlayController.setActive(false);
          this.syncCropOverlayView();
        }
      } else if ((ev.key === 'Delete' || ev.key === 'Backspace') && this.detail && this.selection) {
        try {
          const srcDur = Math.max(Number(this.detail.meta?.durationSeconds) || 1, 0.05);
          if (this.selection.kind === 'zoom') {
            const res = deleteZoomClipById(this.detail.project, this.selection.id);
            this.getContext().applyProjectMutation(res.project, { selection: null });
          } else if (this.selection.kind === 'mosaic') {
            const res = deleteMosaicClipById(this.detail.project, this.selection.id);
            this.getContext().applyProjectMutation(res.project, { selection: null });
          } else if (this.selection.kind === 'subtitle') {
            const nextCues = this.detail.project.timeline.subtitleCues.filter((c) => c.id !== this.selection!.id);
            this.getContext().applyProjectMutation(
              { ...this.detail.project, timeline: { ...this.detail.project.timeline, subtitleCues: nextCues } },
              { selection: null }
            );
          } else if (this.selection.kind === 'animation') {
            const nextAnims = this.detail.project.timeline.animationClips.filter((c) => c.id !== this.selection!.id);
            this.getContext().applyProjectMutation(
              { ...this.detail.project, timeline: { ...this.detail.project.timeline, animationClips: nextAnims } },
              { selection: null }
            );
          } else if (this.selection.kind === 'audio') {
            const nextAudio = this.detail.project.timeline.audioClips.filter((c) => c.id !== this.selection!.id);
            this.getContext().applyProjectMutation(
              { ...this.detail.project, timeline: { ...this.detail.project.timeline, audioClips: nextAudio } },
              { selection: null }
            );
          } else if (this.selection.kind === 'segment') {
            const res = deleteSegmentById(this.detail.project, srcDur, this.selection.id);
            this.getContext().applyProjectMutation(res.project, { selection: res.selection });
          }
        } catch {
          // Preserve state if cannot delete last segment
        }
      }
    });
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const canvas = document.getElementById('studio-stage') as HTMLCanvasElement | null;
  if (canvas) {
    const app = new StudioApp(canvas);
    (window as any).__dogscStudio = app;
    void app.init();
  }
}
