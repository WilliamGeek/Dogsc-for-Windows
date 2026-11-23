/**
 * web/studio/colorPicker.ts
 *
 * Self-contained Warm Graphite popover HSV/HEX color picker (Frontend P2),
 * replacing native OS <input type="color"> dialogs with smooth live WebGL preview updates.
 * Strictly ZERO node:* imports and stripTypeScriptTypes compatible.
 */

export const STUDIO_COLOR_SWATCHES: readonly string[] = Object.freeze([
  '#ffffff',
  '#ecece9',
  '#a3a29e',
  '#2d2d2b',
  '#da7a52',
  '#e5a93c',
  '#52b788',
  '#4ea8de',
  '#7c6cf0',
  '#e05a6d',
]);

export function normalizeHexColor(raw: string): string | null {
  const s = String(raw || '').trim();
  const m6 = /^#?([0-9a-f]{6})$/i.exec(s);
  if (m6) return `#${m6[1].toLowerCase()}`;
  const m3 = /^#?([0-9a-f]{3})$/i.exec(s);
  if (m3) {
    const [r, g, b] = m3[1].toLowerCase().split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return null;
}

export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const norm = normalizeHexColor(hex) ?? '#ffffff';
  const r = Number.parseInt(norm.slice(1, 3), 16) / 255;
  const g = Number.parseInt(norm.slice(3, 5), 16) / 255;
  const b = Number.parseInt(norm.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  if (d > 1e-6) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
  }
  const s = max <= 1e-6 ? 0 : d / max;
  return { h, s, v: max };
}

