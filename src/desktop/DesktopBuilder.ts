/**
 * src/desktop/DesktopBuilder.ts
 *
 * Pure Node.js helpers (zero npm dependencies) for Wave F:
 * - Zero-dependency PNG-in-ICO icon generator (brand Warm Graphite + Terracotta mark)
 * - Windows toolchain discovery (csc.exe / iexpress.exe)
 * - Strict package payload filtering & IExpress .SED manifest generation
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function renderBrandIconRgba(size: number): Buffer {
  const buf = Buffer.alloc(size * size * 4);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const halfBox = size * 0.43;
  const boxRadius = size * 0.12;
  const rimWidth = Math.max(1.2, size * 0.035);
  const dotRadius = size * 0.19;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(x - cx) - (halfBox - boxRadius);
      const dy = Math.abs(y - cy) - (halfBox - boxRadius);
      const qx = Math.max(dx, 0);
      const qy = Math.max(dy, 0);
      const boxDist = Math.hypot(qx, qy) + Math.min(Math.max(dx, dy), 0) - boxRadius;

      const idx = (y * size + x) * 4;
      const boxAlpha = Math.min(Math.max(0.75 - boxDist, 0), 1);
      if (boxAlpha <= 0) {
        buf[idx] = 0;
        buf[idx + 1] = 0;
        buf[idx + 2] = 0;
        buf[idx + 3] = 0;
        continue;
      }

      // Warm Graphite base (#1b1b1a) + subtle hairline rim (#3c3b38)
      const rimFactor =
        boxDist > -rimWidth ? Math.min(1, Math.max(0, (boxDist + rimWidth) / rimWidth)) : 0;
      let r = 27 + rimFactor * 33;
      let g = 27 + rimFactor * 32;
      let b = 26 + rimFactor * 30;

      // Terracotta studio lens dot (#da7a52) with subtle upper-left sheen
      const dDot = Math.hypot(x - cx, y - cy) - dotRadius;
      const dotCoverage = Math.min(Math.max(0.75 - dDot, 0), 1);
      if (dotCoverage > 0) {
        const sheen = Math.max(0, ((cx - x) + (cy - y)) / (2 * Math.max(dotRadius, 1)));
        const dr = 218 + sheen * 22;
        const dg = 122 + sheen * 32;
        const db = 82 + sheen * 24;
        r = r * (1 - dotCoverage) + dr * dotCoverage;
        g = g * (1 - dotCoverage) + dg * dotCoverage;
        b = b * (1 - dotCoverage) + db * dotCoverage;
      }

      buf[idx] = Math.min(255, Math.max(0, Math.round(r)));
      buf[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
      buf[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
      buf[idx + 3] = Math.round(boxAlpha * 255);
    }
  }
  return buf;
}

function encodePngRgba(size: number, rgba: Buffer): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    const rowOut = y * (stride + 1);
    raw[rowOut] = 0; // filter None
    rgba.copy(raw, rowOut + 1, y * stride, (y + 1) * stride);
  }
  const compressed = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Generates a valid multi-resolution (32x32 & 64x64) PNG-in-ICO Windows icon
 * depicting DogSC's Warm Graphite rounded frame with Terracotta lens dot.
 */
export function generateBrandIconIco(): Buffer {
  const sizes = [32, 64];
  const pngs = sizes.map((sz) => encodePngRgba(sz, renderBrandIconRgba(sz)));

  const headerSize = 6;
  const entrySize = 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = ICO
  header.writeUInt16LE(sizes.length, 4);

  let offset = headerSize + sizes.length * entrySize;
  const entries: Buffer[] = [];
  for (let i = 0; i < sizes.length; i++) {
    const sz = sizes[i];
    const png = pngs[i];
    const entry = Buffer.alloc(entrySize);
    entry[0] = sz >= 256 ? 0 : sz;
    entry[1] = sz >= 256 ? 0 : sz;
    entry[2] = 0; // color palette count
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(entry);
  }

  return Buffer.concat([header, ...entries, ...pngs]);
}

