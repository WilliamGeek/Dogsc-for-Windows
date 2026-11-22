import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHexColor } from '../../src/core/HexColor.ts';
import { makeOverlayTiming } from '../../src/core/OverlayTimeline.ts';
import {
  MediaAsset,
  MediaAssetKind,
  SUBTITLE_TEXT_MAX_UNITS,
  SubtitleSRT,
  SubtitleStyle,
  SubtitleText,
  audioClipFromJSON,
  audioClipMatchesCompositionStructure,
  makeAudioClip,
  makeMediaAsset,
  makeSubtitleCue,
  makeSubtitleStyle,
  makeVideoClip,
  mediaAssetDisplayName,
  mediaAssetKindForExtension,
  subtitleStyleFromJSON,
  videoClipFromJSON,
} from '../../src/core/PostProductionModel.ts';

test('MediaAssetKind and MediaAsset displayName strip extensions without node:path per Swift L11-52', () => {
  assert.equal(mediaAssetKindForExtension('MP4'), 'video');
  assert.equal(mediaAssetKindForExtension('heic'), 'image');
  assert.equal(mediaAssetKindForExtension('FLAC'), 'audio');
  assert.equal(mediaAssetKindForExtension('dmhtml'), 'animation');
  assert.equal(MediaAssetKind.kindForExtension('txt'), null);

  const motion = makeMediaAsset({ path: 'F:\\assets\\lower_third.dmhtml', kind: 'animation' });
  assert.equal(motion.name, 'lower_third.dmhtml');
  assert.equal(mediaAssetDisplayName(motion), 'lower_third');

  const dotOnly = makeMediaAsset({ path: '/tmp/.dmhtml', kind: 'animation' });
  assert.equal(MediaAsset.displayName(dotOnly), '.dmhtml');
});

test('VideoClip and AudioClip defaults, JSON decoding and composition matching per Swift L56-109, L216-289', () => {
  const video = makeVideoClip({
    timing: makeOverlayTiming(2, 4),
    sourcePath: 'broll/demo.mp4',
  });
  assert.equal(video.aspect, 9.0 / 16.0);
  assert.equal(video.playbackRate, 1);
  assert.deepEqual(video.position, { x: 0.5, y: 0.5 });

  const decodedVideo = videoClipFromJSON({
    id: 'V-1',
    timing: { startTime: 1, duration: 5 },
    sourcePath: 'clip.mov',
    position: { x: 0.2, y: 0.8 },
    width: 0.4,
    aspect: 1.5,
    opacity: 0.9,
    volume: 0.5,
    layerIndex: 2,
    mainTrackStyle: {
      usesFrameStyle: true,
      screenAppearance: { cornerRadius: 20 },
    },
  });
  assert.equal(decodedVideo.playbackRate, 1);
  assert.equal(decodedVideo.mainTrackStyle?.usesFrameStyle, true);
  assert.equal(decodedVideo.mainTrackStyle?.screenAppearance?.cornerRadius, 20);

  const music = makeAudioClip({ timing: makeOverlayTiming(0, 10), sourcePath: 'bgm.mp3' });
  assert.equal(music.kind, 'music');
  assert.equal(music.ducksUnderSpeech, true);
  assert.equal(music.lane, 0);
  assert.equal(music.fadeIn, 0.5);
  assert.equal(music.fadeOut, 1);

  // Swift AudioClip init(from:) uses 0 default for absent fadeIn/fadeOut.
  const fxFromJson = audioClipFromJSON({
    id: 'A-1',
    timing: { startTime: 3, duration: 2 },
    sourcePath: 'pop.wav',
    kind: 'effect',
  });
  assert.equal(fxFromJson.fadeIn, 0);
  assert.equal(fxFromJson.fadeOut, 0);
  assert.equal(fxFromJson.ducksUnderSpeech, false);
  assert.equal(fxFromJson.lane, 1);

  const fxMixOnlyDiff = makeAudioClip({
    ...fxFromJson,
    volume: 0.2,
    isMuted: true,
    fadeIn: 0.3,
  });
  assert.equal(audioClipMatchesCompositionStructure(fxFromJson, fxMixOnlyDiff), true);
  assert.equal(
    audioClipMatchesCompositionStructure(fxFromJson, { ...fxFromJson, sourceStart: 0.01 }),
    false,
  );
});

