// Test for: F:\dogsc-win\src\render\AudioMixPlan.ts & ExportServer audio mux

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import {
  buildAtempoFilterChain,
  buildAudioMixFilterGraph,
  buildAudioOnlyM4aArgs,
  buildSessionAudioTracks,
  extractAudioSourceSlices,
} from '../../src/render/AudioMixPlan.ts';
import { buildExportFfmpegArgs } from '../../src/server/ExportServer.ts';

const execFileAsync = promisify(execFile);

test('T15.5: buildAtempoFilterChain decomposes extreme playback rates into [0.5, 2.0] stages', () => {
  assert.equal(buildAtempoFilterChain(1), 'anull');
  assert.equal(buildAtempoFilterChain(0.5), 'atempo=0.5');
  assert.equal(buildAtempoFilterChain(2), 'atempo=2.0');
  assert.equal(buildAtempoFilterChain(0.25), 'atempo=0.5,atempo=0.5');
  assert.equal(buildAtempoFilterChain(4), 'atempo=2.0,atempo=2.0');
  assert.equal(buildAtempoFilterChain(10), 'atempo=2.0,atempo=2.0,atempo=2.0,atempo=1.25');

  const chain25 = buildAtempoFilterChain(25).split(',');
  for (const part of chain25) {
    const val = Number(part.replace('atempo=', ''));
    assert.ok(val >= 0.5 && val <= 2.0, `atempo stage out of bounds: ${part}`);
  }
});

test('T15.5: buildSessionAudioTracks honors mute, volumes, meta offsets, and audioClips', () => {
  const existing = new Set(['system-audio.wav', 'mic-audio.wav', 'bgm.mp3']);
  const tracks = buildSessionAudioTracks({
    recDir: 'F:\\fake-rec',
    meta: {
      systemAudioOffsetSeconds: 0.12,
      micAudioOffsetSeconds: -0.05,
    },
    project: {
      audio: {
        isSystemMuted: false,
        systemVolume: 0.7,
        isMicrophoneMuted: true,
        microphoneVolume: 0.9,
      },
      timeline: {
        audioClips: [
          {
            sourcePath: 'bgm.mp3',
            sourceStart: 1.5,
            volume: 0.4,
            isMuted: false,
            fadeIn: 0.5,
            fadeOut: 1.0,
            playbackRate: 1.25,
            timing: { startTime: 2.0, duration: 8.0 },
          },
          {
            sourcePath: 'missing.wav',
            volume: 1.0,
            timing: { startTime: 0, duration: 3 },
          },
        ],
      },
    },
    existingFiles: existing,
  });

  assert.equal(tracks.length, 3);
  assert.equal(tracks[0].kind, 'system');
  assert.equal(tracks[0].isMuted, false);
  assert.equal(tracks[0].volume, 0.7);
  assert.equal(tracks[0].offsetSeconds, 0.12);

  assert.equal(tracks[1].kind, 'microphone');
  assert.equal(tracks[1].isMuted, true);

  assert.equal(tracks[2].kind, 'clip');
  assert.equal(tracks[2].timelineStart, 2.0);
  assert.equal(tracks[2].sourceStart, 1.5);
  assert.equal(tracks[2].fadeIn, 0.5);
  assert.equal(tracks[2].fadeOut, 1.0);
  assert.equal(tracks[2].playbackRate, 1.25);

  const slices = extractAudioSourceSlices(
    {
      timeline: {
        sourceSequence: {
          kind: 'edited',
          segments: [
            { sourceStart: 0, sourceDuration: 2, playbackRate: 1, media: null },
            { sourceStart: 0, sourceDuration: 1, playbackRate: 1, media: { path: 'intro.mp4' } },
            { sourceStart: 4, sourceDuration: 3, playbackRate: 2, media: null },
          ],
        },
      },
    },
    5
  );
  assert.equal(slices.length, 2);
  assert.equal(slices[1].sourceStart, 4);
  assert.equal(slices[1].playbackRate, 2);
});

