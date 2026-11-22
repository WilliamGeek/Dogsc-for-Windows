/**
 * SafePath.ts
 *
 * Path containment for the local HTTP servers. `startsWith(root)` is NOT a
 * containment check: `F:\dogsc-win-evil` starts with `F:\dogsc-win`. This
 * helper uses path.relative and rejects any result that escapes the root.
 */

import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/**
 * Resolves a URL pathname under rootDir, returning null when the path is
 * absolute, contains a parent segment, uses backslashes, resolves to a
 * sibling whose name merely shares the root prefix, or traverses via symlink/junction.
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
  const target = relativeUrl.length === 0 ? root : resolve(root, relativeUrl);

  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return null;
  }

  if (existsSync(root)) {
    const realRoot = realpathSync(root);
    let probe = target;
    while (!existsSync(probe)) {
      const parent = dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    if (existsSync(probe)) {
      const realProbe = realpathSync(probe);
      const realRel = relative(realRoot, realProbe);
      if (realRel === '..' || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) {
        return null;
      }
    }
  }

  return target;
}
