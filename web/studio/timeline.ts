/**
 * web/studio/timeline.ts
 *
 * Interactive 7-lane waveform & filmstrip timeline aligned with macOS EditorTimelineView:
 *   1. 主视频 (with real decoded JPEG thumbnail filmstrip)
 *   2. 缩放运镜    3. 区域效果
 *   4. 双语字幕    5. 动效贴纸
 *   6. 叠加音轨    7. 录制声轨 (+ live PCM waveform canvas)
 * Upgraded with unified SVG icons & live drag positioning (zero flicker).
 * Strictly ZERO node:* imports.
 */

import type { StudioRuntimeContext, StudioSessionDetail } from './app.ts';
import type { RecorderProject } from '../../src/core/ProjectMediaModel.ts';
import type { ResolvedRecordingSegment } from '../../src/core/TimelineMap.ts';
import { svgIcon } from './icons.ts';
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
  moveSubtitleCueById,
  deleteSubtitleCueById,
  moveAnimationClipById,
  deleteAnimationClipById,
  moveAudioClipById,
  deleteAudioClipById,
  type StudioMutationResult,
  type StudioSelection,
} from './state.ts';

const SPEED_OPTIONS = [1, 1.5, 2, 4] as const;

interface CachedWaveform {
  hasAudio: boolean;
  peaks: number[];
}

const waveformCache = new Map<string, CachedWaveform>();
const waveformInFlight = new Set<string>();

const MAX_CACHED_FILMSTRIP_FRAMES = 96;
const filmstripCache = new Map<string, HTMLImageElement>();
const filmstripInFlight = new Set<string>();
const filmstripFailed = new Set<string>();

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

function ensureWaveformLoaded(sessionId: string): void {
  if (waveformCache.has(sessionId) || waveformInFlight.has(sessionId)) {
    return;
  }
  waveformInFlight.add(sessionId);
  void fetch(`/api/recordings/${encodeURIComponent(sessionId)}/waveform?samples=240`, {
    cache: 'no-store',
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (data && Array.isArray(data.peaks)) {
        waveformCache.set(sessionId, {
          hasAudio: Boolean(data.hasAudio),
          peaks: data.peaks,
        });
        paintWaveformCanvas(sessionId);
      }
    })
    .catch(() => {
      // Ignore waveform load error
    })
    .finally(() => {
      waveformInFlight.delete(sessionId);
    });
}

function paintWaveformCanvas(sessionId: string): void {
  const canvas = document.getElementById('tl-waveform-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  const cached = waveformCache.get(sessionId);
  if (!cached || !cached.hasAudio || cached.peaks.length === 0) return;

  const rect = canvas.getBoundingClientRect();
  const w = Math.max(300, Math.round(rect.width || canvas.parentElement?.clientWidth || 600));
  const h = Math.max(20, Math.round(rect.height || 23));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d) return;

  ctx2d.clearRect(0, 0, w, h);
  ctx2d.fillStyle = 'rgba(130, 178, 228, 0.55)';
  const peaks = cached.peaks;
  const stepX = w / peaks.length;
  const midY = h * 0.5;
  for (let i = 0; i < peaks.length; i++) {
    const p = Math.min(1, Math.max(0.05, Number(peaks[i]) || 0));
    const barH = Math.max(2, p * (h - 5));
    const barW = Math.max(1, stepX * 0.72);
    ctx2d.fillRect(i * stepX, midY - barH * 0.5, barW, barH);
  }
}

function cacheFilmstripImage(key: string, img: HTMLImageElement): void {
  if (filmstripCache.size >= MAX_CACHED_FILMSTRIP_FRAMES) {
    const firstKey = filmstripCache.keys().next().value;
    if (firstKey !== undefined) filmstripCache.delete(firstKey);
  }
  filmstripCache.set(key, img);
}

