/**
 * web/studio/recorderIsland.ts
 *
 * Windows-native capture configuration modal ("录制岛") querying /api/devices
 * for displays, visible windows, DirectShow cameras, and DirectShow microphones,
 * driving background `recordSession` via /api/record/start.
 * Strictly ZERO node:* imports.
 */

import type { StudioRuntimeContext } from './app.ts';
import { svgIcon } from './icons.ts';
import { renderSwitchRow } from './controls.ts';

interface DeviceCatalogPayload {
  displays: Array<{ index: number; deviceName: string; isPrimary: boolean; width: number; height: number }>;
  windows: Array<{ title: string; processName: string; x: number; y: number; width: number; height: number }>;
  cameras: Array<{ name: string; alternativeName: string | null }>;
  microphones: Array<{ name: string; alternativeName: string | null }>;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function openRecordingIslandModal(ctx: StudioRuntimeContext): Promise<void> {
  const bd = document.getElementById('studio-modal-backdrop');
  const card = document.getElementById('studio-modal-card');
  if (!bd || !card) return;

  card.className = 'modal-card';
  card.innerHTML = `
    <div class="modal-header">
      <h3 class="modal-title">新建录制（Windows 多源采集）</h3>
      <button id="rec-modal-close" class="chrome-btn" title="关闭">${svgIcon('close', 14)}</button>
    </div>
    <div class="modal-body" id="rec-modal-body">
      <div style="color:var(--ink-secondary);padding:12px 0;">正在探测本机显示器、可见窗口与音视频设备…</div>
    </div>`;
  bd.classList.add('open');
  document.getElementById('rec-modal-close')?.addEventListener('click', () => ctx.closeModal());

  let devices: DeviceCatalogPayload = { displays: [], windows: [], cameras: [], microphones: [] };
  try {
    const res = await fetch('/api/devices', { cache: 'no-store' });
    if (res.ok) devices = await res.json();
  } catch {
    // Keep empty defaults if offline
  }

  const displayOpts =
    devices.displays.length > 0
      ? devices.displays
          .map(
            (d) =>
              `<option value="${d.index}">显示器 ${d.index} (${d.width}×${d.height})${d.isPrimary ? ' [主屏]' : ''}</option>`
          )
          .join('')
      : '<option value="0">主显示器 (index 0)</option>';

  const windowOpts =
    devices.windows.length > 0
      ? devices.windows
          .map(
            (w, idx) =>
              `<option value="${idx}">${escapeHtml(w.title.slice(0, 48))} (${w.width}×${w.height})</option>`
          )
          .join('')
      : '<option value="">未检测到可采集桌面窗口</option>';

  const micOpts = [
    '<option value="">不录制麦克风</option>',
    ...devices.microphones.map((m) => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}</option>`),
  ].join('');

  const camOpts = [
    '<option value="">不开启摄像头画中画</option>',
    ...devices.cameras.map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`),
  ].join('');

  const body = document.getElementById('rec-modal-body');
  if (!body) return;

  body.innerHTML = `
    <div class="insp-card">
      <div class="insp-row">
        <span class="insp-label">采集模式</span>
        <select id="rec-mode" class="chrome-select">
          <option value="display">整块屏幕 (ddagrab GPU)</option>
          <option value="window">单个窗口 (gdigrab 无光标)</option>
          <option value="region">居中自选区域 (1280×720)</option>
        </select>
      </div>
      <div class="insp-row" id="rec-display-row">
        <span class="insp-label">目标显示器</span>
        <select id="rec-display" class="chrome-select">${displayOpts}</select>
      </div>
      <div class="insp-row" id="rec-window-row" style="display:none;">
        <span class="insp-label">目标窗口</span>
        <select id="rec-window" class="chrome-select">${windowOpts}</select>
      </div>
      <div class="insp-row">
        <span class="insp-label">录制时长 (秒) / 帧率</span>
        <div style="display:flex;gap:6px;align-items:center;">
          <input id="rec-seconds" class="chrome-title-input" style="width:74px;" type="number" min="2" max="300" value="6" />
          <select id="rec-fps" class="chrome-select">
            <option value="60" selected>60 fps</option>
            <option value="30">30 fps</option>
          </select>
        </div>
      </div>
    </div>

    <div class="insp-card">
      ${renderSwitchRow({ id: 'rec-sys-audio', label: '录制系统音频 (WASAPI 零依赖)', checked: true })}
      <div class="insp-row">
        <span class="insp-label">麦克风输入</span>
        <select id="rec-mic" class="chrome-select">${micOpts}</select>
      </div>
      <div class="insp-row">
        <span class="insp-label">摄像头画中画</span>
        <select id="rec-cam" class="chrome-select">${camOpts}</select>
      </div>
    </div>

    <div id="rec-status-msg" style="font-size:12px;color:var(--ink-secondary);min-height:18px;"></div>
    <div style="display:flex;justify-content:flex-end;gap:8px;padding-top:4px;">
      <button id="rec-cancel-btn" class="chrome-btn">取消</button>
      <button id="rec-start-btn" class="primary-export-btn" style="background:var(--recording-red);color:#fff;">开始录制</button>
    </div>`;

