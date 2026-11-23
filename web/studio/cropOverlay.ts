/**
 * web/studio/cropOverlay.ts
 *
 * Interactive 8-handle Canvas Crop Overlay (`project.canvas.crop`) for DogSC Studio:
 * - Pure `applyCropDragDelta` enforces [0, 1] clamping and minimum 15% crop extent
 * - Draggable corners/edges/interior directly over `#studio-stage` with 1-step Undo grouping
 * Strictly ZERO node:* imports and stripTypeScriptTypes compatible.
 */

import {
  NormalizedCropFull,
  normalizedCropClamped,
  type NormalizedCrop,
} from '../../src/core/ProjectModel.ts';
import { clamp } from '../../src/core/swift.ts';

export type CropHandleKind = 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r' | 'move';

export const CROP_TOGGLE_EVENT = 'dogsc:toggle-crop';

const HANDLES: readonly CropHandleKind[] = ['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r'];

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Pure function: applies normalized pointer displacement `(dxNorm, dyNorm)` on the given handle,
 * clamping strictly within [0, 1] and preserving at least `minSize` extent along both axes.
 */
export function applyCropDragDelta(
  initial: NormalizedCrop,
  handle: CropHandleKind,
  dxNorm: number,
  dyNorm: number,
  minSize: number = 0.15
): NormalizedCrop {
  const safeMin = clamp(minSize, 0.05, 0.9);
  const dx = Number.isFinite(dxNorm) ? dxNorm : 0;
  const dy = Number.isFinite(dyNorm) ? dyNorm : 0;

  const base = normalizedCropClamped(initial);
  const w0 = clamp(base.width, safeMin, 1);
  const h0 = clamp(base.height, safeMin, 1);
  const x0 = clamp(base.x, 0, Math.max(0, 1 - w0));
  const y0 = clamp(base.y, 0, Math.max(0, 1 - h0));

  if (handle === 'move') {
    return normalizedCropClamped({
      x: round4(clamp(x0 + dx, 0, Math.max(0, 1 - w0))),
      y: round4(clamp(y0 + dy, 0, Math.max(0, 1 - h0))),
      width: round4(w0),
      height: round4(h0),
    });
  }

  let left = x0;
  let right = x0 + w0;
  let top = y0;
  let bottom = y0 + h0;

  if (handle.includes('l')) {
    left = clamp(x0 + dx, 0, right - safeMin);
  }
  if (handle.includes('r')) {
    right = clamp(x0 + w0 + dx, left + safeMin, 1);
  }
  if (handle.includes('t')) {
    top = clamp(y0 + dy, 0, bottom - safeMin);
  }
  if (handle.includes('b')) {
    bottom = clamp(y0 + h0 + dy, top + safeMin, 1);
  }

  return normalizedCropClamped({
    x: round4(left),
    y: round4(top),
    width: round4(right - left),
    height: round4(bottom - top),
  });
}

export class StudioCropOverlayController {
  private active = false;

  isActive(): boolean {
    return this.active;
  }

  setActive(next: boolean): void {
    this.active = next;
  }

  toggle(): boolean {
    this.active = !this.active;
    return this.active;
  }

  sync(
    container: HTMLElement | null,
    getCrop: () => NormalizedCrop | null,
    onChangeCrop: (nextCrop: NormalizedCrop, recordHistory: boolean) => void,
    onDone: () => void
  ): void {
    const toggleBtn = document.getElementById('btn-toggle-crop');
    toggleBtn?.classList.toggle('active', this.active);

    if (!container) return;
    const crop = getCrop();

    if (!this.active || !crop) {
      container.classList.remove('active');
      container.setAttribute('aria-hidden', 'true');
      container.innerHTML = '';
      return;
    }

    const c = normalizedCropClamped(crop);
    const leftPct = (c.x * 100).toFixed(3);
    const topPct = (c.y * 100).toFixed(3);
    const widthPct = (c.width * 100).toFixed(3);
    const heightPct = (c.height * 100).toFixed(3);
    const rightPct = (Math.max(0, 1 - c.x - c.width) * 100).toFixed(3);
    const botPct = (Math.max(0, 1 - c.y - c.height) * 100).toFixed(3);

    const handlesHtml = HANDLES.map(
      (h) => `<div class="crop-handle crop-handle-${h}" data-crop-handle="${h}"></div>`
    ).join('');

    container.classList.add('active');
    container.setAttribute('aria-hidden', 'false');
    container.innerHTML = `
      <div class="crop-scrim" style="left:0;right:0;top:0;height:${topPct}%;"></div>
      <div class="crop-scrim" style="left:0;right:0;bottom:0;height:${botPct}%;"></div>
      <div class="crop-scrim" style="left:0;top:${topPct}%;height:${heightPct}%;width:${leftPct}%;"></div>
      <div class="crop-scrim" style="right:0;top:${topPct}%;height:${heightPct}%;width:${rightPct}%;"></div>
      <div class="crop-box" data-crop-handle="move" style="left:${leftPct}%;top:${topPct}%;width:${widthPct}%;height:${heightPct}%;">
        <div class="crop-thirds"></div>
        ${handlesHtml}
      </div>
      <div class="crop-toolbar">
        <span class="crop-readout">${Math.round(c.width * 100)}% × ${Math.round(c.height * 100)}%</span>
        <button id="crop-btn-reset" class="chrome-btn">重置 100%</button>
        <button id="crop-btn-done" class="primary-export-btn crop-done-btn">完成</button>
      </div>
    `;

    container.querySelector('.crop-toolbar')?.addEventListener('click', (ev) => ev.stopPropagation());
    container.querySelector('#crop-btn-reset')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      onChangeCrop(NormalizedCropFull, true);
    });
    container.querySelector('#crop-btn-done')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      onDone();
    });

    container.querySelectorAll('[data-crop-handle]').forEach((el) => {
      el.addEventListener('pointerdown', (ev) => {
        const pe = ev as PointerEvent;
        pe.preventDefault();
        pe.stopPropagation();
        const handle = (el as HTMLElement).getAttribute('data-crop-handle') as CropHandleKind | null;
        if (!handle) return;
        const startCrop = getCrop();
        if (!startCrop) return;
        const rect = container.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) return;

        const startX = pe.clientX;
        const startY = pe.clientY;
        let pushedHistory = false;

        const onMove = (moveEv: PointerEvent) => {
          const dxNorm = (moveEv.clientX - startX) / rect.width;
          const dyNorm = (moveEv.clientY - startY) / rect.height;
          const next = applyCropDragDelta(startCrop, handle, dxNorm, dyNorm);
          onChangeCrop(next, !pushedHistory);
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
  }
}
