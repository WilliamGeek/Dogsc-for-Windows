/**
 * src/render/SoundSynth.ts
 *
 * Pure Node Buffer 48kHz stereo 16-bit RIFF/WAVE procedural SFX synthesizer.
 * Windows counterpart of macOS SoundSynth built-in studio sound effects (`click`, `whoosh`, `pop`, `chime`, `ding`).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type SoundEffectPresetId = 'click' | 'whoosh' | 'pop' | 'chime' | 'ding';

export interface SoundEffectPresetInfo {
  id: SoundEffectPresetId;
  label: string;
  durationSeconds: number;
  description: string;
}

export const SOUND_EFFECT_PRESETS: readonly SoundEffectPresetInfo[] = Object.freeze([
  {
    id: 'click',
    label: '点击 Click',
    durationSeconds: 0.08,
    description: '清脆界面微交互按键点击声',
  },
  {
    id: 'whoosh',
    label: '划过 Whoosh',
    durationSeconds: 0.36,
    description: '镜头切换与卡片滑入风声转场',
  },
  {
    id: 'pop',
    label: '弹出 Pop',
    durationSeconds: 0.14,
    description: '气泡标注与重点提示弹出音效',
  },
  {
    id: 'chime',
    label: '提示音 Chime',
    durationSeconds: 0.65,
    description: '温暖双音泛音强调提示',
  },
  {
    id: 'ding',
    label: '叮咚 Ding',
    durationSeconds: 0.55,
    description: '清亮高音确认铃声',
  },
]);

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const BITS_PER_SAMPLE = 16;

function encodeStereoWavPcm16(samplesLeft: Float32Array, samplesRight?: Float32Array): Buffer {
  const frameCount = samplesLeft.length;
  const right = samplesRight ?? samplesLeft;
  const dataBytes = frameCount * CHANNELS * (BITS_PER_SAMPLE / 8);
  const buf = Buffer.allocUnsafe(44 + dataBytes);

  buf.write('RIFF', 0, 4, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 4, 'ascii');
  buf.write('fmt ', 12, 4, 'ascii');
  buf.writeUInt32LE(16, 16); // PCM subchunk size
  buf.writeUInt16LE(1, 20); // PCM format = 1
  buf.writeUInt16LE(CHANNELS, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8), 28);
  buf.writeUInt16LE(CHANNELS * (BITS_PER_SAMPLE / 8), 32);
  buf.writeUInt16LE(BITS_PER_SAMPLE, 34);
  buf.write('data', 36, 4, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);

  let offset = 44;
  for (let i = 0; i < frameCount; i++) {
    const sl = Math.max(-1, Math.min(1, samplesLeft[i]));
    const sr = Math.max(-1, Math.min(1, right[i]));
    buf.writeInt16LE(Math.round(sl * 32767), offset);
    buf.writeInt16LE(Math.round(sr * 32767), offset + 2);
    offset += 4;
  }
  return buf;
}

export function synthesizeSoundEffectWav(preset: SoundEffectPresetId): Buffer {
  const meta = SOUND_EFFECT_PRESETS.find((p) => p.id === preset) ?? SOUND_EFFECT_PRESETS[0];
  const n = Math.max(1, Math.round(meta.durationSeconds * SAMPLE_RATE));
  const left = new Float32Array(n);
  const right = new Float32Array(n);

  switch (preset) {
    case 'click': {
      let phase = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const env = Math.exp(-t * 72);
        const freq = 1850 * Math.exp(-t * 48) + 320;
        phase += (2 * Math.PI * freq) / SAMPLE_RATE;
        const transient = i < 64 ? (1 - i / 64) * 0.45 : 0;
        const v = (Math.sin(phase) * env * 0.75 + transient * 0.4) * 0.85;
        left[i] = v;
        right[i] = v;
      }
      break;
    }

    case 'whoosh': {
      // Deterministic PRNG + moving-cutoff lowpass swell
      let seed = 0x13572468;
      let lpL = 0;
      let lpR = 0;
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        const swell = Math.pow(Math.sin(Math.PI * u), 1.5);
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const nL = (seed / 0xffffffff) * 2 - 1;
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const nR = (seed / 0xffffffff) * 2 - 1;
        const alpha = 0.04 + 0.34 * swell;
        lpL = lpL + alpha * (nL - lpL);
        lpR = lpR + alpha * (nR - lpR);
        left[i] = lpL * swell * 0.72;
        right[i] = lpR * swell * 0.72;
      }
      break;
    }

    case 'pop': {
      let phase = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const attack = Math.min(1, t / 0.006);
        const decay = Math.exp(-t * 28);
        const freq = t < 0.045 ? 240 + (640 - 240) * (t / 0.045) : 640 * Math.exp(-(t - 0.045) * 14);
        phase += (2 * Math.PI * freq) / SAMPLE_RATE;
        const v = Math.sin(phase) * attack * decay * 0.85;
        left[i] = v;
        right[i] = v;
      }
      break;
    }

    case 'chime': {
      for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const env1 = Math.min(1, t / 0.008) * Math.exp(-t * 6.5);
        const t2 = Math.max(0, t - 0.11);
        const env2 = t >= 0.11 ? Math.min(1, t2 / 0.008) * Math.exp(-t2 * 5.8) : 0;
        const tone1 = Math.sin(2 * Math.PI * 1046.5 * t) * 0.55 + Math.sin(2 * Math.PI * 2093 * t) * 0.18;
        const tone2 = Math.sin(2 * Math.PI * 1567.98 * t2) * 0.52 + Math.sin(2 * Math.PI * 3135.96 * t2) * 0.15;
        left[i] = (tone1 * env1 + tone2 * env2) * 0.7;
        right[i] = (tone1 * env1 * 0.94 + tone2 * env2 * 1.04) * 0.7;
      }
      break;
    }

    case 'ding': {
      for (let i = 0; i < n; i++) {
        const t = i / SAMPLE_RATE;
        const env = Math.min(1, t / 0.005) * Math.exp(-t * 7.2);
        const shimmer = Math.exp(-t * 16);
        const v =
          (Math.sin(2 * Math.PI * 880 * t) * 0.6 +
            Math.sin(2 * Math.PI * 1760 * t) * 0.25 * shimmer +
            Math.sin(2 * Math.PI * 2640 * t) * 0.12 * shimmer) *
          env *
          0.8;
        left[i] = v;
        right[i] = v;
      }
      break;
    }
  }

  return encodeStereoWavPcm16(left, right);
}

export function writeSoundEffectFile(preset: SoundEffectPresetId, outPath: string): Buffer {
  const wav = synthesizeSoundEffectWav(preset);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, wav);
  return wav;
}
