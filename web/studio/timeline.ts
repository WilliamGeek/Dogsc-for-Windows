/**
 * web/studio/timeline.ts
 *
 * Interactive 4-lane multi-track timeline aligned with macOS EditorTimelineView &
 * EditorTimelineTrackHues (--t-zoom, --t-region, --t-audio).
 * Supports Select / Cut tool, segment split/delete/retime, zoom move/resize drag,
 * mosaic drag/insert, marker jump pins, and smooth playhead scrubbing.
 * Strictly ZERO node:* imports.
 */

import type { StudioRuntimeContext } from './app.ts';
import {
  resolveTimelineSegments,
  splitSegmentAtTime,
  deleteSegmentById,
  setSegmentPlaybackRate,
  addZoomClipAtTime,
  moveZoomClipById,
  resizeZoomClipById,
  deleteZoomClipById,
  addMosaicClipAtTime,
  moveMosaicClipById,
  deleteMosaicClipById,
} from './state.ts';

const SPEED_OPTIONS = [1, 1.5, 2, 4] as const;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function chooseRulerStep(durationSeconds: number): number {
  if (durationSeconds <= 4) return 0.5;
  if (durationSeconds <= 15) return 1;
  if (durationSeconds <= 40) return 2;
  if (durationSeconds <= 120) return 5;
  return 10;
}

