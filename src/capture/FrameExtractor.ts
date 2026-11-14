/**
 * FrameExtractor.ts
 *
 * Pre-decodes source screen recording MP4 into sequential JPEG frames (%06d.jpg)
 * using ffmpeg. Strictly adheres to docs/CONTRACTS.md §4.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface FrameExtractorOptions {
  video: string;
  outDir: string;
  fps: number;
}

/**
 * Pure function: constructs the command-line arguments for ffmpeg frame extraction.
 * Frame files are 1-based sequential JPEGs (%06d.jpg) per CONTRACTS §4.
 */
export function buildExtractArgs(i: FrameExtractorOptions): string[] {
  const fps = i.fps > 0 ? i.fps : 60;
  const outPattern = path.resolve(i.outDir, '%06d.jpg');

  return [
    '-y',
    '-i',
    i.video,
    '-vf',
    `fps=${fps}`,
    '-q:v',
    '2',
    outPattern,
  ];
}

/**
 * Executes ffmpeg to extract frames from a video file into outDir.
 * Returns the total count of extracted frame files.
 */
export async function extractFrames(i: FrameExtractorOptions): Promise<number> {
  await fs.mkdir(i.outDir, { recursive: true });
  const args = buildExtractArgs(i);

  return new Promise<number>((resolve, reject) => {
    const proc = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`ffmpeg frame extraction timed out after 120s:\n${stderr}`));
    }, 120000);

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on('close', async (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`ffmpeg exited with code ${code}:\n${stderr}`));
      }

      try {
        const files = await fs.readdir(i.outDir);
        const frameFiles = files.filter((f) => /^\d{6}\.jpg$/.test(f));
        resolve(frameFiles.length);
      } catch (err) {
        reject(err);
      }
    });
  });
}
