// Test for: F:\dogsc-win\src\render\SoundSynth.ts, AudioMixPlan.ts ducking, MediaAssetsService.ts, StudioServer routes

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  SOUND_EFFECT_PRESETS,
  synthesizeSoundEffectWav,
} from '../../src/render/SoundSynth.ts';
import {
  buildAudioOnlyM4aArgs,
  buildDuckingVolumeFilter,
  extractSpeechIntervals,
} from '../../src/render/AudioMixPlan.ts';
import { parseWavPcm16Peaks } from '../../src/server/MediaAssetsService.ts';
import { startStudioServer } from '../../src/server/StudioServer.ts';
import { encodeRecorderProject, makeRecorderProject } from '../../src/core/ProjectMediaModel.ts';
import { makeSubtitleCue } from '../../src/core/PostProductionModel.ts';
import { makeOverlayTiming } from '../../src/core/OverlayTimeline.ts';
import { makeProjectTimeline } from '../../src/core/ProjectTimeline.ts';

test('T18.3: SoundSynth synthesizes all 5 presets as valid non-silent 48kHz stereo PCM WAV buffers', () => {
  assert.equal(SOUND_EFFECT_PRESETS.length, 5);

  for (const preset of SOUND_EFFECT_PRESETS) {
    const wav = synthesizeSoundEffectWav(preset.id);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.toString('ascii', 12, 16), 'fmt ');
    assert.equal(wav.readUInt16LE(22), 2); // stereo
    assert.equal(wav.readUInt32LE(24), 48000);
    assert.equal(wav.readUInt16LE(34), 16);

    const parsed = parseWavPcm16Peaks(wav, 32);
    assert.ok(parsed);
    assert.ok(Math.abs(parsed.durationSeconds - preset.durationSeconds) < 0.02);
    const maxPeak = Math.max(...parsed.peaks);
    assert.ok(maxPeak > 0.05, `Preset ${preset.id} had near-silent peak ${maxPeak}`);
  }
});

