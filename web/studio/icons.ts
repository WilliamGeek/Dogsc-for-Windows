/**
 * web/studio/icons.ts
 *
 * Unified 1.6px stroke Lucide / SF-Symbols-inspired SVG icon registry for DogSC Studio.
 * Zero external dependencies & strictly ZERO node:* imports.
 */

export type StudioIconName =
  | 'recordDot'
  | 'sidebar'
  | 'undo'
  | 'redo'
  | 'keyboard'
  | 'sun'
  | 'moon'
  | 'exportShare'
  | 'chevronLeft'
  | 'crop'
  | 'stepBack'
  | 'play'
  | 'pause'
  | 'stepFwd'
  | 'frame'
  | 'zoomIn'
  | 'sparkles'
  | 'cursor'
  | 'camera'
  | 'volume'
  | 'mic'
  | 'mousePointer'
  | 'scissors'
  | 'split'
  | 'trash'
  | 'plus'
  | 'mosaic'
  | 'spotlight'
  | 'subtitles'
  | 'music'
  | 'duck'
  | 'close'
  | 'check'
  | 'upload'
  | 'download'
  | 'wand'
  | 'sliders'
  | 'folder'
  | 'copy'
  | 'film'
  | 'eyeOff'
  | 'layers';

const ICON_PATHS: Record<StudioIconName, string> = {
  recordDot:
    '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/>',
  sidebar:
    '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/>',
  undo:
    '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo:
    '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  keyboard:
    '<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  sun:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon:
    '<path d="M20.354 15.354A9 9 0 0 1 8.646 3.646 9.003 9.003 0 0 0 12 21a9.003 9.003 0 0 0 8.354-5.646Z"/>',
  exportShare:
    '<path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
  chevronLeft:
    '<path d="m15 18-6-6 6-6"/>',
  crop:
    '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  stepBack:
    '<path d="M6 6v12"/><path d="M17 6 9 12l8 6V6Z" fill="currentColor" stroke="none"/>',
  play:
    '<path d="m7 5 12 7-12 7V5Z" fill="currentColor" stroke="none"/>',
  pause:
    '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>',
  stepFwd:
    '<path d="M18 6v12"/><path d="M7 6l8 6-8 6V6Z" fill="currentColor" stroke="none"/>',
  frame:
    '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18"/><circle cx="6.5" cy="6.5" r="0.7" fill="currentColor" stroke="none"/>',
  zoomIn:
    '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/><path d="M11 8v6M8 11h6"/>',
  sparkles:
    '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/>',
  cursor:
    '<path d="m5 3 13 7-5.5 2-2 5.5L5 3Z"/><path d="m12.5 12 4.5 4.5"/>',
  camera:
    '<path d="M15 8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-1.5l5 3v-7l-5 3V8Z"/>',
  volume:
    '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 6a8.5 8.5 0 0 1 0 12"/>',
  mic:
    '<rect x="9" y="3" width="6" height="10" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v4"/>',
  mousePointer:
    '<path d="m5 3 13.5 7.5-5.8 1.9-2 5.8L5 3Z"/>',
  scissors:
    '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88"/><path d="M14.47 14.48 20 20"/><path d="M8.12 8.12 12 12"/>',
  split:
    '<path d="M12 3v18"/><path d="m7 8-4 4 4 4"/><path d="m17 8 4 4-4 4"/>',
  trash:
    '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/>',
  plus:
    '<path d="M12 5v14M5 12h14"/>',
  mosaic:
    '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
  spotlight:
    '<circle cx="12" cy="12" r="5"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2"/>',
  subtitles:
    '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 12h6M7 15.5h4M15.5 12H17M13 15.5h4"/>',
  music:
    '<path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>',
  duck:
    '<path d="M4 15c2-4 5-4 8-2l4 2 4-1v4H5l-1-3Z"/><circle cx="14.5" cy="9.5" r="2.5"/>',
  close:
    '<path d="M18 6 6 18M6 6l12 12"/>',
  check:
    '<path d="m5 12 4.5 4.5L19 7"/>',
  upload:
    '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  download:
    '<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  wand:
    '<path d="m15 4 5 5L8 21l-5-5L15 4Z"/><path d="m12 7 5 5"/><path d="M5 4v3M3.5 5.5h3M19 14v3M17.5 15.5h3"/>',
  sliders:
    '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="var(--panel-surface)"/><circle cx="15" cy="12" r="2" fill="var(--panel-surface)"/><circle cx="11" cy="18" r="2" fill="var(--panel-surface)"/>',
  folder:
    '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  copy:
    '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  film:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 12h18"/>',
  eyeOff:
    '<path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 4.2A10.4 10.4 0 0 1 21 12c-.7 1.3-1.7 2.5-2.9 3.5"/><path d="M6.1 6.1C4.4 7.5 3.1 9.6 3 12c1.7 3.7 5.1 6 9 6 1.5 0 2.9-.3 4.2-.9"/>',
  layers:
    '<path d="m12 3 9 4.5-9 4.5-9-4.5L12 3Z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/>',
};

export const STUDIO_ICON_NAMES: readonly StudioIconName[] = Object.keys(
  ICON_PATHS
) as StudioIconName[];

export function svgIcon(name: StudioIconName, size: number = 14, className: string = ''): string {
  const paths = ICON_PATHS[name];
  const cls = className ? `ico ${className}` : 'ico';
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

