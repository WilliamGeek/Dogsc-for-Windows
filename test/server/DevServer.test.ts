// Test for: F:\dogsc-win\src\server\DevServer.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { startDevServer } from '../../src/server/DevServer.ts';

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
