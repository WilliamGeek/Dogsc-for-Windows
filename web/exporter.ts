/**
 * web/exporter.ts
 *
 * Drives the browser-side WebGL2 frame-by-frame rendering and raw RGBA upload loop
 * to ExportServer (/api/frame/:n and /api/done).
 * Strictly adheres to docs/CONTRACTS.md §1 and §4 (NO node:* imports).
 */

export interface ExportLoopPlan {
  frameCount: number;
  width: number;
  height: number;
}

/**
 * Renders every frame sequentially, reads back raw RGBA pixels via gl.readPixels,
 * streams each frame to POST /api/frame/:n, and signals completion with POST /api/done.
 */
export async function runExportLoop(
  renderFrameAt: (n: number) => Promise<void>,
  gl: WebGL2RenderingContext,
  plan: ExportLoopPlan
): Promise<void> {
  const byteLength = plan.width * plan.height * 4;
  const pixels = new Uint8Array(byteLength);

  for (let n = 0; n < plan.frameCount; n++) {
    await renderFrameAt(n);
    gl.finish();
    gl.readPixels(0, 0, plan.width, plan.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    const res = await fetch(`/api/frame/${n}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: pixels,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`POST /api/frame/${n} failed (${res.status}): ${errText}`);
    }
  }

  const doneRes = await fetch('/api/done', { method: 'POST' });
  if (!doneRes.ok) {
    const errText = await doneRes.text().catch(() => '');
    throw new Error(`POST /api/done failed (${doneRes.status}): ${errText}`);
  }
}
