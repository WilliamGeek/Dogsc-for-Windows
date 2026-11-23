// Test for: F:\dogsc-win\web\studio\state.ts 7-lane overlay clip mutators

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  moveSubtitleCueById,
  deleteSubtitleCueById,
  moveAnimationClipById,
  deleteAnimationClipById,
  moveAudioClipById,
  deleteAudioClipById,
} from '../../web/studio/state.ts';
import { makeRecorderProject } from '../../src/core/ProjectMediaModel.ts';
import { makeProjectTimeline } from '../../src/core/ProjectTimeline.ts';
import { makeSubtitleCue, makeAudioClip } from '../../src/core/PostProductionModel.ts';
import { makeAnimationClip, makeOverlayTiming } from '../../src/core/OverlayTimeline.ts';
import { ProjectValidator } from '../../src/core/ProjectValidator.ts';

test('T18.6: 7-lane subtitle, animation, and audio clip move/delete mutators clamp cleanly and validate', () => {
  const cue = makeSubtitleCue({ timing: makeOverlayTiming(1.0, 2.0), text: 'Hello' });
  const anim = makeAnimationClip({
    timing: makeOverlayTiming(2.0, 3.0),
    sourcePath: 'builtin://callout',
  });
  const sfx = makeAudioClip({
    timing: makeOverlayTiming(0.5, 1.0),
    sourcePath: 'assets/click.wav',
    kind: 'effect',
    ducksUnderSpeech: true,
  });

  const base = makeRecorderProject({
    timeline: makeProjectTimeline({
      subtitleCues: [cue],
      animationClips: [anim],
      audioClips: [sfx],
    }),
  });

  // Move subtitle past end -> clamped to 10 - 2 = 8
  const mSub = moveSubtitleCueById(base, 10.0, cue.id, 12.5);
  ProjectValidator.validate(mSub.project);
  assert.equal(mSub.project.timeline.subtitleCues[0].timing.startTime, 8.0);
  assert.deepEqual(mSub.selection, { kind: 'subtitle', id: cue.id });

  // Move animation negative -> clamped to 0
  const mAnim = moveAnimationClipById(mSub.project, 10.0, anim.id, -3.0);
  ProjectValidator.validate(mAnim.project);
  assert.equal(mAnim.project.timeline.animationClips[0].timing.startTime, 0);

  // Move audio
  const mAud = moveAudioClipById(mAnim.project, 10.0, sfx.id, 4.2);
  ProjectValidator.validate(mAud.project);
  assert.equal(mAud.project.timeline.audioClips[0].timing.startTime, 4.2);

  // Deletes clear arrays & selection cleanly
  const d1 = deleteSubtitleCueById(mAud.project, cue.id);
  const d2 = deleteAnimationClipById(d1.project, anim.id);
  const d3 = deleteAudioClipById(d2.project, sfx.id);
  ProjectValidator.validate(d3.project);
  assert.equal(d3.project.timeline.subtitleCues.length, 0);
  assert.equal(d3.project.timeline.animationClips.length, 0);
  assert.equal(d3.project.timeline.audioClips.length, 0);
  assert.equal(d3.selection, null);
});