export function renderStudioTimeline(ctx: StudioRuntimeContext): void {
  const dock = document.getElementById('studio-timeline');
  if (!dock) return;

  const detail = ctx.getDetail();
  const project = ctx.getProject();
  if (!detail || !project) {
    dock.innerHTML =
      '<div style="padding:18px;color:var(--ink-secondary);font-size:12px;">打开任意录制或点击“+ 新建录制”后，可在此交互编辑主视频、缩放运镜、马赛克与音轨。</div>';
    return;
  }

  const srcDur = Math.max(Number(detail.meta?.durationSeconds) || 1, 0.05);
  const outDur = Math.max(ctx.getOutputDuration(), 0.05);
  const segments = resolveTimelineSegments(project, srcDur);
  const sel = ctx.getSelection();
  const tool = ctx.getTool();
  const tlZoom = ctx.getTimelineZoom();
  const player = ctx.getPlayer();
  const currentTime = player.getCurrentTime();
  const playheadPct = Math.min(100, Math.max(0, (currentTime / outDur) * 100));

  const selectedSegment =
    sel?.kind === 'segment'
      ? segments.find((s) => s.id === sel.id) ?? segments[0] ?? null
      : segments[0] ?? null;
  const activeSpeed = selectedSegment?.playbackRate ?? 1;

  // Compute scrollable tracks width percentage
  const widthPct = Math.round(tlZoom * 100);
  const tickStep = chooseRulerStep(outDur / tlZoom);
  let ticksHtml = '';
  for (let t = 0; t <= outDur + 0.0001; t += tickStep) {
    const pct = (t / outDur) * 100;
    if (pct > 99.5 && t > 0) continue;
    ticksHtml += `<span class="ruler-tick" style="left:${pct.toFixed(3)}%">${t.toFixed(tickStep < 1 ? 1 : 0)}s</span>`;
  }

  // Recording markers
  let markersHtml = '';
  for (const m of project.recordingMarkers) {
    const mPct = Math.min(100, Math.max(0, (m.sourceTime / outDur) * 100));
    markersHtml += `<button class="marker-pin" data-marker-time="${m.sourceTime}" data-marker-id="${escapeHtml(m.id)}" style="left:${mPct.toFixed(3)}%" title="标记 #${m.number} (${m.sourceTime.toFixed(2)}s)">${m.number}</button>`;
  }

  // Lane 1: Primary video segments
  let segsHtml = '';
  segments.forEach((seg, idx) => {
    const leftPct = (seg.outputStart / outDur) * 100;
    const wPct = Math.max(0.8, (seg.outputDuration / outDur) * 100);
    const isSel = sel?.kind === 'segment' && sel.id === seg.id;
    const rateLabel = seg.playbackRate !== 1 ? ` · ${seg.playbackRate}×` : '';
    segsHtml += `
      <div class="tl-clip segment ${isSel ? 'selected' : ''}"
           data-seg-id="${escapeHtml(seg.id)}"
           style="left:${leftPct.toFixed(3)}%;width:${wPct.toFixed(3)}%;"
           title="片段 ${idx + 1} (${seg.outputDuration.toFixed(2)}s${rateLabel})">
        <span>#${idx + 1} (${seg.outputDuration.toFixed(2)}s${rateLabel})</span>
      </div>`;
  });

  // Lane 2: Zoom clips
  let zoomsHtml = '';
  for (const z of project.timeline.zoomClips) {
    const leftPct = Math.min(100, Math.max(0, (z.startTime / outDur) * 100));
    const wPct = Math.max(1.2, ((z.endTime - z.startTime) / outDur) * 100);
    const isSel = sel?.kind === 'zoom' && sel.id === z.id;
    zoomsHtml += `
      <div class="tl-clip zoom ${isSel ? 'selected' : ''}"
           data-zoom-id="${escapeHtml(z.id)}"
           style="left:${leftPct.toFixed(3)}%;width:${wPct.toFixed(3)}%;"
           title="缩放 ${z.scale.toFixed(2)}× (${z.startTime.toFixed(2)}s - ${z.endTime.toFixed(2)}s)">
        <div class="tl-resize-handle left" data-resize-edge="left"></div>
        <span>⊕ ${z.scale.toFixed(1)}×</span>
        <div class="tl-resize-handle right" data-resize-edge="right"></div>
      </div>`;
  }

  // Lane 3: Mosaic / spotlight region clips
  let mosaicsHtml = '';
  for (const m of project.timeline.mosaicClips) {
    const leftPct = Math.min(100, Math.max(0, (m.timing.startTime / outDur) * 100));
    const wPct = Math.max(1.2, (m.timing.duration / outDur) * 100);
    const isSel = sel?.kind === 'mosaic' && sel.id === m.id;
    const label = m.style === 'spotlight' ? '◉ 聚光灯' : '▦ 马赛克';
    mosaicsHtml += `
      <div class="tl-clip region ${isSel ? 'selected' : ''}"
           data-mosaic-id="${escapeHtml(m.id)}"
           style="left:${leftPct.toFixed(3)}%;width:${wPct.toFixed(3)}%;"
           title="${label} (${m.timing.startTime.toFixed(2)}s - ${m.timing.endTime.toFixed(2)}s)">
        <span>${label}</span>
      </div>`;
  }

  // Lane 4: Audio tracks
  let audioHtml = '';
  if (detail.hasSystemAudio || project.capture.recordsSystemAudio) {
    audioHtml += `<div class="tl-clip audio ${project.audio.isSystemMuted ? 'muted' : ''}" data-audio-kind="system" style="left:0%;width:100%;" title="点击切换系统音频 / 打开声音面板">🔊 系统声音 (${Math.round(project.audio.systemVolume * 100)}%)</div>`;
  } else if (!detail.hasMicAudio) {
    audioHtml += `<div class="tl-clip audio muted" data-audio-kind="none" style="left:0%;width:100%;">未检测到系统音/麦克风音轨（可点声音面板配置）</div>`;
  }

  if (detail.hasMicAudio || project.capture.recordsMicrophone) {
    audioHtml += `<div class="tl-clip audio ${project.audio.isMicrophoneMuted ? 'muted' : ''}" data-audio-kind="mic" style="left:0%;width:48%;top:22px;height:18px;font-size:10px;" title="点击打开麦克风控制">🎙 麦克风 (${Math.round(project.audio.microphoneVolume * 100)}%)</div>`;
  }

  const speedButtonsHtml = SPEED_OPTIONS.map(
    (r) =>
      `<button class="pill-choice ${Math.abs(activeSpeed - r) < 0.01 ? 'active' : ''}" data-seg-speed="${r}">${r}×</button>`
  ).join('');

  dock.innerHTML = `
    <div class="timeline-toolbar">
      <div class="transport-cluster">
        <div class="segmented-well" id="tl-tool-switch">
          <button class="seg-opt ${tool === 'select' ? 'active' : ''}" data-tool="select" title="选择工具 (A)">选择 (A)</button>
          <button class="seg-opt ${tool === 'cut' ? 'active' : ''}" data-tool="cut" title="剪刀分割工具 (B)">✂ 分割 (B)</button>
        </div>
        <button id="tl-btn-split" class="chrome-btn subtle-well" title="在播放头位置拆分主片段 (S)">从此处分割 (S)</button>
        <button id="tl-btn-delete" class="chrome-btn" ${sel ? '' : 'disabled'} title="删除选中项 (Delete)">删除选中</button>
        <span style="color:var(--ink-tertiary);font-size:11px;margin-left:6px;">片段倍速</span>
        <div class="pill-grid">${speedButtonsHtml}</div>
      </div>

      <div class="transport-cluster">
        <button id="tl-btn-add-zoom" class="chrome-btn subtle-well" title="在播放头添加缩放关键段">+ 缩放</button>
        <button id="tl-btn-add-mosaic" class="chrome-btn subtle-well" title="在播放头添加马赛克遮挡">+ 马赛克</button>
        <span style="color:var(--ink-tertiary);font-size:11px;margin-left:6px;">视图缩放</span>
        <input id="tl-zoom-slider" class="insp-slider" style="width:90px" type="range" min="1" max="4" step="0.25" value="${tlZoom}" />
      </div>
    </div>

    <div class="timeline-scroll-area">
      <div class="timeline-lane-headers">
        <div class="lane-header-spacer"></div>
        <div class="lane-header-row"><span>主视频</span><span>${segments.length}段</span></div>
        <div class="lane-header-row"><span><i class="lane-dot" style="background:var(--t-zoom)"></i>缩放运镜</span><span>${project.timeline.zoomClips.length}</span></div>
        <div class="lane-header-row"><span><i class="lane-dot" style="background:var(--t-region)"></i>区域效果</span><span>${project.timeline.mosaicClips.length}</span></div>
        <div class="lane-header-row"><span><i class="lane-dot" style="background:var(--t-audio)"></i>音频轨道</span></div>
      </div>

      <div class="timeline-tracks-canvas" id="tl-tracks-canvas" style="min-width:${widthPct}%;">
        <div class="timeline-ruler" id="tl-ruler">${ticksHtml}${markersHtml}</div>
        <div class="timeline-lane ${tool === 'cut' ? 'cut-cursor' : ''}" id="tl-lane-primary">${segsHtml}</div>
        <div class="timeline-lane" id="tl-lane-zoom" title="双击空白处添加缩放段">${zoomsHtml}</div>
        <div class="timeline-lane" id="tl-lane-mosaic" title="双击空白处添加马赛克">${mosaicsHtml}</div>
        <div class="timeline-lane" id="tl-lane-audio">${audioHtml}</div>
        <div id="timeline-playhead-line" class="timeline-playhead" style="left:${playheadPct.toFixed(3)}%;"></div>
      </div>
    </div>
  `;

  wireTimelineEvents(ctx, outDur, srcDur, selectedSegment?.id ?? null);
}

