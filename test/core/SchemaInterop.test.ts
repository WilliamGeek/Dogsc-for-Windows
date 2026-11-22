// Gate G3: Schema v27 <-> v28 Bi-Directional Golden Fixture Interop Tests
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  decodeRecorderProject,
  encodeRecorderProject,
} from '../../src/core/ProjectMediaModel.ts';
import {
  ProjectSchema,
  ProjectSchemaError,
} from '../../src/core/ProjectModel.ts';
import {
  ProjectValidationError,
  ProjectValidator,
} from '../../src/core/ProjectValidator.ts';
import { recordingMarkerResolvedSourceID } from '../../src/core/RecordingMarker.ts';
import { RecordingSourcePrimaryID } from '../../src/core/RecordingSource.ts';
import { insertedMediaHasEmbeddedAudio } from '../../src/core/ProjectTimeline.ts';

const fixtureDir = path.resolve(import.meta.dirname, '..', 'fixtures', 'schema');

function readFixtureJSON(filename: string): Record<string, any> {
  return JSON.parse(readFileSync(path.join(fixtureDir, filename), 'utf8')) as Record<string, any>;
}

test('G3: v27 Golden Fixture migrates to v28, passes validation and preserves unknown fields losslessly', () => {
  const rawV27 = readFixtureJSON('v27_single_recording.json');
  const decoded = decodeRecorderProject(rawV27);

  assert.equal(decoded.version, 28);
  assert.equal(decoded.cursorStyle.pressesOnClick, true);
  assert.equal(decoded.cursorStyle.clickColor?.rgb24, 0xff5500);
  assert.equal(decoded.canvas.borderColor.rgb24, 0xffffff);
  assert.deepEqual(decoded.camera.beauty, { smoothing: 0, whitening: 0 });
  assert.equal(decoded.exportSettings.videoCodec, null);
  assert.equal(decoded.exportSettings.quality, 'high');
  assert.equal(decoded.additionalSources.length, 0);
  assert.equal(decoded.recordingMarkers[0].sourceID, null);
  assert.equal(
    recordingMarkerResolvedSourceID(decoded.recordingMarkers[0]),
    RecordingSourcePrimaryID,
  );
  assert.equal(decoded.timeline.stickerClips[0].borderColor.rgb24, 0xeeeeee);

  assert.doesNotThrow(() => ProjectValidator.validate(decoded));

  const encoded = encodeRecorderProject(decoded);
  const parsedOut = JSON.parse(encoded) as Record<string, any>;
  assert.equal(parsedOut.version, 28);
  // Single-recording payload omits empty additionalSources per Swift ProjectMediaModel.swift L295
  assert.equal(Object.hasOwn(parsedOut, 'additionalSources'), false);
  // Unknown top-level fields survive decode -> encode lossless roundtrip
  assert.deepEqual(parsedOut.futurePluginMeta, {
    owner: 'upstream-v0.2.x',
    enabled: true,
  });

  // Subsequent decode -> encode is strictly idempotent
  const encodedAgain = encodeRecorderProject(decodeRecorderProject(encoded));
  assert.equal(encodedAgain, encoded);
});

test('G3: v27 legacy appearance freeze runs only for decodedVersion < 28 (idempotent at v28)', () => {
  const basePayload = readFixtureJSON('v28_multisource_full.json');
  // Strip screenAppearance from additionalSources[0] and InsertedMedia segment
  basePayload.additionalSources[0].screenAppearance = null;
  basePayload.timeline.sourceSequence.segments[2].media.screenAppearance = null;

  // When saved at v27, decode freezes top-level canvas appearance onto them
  const fromV27 = decodeRecorderProject({ ...structuredClone(basePayload), version: 27 });
  assert.equal(fromV27.additionalSources[0].screenAppearance?.cornerRadius, 24);
  assert.equal(fromV27.additionalSources[0].screenAppearance?.screenFrame, 'browserLight');
  if (fromV27.timeline.sourceSequence.kind === 'edited') {
    assert.equal(
      fromV27.timeline.sourceSequence.segments[2].media?.screenAppearance?.cornerRadius,
      24,
    );
  }

  // When already at v28, decode leaves explicit null screenAppearance untouched
  const fromV28 = decodeRecorderProject({ ...structuredClone(basePayload), version: 28 });
  assert.equal(fromV28.additionalSources[0].screenAppearance, null);
  if (fromV28.timeline.sourceSequence.kind === 'edited') {
    assert.equal(fromV28.timeline.sourceSequence.segments[2].media?.screenAppearance, null);
  }
});

