/**
 * MediaProbe.ts
 *
 * The single source of truth for a recorded video's duration, frame count,
 * dimensions, frame rate, codec, start time and byte size.
 *
 * This module intentionally uses ffprobe instead of wall-clock timing. A
 * recorder may initialize slowly, so `Date.now()` around ffmpeg's lifecycle is
 * not a valid substitute for the media's actual duration.
 */

import { execFile } from 'node:child_process';

export interface ProbedVideoInfo {
  durationSeconds: number;
  frameCount: number;
  width: number;
  height: number;
  fps: number;
  codecName: string;
  startTimeSeconds: number;
  sizeBytes: number;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumber(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function parseFrameRate(value: unknown): number | null {
  if (typeof value !== 'string' || value.length === 0) {
    const numeric = positiveNumber(value);
    return numeric;
  }

  const parts = value.split('/');
  if (parts.length === 2) {
    const numerator = Number(parts[0]);
    const denominator = Number(parts[1]);
    if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0) {
      const rate = numerator / denominator;
      return Number.isFinite(rate) && rate > 0 ? rate : null;
    }
    return null;
  }

  const numeric = positiveNumber(value);
  return numeric;
}

function describeInvalid(reason: string): Error {
  return new Error(`ffprobe 返回无效视频信息: ${reason}`);
}

/**
 * Parses the JSON emitted by:
 *   ffprobe -v error -select_streams v:0 \
 *     -show_entries format=duration,size \
 *     -show_entries stream=codec_name,width,height,nb_frames,r_frame_rate,avg_frame_rate,start_time \
 *     -of json <file>
 *
 * Throws if there is no video stream, duration is non-positive, dimensions are
 * non-positive, or frame count cannot be established.
 */
export function parseFfprobeJson(stdout: string): ProbedVideoInfo {
  let root: unknown;
  try {
    root = JSON.parse(stdout);
  } catch {
    throw describeInvalid('stdout 不是合法 JSON');
  }

  if (root === null || typeof root !== 'object') {
    throw describeInvalid('JSON 根节点不是对象');
  }

  const record = root as Record<string, unknown>;
  const streams = Array.isArray(record.streams) ? record.streams : [];
  const videoStream = streams.find((stream) => {
    if (stream === null || typeof stream !== 'object') return false;
    return (stream as Record<string, unknown>).codec_type === 'video';
  }) ?? streams[0];

  if (videoStream === null || typeof videoStream !== 'object') {
    throw describeInvalid('没有视频流');
  }

  const stream = videoStream as Record<string, unknown>;
  const format = record.format !== null && typeof record.format === 'object'
    ? record.format as Record<string, unknown>
    : {};

  const durationSeconds =
    positiveNumber(stream.duration) ??
    positiveNumber(format.duration);

  if (durationSeconds === null) {
    throw describeInvalid('duration 为空、非有限数或小于等于 0');
  }

  const width = positiveNumber(stream.width);
  const height = positiveNumber(stream.height);
  if (width === null || height === null) {
    throw describeInvalid('width/height 为空、非有限数或小于等于 0');
  }

  const rawFrameCount = finiteNumber(stream.nb_frames);
  let frameCount = rawFrameCount !== null && rawFrameCount > 0
    ? Math.round(rawFrameCount)
    : 0;

  let fps =
    parseFrameRate(stream.r_frame_rate) ??
    parseFrameRate(stream.avg_frame_rate);

  if (fps === null && frameCount > 0) {
    fps = frameCount / durationSeconds;
  }

  if (fps === null || !Number.isFinite(fps) || fps <= 0) {
    throw describeInvalid('r_frame_rate/avg_frame_rate 无法解析');
  }

  if (frameCount <= 0) {
    frameCount = Math.round(durationSeconds * fps);
  }

  if (frameCount <= 0 || !Number.isFinite(frameCount)) {
    throw describeInvalid('frameCount 无法确定');
  }

  const startTimeSeconds =
    finiteNumber(stream.start_time) ??
    finiteNumber(format.start_time) ??
    0;

  const sizeBytes = finiteNumber(format.size) ?? 0;

  return {
    durationSeconds,
    frameCount,
    width: Math.round(width),
    height: Math.round(height),
    fps,
    codecName: typeof stream.codec_name === 'string' ? stream.codec_name : '',
    startTimeSeconds,
    sizeBytes,
  };
}

/**
 * Runs ffprobe with a hard 10s timeout and returns the parsed video info.
 * Failure is fatal: callers must never fall back to wall-clock timing.
 */
export function probeMediaFile(filePath: string): Promise<ProbedVideoInfo> {
  const args = [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'format=duration,size',
    '-show_entries', 'stream=codec_name,width,height,nb_frames,r_frame_rate,avg_frame_rate,start_time',
    '-of', 'json',
    filePath,
  ];

  return new Promise((resolve, reject) => {
    execFile(
      'ffprobe',
      args,
      { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const detail = (stderr || error.message || '').trim().slice(-500);
          reject(new Error(`ffprobe 读取失败 (${filePath}): ${detail || '未知错误'}`));
          return;
        }

        try {
          resolve(parseFfprobeJson(stdout));
        } catch (parseError) {
          reject(parseError);
        }
      }
    );
  });
}
