/**
 * SafePath.ts
 *
 * Path containment for the local HTTP servers. `startsWith(root)` is NOT a
 * containment check: `F:\dogsc-win-evil` starts with `F:\dogsc-win`. This
 * helper uses path.relative and rejects any result that escapes the root.
 */

import { isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * Resolves a URL pathname under rootDir, returning null when the path is
 * absolute, contains a parent segment, uses backslashes, or resolves to a
 * sibling whose name merely shares the root prefix.
 */
export function resolveSafeChildPath(rootDir: string, urlPathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPathname);
  } catch {
    return null;
  }

  if (decoded.includes('\0') || decoded.includes('\\')) return null;

  const root = resolve(rootDir);
  const relativeUrl = decoded.replace(/^\/+/, '');
  if (isAbsolute(relativeUrl)) return null;
  if (relativeUrl.length === 0) return root;

  const target = resolve(root, relativeUrl);
  const rel = relative(root, target);

  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return null;
  }

  return target;
}
