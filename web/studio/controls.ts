/**
 * web/studio/controls.ts
 *
 * Professional NLE micro-interaction controls (Frontend P3):
 * - Filled-track range slider with double-click reset to default
 * - Scrubbable numeric readout label (drag horizontally; hold Shift for 0.25x fine control)
 * - Custom pill switch markup helper
 * Strictly ZERO node:* imports and stripTypeScriptTypes compatible.
 */

export function snapAndClampValue(
  raw: number,
  min: number,
  max: number,
  step: number
): number {
  const clamped = Math.min(max, Math.max(min, raw));
  if (!Number.isFinite(step) || step <= 0) return clamped;
  const snapped = min + Math.round((clamped - min) / step) * step;
  const safeSnapped = Math.min(max, Math.max(min, snapped));
  return Number(safeSnapped.toFixed(6));
}

/**
 * Pure helper computing a new numeric value while scrubbing a readout horizontally.
 */
export function computeScrubbedValue(
  startValue: number,
  deltaPx: number,
  min: number,
  max: number,
  step: number,
  fine: boolean = false
): number {
  const span = Math.max(1e-6, max - min);
  const sensitivity = fine ? 0.25 : 1.0;
  const raw = startValue + (deltaPx / 140) * span * sensitivity;
  return snapAndClampValue(raw, min, max, step);
}

export function rangeProgressPct(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || max <= min) return 0;
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
}

export function renderSliderRow(opts: {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  defaultValue: number;
  display: string;
  labelWidth?: number;
}): string {
  const pct = rangeProgressPct(opts.value, opts.min, opts.max).toFixed(2);
  const minW = opts.labelWidth ?? 74;
  return `
    <div class="insp-row">
      <span class="insp-label" style="min-width:${minW}px;">${opts.label}</span>
      <input id="${opts.id}" class="insp-slider" type="range" min="${opts.min}" max="${opts.max}" step="${opts.step}" value="${opts.value}" data-default="${opts.defaultValue}" style="--range-pct:${pct}%" title="双击恢复默认值 (${opts.defaultValue})" />
      <span id="${opts.id}-val" class="insp-val is-scrubbable" title="左右拖拽微调（按住 Shift 更精细），双击复位">${opts.display}</span>
    </div>`;
}

export function renderSwitchRow(opts: {
  id: string;
  label: string;
  checked: boolean;
  labelClass?: string;
}): string {
  return `
    <label class="insp-row insp-switch-row" for="${opts.id}">
      <span class="${opts.labelClass ?? 'insp-label'}">${opts.label}</span>
      <span class="studio-switch">
        <input id="${opts.id}" type="checkbox" ${opts.checked ? 'checked' : ''} />
        <span class="studio-switch-track"><span class="studio-switch-thumb"></span></span>
      </span>
    </label>`;
}

export function bindProRange(
  id: string,
  onApply: (value: number, recordHistory: boolean) => void,
  formatVal: (v: number) => string,
  defaultValue?: number
): void {
  const slider = document.getElementById(id) as HTMLInputElement | null;
  const valEl = document.getElementById(`${id}-val`);
  if (!slider) return;

  const min = Number(slider.min) || 0;
  const max = Number(slider.max) || 100;
  const step = Number(slider.step) || 1;
  const fallbackDefault =
    defaultValue !== undefined
      ? defaultValue
      : slider.dataset.default !== undefined
        ? Number(slider.dataset.default)
        : Number(slider.value);

  const syncVisual = (num: number) => {
    slider.value = String(num);
    slider.style.setProperty('--range-pct', `${rangeProgressPct(num, min, max).toFixed(2)}%`);
    if (valEl) valEl.textContent = formatVal(num);
  };

  syncVisual(Number(slider.value));

  let pushed = false;
  slider.addEventListener('input', () => {
    const num = Number(slider.value);
    syncVisual(num);
    onApply(num, !pushed);
    pushed = true;
  });
  slider.addEventListener('change', () => {
    pushed = false;
  });

  const handleReset = () => {
    if (!Number.isFinite(fallbackDefault)) return;
    const target = snapAndClampValue(fallbackDefault, min, max, step);
    syncVisual(target);
    onApply(target, true);
  };

  slider.addEventListener('dblclick', handleReset);

  if (valEl) {
    valEl.addEventListener('dblclick', handleReset);
    valEl.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      valEl.setPointerCapture(ev.pointerId);
      const startX = ev.clientX;
      const startVal = Number(slider.value);
      let scrubPushed = false;
      let moved = false;

      const onMove = (moveEv: PointerEvent) => {
        const dx = moveEv.clientX - startX;
        if (!moved && Math.abs(dx) < 2) return;
        moved = true;
        const nextVal = computeScrubbedValue(startVal, dx, min, max, step, moveEv.shiftKey);
        syncVisual(nextVal);
        onApply(nextVal, !scrubPushed);
        scrubPushed = true;
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }
}