  const modeEl = document.getElementById('rec-mode') as HTMLSelectElement;
  const dispRow = document.getElementById('rec-display-row')!;
  const winRow = document.getElementById('rec-window-row')!;
  modeEl.addEventListener('change', () => {
    const isWin = modeEl.value === 'window';
    winRow.style.display = isWin ? 'flex' : 'none';
    dispRow.style.display = isWin ? 'none' : 'flex';
  });

  document.getElementById('rec-cancel-btn')?.addEventListener('click', () => ctx.closeModal());

  const startBtn = document.getElementById('rec-start-btn') as HTMLButtonElement;
  const statusEl = document.getElementById('rec-status-msg')!;
  startBtn.addEventListener('click', async () => {
    const captureMode = modeEl.value as 'display' | 'window' | 'region';
    const outputIdx = Number((document.getElementById('rec-display') as HTMLSelectElement).value) || 0;
    const winIdxRaw = (document.getElementById('rec-window') as HTMLSelectElement).value;
    const pickedWin = winIdxRaw !== '' ? devices.windows[Number(winIdxRaw)] : null;
    const seconds = Number((document.getElementById('rec-seconds') as HTMLInputElement).value) || 6;
    const fps = Number((document.getElementById('rec-fps') as HTMLSelectElement).value) || 60;
    const recordSystemAudio = (document.getElementById('rec-sys-audio') as HTMLInputElement).checked;
    const micDeviceName = (document.getElementById('rec-mic') as HTMLSelectElement).value;
    const cameraDeviceName = (document.getElementById('rec-cam') as HTMLSelectElement).value;

    const disp = devices.displays.find((d) => d.index === outputIdx) ?? devices.displays[0];
    const region =
      captureMode === 'region' && disp
        ? {
            x: Math.max(0, Math.round((disp.width - 1280) / 2)),
            y: Math.max(0, Math.round((disp.height - 720) / 2)),
            width: Math.min(1280, disp.width),
            height: Math.min(720, disp.height),
          }
        : undefined;

    startBtn.disabled = true;
    statusEl.textContent = `正在后台录制 (${seconds}s @ ${fps}fps)… 请稍候`;

    const res = await fetch('/api/record/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        captureMode,
        outputIdx,
        windowTitle: pickedWin?.title,
        windowBounds: pickedWin
          ? { x: pickedWin.x, y: pickedWin.y, width: pickedWin.width, height: pickedWin.height }
          : undefined,
        region,
        seconds,
        fps,
        recordSystemAudio,
        micDeviceName: micDeviceName || undefined,
        cameraDeviceName: cameraDeviceName || undefined,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      statusEl.textContent = `启动失败: ${err.error ?? res.status}`;
      startBtn.disabled = false;
      return;
    }

    const timer = window.setInterval(async () => {
      try {
        const stRes = await fetch('/api/record/status', { cache: 'no-store' });
        const st = await stRes.json();
        if (st.status === 'completed' && st.sessionId) {
          window.clearInterval(timer);
          ctx.closeModal();
          await ctx.reloadRecordings(st.sessionId);
        } else if (st.status === 'error') {
          window.clearInterval(timer);
          statusEl.textContent = `录制失败: ${st.error ?? '未知错误'}`;
          startBtn.disabled = false;
        }
      } catch {
        // retry on next tick
      }
    }, 600);
  });
}