export function resolveCscPath(): string | null {
  const winDir = process.env.SystemRoot || 'C:\\Windows';
  const candidates = [
    path.join(winDir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(winDir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function resolveIExpressPath(): string | null {
  const winDir = process.env.SystemRoot || 'C:\\Windows';
  const candidate = path.join(winDir, 'System32', 'iexpress.exe');
  return existsSync(candidate) ? candidate : null;
}

export function buildCscArgs(opts: {
  sourceCs: string;
  outExe: string;
  iconPath?: string;
}): string[] {
  const args = [
    '/nologo',
    '/target:winexe',
    '/platform:x64',
    '/optimize+',
    '/utf8output',
    '/codepage:65001',
    '/r:System.Windows.Forms.dll',
    '/r:System.Drawing.dll',
    '/r:Microsoft.CSharp.dll',
  ];
  if (opts.iconPath) {
    args.push(`/win32icon:${opts.iconPath}`);
  }
  args.push(`/out:${opts.outExe}`, opts.sourceCs);
  return args;
}

const INCLUDED_DIRS = ['src', 'web', 'scripts', 'tools'] as const;
const INCLUDED_ROOT_FILES = [
  'package.json',
  'LICENSE',
  'LICENSE-MIT',
  'THIRD_PARTY_NOTICES.md',
  'README.md',
  'README.en.md',
] as const;
const EXCLUDED_SEGMENTS = new Set([
  'recordings',
  'out',
  '.git',
  'test',
  'dist',
  'node_modules',
  'audit-runs',
  '__pycache__',
]);
const EXCLUDED_EXTENSIONS = new Set(['.mp4', '.jpg', '.jpeg', '.wav', '.tmp', '.log']);

function collectDirRelative(baseRoot: string, currentDir: string, out: string[]): void {
  const entries = readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDED_SEGMENTS.has(entry.name)) continue;
    const full = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      collectDirRelative(baseRoot, full, out);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (EXCLUDED_EXTENSIONS.has(ext)) continue;
      const rel = path.relative(baseRoot, full).split(path.sep).join('/');
      out.push(rel);
    }
  }
}

/**
 * Enumerates strictly clean runtime/source/documentation relative paths
 * eligible for Windows distribution packages.
 */
export function listPackagedRelativePaths(rootDir: string): string[] {
  const out: string[] = [];
  for (const dirName of INCLUDED_DIRS) {
    const abs = path.join(rootDir, dirName);
    if (existsSync(abs) && statSync(abs).isDirectory()) {
      collectDirRelative(rootDir, abs, out);
    }
  }
  for (const fileName of INCLUDED_ROOT_FILES) {
    const abs = path.join(rootDir, fileName);
    if (existsSync(abs) && statSync(abs).isFile()) {
      out.push(fileName);
    }
  }
  return out.sort();
}

export function buildIExpressSed(opts: {
  targetExe: string;
  sourceDir: string;
  files: string[];
  appLaunched: string;
  friendlyName: string;
}): string {
  const normalizedSourceDir = path.resolve(opts.sourceDir).replace(/[\\/]+$/, '') + '\\';
  const fileStrings = opts.files.map((f, idx) => `FILE${idx}="${f}"`).join('\r\n');
  const fileRefs = opts.files.map((_, idx) => `%FILE${idx}%=`).join('\r\n');

  return [
    '[Version]',
    'Class=IEXPRESS',
    'SEDVersion=3',
    '[Options]',
    'PackagePurpose=InstallApp',
    'ShowInstallProgramWindow=0',
    'HideExtractAnimation=0',
    'UseLongFileName=1',
    'InsideCompressed=0',
    'CAB_FixedSize=0',
    'CAB_ResvCodeSigning=0',
    'RebootMode=N',
    'InstallPrompt=%InstallPrompt%',
    'DisplayLicense=%DisplayLicense%',
    'FinishMessage=%FinishMessage%',
    'TargetName=%TargetName%',
    'FriendlyName=%FriendlyName%',
    'AppLaunched=%AppLaunched%',
    'PostInstallCmd=%PostInstallCmd%',
    'AdminQuietInstCmd=%AdminQuietInstCmd%',
    'UserQuietInstCmd=%UserQuietInstCmd%',
    'SourceFiles=SourceFiles',
    '[Strings]',
    'InstallPrompt=',
    'DisplayLicense=',
    'FinishMessage=',
    `TargetName=${path.resolve(opts.targetExe)}`,
    `FriendlyName=${opts.friendlyName}`,
    `AppLaunched=${opts.appLaunched}`,
    'PostInstallCmd=<None>',
    'AdminQuietInstCmd=',
    'UserQuietInstCmd=',
    fileStrings,
    '[SourceFiles]',
    `SourceFiles0=${normalizedSourceDir}`,
    '[SourceFiles0]',
    fileRefs,
    '',
  ].join('\r\n');
}

/**
 * Resolves the active Node.js binary eligible for bundling into `runtime/node.exe`
 * for zero-prerequisite portable Windows distributions.
 */
export function resolvePortableNodeBinary(explicitPath?: string): string {
  const candidate = path.resolve(explicitPath || process.execPath);
  if (!existsSync(candidate)) {
    throw new Error(`找不到可用于便携打包的 Node.js 运行时: ${candidate}`);
  }
  return candidate;
}

/**
 * Emits attribution and license disclosure for bundled portable Node.js runtimes.
 */
export function buildPortableRuntimeNotice(nodeVersion: string): string {
  return [
    'DogSC Windows Portable Node.js Runtime Notice',
    '==========================================',
    '',
    `Bundled Node.js version: ${nodeVersion}`,
    'License: MIT / OpenJS Foundation & Node.js contributors',
    'Upstream source: https://nodejs.org/',
    '',
    'This portable bundle places node.exe under runtime\\node.exe so DogSC.exe',
    'runs without a system-wide Node.js installation.',
    '',
  ].join('\r\n');
}


