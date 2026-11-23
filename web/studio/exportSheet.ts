/**
 * web/studio/exportSheet.ts
 *
 * Interactive 760px two-column Export Sheet aligned with macOS `EditorExportViews.swift`:
 *   - Left column: Live stage thumbnail preview + output dimensions/FPS/codec/estimated file size
 *   - Right column: 3 phases (`options` -> `running` -> `done`) with MP4/M4A switch,
 *     1080p/1440p/4K/Original resolution, 30/60 fps, H.264/HEVC, quality presets,
 *     live polling, cancellation, and one-click Explorer folder reveal.
 * Strictly ZERO node:* imports.
 */

import {
  CanvasResolutionAllCases,
  canvasStylePixelDimensions,
  type CanvasResolution,
} from '../../src/core/ProjectModel.ts';
import {
  makeExportSettings,
  exportSettingsOutputDimensions,
  ExportQualityAllCases,
  exportQualityDisplayName,
  ExportVideoCodecAllCases,
  exportVideoCodecDisplayName,
  type ExportQuality,
  type ExportVideoCodec,
} from '../../src/core/ExportSettings.ts';
import { ExportEncodingPolicy } from '../../src/core/ExportPolicy.ts';
import type { OutputFrameRate } from '../../src/core/CaptureConfiguration.ts';
import type { StudioRuntimeContext } from './app.ts';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function openExportSheetModal(ctx: StudioRuntimeContext): void {
  const detail = ctx.getDetail();
  const project = ctx.getProject();
  const bd = document.getElementById('studio-modal-backdrop');
  const card = document.getElementById('studio-modal-card');
  if (!bd || !card || !detail || !project) return;

  const stageCanvas = document.getElementById('studio-stage') as HTMLCanvasElement | null;
  let previewDataUrl = '';
  try {
    previewDataUrl = stageCanvas ? stageCanvas.toDataURL('image/jpeg', 0.88) : '';
  } catch {
    previewDataUrl = '';
  }

  let outputFormat: 'mp4' | 'm4a' = 'mp4';
  let fileName = 'export.mp4';
  let activeJobId: string | null = null;
  let pollTimer: number | null = null;
  let phase: 'options' | 'running' | 'done' | 'error' = 'options';
  let jobProgress = { doneFrames: 0, totalFrames: 1, outFile: '', error: '' };

  const hasAudio = detail.hasSystemAudio || detail.hasMicAudio || project.timeline.audioClips.length > 0;
  const outDur = Math.max(0.05, ctx.getOutputDuration());

  const computeEstimate = () => {
    const cur = ctx.getProject() ?? project;
    const es = cur.exportSettings;
    const srcW = Math.max(Number(detail.meta?.width) || 1920, 2);
    const srcH = Math.max(Number(detail.meta?.height) || 1080, 2);
    const crop = cur.canvas.crop;
    const aspect = (srcW / srcH) * (crop.width / Math.max(crop.height, 0.01));
    const requested = canvasStylePixelDimensions(cur.canvas, es.resolution, aspect, {
      width: srcW,
      height: srcH,
    });
    const dims = exportSettingsOutputDimensions(es, requested);
    const codec = es.videoCodec ?? 'h264';
    const bps =
      outputFormat === 'm4a'
        ? ExportEncodingPolicy.audioBitrate
        : ExportEncodingPolicy.videoBitrate(dims.width, dims.height, es.frameRate, codec, es.quality) +
          (hasAudio ? ExportEncodingPolicy.audioBitrate : 0);
    return {
      width: Math.max(2, Math.trunc(dims.width / 2) * 2),
      height: Math.max(2, Math.trunc(dims.height / 2) * 2),
      fps: es.frameRate,
      codec,
      quality: es.quality,
      resolution: es.resolution,
      estimatedBytes: Math.round((bps * outDur) / 8),
    };
  };

  const stopPolling = () => {
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const closeSheet = () => {
    stopPolling();
    ctx.closeModal();
  };

  const renderSheet = () => {
    const est = computeEstimate();
    const m4aBlocked = outputFormat === 'm4a' && !hasAudio;
    card.className = 'modal-card export-sheet-card';

    const leftPreview = `
      <div style="display:flex;flex-direction:column;gap:10px;flex:1;min-width:0;">
        <div style="background:#000;border-radius:8px;overflow:hidden;border:1px solid var(--hairline);aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;">
          ${
            previewDataUrl
              ? `<img src="${previewDataUrl}" alt="导出预览缩略图" style="width:100%;height:100%;object-fit:contain;" />`
              : '<span style="color:var(--ink-secondary);">预览帧</span>'
          }
        </div>
        <div class="insp-card">
          <div class="insp-row"><span class="insp-label">输出规格</span><span class="insp-val" style="min-width:auto;">${
            outputFormat === 'm4a'
              ? 'M4A · AAC 192 kbps'
              : `${est.width} × ${est.height} · ${est.fps} fps`
          }</span></div>
          <div class="insp-row"><span class="insp-label">编码与时长</span><span class="insp-val" style="min-width:auto;">${
            outputFormat === 'm4a' ? '纯音频' : exportVideoCodecDisplayName(est.codec)
          } · ${outDur.toFixed(2)}s</span></div>
          <div class="insp-row"><span class="insp-label">音频封装</span><span class="insp-badge ${hasAudio ? 'ok' : ''}">${hasAudio ? '含多轨混音' : '静音/无音轨'}</span></div>
        </div>
      </div>`;

    let rightColumn = '';
    if (phase === 'options') {
      const resPills = CanvasResolutionAllCases.map(
        (r) =>
          `<button class="pill-choice ${est.resolution === r ? 'active' : ''}" data-exp-res="${r}">${r}</button>`
      ).join('');
      const fpsPills = ([30, 60] as OutputFrameRate[])
        .map(
          (f) =>
            `<button class="pill-choice ${est.fps === f ? 'active' : ''}" data-exp-fps="${f}">${f} fps</button>`
        )
        .join('');
      const codecPills = ExportVideoCodecAllCases.map(
        (c) =>
          `<button class="pill-choice ${est.codec === c ? 'active' : ''}" data-exp-codec="${c}">${exportVideoCodecDisplayName(c)}</button>`
      ).join('');
      const qualPills = ExportQualityAllCases.map(
        (q) =>
          `<button class="pill-choice ${est.quality === q ? 'active' : ''}" data-exp-qual="${q}">${exportQualityDisplayName(q)}</button>`
      ).join('');

      rightColumn = `
        <div style="width:316px;display:flex;flex-direction:column;gap:10px;flex-shrink:0;">
          <div class="segmented-well" id="exp-kind-switch">
            <button class="seg-opt ${outputFormat === 'mp4' ? 'active' : ''}" data-exp-fmt="mp4" style="flex:1;">视频 MP4</button>
            <button class="seg-opt ${outputFormat === 'm4a' ? 'active' : ''}" data-exp-fmt="m4a" style="flex:1;" ${hasAudio ? '' : 'title="当前工程无独立音轨，可先录制声音"'}>纯音频 M4A</button>
          </div>
          ${
            outputFormat === 'mp4'
              ? `
            <div class="insp-card">
              <div class="insp-card-title">分辨率预设</div>
              <div class="pill-grid">${resPills}</div>
              <div class="insp-card-title">帧率与编码器</div>
              <div class="pill-grid">${fpsPills}${codecPills}</div>
              <div class="insp-card-title">画质挡位</div>
              <div class="pill-grid">${qualPills}</div>
            </div>`
              : `<div class="insp-card"><div class="insp-card-title">M4A 音频规范</div><p style="margin:0;color:var(--ink-secondary);line-height:1.5;">跳过视频重编码，直接使用 FFmpeg 按时间线片段混音输出 192kbps AAC M4A 文件。</p>${hasAudio ? '' : '<p style="margin:6px 0 0;color:#e0705b;font-size:11px;">当前录制未检测到可用音轨，无法导出纯音频 M4A。</p>'}</div>`
          }
          <div class="insp-row">
            <span class="insp-label">文件名</span>
            <input id="exp-filename" class="insp-input" style="flex:1;" value="${escapeHtml(fileName)}" />
          </div>
        </div>`;
    } else if (phase === 'running') {
      const pct = Math.min(
        100,
        Math.round((jobProgress.doneFrames / Math.max(1, jobProgress.totalFrames)) * 100)
      );
      rightColumn = `
        <div style="width:316px;display:flex;flex-direction:column;gap:14px;justify-content:center;flex-shrink:0;">
          <div class="insp-card">
            <div class="insp-row"><span class="insp-card-title">正在导出 ${outputFormat.toUpperCase()}…</span><span class="insp-val">${pct}%</span></div>
            <div style="height:8px;border-radius:999px;background:var(--hairline);overflow:hidden;">
              <div style="height:100%;width:${pct}%;background:var(--accent);transition:width 180ms ease;"></div>
            </div>
            <div style="font-size:11px;color:var(--ink-secondary);">已编码 ${jobProgress.doneFrames} / ${jobProgress.totalFrames} 帧</div>
          </div>
        </div>`;
    } else if (phase === 'done') {
      rightColumn = `
        <div style="width:316px;display:flex;flex-direction:column;gap:12px;justify-content:center;flex-shrink:0;">
          <div class="insp-card" style="border-color:var(--success-green);">
            <div class="insp-card-title" style="color:#7ebd8c;">✓ 导出完成</div>
            <div style="font-size:11px;color:var(--ink-secondary);word-break:break-all;">${escapeHtml(jobProgress.outFile)}</div>
          </div>
        </div>`;
    } else {
      rightColumn = `
        <div style="width:316px;display:flex;flex-direction:column;gap:12px;justify-content:center;flex-shrink:0;">
          <div class="insp-card" style="border-color:var(--recording-red);">
            <div class="insp-card-title" style="color:#e0705b;">导出未完成</div>
            <div style="font-size:11px;color:var(--ink-secondary);word-break:break-word;">${escapeHtml(jobProgress.error)}</div>
          </div>
        </div>`;
    }

    const footerActions =
      phase === 'options'
        ? `<span style="color:var(--ink-secondary);font-size:12px;">预估大小：约 <strong style="color:var(--ink);">${formatBytes(est.estimatedBytes)}</strong></span>
           <div style="display:flex;gap:8px;">
             <button id="exp-close-btn" class="chrome-btn">取消</button>
             <button id="exp-start-btn" class="primary-export-btn" ${m4aBlocked ? 'disabled title="当前会话无可用音轨" style="opacity:0.45;cursor:not-allowed;"' : ''}>开始导出</button>
           </div>`
        : phase === 'running'
          ? `<span style="color:var(--ink-secondary);font-size:11px;">WebGL2 与 FFmpeg 管线运行中</span>
             <button id="exp-cancel-job" class="insp-btn danger">取消导出</button>`
          : phase === 'done'
            ? `<button id="exp-open-folder" class="insp-btn">打开所在文件夹</button>
               <div style="display:flex;gap:8px;">
                 <button id="exp-again-btn" class="chrome-btn">再次导出</button>
                 <button id="exp-finish-btn" class="primary-export-btn">完成</button>
               </div>`
            : `<span></span>
               <div style="display:flex;gap:8px;">
                 <button id="exp-again-btn" class="chrome-btn">返回重试</button>
                 <button id="exp-finish-btn" class="primary-export-btn">关闭</button>
               </div>`;

    card.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title">导出成片</h3>
        <button id="exp-modal-x" class="chrome-btn">✕</button>
      </div>
      <div class="modal-body" style="flex-direction:row;align-items:stretch;gap:20px;">
        ${leftPreview}
        ${rightColumn}
      </div>
      <div class="modal-footer">${footerActions}</div>`;

    wireEvents();
  };

  const updateSettings = (
    patch: Partial<{
      resolution: CanvasResolution;
      frameRate: OutputFrameRate;
      videoCodec: ExportVideoCodec;
      quality: ExportQuality;
    }>
  ) => {
    const cur = ctx.getProject()!;
    ctx.applyProjectMutation(
      { ...cur, exportSettings: makeExportSettings({ ...cur.exportSettings, ...patch }) },
      { recordHistory: true }
    );
    renderSheet();
  };

  const wireEvents = () => {
    document.getElementById('exp-modal-x')?.addEventListener('click', closeSheet);
    document.getElementById('exp-close-btn')?.addEventListener('click', closeSheet);
    document.getElementById('exp-finish-btn')?.addEventListener('click', closeSheet);

    document.getElementById('exp-again-btn')?.addEventListener('click', () => {
      phase = 'options';
      renderSheet();
    });

    card.querySelectorAll('[data-exp-fmt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextFmt = btn.getAttribute('data-exp-fmt') as 'mp4' | 'm4a';
        if (nextFmt !== outputFormat) {
          outputFormat = nextFmt;
          fileName = outputFormat === 'm4a' ? 'export.m4a' : 'export.mp4';
          renderSheet();
        }
      });
    });

    card.querySelectorAll('[data-exp-res]').forEach((btn) => {
      btn.addEventListener('click', () => {
        updateSettings({ resolution: btn.getAttribute('data-exp-res') as CanvasResolution });
      });
    });
    card.querySelectorAll('[data-exp-fps]').forEach((btn) => {
      btn.addEventListener('click', () => {
        updateSettings({ frameRate: Number(btn.getAttribute('data-exp-fps')) as OutputFrameRate });
      });
    });
    card.querySelectorAll('[data-exp-codec]').forEach((btn) => {
      btn.addEventListener('click', () => {
        updateSettings({ videoCodec: btn.getAttribute('data-exp-codec') as ExportVideoCodec });
      });
    });
    card.querySelectorAll('[data-exp-qual]').forEach((btn) => {
      btn.addEventListener('click', () => {
        updateSettings({ quality: btn.getAttribute('data-exp-qual') as ExportQuality });
      });
    });

    const fnInput = document.getElementById('exp-filename') as HTMLInputElement | null;
    fnInput?.addEventListener('input', () => {
      fileName = fnInput.value.trim() || (outputFormat === 'm4a' ? 'export.m4a' : 'export.mp4');
    });

    document.getElementById('exp-start-btn')?.addEventListener('click', async () => {
      const est = computeEstimate();
      phase = 'running';
      jobProgress = { doneFrames: 0, totalFrames: 1, outFile: '', error: '' };
      renderSheet();

      const res = await fetch(`/api/recordings/${encodeURIComponent(detail.id)}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format: outputFormat,
          resolution: est.resolution,
          fps: est.fps,
          quality: est.quality,
          videoCodec: est.codec,
          fileName,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        phase = 'error';
        jobProgress.error = err.error ?? `HTTP ${res.status}`;
        renderSheet();
        return;
      }

      const job = await res.json();
      activeJobId = job.id;
      jobProgress.totalFrames = Math.max(1, Number(job.totalFrames) || 1);
      jobProgress.outFile = String(job.outFile || '');

      pollTimer = window.setInterval(async () => {
        if (!activeJobId) return;
        try {
          const stRes = await fetch(`/api/export/status/${encodeURIComponent(activeJobId)}`, {
            cache: 'no-store',
          });
          if (!stRes.ok) return;
          const st = await stRes.json();
          jobProgress = {
            doneFrames: Number(st.doneFrames) || 0,
            totalFrames: Math.max(1, Number(st.totalFrames) || 1),
            outFile: String(st.outFile || ''),
            error: String(st.error || ''),
          };
          if (st.status === 'completed') {
            stopPolling();
            phase = 'done';
          } else if (st.status === 'cancelled' || st.status === 'error') {
            stopPolling();
            phase = 'error';
          }
          renderSheet();
        } catch {
          // retry
        }
      }, 350);
    });

    document.getElementById('exp-cancel-job')?.addEventListener('click', async () => {
      if (!activeJobId) return;
      stopPolling();
      await fetch(`/api/export/cancel/${encodeURIComponent(activeJobId)}`, { method: 'POST' }).catch(
        () => {}
      );
      phase = 'error';
      jobProgress.error = '已取消导出并清理残片';
      renderSheet();
    });

    document.getElementById('exp-open-folder')?.addEventListener('click', async () => {
      await fetch(`/api/recordings/${encodeURIComponent(detail.id)}/open-folder`, {
        method: 'POST',
      }).catch(() => {});
    });
  };

  bd.classList.add('open');
  renderSheet();
}