function paintFilmstripCanvas(
  detail: StudioSessionDetail,
  segments: readonly ResolvedRecordingSegment[],
  outDur: number
): void {
  const canvas = document.getElementById('tl-filmstrip-canvas') as HTMLCanvasElement | null;
  if (!canvas || detail.sourceFrameCount <= 0 || outDur <= 0) return;

  const rect = canvas.getBoundingClientRect();
  const w = Math.max(300, Math.round(rect.width || canvas.parentElement?.clientWidth || 600));
  const h = Math.max(26, Math.round(rect.height || 32));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d) return;

  ctx2d.clearRect(0, 0, w, h);
  const fps = Math.max(1, Number(detail.meta?.fps) || 60);
  const tileW = Math.max(44, Math.round(h * 1.65));

  for (const seg of segments) {
    const x0 = (seg.outputStart / outDur) * w;
    const x1 = (seg.outputEnd / outDur) * w;
    const segPxW = x1 - x0;
    if (segPxW < 8) continue;

    ctx2d.save();
    ctx2d.beginPath();
    ctx2d.rect(x0, 0, segPxW, h);
    ctx2d.clip();

    const count = Math.max(1, Math.min(16, Math.ceil(segPxW / tileW)));
    const stepW = segPxW / count;
    const srcSpan = Math.max(0.01, seg.sourceEnd - seg.sourceStart);

    for (let i = 0; i < count; i++) {
      const u = count === 1 ? 0.5 : (i + 0.5) / count;
      const srcT = seg.sourceStart + u * srcSpan;
      const frameIdx = Math.min(
        detail.sourceFrameCount,
        Math.max(1, Math.round(srcT * fps) + 1)
      );
      const cacheKey = `${detail.id}:${frameIdx}`;
      const cachedImg = filmstripCache.get(cacheKey);
      const destX = x0 + i * stepW;

      if (cachedImg && cachedImg.complete && cachedImg.naturalWidth > 0) {
        const iw = cachedImg.naturalWidth;
        const ih = cachedImg.naturalHeight;
        const targetRatio = stepW / h;
        const imgRatio = iw / ih;
        let sx = 0;
        let sy = 0;
        let sw = iw;
        let sh = ih;
        if (imgRatio > targetRatio) {
          sw = ih * targetRatio;
          sx = (iw - sw) * 0.5;
        } else {
          sh = iw / targetRatio;
          sy = (ih - sh) * 0.5;
        }
        ctx2d.drawImage(cachedImg, sx, sy, sw, sh, destX, 0, stepW + 0.5, h);
      } else if (!filmstripInFlight.has(cacheKey) && !filmstripFailed.has(cacheKey)) {
        filmstripInFlight.add(cacheKey);
        const img = new Image();
        const padded = String(frameIdx).padStart(6, '0');
        img.onload = () => {
          filmstripInFlight.delete(cacheKey);
          cacheFilmstripImage(cacheKey, img);
          paintFilmstripCanvas(detail, segments, outDur);
        };
        img.onerror = () => {
          filmstripInFlight.delete(cacheKey);
          filmstripFailed.add(cacheKey);
        };
        img.src = `/recordings/${encodeURIComponent(detail.id)}/frames/${padded}.jpg`;
      }
    }

    ctx2d.fillStyle = 'rgba(18, 18, 17, 0.34)';
    ctx2d.fillRect(x0, 0, segPxW, h);
    ctx2d.restore();
  }
}