test('SubtitleStyle, SubtitleText cleanup/censorship and SubtitleSRT roundtrip per Swift L314-506', () => {
  assert.equal(SubtitleStyle.legacyDefault.fontScale, 0.045);
  assert.equal(SubtitleStyle.legacyDefault.entrance, 'fade');
  const styleJson = subtitleStyleFromJSON({ textColor: '#112233', bold: false });
  assert.equal(styleJson.textColor.rgb24, makeHexColor(0x112233).rgb24);
  assert.equal(styleJson.bold, false);
  assert.equal(styleJson.fontScale, makeSubtitleStyle().fontScale);

  // Units: ASCII counts 0.5, non-ASCII counts 1.
  // Hand calc: "Hi中国" => 2*0.5 + 2*1 = 3.0
  assert.equal(SUBTITLE_TEXT_MAX_UNITS, 16);
  assert.equal(SubtitleText.units('Hi中国'), 3);

  // Commas between numbers preserved (Swift L398), fillers & trailing punct removed in clean()
  assert.equal(SubtitleText.clean('呃，1,000，测试一下，啊。'), '1,000 测试一下');
  assert.equal(SubtitleText.clean('呃，1,000，测试一下啊'), '1,000 测试一下');
  // speechDisplay retains fillers while censoring profanity
  assert.equal(SubtitleText.speechDisplay('呃，他妈的 what the fuck。'), '呃 TM what the');

  // Split-token profanity censorship (Swift L418-443)
  assert.deepEqual(SubtitleText.censoredSpeechTokens(['fu', 'ck', ' it']), [' ', '', ' it']);
  assert.deepEqual(SubtitleText.censoredSpeechTokens(['他', '妈的', '屎壳郎']), [
    'TM',
    '',
    '屎壳郎',
  ]);
  assert.deepEqual(SubtitleText.censoredSpeechTokens([]), []);

  // Preserving numeric notation
  assert.equal(
    SubtitleText.preservingNumericNotation('upgrade to 0 点 2 point 0 now', 'recorded on 0.2.0 build'),
    'upgrade to 0.2.0 now',
  );

  // Empty cues dropped after normalization
  const norm = SubtitleText.normalized([
    makeSubtitleCue({ timing: makeOverlayTiming(0, 1), text: '嗯。' }),
    makeSubtitleCue({ timing: makeOverlayTiming(1, 2), text: 'Hello，world！', secondaryText: '啊' }),
  ]);
  assert.equal(norm.length, 1);
  assert.equal(norm[0].text, 'Hello world');
  assert.equal(norm[0].secondaryText, null);

  // SRT encode / decode roundtrip (Hand calc: 3661.045s = 01:01:01,045)
  assert.equal(SubtitleSRT.stamp(3661.045), '01:01:01,045');
  assert.equal(SubtitleSRT.seconds('01:01:01,045'), 3661.045);

  const srt = SubtitleSRT.encode([
    makeSubtitleCue({ timing: makeOverlayTiming(1.5, 2.25), text: 'Line 1' }),
    makeSubtitleCue({ timing: makeOverlayTiming(0, 1), text: 'Intro', secondaryText: '开场' }),
  ]);
  const decoded = SubtitleSRT.decode(srt);
  assert.equal(decoded.length, 2);
  assert.equal(decoded[0].text, 'Intro');
  assert.equal(decoded[0].timing.startTime, 0);
  assert.ok(Math.abs(decoded[1].timing.startTime - 1.5) < 1e-9);
  assert.ok(Math.abs(decoded[1].timing.duration - 2.25) < 1e-9);
  assert.equal(SubtitleSRT.decode('invalid\nno arrow\n').length, 0);
});
