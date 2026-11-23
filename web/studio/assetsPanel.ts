/**
 * web/studio/assetsPanel.ts
 *
 * Left Library `素材库` (`assets`) tab:
 * - Upload external image / audio / video / `.dmhtml` assets to session storage
 * - Built-in SoundSynth SFX synthesis (`click`, `whoosh`, `pop`, `chime`, `ding`)
 * - Asset actions (`设为壁纸`, `加入音轨`) & active `audioClips` speech-ducking toggle
 * - Multi-recording merge into current project timeline
 * Strictly ZERO node:* imports and stripTypeScriptTypes compatible.
 */

import type { LibraryPanelHost } from './aiPanel.ts';
import { makeAudioClip, type MediaAssetKind } from '../../src/core/PostProductionModel.ts';
import { makeOverlayTiming } from '../../src/core/OverlayTimeline.ts';
import { svgIcon } from './icons.ts';

interface RecordingSummaryItem {
  id: string;
  title: string;
  durationSeconds: number;
}

const SFX_ITEMS: ReadonlyArray<{ id: 'click' | 'whoosh' | 'pop' | 'chime' | 'ding'; label: string }> = [
  { id: 'click', label: '点击 Click' },
  { id: 'whoosh', label: '划过 Whoosh' },
  { id: 'pop', label: '弹出 Pop' },
  { id: 'chime', label: '提示音 Chime' },
  { id: 'ding', label: '叮咚 Ding' },
];

