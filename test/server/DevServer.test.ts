// Test for: F:\dogsc-win\src\server\DevServer.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, basename } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { startDevServer } from '../../src/server/DevServer.ts';

function rawGet(port: number, rawPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, reject) => {
    const req = httpGet({ hostname: '127.0.0.1', port, path: rawPath }, (res) => {
      let body = '';
      res.setEncoding('utf-8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
  });
}

test('T11.1: DevServer starts on random port, serves stripped TypeScript and prevents traversal', async () => {
  const rootDir = resolve('.');
  const server = await startDevServer({ rootDir, port: 0 });
  assert.ok(server.port > 0, `Server port should be assigned: ${server.port}`);

  try {
    // 1. GET /src/core/swift.ts
    const tsRes = await fetch(`http://127.0.0.1:${server.port}/src/core/swift.ts`, {
      headers: { Connection: 'close' },
    });
    assert.equal(tsRes.status, 200);
    const contentType = tsRes.headers.get('content-type') ?? '';
    assert.ok(
      contentType.includes('javascript'),
      `Content-Type should be javascript, got: ${contentType}`
    );

    const body = await tsRes.text();
    assert.ok(body.includes('export function clamp('), 'Should contain clamp function definition');
    // Ensure TypeScript type annotation `: number` is stripped
    assert.ok(
      !body.includes('val: number'),
      'Type annotation "val: number" should be stripped away'
    );
    assert.ok(
      !body.includes('maxVal: number'),
      'Parameter type annotation should be stripped away'
    );
    assert.ok(
      !body.includes('): number {'),
      'Return type annotation should be stripped away'
    );

    // 2. GET /package.json (static json)
    const jsonRes = await fetch(`http://127.0.0.1:${server.port}/package.json`, {
      headers: { Connection: 'close' },
    });
    assert.equal(jsonRes.status, 200);
    assert.ok(jsonRes.headers.get('content-type')?.includes('application/json'));
    const pkg = await jsonRes.json();
    assert.equal(pkg.name, 'dogsc-win');

    // 3. Security: Path traversal protection
    const traversalRes = await fetch(
      `http://127.0.0.1:${server.port}/../../../Windows/System32/drivers/etc/hosts`,
      { headers: { Connection: 'close' } }
    );
    assert.ok(
      traversalRes.status === 403 || traversalRes.status === 404,
      `Traversal should be blocked (403 or 404), got: ${traversalRes.status}`
    );

    // 4. Non-existent file
    const notFoundRes = await fetch(
      `http://127.0.0.1:${server.port}/does-not-exist-file-123.xyz`,
      { headers: { Connection: 'close' } }
    );
    assert.equal(notFoundRes.status, 404);
  } finally {
    await server.close();
  }
});

test('T12.8: DevServer blocks a same-prefix sibling directory escape', async () => {
  const rootDir = resolve('.');
  const siblingName = `${basename(rootDir)}-evil`;
  const siblingDir = resolve(rootDir, '..', siblingName);
  const secret = resolve(siblingDir, 'secret.txt');

  mkdirSync(siblingDir, { recursive: true });
  writeFileSync(secret, 'TOP-SECRET', 'utf-8');

  const server = await startDevServer({ rootDir, port: 0 });
  try {
    const res = await rawGet(server.port, `/%2e%2e%5C${siblingName}/secret.txt`);
    assert.equal(res.status, 403, 'same-prefix sibling must be rejected, not merely prefix-matched');
    assert.ok(!res.body.includes('TOP-SECRET'));
  } finally {
    await server.close();
    rmSync(siblingDir, { recursive: true, force: true });
  }
});
