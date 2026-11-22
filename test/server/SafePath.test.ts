// Test for: F:\dogsc-win\src\server\SafePath.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { resolveSafeChildPath } from '../../src/server/SafePath.ts';

const root = resolve('out/safe-path-root');

test('T12.8: SafePath accepts normal child paths', () => {
  const target = resolveSafeChildPath(root, '/web/render.html');
  assert.equal(target, resolve(root, 'web/render.html'));
});

test('T12.8: SafePath rejects parent traversal and encoded traversal', () => {
  assert.equal(resolveSafeChildPath(root, '/../secret.txt'), null);
  assert.equal(resolveSafeChildPath(root, '/%2e%2e/secret.txt'), null);
  assert.equal(resolveSafeChildPath(root, '/..%5Csecret.txt'), null);
});

test('T12.8: SafePath rejects same-prefix sibling directories', () => {
  assert.equal(resolveSafeChildPath(root, '/../safe-path-root-evil/secret.txt'), null);
});

test('T12.8: SafePath rejects absolute paths and NUL bytes', () => {
  assert.equal(resolveSafeChildPath(root, '/C:/Windows/win.ini'), null);
  assert.equal(resolveSafeChildPath(root, '/web%00.txt'), null);
});

test('T12.8: SafePath returns root for slash and keeps nested path contained', () => {
  assert.equal(resolveSafeChildPath(root, '/'), root);
  const nested = resolveSafeChildPath(root, '/a/b/c.txt');
  assert.ok(nested && nested.startsWith(root));
});

test('T12.10: SafePath rejects symlinks or junctions pointing outside rootDir', (t) => {
  const base = resolve('out/safe-path-symlink-test');
  const insideRoot = resolve(base, 'inside');
  const outsideDir = resolve(base, 'outside');
  const linkPath = resolve(insideRoot, 'escape-link');
  rmSync(base, { recursive: true, force: true });
  mkdirSync(insideRoot, { recursive: true });
  mkdirSync(outsideDir, { recursive: true });
  writeFileSync(resolve(outsideDir, 'secret.txt'), 'top-secret', 'utf-8');

  try {
    try {
      symlinkSync(outsideDir, linkPath, 'junction');
    } catch {
      t.skip('Symlink/junction creation not permitted in this environment');
      return;
    }
    assert.equal(resolveSafeChildPath(insideRoot, '/escape-link/secret.txt'), null);
    assert.equal(resolveSafeChildPath(insideRoot, '/escape-link'), null);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