export function renderStudioTimeline(ctx: StudioRuntimeContext): void {
  const dock = document.getElementById('studio-timeline');
  if (!dock) return;

  const detail = ctx.getDetail();
  const project = ctx.getProject();
  if (!detail || !project) {
    dock.innerHTML =
      '<div style="padding:18px;color:var(--ink-secondary);font-size:12px;">打开任意录制或点击“新建录制”后，可在此交互编辑主视频、缩放运镜、字幕、动效与 7 轨波形时间线。</div>';
    return;
  }

  ensureWaveformLoaded(detail.id);

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

  const widthStyle =
    tlZoom <= 1.001
      ? 'flex:1;min-width:0;'
      : `width:calc((100% - 118px) * ${tlZoom.toFixed(2)});min-width:calc((100% - 118px) * ${tlZoom.toFixed(2)});flex-shrink:0;`;
  const tickStep = chooseRulerStep(outDur / tlZoom);
  let ticksHtml = '';
  for (let t = 0; t <= outDur + 0.0001; t += tickStep) {
    const pct = (t / outDur) * 100;
    if (pct > 99.5 && t > 0) continue;
    ticksHtml += `<span class="ruler-tick" style="left:${pct.toFixed(3)}%">${t.toFixed(tickStep < 1 ? 1 : 0)}s</span>`;
  }

  let markersHtml = '';
  for (const m of project.recordingMarkers) {
    const mPct = Math.min(100, Math.max(0, (m.sourceTime / outDur) * 100));
    markersHtml += `<button class="marker-pin" data-marker-time="${m.sourceTime}" data-marker-id="${escapeHtml(m.id)}" style="left:${mPct.toFixed(3)}%" title="标记 #${m.number} (${m.sourceTime.toFixed(2)}s)">${m.number}</button>`;
  }

  // Lane 1: Primary video segments (layered above #tl-filmstrip-canvas)
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
        <span class="seg-badge">${svgIcon('film', 10)}#${idx + 1} · ${seg.outputDuration.toFixed(2)}s${rateLabel}</span>
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
        <span class="tl-clip-label">${svgIcon('zoomIn', 11)}<span>${z.scale.toFixed(1)}×</span></span>
        <div class="tl-resize-handle right" data-resize-edge="right"></div>
      </div>`;
  }

  // Lane 3: Mosaic / spotlight regions
  let mosaicsHtml = '';
  for (const m of project.timeline.mosaicClips) {
    const leftPct = Math.min(100, Math.max(0, (m.timing.startTime / outDur) * 100));
    const wPct = Math.max(1.2, (m.timing.duration / outDur) * 100);
    const isSel = sel?.kind === 'mosaic' && sel.id === m.id;
    const isSpot = m.style === 'spotlight';
    const label = isSpot ? '聚光灯' : '马赛克';
    mosaicsHtml += `
      <div class="tl-clip region ${isSel ? 'selected' : ''}"
           data-mosaic-id="${escapeHtml(m.id)}"
           style="left:${leftPct.toFixed(3)}%;width:${wPct.toFixed(3)}%;"
           title="${label} (${m.timing.startTime.toFixed(2)}s - ${m.timing.endTime.toFixed(2)}s)">
        <span class="tl-clip-label">${svgIcon(isSpot ? 'spotlight' : 'mosaic', 11)}<span>${label}</span></span>
      </div>`;
  }

  // Lane 4: Bilingual subtitles
  const subtitles = project.timeline.subtitleCues ?? [];
  let subtitlesHtml = '';
  for (const cue of subtitles) {
    const leftPct = Math.min(100, Math.max(0, (cue.timing.startTime / outDur) * 100));
    const wPct = Math.max(1.5, (cue.timing.duration / outDur) * 100);
    const isSel = sel?.kind === 'subtitle' && sel.id === cue.id;
    subtitlesHtml += `
      <div class="tl-clip subtitle ${isSel ? 'selected' : ''}"
           data-sub-id="${escapeHtml(cue.id)}"
           style="left:${leftPct.toFixed(3)}%;width:${wPct.toFixed(3)}%;"
           title="${escapeHtml(cue.text)} (${cue.timing.startTime.toFixed(2)}s - ${cue.timing.endTime.toFixed(2)}s)">
        <span class="tl-clip-label">${svgIcon('subtitles', 11)}<span>${escapeHtml(cue.text)}</span></span>
      </div>`;
  }

  // Lane 5: HTML Motion stickers
  const animations = project.timeline.animationClips ?? [];
  let motionHtml = '';
  for (const anim of animations) {
    const leftPct = Math.min(100, Math.max(0, (anim.timing.startTime / outDur) * 100));
    const wPct = Math.max(1.5, (anim.timing.duration / outDur) * 100);
    const isSel = sel?.kind === 'animation' && sel.id === anim.id;
    const tProp = anim.properties?.title;
    const title = tProp && tProp.kind === 'string' && tProp.value ? tProp.value : '动效卡片';
    motionHtml += `
      <div class="tl-clip motion ${isSel ? 'selected' : ''}"
           data-motion-id="${escapeHtml(anim.id)}"
           style="left:${leftPct.toFixed(3)}%;width:${wPct.toFixed(3)}%;"
           title="${escapeHtml(title)} (${anim.timing.startTime.toFixed(2)}s - ${anim.timing.endTime.toFixed(2)}s)">
        <span class="tl-clip-label">${svgIcon('sparkles', 11)}<span>${escapeHtml(title)}</span></span>
      </div>`;
  }

  // Lane 6: Overlay Audio Clips (BGM & SoundSynth SFX)
  const audioClips = project.timeline.audioClips ?? [];
  let audioClipsHtml = '';
  for (const ac of audioClips) {
    const leftPct = Math.min(100, Math.max(0, (ac.timing.startTime / outDur) * 100));
    const wPct = Math.max(1.4, (ac.timing.duration / outDur) * 100);
    const isSel = sel?.kind === 'audio' && sel.id === ac.id;
    const shortName = ac.sourcePath.split(/[\\/]/).pop() ?? '音频';
    const duckIcon = ac.ducksUnderSpeech ? svgIcon('duck', 10) : '';
    audioClipsHtml += `
      <div class="tl-clip sfx ${isSel ? 'selected' : ''}"
           data-audioclip-id="${escapeHtml(ac.id)}"
           style="left:${leftPct.toFixed(3)}%;width:${wPct.toFixed(3)}%;"
           title="${escapeHtml(shortName)} (${ac.timing.startTime.toFixed(2)}s)${ac.ducksUnderSpeech ? ' · 人声压低开启' : ''}">
        <span class="tl-clip-label">${svgIcon('music', 11)}<span>${escapeHtml(shortName)}</span>${duckIcon}</span>
      </div>`;
  }

  // Lane 7: Recorded audio tracks + PCM waveform overlay canvas
  let audioBaseHtml = '<canvas id="tl-waveform-canvas" class="tl-waveform-canvas"></canvas>';
  if (detail.hasSystemAudio || project.capture.recordsSystemAudio) {
    audioBaseHtml += `<div class="tl-clip audio ${project.audio.isSystemMuted ? 'muted' : ''}" data-audio-kind="system" style="left:0%;width:100%;" title="点击打开声音面板"><span class="tl-clip-label">${svgIcon('volume', 11)}<span>系统声音 (${Math.round(project.audio.systemVolume * 100)}%)</span></span></div>`;
  } else if (!detail.hasMicAudio) {
    audioBaseHtml += `<div class="tl-clip audio muted" data-audio-kind="none" style="left:0%;width:100%;"><span class="tl-clip-label">未检测到系统音/麦克风（可点素材库插入音效或 BGM）</span></div>`;
  }
  if (detail.hasMicAudio || project.capture.recordsMicrophone) {
    audioBaseHtml += `<div class="tl-clip audio mic-chip ${project.audio.isMicrophoneMuted ? 'muted' : ''}" data-audio-kind="mic" style="left:0%;width:45%;" title="点击打开麦克风控制"><span class="tl-clip-label">${svgIcon('mic', 10)}<span>麦克风 (${Math.round(project.audio.microphoneVolume * 100)}%)</span></span></div>`;
  }

  const speedButtonsHtml = SPEED_OPTIONS.map(
    (r) =>
      `<button class="pill-choice ${Math.abs(activeSpeed - r) < 0.01 ? 'active' : ''}" data-seg-speed="${r}">${r}×</button>`
  ).join('');

  const tlZoomPct = Math.min(100, Math.max(0, ((tlZoom - 1) / 3) * 100)).toFixed(2);

  dock.innerHTML = `
    <div class="timeline-toolbar">
      <div class="transport-cluster">
        <div class="segmented-well" id="tl-tool-switch">
          <button class="seg-opt ${tool === 'select' ? 'active' : ''}" data-tool="select" title="选择工具 (A)">${svgIcon('mousePointer', 12)}<span>选择 (A)</span></button>
          <button class="seg-opt ${tool === 'cut' ? 'active' : ''}" data-tool="cut" title="剪刀分割工具 (B)">${svgIcon('scissors', 12)}<span>分割 (B)</span></button>
        </div>
        <button id="tl-btn-split" class="chrome-btn subtle-well" title="在播放头位置拆分主片段 (S)">${svgIcon('split', 12)}<span>从此处分割 (S)</span></button>
        <button id="tl-btn-delete" class="chrome-btn" ${sel ? '' : 'disabled'} title="删除选中项 (Delete)">${svgIcon('trash', 12)}<span>删除</span></button>
        <span style="color:var(--ink-tertiary);font-size:11px;margin-left:6px;">倍速</span>
        <div class="pill-grid">${speedButtonsHtml}</div>
      </div>

      <div class="transport-cluster">
        <button id="tl-btn-add-zoom" class="chrome-btn subtle-well" title="在播放头添加缩放关键段">${svgIcon('plus', 11)}<span>缩放</span></button>
        <button id="tl-btn-add-mosaic" class="chrome-btn subtle-well" title="在播放头添加马赛克遮挡">${svgIcon('plus', 11)}<span>马赛克</span></button>
        <span style="color:var(--ink-tertiary);font-size:11px;margin-left:6px;">视图</span>
        <input id="tl-zoom-slider" class="insp-slider" style="width:86px;--range-pct:${tlZoomPct}%" type="range" min="1" max="4" step="0.25" value="${tlZoom}" />
      </div>
    </div>

    <div class="timeline-scroll-area">
      <div class="timeline-lane-headers">
        <div class="lane-header-spacer"></div>
        <div class="lane-header-row lane-primary"><span>主视频</span><span>${segments.length}段</span></div>
        <div class="lane-header-row"><span><i class="lane-dot" style="background:var(--t-zoom)"></i>缩放运镜</span><span>${project.timeline.zoomClips.length}</span></div>
        <div class="lane-header-row"><span><i class="lane-dot" style="background:var(--t-region)"></i>区域效果</span><span>${project.timeline.mosaicClips.length}</span></div>
        <div class="lane-header-row"><span><i class="lane-dot" style="background:var(--t-subtitle)"></i>双语字幕</span><span>${subtitles.length}</span></div>
        <div class="lane-header-row"><span><i class="lane-dot" style="background:var(--t-overlay)"></i>动效贴纸</span><span>${animations.length}</span></div>
        <div class="lane-header-row"><span><i class="lane-dot" style="background:var(--t-audio)"></i>叠加音轨</span><span>${audioClips.length}</span></div>
        <div class="lane-header-row"><span><i class="lane-dot" style="background:var(--t-audio)"></i>录制声轨</span></div>
      </div>

      <div class="timeline-tracks-canvas" id="tl-tracks-canvas" style="${widthStyle}">
        <div class="timeline-ruler" id="tl-ruler">${ticksHtml}${markersHtml}</div>
        <div class="timeline-lane lane-primary ${tool === 'cut' ? 'cut-cursor' : ''}" id="tl-lane-primary">
          <canvas id="tl-filmstrip-canvas" class="tl-filmstrip-canvas"></canvas>
          ${segsHtml}
        </div>
        <div class="timeline-lane" id="tl-lane-zoom" title="双击空白处添加缩放段">${zoomsHtml}</div>
        <div class="timeline-lane" id="tl-lane-mosaic" title="双击空白处添加马赛克">${mosaicsHtml}</div>
        <div class="timeline-lane" id="tl-lane-subtitle">${subtitlesHtml}</div>
        <div class="timeline-lane" id="tl-lane-motion">${motionHtml}</div>
        <div class="timeline-lane" id="tl-lane-audio-clips">${audioClipsHtml}</div>
        <div class="timeline-lane" id="tl-lane-audio">${audioBaseHtml}</div>
        <div id="timeline-playhead-line" class="timeline-playhead" style="left:${playheadPct.toFixed(3)}%;"></div>
      </div>
    </div>
  `;

  paintFilmstripCanvas(detail, segments, outDur);
  paintWaveformCanvas(detail.id);
  wireTimelineEvents(ctx, outDur, srcDur, selectedSegment?.id ?? null);
}

function wireHorizontalClipDrag(
  ctx: StudioRuntimeContext,
  tracksCanvas: HTMLElement | null,
  outDur: number,
  attrName: string,
  selectionKind: Exclude<StudioSelection, null>['kind'],
  getOrigStart: (project: RecorderProject, clipId: string) => number | null,
  onMoveClip: (project: RecorderProject, outDur: number, clipId: string, nextStart: number) => StudioMutationResult,
  onSelectHook?: () => void
): void {
  document.querySelectorAll(`[${attrName}]`).forEach((el) => {
    const htmlEl = el as HTMLElement;
    const clipId = htmlEl.getAttribute(attrName);
    if (!clipId) return;

    htmlEl.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      const project = ctx.getProject();
      if (!project) return;
      const origStart = getOrigStart(project, clipId);
      if (origStart === null) return;

      const startX = ev.clientX;
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
        const res = onMoveClip(latestProj, outDur, clipId, origStart + dt);
        const nextStart = getOrigStart(res.project, clipId);
        if (nextStart !== null) {
          htmlEl.style.left = `${Math.min(100, Math.max(0, (nextStart / outDur) * 100)).toFixed(3)}%`;
        }
        ctx.applyProjectMutation(res.project, {
          recordHistory: !pushedHistory,
          selection: res.selection,
          skipTimelineRerender: true,
        });
        pushedHistory = true;
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        ctx.setSelection({ kind: selectionKind, id: clipId } as StudioSelection);
        onSelectHook?.();
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  });
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

  document.querySelectorAll('#tl-tool-switch .seg-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tool = btn.getAttribute('data-tool') as 'select' | 'cut' | null;
      if (tool) ctx.setTool(tool);
    });
  });

  document.getElementById('tl-btn-split')?.addEventListener('click', () => {
    const project = ctx.getProject();
    if (!project) return;
    try {
      const res = splitSegmentAtTime(project, srcDur, player.getCurrentTime());
      ctx.applyProjectMutation(res.project, { selection: res.selection });
    } catch {
      // ignore boundary split
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
      } else if (sel.kind === 'subtitle') {
        const res = deleteSubtitleCueById(project, sel.id);
        ctx.applyProjectMutation(res.project, { selection: null });
      } else if (sel.kind === 'animation') {
        const res = deleteAnimationClipById(project, sel.id);
        ctx.applyProjectMutation(res.project, { selection: null });
      } else if (sel.kind === 'audio') {
        const res = deleteAudioClipById(project, sel.id);
        ctx.applyProjectMutation(res.project, { selection: null });
      } else if (sel.kind === 'segment') {
        const res = deleteSegmentById(project, srcDur, sel.id);
        ctx.applyProjectMutation(res.project, { selection: res.selection });
      }
    } catch {
      // ignore invalid delete
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
      // ignore
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
      // ignore
    }
  });

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

        const updatedClip = res.project.timeline.zoomClips.find((z) => z.id === clipId);
        if (updatedClip) {
          htmlEl.style.left = `${Math.min(100, Math.max(0, (updatedClip.startTime / outDur) * 100)).toFixed(3)}%`;
          htmlEl.style.width = `${Math.max(1.2, ((updatedClip.endTime - updatedClip.startTime) / outDur) * 100).toFixed(3)}%`;
        }

        ctx.applyProjectMutation(res.project, {
          recordHistory: !pushedHistory,
          selection: res.selection,
          skipTimelineRerender: true,
        });
        pushedHistory = true;
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        ctx.setSelection({ kind: 'zoom', id: clipId });
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  });

  const mosaicLane = document.getElementById('tl-lane-mosaic');
  mosaicLane?.addEventListener('dblclick', (ev) => {
    if (ev.target !== mosaicLane) return;
    const project = ctx.getProject();
    if (!project) return;
    const res = addMosaicClipAtTime(project, outDur, timeFromClientX(ev.clientX), 'blur');
    ctx.applyProjectMutation(res.project, { selection: res.selection });
  });

  wireHorizontalClipDrag(
    ctx,
    tracksCanvas,
    outDur,
    'data-mosaic-id',
    'mosaic',
    (p, id) => p.timeline.mosaicClips.find((c) => c.id === id)?.timing.startTime ?? null,
    moveMosaicClipById
  );

  wireHorizontalClipDrag(
    ctx,
    tracksCanvas,
    outDur,
    'data-sub-id',
    'subtitle',
    (p, id) => p.timeline.subtitleCues.find((c) => c.id === id)?.timing.startTime ?? null,
    moveSubtitleCueById,
    () => window.dispatchEvent(new CustomEvent('dogsc:open-library-tab', { detail: 'subtitles' }))
  );

  wireHorizontalClipDrag(
    ctx,
    tracksCanvas,
    outDur,
    'data-motion-id',
    'animation',
    (p, id) => p.timeline.animationClips.find((c) => c.id === id)?.timing.startTime ?? null,
    moveAnimationClipById,
    () => window.dispatchEvent(new CustomEvent('dogsc:open-library-tab', { detail: 'motion' }))
  );

  wireHorizontalClipDrag(
    ctx,
    tracksCanvas,
    outDur,
    'data-audioclip-id',
    'audio',
    (p, id) => p.timeline.audioClips.find((c) => c.id === id)?.timing.startTime ?? null,
    moveAudioClipById,
    () => window.dispatchEvent(new CustomEvent('dogsc:open-library-tab', { detail: 'assets' }))
  );

  document.querySelectorAll('[data-audio-kind]').forEach((el) => {
    el.addEventListener('click', () => {
      ctx.setInspectorTab('audio');
    });
  });
}
