// Test for: F:\dogsc-win\src\core\ZoomTransitionResolution.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ZoomTransitionResolution,
  zoomAnimationClipRequestedExitDuration,
  zoomAnimationClipPreserveTransitionIntent,
} from '../../src/core/ZoomTransitionResolution.ts';
import {
  makeZoomAnimationClip,
  zoomAnimationClipFromJSON,
} from '../../src/core/ZoomAnimation.ts';

test('T13.5b-2a: transitionIntentVersion 0 legacy automatic sub-frame exit is repaired to defaultTransition', () => {
  const legacyDecoded = zoomAnimationClipFromJSON({
    id: 'legacy-1',
    startTime: 1.0,
    endTime: 3.0,
    origin: 'automatic',
    enterDuration: 0.7,
    exitDuration: 0.01, // < 1/30s legacy clamped window
    preferredExitDuration: 0.01,
  });
  assert.equal(legacyDecoded.transitionIntentVersion, 0);
  assert.equal(zoomAnimationClipRequestedExitDuration(legacyDecoded, 0.7), 0.7);

  const preserved = zoomAnimationClipPreserveTransitionIntent(legacyDecoded, 0.7);
  assert.equal(preserved.transitionIntentVersion, 1);
  assert.equal(preserved.preferredExitDuration, 0.7);

  // Explicit v1 fast exit remains exact
  const fastExplicit = makeZoomAnimationClip({
    id: 'fast-1',
    startTime: 1.0,
    endTime: 3.0,
    origin: 'automatic',
    exitDuration: 0.01,
    preferredExitDuration: 0.01,
    transitionIntentVersion: 1,
  });
  assert.equal(zoomAnimationClipRequestedExitDuration(fastExplicit, 0.7), 0.01);
});

test('T13.5b-2a: resolve drops isolated sub-2-frame automatic entrance fragments and bridges sub-frame automatic gaps', () => {
  const tinyFragment = makeZoomAnimationClip({
    id: 'frag',
    startTime: 0.5,
    endTime: 0.52, // 0.02s < 1/30s (0.0333s)
    origin: 'automatic',
    enterDuration: 0.7,
    enterProgressOffset: 0,
  });
  const a = makeZoomAnimationClip({
    id: 'a',
    startTime: 2.0,
    endTime: 4.0,
    origin: 'automatic',
    enterDuration: 0.5,
    exitDuration: 0.5,
  });
  const b = makeZoomAnimationClip({
    id: 'b',
    startTime: 4.01, // 0.01s < 1/60s gap after a
    endTime: 6.0,
    origin: 'automatic',
    enterDuration: 0.5,
    exitDuration: 0.5,
  });

  const resolved = ZoomTransitionResolution.resolve([tinyFragment, a, b], 10.0);
  assert.equal(resolved.length, 2);
  assert.equal(resolved[0].id, 'a');
  assert.equal(resolved[0].endTime, 4.01);
  assert.equal(resolved[0].exitDuration, 0);
  assert.equal(resolved[1].id, 'b');
});