export function hsvToHex(h: number, s: number, v: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(1, Math.max(0, s));
  const val = Math.min(1, Math.max(0, v));
  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;

  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (hue < 60) [rp, gp, bp] = [c, x, 0];
  else if (hue < 120) [rp, gp, bp] = [x, c, 0];
  else if (hue < 180) [rp, gp, bp] = [0, c, x];
  else if (hue < 240) [rp, gp, bp] = [0, x, c];
  else if (hue < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];

  const toHex = (n: number) =>
    Math.min(255, Math.max(0, Math.round((n + m) * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(rp)}${toHex(gp)}${toHex(bp)}`;
}

let activeCleanup: (() => void) | null = null;

export function closeActiveColorPicker(): void {
  if (activeCleanup) {
    activeCleanup();
    activeCleanup = null;
  }
}

export function renderColorChipButton(id: string, hex: string): string {
  const norm = normalizeHexColor(hex) ?? '#ffffff';
  return `<button type="button" id="${id}" class="cp-trigger" data-hex="${norm}" title="点击打开调色板 (${norm.toUpperCase()})"><span class="cp-trigger-swatch" style="background:${norm}"></span><span class="cp-trigger-code">${norm.toUpperCase()}</span></button>`;
}

export function mountStudioColorPicker(
  id: string,
  initialHex: string,
  onInput: (hex: string, recordHistory: boolean) => void
): void {
  const trigger = document.getElementById(id) as HTMLButtonElement | null;
  if (!trigger) return;

  let currentHex = normalizeHexColor(initialHex) ?? '#ffffff';

  trigger.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const wasMine = trigger.dataset.cpOpen === '1';
    closeActiveColorPicker();
    if (wasMine) return;

    let hsv = hexToHsv(currentHex);
    let pushedHistory = false;

    const pop = document.createElement('div');
    pop.className = 'cp-popover';
    pop.innerHTML = `
      <div class="cp-sv-box" id="cp-sv-box">
        <div class="cp-sv-white"></div>
        <div class="cp-sv-black"></div>
        <div class="cp-sv-thumb" id="cp-sv-thumb"></div>
      </div>
      <input id="cp-hue-slider" class="cp-hue-range" type="range" min="0" max="359" step="1" value="${Math.round(hsv.h)}" />
      <div class="cp-swatches">
        ${STUDIO_COLOR_SWATCHES.map(
          (sw) =>
            `<button type="button" class="cp-swatch-chip" data-sw="${sw}" style="background:${sw}" title="${sw.toUpperCase()}"></button>`
        ).join('')}
      </div>
      <div class="cp-hex-row">
        <span class="cp-hex-preview" id="cp-hex-preview" style="background:${currentHex}"></span>
        <input id="cp-hex-input" class="ai-input cp-hex-input" type="text" maxlength="7" value="${currentHex.toUpperCase()}" />
      </div>
    `;

    document.body.appendChild(pop);
    trigger.dataset.cpOpen = '1';

    const rect = trigger.getBoundingClientRect();
    const popW = 220;
    const popH = 248;
    const left = Math.min(window.innerWidth - popW - 10, Math.max(10, rect.right - popW));
    const top =
      rect.bottom + popH + 10 <= window.innerHeight
        ? rect.bottom + 6
        : Math.max(10, rect.top - popH - 6);
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;

    const svBox = pop.querySelector('#cp-sv-box') as HTMLElement;
    const svThumb = pop.querySelector('#cp-sv-thumb') as HTMLElement;
    const hueEl = pop.querySelector('#cp-hue-slider') as HTMLInputElement;
    const hexInp = pop.querySelector('#cp-hex-input') as HTMLInputElement;
    const hexPrev = pop.querySelector('#cp-hex-preview') as HTMLElement;

    const paintUi = () => {
      svBox.style.background = hsvToHex(hsv.h, 1, 1);
      svThumb.style.left = `${Math.round(hsv.s * 100)}%`;
      svThumb.style.top = `${Math.round((1 - hsv.v) * 100)}%`;
      hueEl.value = String(Math.round(hsv.h));
      hexPrev.style.background = currentHex;
      if (document.activeElement !== hexInp) {
        hexInp.value = currentHex.toUpperCase();
      }
      const swEl = trigger.querySelector('.cp-trigger-swatch') as HTMLElement | null;
      const codeEl = trigger.querySelector('.cp-trigger-code') as HTMLElement | null;
      if (swEl) swEl.style.background = currentHex;
      if (codeEl) codeEl.textContent = currentHex.toUpperCase();
      trigger.dataset.hex = currentHex;
      trigger.title = `点击打开调色板 (${currentHex.toUpperCase()})`;
    };

    const emitColor = (nextHex: string, record: boolean) => {
      currentHex = nextHex;
      paintUi();
      onInput(nextHex, record);
    };

    paintUi();

    const updateSvFromClient = (cx: number, cy: number, record: boolean) => {
      const r = svBox.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      hsv.s = Math.min(1, Math.max(0, (cx - r.left) / r.width));
      hsv.v = Math.min(1, Math.max(0, 1 - (cy - r.top) / r.height));
      emitColor(hsvToHex(hsv.h, hsv.s, hsv.v), record);
    };

    svBox.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      svBox.setPointerCapture(e.pointerId);
      updateSvFromClient(e.clientX, e.clientY, !pushedHistory);
      pushedHistory = true;
    });
    svBox.addEventListener('pointermove', (e) => {
      if (e.buttons === 1) {
        updateSvFromClient(e.clientX, e.clientY, !pushedHistory);
        pushedHistory = true;
      }
    });
    svBox.addEventListener('pointerup', () => {
      pushedHistory = false;
    });

    hueEl.addEventListener('input', () => {
      hsv.h = Number(hueEl.value) || 0;
      emitColor(hsvToHex(hsv.h, hsv.s, hsv.v), !pushedHistory);
      pushedHistory = true;
    });
    hueEl.addEventListener('change', () => {
      pushedHistory = false;
    });

    pop.querySelectorAll('.cp-swatch-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const sw = normalizeHexColor(chip.getAttribute('data-sw') || '');
        if (!sw) return;
        hsv = hexToHsv(sw);
        emitColor(sw, true);
      });
    });

    hexInp.addEventListener('change', () => {
      const parsed = normalizeHexColor(hexInp.value);
      if (!parsed) {
        hexInp.value = currentHex.toUpperCase();
        return;
      }
      hsv = hexToHsv(parsed);
      emitColor(parsed, true);
    });

    const onDocDown = (e: PointerEvent) => {
      if (!pop.contains(e.target as Node) && e.target !== trigger && !trigger.contains(e.target as Node)) {
        closeActiveColorPicker();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeActiveColorPicker();
    };
    window.addEventListener('pointerdown', onDocDown, true);
    window.addEventListener('keydown', onKeyDown, true);

    activeCleanup = () => {
      delete trigger.dataset.cpOpen;
      window.removeEventListener('pointerdown', onDocDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      pop.remove();
    };
  });
}

