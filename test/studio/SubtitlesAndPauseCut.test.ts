// Test for: F:\dogsc-win\web\studio\subtitlesPanel.ts & PostProductionModel SRT/normalization

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectSilentIntervals,
  removeSilentIntervalsFromProject,
} from '../../web/studio/subtitlesPanel.ts';
import { SubtitleSRT, SubtitleText } from '../../src/core/PostProductionModel.ts';
import { makeRecorderProject } from '../../src/core/ProjectMediaModel.ts';
import { ProjectValidator } from '../../src/core/ProjectValidator.ts';
import { TimelineMap } from '../../src/core/TimelineMap.ts';

test('T18.4: detectSilentIntervals finds padded pauses accurately and honors thresholds', () => {
  // 10s audio across 100 buckets (0.1s per bucket)
  // Speech [0..2.0], Silence [2.0..4.0], Speech [4.0..6.5], Silence [6.5..8.5], Speech [8.5..10.0]
  const peaks: number[] = [];
  for (let i = 0; i < 100; i++) {
    const t = i * 0.1;
    const isSilent = (t >= 2.0 && t < 4.0) || (t >= 6.5 && t < 8.5);
    peaks.push(isSilent ? 0.01 : 0.45);
  }

  const intervals = detectSilentIntervals(peaks, 10.0, {
    threshold: 0.045,
    minPauseSeconds: 0.5,
    keepPaddingSeconds: 0.08,
  });

  assert.equal(intervals.length, 2);
  assert.ok(intervals[0].start > 2.0 && intervals[0].end < 4.0);
  assert.ok(intervals[0].duration >= 1.8 && intervals[0].duration <= 1.9);
  assert.ok(intervals[1].start > 6.5 && intervals[1].end < 8.5);

  // Higher minPauseSeconds filters both out
  const strict = detectSilentIntervals(peaks, 10.0, {
    threshold: 0.045,
    minPauseSeconds: 3.0,
    keepPaddingSeconds: 0.08,
  });
  assert.equal(strict.length, 0);
});

test('T18.4: removeSilentIntervalsFromProject cleanly ripples out silent segments and passes ProjectValidator', () => {
  const initial = makeRecorderProject({ title: 'Pause Cut Test' });
  const result = removeSilentIntervalsFromProject(initial, 10.0, [
    { start: 2.0, end: 4.0 },
    { start: 6.5, end: 8.5 },
  ]);

  ProjectValidator.validate(result);
  const map = new TimelineMap(result.timeline.sourceSequence, 10.0);
  assert.ok(Math.abs(map.outputDuration - 6.0) < 0.05, `Expected ~6s, got ${map.outputDuration}`);
  assert.equal(map.segments.length, 3);
});

test('T18.4: SubtitleSRT roundtrip and SubtitleText.normalized clean cue text accurately', () => {
  const srt = [
    '1',
    '00:00:01,000 --> 00:00:03,200',
    '  嗯   hello ,  world ! ',
    '',
    '2',
    '00:00:04,500 --> 00:00:06,000',
    'Second line',
  ].join('\n');

  const decoded = SubtitleSRT.decode(srt);
  assert.equal(decoded.length, 2);
  const cleaned = SubtitleText.normalized(decoded);
  assert.ok(cleaned.length === 2);
  assert.ok(!cleaned[0].text.includes('   '));

  const encoded = SubtitleSRT.encode(cleaned);
  assert.ok(encoded.includes('00:00:01,000 --> 00:00:03,200'));
});