function wireTimelineEvents(
  ctx: StudioRuntimeContext,
  outDur: number,
  srcDur: number,
  activeSegId: string | null
): void {
  const player = ctx.getPlayer();
  const tracksCanvas = document.getElementById('tl-tracks-canvas');

  const timeFromClientX = (clientX: number): number => {
    if (!tracksCanvas) return 0;
    const rect = tracksCanvas.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.min(Math.max(0, ((clientX - rect.left) / rect.width) * outDur), outDur);
  };

  // Tool switch
  document.querySelectorAll('#tl-tool-switch .seg-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tool = btn.getAttribute('data-tool') as 'select' | 'cut' | null;
      if (tool) ctx.setTool(tool);
    });
  });

  // Toolbar actions
  document.getElementById('tl-btn-split')?.addEventListener('click', () => {
    const project = ctx.getProject();
    if (!project) return;
    try {
      const res = splitSegmentAtTime(project, srcDur, player.getCurrentTime());
      ctx.applyProjectMutation(res.project, { selection: res.selection });
    } catch {
      // ignore invalid split at boundary
    }
  });

  document.getElementById('tl-btn-delete')?.addEventListener('click', () => {
    const project = ctx.getProject();
    const sel = ctx.getSelection();
    if (!project || !sel) return;
    try {
      if (sel.kind === 'zoom') {
        const res = deleteZoomClipById(project, sel.id);
        ctx.applyProjectMutation(res.project, { selection: null });
      } else if (sel.kind === 'mosaic') {
        const res = deleteMosaicClipById(project, sel.id);
        ctx.applyProjectMutation(res.project, { selection: null });
      } else if (sel.kind === 'segment') {
        const res = deleteSegmentById(project, srcDur, sel.id);
        ctx.applyProjectMutation(res.project, { selection: res.selection });
      }
    } catch {
      // ignore if cannot delete last segment
    }
  });

  document.querySelectorAll('[data-seg-speed]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const project = ctx.getProject();
      if (!project || !activeSegId) return;
      const rate = Number(btn.getAttribute('data-seg-speed')) || 1;
      try {
        const res = setSegmentPlaybackRate(project, srcDur, activeSegId, rate);
        ctx.applyProjectMutation(res.project, { selection: res.selection });
      } catch {
        // ignore
      }
    });
  });

  document.getElementById('tl-btn-add-zoom')?.addEventListener('click', () => {
    const project = ctx.getProject();
    if (!project) return;
    try {
      const res = addZoomClipAtTime(project, outDur, player.getCurrentTime());
      ctx.applyProjectMutation(res.project, { selection: res.selection });
      ctx.setInspectorTab('zoom');
    } catch {
      // ignore if lane full
    }
  });

  document.getElementById('tl-btn-add-mosaic')?.addEventListener('click', () => {
    const project = ctx.getProject();
    if (!project) return;
    const res = addMosaicClipAtTime(project, outDur, player.getCurrentTime(), 'blur');
    ctx.applyProjectMutation(res.project, { selection: res.selection });
  });

  const zoomSlider = document.getElementById('tl-zoom-slider') as HTMLInputElement | null;
  zoomSlider?.addEventListener('input', () => {
    ctx.setTimelineZoom(Number(zoomSlider.value) || 1);
  });

  // Marker pin jump
  document.querySelectorAll('.marker-pin').forEach((pin) => {
    pin.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const t = Number(pin.getAttribute('data-marker-time'));
      if (Number.isFinite(t)) {
        player.pause();
        player.seek(t);
      }
    });
  });

  // Ruler scrub
  const ruler = document.getElementById('tl-ruler');
  ruler?.addEventListener('pointerdown', (ev) => {
    if ((ev.target as HTMLElement)?.classList.contains('marker-pin')) return;
    ruler.setPointerCapture(ev.pointerId);
    player.pause();
    player.seek(timeFromClientX(ev.clientX));
  });
  ruler?.addEventListener('pointermove', (ev) => {
    if (ev.buttons === 1) {
      player.seek(timeFromClientX(ev.clientX));
    }
  });

  // Primary lane segment clicks / cuts
  document.querySelectorAll('[data-seg-id]').forEach((el) => {
    el.addEventListener('click', (ev) => {
      const project = ctx.getProject();
      if (!project) return;
      const segId = el.getAttribute('data-seg-id');
      if (!segId) return;
      if (ctx.getTool() === 'cut') {
        try {
          const splitT = timeFromClientX((ev as MouseEvent).clientX);
          const res = splitSegmentAtTime(project, srcDur, splitT);
          ctx.applyProjectMutation(res.project, { selection: res.selection });
        } catch {
          // ignore edge split
        }
        return;
      }
      ctx.setSelection({ kind: 'segment', id: segId });
    });
  });

  // Zoom lane double click to add
  const zoomLane = document.getElementById('tl-lane-zoom');
  zoomLane?.addEventListener('dblclick', (ev) => {
    if (ev.target !== zoomLane) return;
    const project = ctx.getProject();
    if (!project) return;
    try {
      const res = addZoomClipAtTime(project, outDur, timeFromClientX(ev.clientX));
      ctx.applyProjectMutation(res.project, { selection: res.selection });
      ctx.setInspectorTab('zoom');
    } catch {
      // ignore if full
    }
  });

  // Zoom clip select + move + resize drag
  document.querySelectorAll('[data-zoom-id]').forEach((el) => {
    const htmlEl = el as HTMLElement;
    const clipId = htmlEl.getAttribute('data-zoom-id');
    if (!clipId) return;

    htmlEl.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      const project = ctx.getProject();
      if (!project) return;
      const clip = project.timeline.zoomClips.find((c) => c.id === clipId);
      if (!clip) return;

      const handleEl = (ev.target as HTMLElement)?.closest('[data-resize-edge]') as HTMLElement | null;
      const edge = (handleEl?.getAttribute('data-resize-edge') as 'left' | 'right' | null) ?? null;

      ctx.setSelection({ kind: 'zoom', id: clipId });

      const startX = ev.clientX;
      const origStart = clip.startTime;
      const origEnd = clip.endTime;
      const trackWidth = tracksCanvas?.getBoundingClientRect().width || 600;
      let pushedHistory = false;
      let dragged = false;

      const onMove = (moveEv: PointerEvent) => {
        const dx = moveEv.clientX - startX;
        if (!dragged && Math.abs(dx) < 3) return;
        dragged = true;
        const dt = (dx / trackWidth) * outDur;
        const latestProj = ctx.getProject();
        if (!latestProj) return;

        const res = edge
          ? resizeZoomClipById(
              latestProj,
              outDur,
              clipId,
              edge,
              edge === 'left' ? origStart + dt : origEnd + dt
            )
          : moveZoomClipById(latestProj, outDur, clipId, origStart + dt);

        ctx.applyProjectMutation(res.project, {
          recordHistory: !pushedHistory,
          selection: res.selection,
        });
        pushedHistory = true;
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  });

  // Mosaic lane double-click & drag
  const mosaicLane = document.getElementById('tl-lane-mosaic');
  mosaicLane?.addEventListener('dblclick', (ev) => {
    if (ev.target !== mosaicLane) return;
    const project = ctx.getProject();
    if (!project) return;
    const res = addMosaicClipAtTime(project, outDur, timeFromClientX(ev.clientX), 'blur');
    ctx.applyProjectMutation(res.project, { selection: res.selection });
  });

  document.querySelectorAll('[data-mosaic-id]').forEach((el) => {
    const htmlEl = el as HTMLElement;
    const clipId = htmlEl.getAttribute('data-mosaic-id');
    if (!clipId) return;

    htmlEl.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      const project = ctx.getProject();
      if (!project) return;
      const clip = project.timeline.mosaicClips.find((c) => c.id === clipId);
      if (!clip) return;

      ctx.setSelection({ kind: 'mosaic', id: clipId });

      const startX = ev.clientX;
      const origStart = clip.timing.startTime;
      const trackWidth = tracksCanvas?.getBoundingClientRect().width || 600;
      let pushedHistory = false;
      let dragged = false;

      const onMove = (moveEv: PointerEvent) => {
        const dx = moveEv.clientX - startX;
        if (!dragged && Math.abs(dx) < 3) return;
        dragged = true;
        const dt = (dx / trackWidth) * outDur;
        const latestProj = ctx.getProject();
        if (!latestProj) return;
        const res = moveMosaicClipById(latestProj, outDur, clipId, origStart + dt);
        ctx.applyProjectMutation(res.project, {
          recordHistory: !pushedHistory,
          selection: res.selection,
        });
        pushedHistory = true;
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  });

  // Audio lane click -> switch to audio tab
  document.querySelectorAll('[data-audio-kind]').forEach((el) => {
    el.addEventListener('click', () => {
      ctx.setInspectorTab('audio');
    });
  });
}
