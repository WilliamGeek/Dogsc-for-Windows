/**
 * web/exporter.ts
 *
 * Drives the browser-side WebGL2 frame-by-frame rendering and raw RGBA upload loop
 * to ExportServer (/api/frame/:n, /api/error and /api/done).
 * Strictly adheres to docs/CONTRACTS.md §1 and §4 (NO node:* imports).
 */

export interface ExportLoopPlan {
  frameCount: number;
  width: number;
  height: number;
}

export interface ExportLoopOptions {
  /** Per-frame upload timeout. Defaults to 15 seconds. */
  frameTimeoutMs?: number;
  /** Retries for network errors and timeouts (not HTTP 400/409). Defaults to 2. */
  maxRetries?: number;
}

class ExportHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ExportHttpError';
    this.status = status;
  }
}

/**
 * Renders every frame sequentially, reads back raw RGBA pixels via gl.readPixels,
 * streams each frame to POST /api/frame/:n, and signals completion with POST /api/done.
 *
 * Any fatal error is reported to POST /api/error before being rethrown, so the
 * Node-side export watchdog can kill ffmpeg and remove the partial output.
 */
export async function runExportLoop(
  renderFrameAt: (n: number) => Promise<void>,
  gl: WebGL2RenderingContext,
  plan: ExportLoopPlan,
  options: ExportLoopOptions = {}
): Promise<void> {
  const byteLength = plan.width * plan.height * 4;
  const pixels = new Uint8Array(byteLength);
  const frameTimeoutMs = options.frameTimeoutMs ?? 15_000;
  const maxRetries = options.maxRetries ?? 2;

  let currentFrame = 0;

  const postFrame = async (n: number): Promise<void> => {
    let attempt = 0;

    while (true) {
      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | null = null;

      try {
        timeout = setTimeout(() => controller.abort(), frameTimeoutMs);
        const res = await fetch(`/api/frame/${n}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: pixels,
          signal: controller.signal,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          // HTTP 400/409 are deterministic protocol errors; never resend the
          // same frame. Other statuses are also unsafe to retry because the
          // server may already have accepted the frame before the response
          // was lost.
          throw new ExportHttpError(
            res.status,
            `POST /api/frame/${n} failed (${res.status}): ${errText}`
          );
        }

        await res.arrayBuffer();
        return;
      } catch (err) {
        if (err instanceof ExportHttpError) {
          throw err;
        }

        if (attempt >= maxRetries) {
          throw err;
        }

        attempt++;
        await new Promise<void>((resolve) => setTimeout(resolve, 200 * attempt));
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
  };

  try {
    for (let n = 0; n < plan.frameCount; n++) {
      currentFrame = n;
      await renderFrameAt(n);
      gl.finish();
      gl.readPixels(0, 0, plan.width, plan.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      await postFrame(n);

      if (n > 0 && n % 15 === 0) {
        await new Promise<void>((r) => setTimeout(r, 0));
      }
    }

    const doneRes = await fetch('/api/done', { method: 'POST' });
    if (!doneRes.ok) {
      const errText = await doneRes.text().catch(() => '');
      throw new ExportHttpError(
        doneRes.status,
        `POST /api/done failed (${doneRes.status}): ${errText}`
      );
    }
    await doneRes.arrayBuffer();
  } catch (err) {
    await fetch('/api/error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: String(err), frameIndex: currentFrame }),
    }).catch(() => {});
    throw err;
  }
}