test('T15.5: buildAudioMixFilterGraph and buildExportFfmpegArgs emit valid mux filters and preserve legacy args', () => {
  const graph = buildAudioMixFilterGraph(
    [
      {
        path: 'sys.wav',
        kind: 'system',
        offsetSeconds: 0.25,
        volume: 0.8,
        isMuted: false,
      },
      {
        path: 'mic.wav',
        kind: 'microphone',
        offsetSeconds: -0.1,
        volume: 0.95,
        isMuted: false,
      },
      {
        path: 'muted.wav',
        kind: 'clip',
        volume: 1.0,
        isMuted: true,
      },
    ],
    {
      durationSeconds: 5.0,
      videoInputIndex: 0,
    }
  );

  assert.ok(graph);
  assert.deepEqual(graph.inputs, ['sys.wav', 'mic.wav']);
  assert.equal(graph.audioMapLabel, '[aout]');
  assert.ok(graph.filterComplex.includes('[1:a]'));
  assert.ok(graph.filterComplex.includes('adelay=250|250'));
  assert.ok(graph.filterComplex.includes('[2:a]'));
  assert.ok(graph.filterComplex.includes('atrim=start=0.1'));
  assert.ok(graph.filterComplex.includes('amix=inputs=2:duration=longest:normalize=0'));

  const muxArgs = buildExportFfmpegArgs({
    width: 1920,
    height: 1080,
    fps: 60,
    encoder: 'libx264',
    outFile: 'mux.mp4',
    audioInputs: graph.inputs,
    audioFilterComplex: graph.filterComplex,
    audioMapLabel: graph.audioMapLabel,
  });
  assert.ok(muxArgs.includes('-filter_complex'));
  assert.ok(muxArgs.some((a) => a.startsWith('[0:v]vflip[vout];')));
  assert.ok(muxArgs.includes('[vout]'));
  assert.ok(muxArgs.includes('[aout]'));
  assert.ok(muxArgs.includes('aac'));
  assert.ok(muxArgs.includes('-shortest'));

  const legacyArgs = buildExportFfmpegArgs({
    width: 1920,
    height: 1080,
    fps: 60,
    encoder: 'libx264',
    outFile: 'plain.mp4',
  });
  assert.ok(legacyArgs.includes('-vf'));
  assert.ok(legacyArgs.includes('vflip'));
  assert.ok(!legacyArgs.includes('-filter_complex'));
});

test('T15.5: real ffmpeg mixes synthetic system and mic WAV inputs into valid AAC M4A', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dogsc-m4a-mix-'));
  const sysWav = path.join(tmpDir, 'system-audio.wav');
  const micWav = path.join(tmpDir, 'mic-audio.wav');
  const outM4a = path.join(tmpDir, 'export.m4a');

  try {
    await execFileAsync(
      'ffmpeg',
      ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-ac', '2', sysWav],
      { timeout: 15_000 }
    );
    await execFileAsync(
      'ffmpeg',
      ['-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1', '-ac', '2', micWav],
      { timeout: 15_000 }
    );

    const args = buildAudioOnlyM4aArgs(
      [
        { path: sysWav, kind: 'system', offsetSeconds: 0.05, volume: 0.7 },
        { path: micWav, kind: 'microphone', offsetSeconds: 0, volume: 0.9 },
      ],
      outM4a,
      { durationSeconds: 1.0 }
    );
    assert.ok(args);
    await execFileAsync('ffmpeg', args, { timeout: 15_000 });

    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-show_entries',
        'stream=codec_name,channels:format=duration',
        '-of',
        'json',
        outM4a,
      ],
      { timeout: 10_000 }
    );
    const probed = JSON.parse(stdout);
    assert.equal(probed.streams[0]?.codec_name, 'aac');
    const dur = Number(probed.format?.duration);
    assert.ok(dur >= 0.85 && dur <= 1.25, `unexpected M4A duration: ${dur}`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