test('T18.3: extractSpeechIntervals merges adjacent cues and buildDuckingVolumeFilter builds real FFmpeg M4A encode', async () => {
  const proj = makeRecorderProject({
    timeline: makeProjectTimeline({
      subtitleCues: [
        makeSubtitleCue({ timing: makeOverlayTiming(0.5, 0.4), text: 'First' }),
        makeSubtitleCue({ timing: makeOverlayTiming(1.0, 0.5), text: 'Second' }),
      ],
    }),
  });
  const encoded = JSON.parse(encodeRecorderProject(proj));
  const intervals = extractSpeechIntervals(encoded, { paddingSeconds: 0.1, mergeGapSeconds: 0.25 });
  assert.equal(intervals.length, 1);
  assert.ok(intervals[0].start <= 0.41 && intervals[0].end >= 1.59);

  const filter = buildDuckingVolumeFilter(0.8, intervals, 0.25);
  assert.ok(filter.includes("volume='if(gt("));
  assert.ok(filter.includes('between(t,'));
  assert.ok(filter.includes(':eval=frame'));

  // Run real ffmpeg M4A encode with speech ducking active
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dogsc-duck-'));
  try {
    const bgmPath = path.join(tmpDir, 'bgm.wav');
    const outM4a = path.join(tmpDir, 'ducked.m4a');
    await fs.writeFile(bgmPath, synthesizeSoundEffectWav('chime'));

    const args = buildAudioOnlyM4aArgs(
      [
        {
          path: bgmPath,
          kind: 'clip',
          volume: 0.8,
          timelineStart: 0,
          ducksUnderSpeech: true,
        },
      ],
      outM4a,
      { durationSeconds: 2.0, speechIntervals: intervals }
    );
    assert.ok(args);
    execFileSync('ffmpeg', args, { windowsHide: true });

    const stat = await fs.stat(outM4a);
    assert.ok(stat.size > 1000);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('T18.3: StudioServer assets upload, SoundSynth /sfx, waveform peaks, and recording merge work end-to-end', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dogsc-assets-srv-'));
  const recDir = path.join(tmpDir, 'recordings');
  const s1Dir = path.join(recDir, '20261123-190001');
  const s2Dir = path.join(recDir, '20261123-190002');
  await fs.mkdir(path.join(s1Dir, 'frames'), { recursive: true });
  await fs.mkdir(path.join(s2Dir, 'frames'), { recursive: true });

  await fs.writeFile(
    path.join(s1Dir, 'meta.json'),
    JSON.stringify({ id: '20261123-190001', fps: 30, width: 1280, height: 720, durationSeconds: 4 })
  );
  await fs.writeFile(
    path.join(s1Dir, 'project.json'),
    encodeRecorderProject(makeRecorderProject({ title: 'Target Recording' }))
  );
  await fs.writeFile(path.join(s1Dir, 'mic-audio.wav'), synthesizeSoundEffectWav('ding'));

  await fs.writeFile(
    path.join(s2Dir, 'meta.json'),
    JSON.stringify({ id: '20261123-190002', fps: 30, width: 1280, height: 720, durationSeconds: 3 })
  );
  await fs.writeFile(
    path.join(s2Dir, 'project.json'),
    encodeRecorderProject(makeRecorderProject({ title: 'Second Recording' }))
  );

  const rootDir = path.resolve(import.meta.dirname, '..', '..');
  const handle = await startStudioServer({
    rootDir,
    recordingsDir: recDir,
    aiSettingsFilePath: path.join(tmpDir, 'ai-settings.json'),
    allowShellOpen: false,
  });

  const baseUrl = handle.url.replace('/web/studio.html', '');
  try {
    // 1. Waveform peaks from mic-audio.wav
    const wfRes = await fetch(`${baseUrl}/api/recordings/20261123-190001/waveform?samples=64`);
    assert.equal(wfRes.status, 200);
    const wfJson = (await wfRes.json()) as any;
    assert.equal(wfJson.hasAudio, true);
    assert.equal(wfJson.peaks.length, 64);
    assert.ok(Math.max(...wfJson.peaks) > 0.1);

    // 2. Upload wallpaper image asset & retrieve via GET /recordings/:id/assets/...
    const png1x1Base64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const upRes = await fetch(`${baseUrl}/api/recordings/20261123-190001/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'wallpaper.png',
        base64Data: png1x1Base64,
        applyAsWallpaper: true,
      }),
    });
    assert.equal(upRes.status, 200);
    const upJson = (await upRes.json()) as any;
    assert.equal(upJson.project.canvas.backgroundSource.kind, 'projectImage');
    const relImg = upJson.project.canvas.backgroundSource.relativePath;
    const fetchAsset = await fetch(`${baseUrl}/recordings/20261123-190001/${relImg}`);
    assert.equal(fetchAsset.status, 200);
    assert.equal(fetchAsset.headers.get('content-type'), 'image/png');

    // 3. Synthesize SoundSynth SFX into project
    const sfxRes = await fetch(`${baseUrl}/api/recordings/20261123-190001/sfx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: 'whoosh', startTime: 1.2 }),
    });
    assert.equal(sfxRes.status, 200);
    const sfxJson = (await sfxRes.json()) as any;
    assert.equal(sfxJson.project.timeline.audioClips.length, 1);
    assert.equal(sfxJson.project.timeline.audioClips[0].kind, 'effect');

    // 4. Merge second recording into first recording
    const mergeRes = await fetch(`${baseUrl}/api/recordings/20261123-190001/merge-recording`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceRecordingId: '20261123-190002' }),
    });
    assert.equal(mergeRes.status, 200);
    const mergeJson = (await mergeRes.json()) as any;
    assert.equal(mergeJson.project.additionalSources.length, 1);
    assert.equal(mergeJson.project.timeline.sourceSequence.kind, 'edited');
    assert.equal(mergeJson.project.timeline.sourceSequence.segments.length, 2);
  } finally {
    await handle.close();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});