function escapeHtml(text: string): string {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function assetKindLabel(kind: MediaAssetKind): string {
  switch (kind) {
    case 'image':
      return '图片';
    case 'audio':
      return '音频';
    case 'video':
      return '视频';
    case 'animation':
      return '动效';
  }
}

function formatClock(sec: number): string {
  const s = Math.max(0, sec);
  const mins = Math.floor(s / 60);
  const rem = s - mins * 60;
  return `${mins}:${rem.toFixed(1).padStart(4, '0')}`;
}

export class AssetsLibraryPanel {
  private container: HTMLElement | null = null;
  private host: LibraryPanelHost | null = null;
  private otherRecordings: RecordingSummaryItem[] = [];
  private loadedListForSession: string | null = null;
  private noticeText: string | null = null;
  private busy = false;

  mountOrSync(container: HTMLElement, host: LibraryPanelHost): void {
    this.container = container;
    this.host = host;

    const sessionId = host.getSessionId();
    if (sessionId && sessionId !== this.loadedListForSession) {
      this.loadedListForSession = sessionId;
      void this.fetchOtherRecordings(sessionId);
    }

    this.render();
  }

  private async fetchOtherRecordings(currentId: string): Promise<void> {
    try {
      const res = await fetch('/api/recordings', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data.recordings) ? (data.recordings as RecordingSummaryItem[]) : [];
      this.otherRecordings = list.filter((r) => r.id !== currentId);
      if (this.loadedListForSession === currentId) {
        this.render();
      }
    } catch {
      // Ignore transient error
    }
  }

  private render(): void {
    if (!this.container || !this.host) return;
    const sessionId = this.host.getSessionId();
    const project = this.host.getProject();

    if (!sessionId || !project) {
      this.container.innerHTML = `<div class="lib-placeholder-card"><div class="lib-placeholder-title">媒体素材库</div><p class="lib-placeholder-desc">请先选择或新建一段录制工程。</p></div>`;
      return;
    }

    const assets = project.timeline.mediaAssets ?? [];
    const audioClips = project.timeline.audioClips ?? [];

    const assetsHtml =
      assets.length === 0
        ? `<div class="assets-empty">尚未导入本地图片、音乐或动效文件。</div>`
        : assets
            .map((a) => {
              const actionBtn =
                a.kind === 'image'
                  ? `<button class="chrome-btn asset-act-btn" data-set-wallpaper="${escapeHtml(a.path)}">设为壁纸</button>`
                  : a.kind === 'audio'
                    ? `<button class="chrome-btn asset-act-btn" data-insert-audio="${escapeHtml(a.path)}">插入音轨</button>`
                    : '';
              return `
                <div class="asset-item-row">
                  <div class="asset-item-meta">
                    <span class="asset-kind-tag">${assetKindLabel(a.kind)}</span>
                    <span class="asset-item-name" title="${escapeHtml(a.path)}">${escapeHtml(a.name)}</span>
                  </div>
                  ${actionBtn}
                </div>`;
            })
            .join('');

    const clipsHtml =
      audioClips.length === 0
        ? `<div class="assets-empty">暂无背景音乐或合成音效片段。</div>`
        : audioClips
            .map((c) => {
              const shortName = c.sourcePath.split(/[\\/]/).pop() ?? c.sourcePath;
              return `
                <div class="audio-clip-row">
                  <div class="audio-clip-top">
                    <span class="audio-clip-name" title="${escapeHtml(c.sourcePath)}">${escapeHtml(shortName)}</span>
                    <span class="audio-clip-time">${formatClock(c.timing.startTime)} · ${Math.round(c.volume * 100)}%</span>
                  </div>
                  <div class="audio-clip-controls">
                    <label class="assets-check-label">
                      <span class="studio-switch">
                        <input type="checkbox" class="audio-duck-toggle" data-clip-id="${escapeHtml(c.id)}" ${
                          c.ducksUnderSpeech ? 'checked' : ''
                        } />
                        <span class="studio-switch-track"><span class="studio-switch-thumb"></span></span>
                      </span>
                      <span>人声压低</span>
                    </label>
                    <button class="chrome-btn asset-act-btn" data-delete-audio="${escapeHtml(c.id)}">${svgIcon('trash', 11)}<span>移除</span></button>
                  </div>
                </div>`;
            })
            .join('');

    const sfxHtml = SFX_ITEMS.map(
      (s) =>
        `<button class="chrome-btn sfx-preset-btn" data-sfx-preset="${s.id}" ${
          this.busy ? 'disabled' : ''
        }>${svgIcon('plus', 11)}<span>${escapeHtml(s.label)}</span></button>`
    ).join('');

    const mergeOptionsHtml = this.otherRecordings
      .map(
        (r) =>
          `<option value="${escapeHtml(r.id)}">${escapeHtml(r.id)} · ${escapeHtml(
            r.title
          )} (${r.durationSeconds.toFixed(1)}s)</option>`
      )
      .join('');

    this.container.innerHTML = `
      <div class="assets-panel-root">
        ${this.noticeText ? `<div class="ai-notice-banner">${escapeHtml(this.noticeText)}</div>` : ''}

        <div class="insp-card">
          <div class="insp-card-title">导入本地媒体</div>
          <label class="assets-upload-btn chrome-btn subtle-well">
            <input id="assets-file-input" type="file" accept="image/*,audio/*,video/*,.dmhtml" hidden ${
              this.busy ? 'disabled' : ''
            } />
            ${svgIcon('upload', 12)}<span>${this.busy ? '处理中…' : '上传图片 / 音频 / .dmhtml'}</span>
          </label>
        </div>

        <div class="insp-card">
          <div class="insp-card-title">内置合成音效 (SoundSynth)</div>
          <div class="sfx-grid">${sfxHtml}</div>
        </div>

        <div class="insp-card">
          <div class="insp-card-title">工程媒体素材 (${assets.length})</div>
          <div class="assets-list">${assetsHtml}</div>
        </div>

        <div class="insp-card">
          <div class="insp-card-title">叠加音轨与人声压低 (${audioClips.length})</div>
          <div class="assets-list">${clipsHtml}</div>
        </div>

        <div class="insp-card">
          <div class="insp-card-title">合并其他录制</div>
          ${
            this.otherRecordings.length === 0
              ? `<div class="assets-empty">暂无其他可合并的录制工程。</div>`
              : `<div class="assets-merge-row">
                  <select id="assets-merge-select" class="chrome-select ai-select">${mergeOptionsHtml}</select>
                  <button id="assets-merge-btn" class="chrome-btn subtle-well" ${
                    this.busy ? 'disabled' : ''
                  }>追加片尾</button>
                </div>`
          }
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    if (!this.container || !this.host) return;
    const host = this.host;
    const sessionId = host.getSessionId();
    const project = host.getProject();
    if (!sessionId || !project) return;

    const fileInput = this.container.querySelector('#assets-file-input') as HTMLInputElement | null;
    fileInput?.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      void this.handleFileUpload(sessionId, file);
    });

    this.container.querySelectorAll('.sfx-preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.getAttribute('data-sfx-preset') as 'click' | 'whoosh' | 'pop' | 'chime' | 'ding' | null;
        if (preset) void this.handleGenerateSfx(sessionId, preset);
      });
    });

    this.container.querySelectorAll('[data-set-wallpaper]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rel = btn.getAttribute('data-set-wallpaper');
        if (!rel || !host.getProject()) return;
        const cur = host.getProject()!;
        host.mutateProject(
          {
            ...cur,
            canvas: {
              ...cur.canvas,
              backgroundSource: { kind: 'projectImage', relativePath: rel },
            },
          },
          { immediate: true }
        );
        this.noticeText = '已将所选图片设为画布壁纸。';
        this.render();
      });
    });

    this.container.querySelectorAll('[data-insert-audio]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rel = btn.getAttribute('data-insert-audio');
        if (!rel || !host.getProject()) return;
        const cur = host.getProject()!;
        const start = host.getCurrentTime();
        const dur = Math.max(1, Math.min(10, host.getOutputDuration() - start));
        const clip = makeAudioClip({
          timing: makeOverlayTiming(start, dur),
          sourcePath: rel,
          kind: 'music',
          ducksUnderSpeech: true,
        });
        host.mutateProject(
          {
            ...cur,
            timeline: {
              ...cur.timeline,
              audioClips: [...cur.timeline.audioClips, clip],
            },
          },
          { immediate: true }
        );
        this.noticeText = '已插入音轨并默认开启“人声压低”。';
        this.render();
      });
    });

    this.container.querySelectorAll('.audio-duck-toggle').forEach((input) => {
      input.addEventListener('change', () => {
        const id = input.getAttribute('data-clip-id');
        const cur = host.getProject();
        if (!id || !cur) return;
        const checked = (input as HTMLInputElement).checked;
        host.mutateProject(
          {
            ...cur,
            timeline: {
              ...cur.timeline,
              audioClips: cur.timeline.audioClips.map((c) =>
                c.id === id ? { ...c, ducksUnderSpeech: checked } : c
              ),
            },
          },
          { immediate: true }
        );
      });
    });

    this.container.querySelectorAll('[data-delete-audio]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-delete-audio');
        const cur = host.getProject();
        if (!id || !cur) return;
        host.mutateProject(
          {
            ...cur,
            timeline: {
              ...cur.timeline,
              audioClips: cur.timeline.audioClips.filter((c) => c.id !== id),
            },
          },
          { immediate: true }
        );
      });
    });

    this.container.querySelector('#assets-merge-btn')?.addEventListener('click', () => {
      const sel = this.container?.querySelector('#assets-merge-select') as HTMLSelectElement | null;
      if (sel?.value) void this.handleMergeRecording(sessionId, sel.value);
    });
  }

  private async handleFileUpload(sessionId: string, file: File): Promise<void> {
    if (!this.host || this.busy) return;
    this.busy = true;
    this.render();

    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.readAsDataURL(file);
      });

      const isImg = file.type.startsWith('image/');
      const isAudio = file.type.startsWith('audio/');
      await this.host.persistProject();

      const res = await fetch(`/api/recordings/${encodeURIComponent(sessionId)}/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          base64Data,
          applyAsWallpaper: isImg,
          insertOnTimeline: isAudio,
          startTime: this.host.getCurrentTime(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      if (data.project) {
        this.host.applyExternalProject(data.project, true);
      }
      this.noticeText = isImg
        ? `已上传 ${file.name} 并自动应用为壁纸。`
        : isAudio
          ? `已上传 ${file.name} 并插入当前时间点音轨。`
          : `已导入素材 ${file.name}。`;
    } catch (err: any) {
      this.noticeText = `导入失败: ${err?.message ?? err}`;
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async handleGenerateSfx(
    sessionId: string,
    preset: 'click' | 'whoosh' | 'pop' | 'chime' | 'ding'
  ): Promise<void> {
    if (!this.host || this.busy) return;
    this.busy = true;
    this.render();

    try {
      await this.host.persistProject();
      const res = await fetch(`/api/recordings/${encodeURIComponent(sessionId)}/sfx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preset,
          startTime: this.host.getCurrentTime(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      if (data.project) {
        this.host.applyExternalProject(data.project, true);
      }
      this.noticeText = `已合成 ${preset} 音效并插入 ${formatClock(this.host.getCurrentTime())}。`;
    } catch (err: any) {
      this.noticeText = `合成音效失败: ${err?.message ?? err}`;
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async handleMergeRecording(sessionId: string, sourceRecordingId: string): Promise<void> {
    if (!this.host || this.busy) return;
    this.busy = true;
    this.render();

    try {
      await this.host.persistProject();
      const res = await fetch(`/api/recordings/${encodeURIComponent(sessionId)}/merge-recording`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceRecordingId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      if (data.project) {
        this.host.applyExternalProject(data.project, true);
      }
      this.noticeText = `已将录制 ${sourceRecordingId} 合并追加至当前时间线。`;
    } catch (err: any) {
      this.noticeText = `合并录制失败: ${err?.message ?? err}`;
    } finally {
      this.busy = false;
      this.render();
    }
  }
}