test('G3: v28 Multi-Source Golden Fixture roundtrips cleanly with full fidelity and idempotency', () => {
  const rawV28 = readFixtureJSON('v28_multisource_full.json');
  const decoded = decodeRecorderProject(rawV28);

  assert.doesNotThrow(() => ProjectValidator.validate(decoded));

  assert.equal(decoded.version, 28);
  assert.equal(decoded.canvas.aspectRatio, '1:2.39');
  assert.equal(decoded.canvas.borderColor.rgb24, 0x224466);
  assert.ok(Math.abs(decoded.camera.beauty.smoothing - 0.45) < 1e-9);
  assert.ok(Math.abs(decoded.camera.beauty.whitening - 0.25) < 1e-9);
  assert.equal(decoded.cursorStyle.pressesOnClick, false);
  assert.equal(decoded.exportSettings.videoCodec, 'hevc');
  assert.equal(decoded.exportSettings.quality, 'maximum');

  // Additional source & screenAppearance
  assert.equal(decoded.additionalSources.length, 1);
  assert.equal(decoded.additionalSources[0].colorIndex, 1);
  assert.equal(
    decoded.additionalSources[0].screenAppearance?.screenFrame,
    'devicePhonePortrait',
  );
  assert.equal(
    decoded.additionalSources[0].screenAppearance?.borderColor.rgb24,
    0xaabbcc,
  );

  // Source-aware markers
  assert.equal(decoded.recordingMarkers.length, 2);
  assert.equal(
    recordingMarkerResolvedSourceID(decoded.recordingMarkers[0]),
    RecordingSourcePrimaryID,
  );
  assert.equal(
    recordingMarkerResolvedSourceID(decoded.recordingMarkers[1]),
    'AAAAAAAA-1111-2222-3333-BBBBBBBBBBBB',
  );

  // Edited source sequence segments (primary, extra with sceneStyle+crop, InsertedMedia)
  assert.equal(decoded.timeline.sourceSequence.kind, 'edited');
  if (decoded.timeline.sourceSequence.kind === 'edited') {
    const segs = decoded.timeline.sourceSequence.segments;
    assert.equal(segs.length, 3);
    assert.equal(segs[0].resolvedSourceID, RecordingSourcePrimaryID);
    assert.equal(segs[1].resolvedSourceID, 'AAAAAAAA-1111-2222-3333-BBBBBBBBBBBB');
    assert.equal(segs[1].crop?.width, 0.8);
    assert.equal(segs[1].sceneStyle?.camera.isHidden, true);
    assert.equal(segs[1].sceneStyle?.presetName, 'Phone Card');

    const inserted = segs[2].media;
    assert.ok(inserted);
    assert.equal(inserted.motionPath, 'motions/intro.dmhtml');
    assert.equal(insertedMediaHasEmbeddedAudio(inserted), true);
    assert.equal(inserted.properties.title.kind, 'string');
    assert.equal(inserted.properties.title.value, 'Release 0.2.0');
    assert.equal(inserted.elementEdits.badge.fontWeight, 700);
    assert.equal(inserted.screenAppearance?.borderColor.rgb24, 0x336699);
  }

  // Post-production tracks
  assert.equal(decoded.timeline.animationClips.length, 1);
  assert.equal(decoded.timeline.animationClips[0].soundtrack?.path, 'audio/pop.wav');
  assert.equal(decoded.timeline.audioClips.length, 1);
  assert.equal(decoded.timeline.videoClips.length, 1);
  assert.equal(decoded.timeline.subtitleCues[0].secondaryText, '欢迎使用');
  assert.equal(decoded.timeline.subtitleStyle.font, 'rounded');
  assert.equal(decoded.timeline.mediaAssets[0].kind, 'animation');

  // Encode -> decode -> encode strict idempotency
  const enc1 = encodeRecorderProject(decoded);
  const dec2 = decodeRecorderProject(enc1);
  const enc2 = encodeRecorderProject(dec2);
  assert.equal(enc2, enc1);
});

test('G3: Schema boundary & dangling source validation enforce fail-closed contracts', () => {
  assert.throws(
    () => ProjectSchema.validateForDecoding(22),
    (err: any) => err instanceof ProjectSchemaError && err.code === 'unsupportedLegacyVersion',
  );
  assert.throws(
    () => decodeRecorderProject({ version: 29 }),
    (err: any) => err instanceof ProjectSchemaError && err.code === 'unsupportedFutureVersion',
  );

  const dangling = readFixtureJSON('v28_multisource_full.json');
  dangling.additionalSources = [];
  const decodedDangling = decodeRecorderProject(dangling);
  assert.throws(
    () => ProjectValidator.validate(decodedDangling),
    (err: any) => err instanceof ProjectValidationError && err.kind === 'invalidTimeline',
  );
});
