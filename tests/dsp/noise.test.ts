import { describe, expect, it } from 'vitest';
import { defaultPreprocessOptions } from '@/dsp/filters/preprocess';
import { magnitudeResponse } from '@/dsp/filters/freqResponse';
import { runNoiseExperiment } from '@/dsp/noise/experiment';
import { addNoise, generateNoise, measureSnrDb, type NoiseKind } from '@/dsp/noise/generate';
import { analyzeRecording } from '@/dsp/pipeline';
import { fft } from '@/dsp/util/fft';
import { createRandom } from '@/dsp/util/random';
import { regularBeats, syntheticEcg } from '../helpers/synth';

const FS = 256;
const N = 16 * FS; // 4096 samples: a power of two for the spectrum checks
const OPTIONS = { mainsHz: 50, seed: 1 } as const;
const KINDS: NoiseKind[] = ['baseline', 'powerline', 'emg', 'motion'];

/** Share of a signal's power (excluding DC) that lies between two frequencies. */
function powerShare(x: Float64Array, fromHz: number, toHz: number): number {
  const re = Float64Array.from(x);
  const im = new Float64Array(x.length);
  fft(re, im);
  let inBand = 0;
  let total = 0;
  for (let k = 1; k < x.length / 2; k++) {
    const power = re[k] ** 2 + im[k] ** 2;
    const freq = (k * FS) / x.length;
    total += power;
    if (freq >= fromHz && freq <= toHz) inBand += power;
  }
  return inBand / total;
}

describe('createRandom', () => {
  it('repeats exactly for the same seed and differs for another', () => {
    const a = createRandom(42);
    const b = createRandom(42);
    const c = createRandom(43);
    const first = [a.uniform(), a.gaussian(), a.uniform()];
    expect([b.uniform(), b.gaussian(), b.uniform()]).toEqual(first);
    expect(c.uniform()).not.toBe(first[0]);
  });

  it('produces uniform numbers in [0, 1) and normal numbers with unit variance', () => {
    const random = createRandom(7);
    const uniform = Array.from({ length: 20_000 }, () => random.uniform());
    expect(Math.min(...uniform)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...uniform)).toBeLessThan(1);
    expect(uniform.reduce((sum, value) => sum + value, 0) / uniform.length).toBeCloseTo(0.5, 2);
    const normal = Array.from({ length: 20_000 }, () => random.gaussian());
    const mean = normal.reduce((sum, value) => sum + value, 0) / normal.length;
    const variance = normal.reduce((sum, value) => sum + (value - mean) ** 2, 0) / normal.length;
    expect(mean).toBeCloseTo(0, 1);
    expect(variance).toBeCloseTo(1, 1);
  });
});

describe('generateNoise', () => {
  it('puts each kind of noise in its own part of the spectrum', () => {
    expect(powerShare(generateNoise(N, FS, 'baseline', OPTIONS), 0, 1)).toBeGreaterThan(0.95);
    expect(powerShare(generateNoise(N, FS, 'powerline', OPTIONS), 49, 51)).toBeGreaterThan(0.9);
    expect(powerShare(generateNoise(N, FS, 'emg', OPTIONS), 20, FS / 2)).toBeGreaterThan(0.9);
    expect(powerShare(generateNoise(N, FS, 'motion', OPTIONS), 0, 10)).toBeGreaterThan(0.95);
  });

  it('follows the chosen mains frequency', () => {
    const noise = generateNoise(N, FS, 'powerline', { mainsHz: 60, seed: 1 });
    expect(powerShare(noise, 59, 61)).toBeGreaterThan(0.9);
  });

  it('leaves out a mains harmonic that would alias', () => {
    // At 256 Hz the third harmonic of 50 Hz (150 Hz) is above Nyquist (128 Hz).
    expect(powerShare(generateNoise(N, FS, 'powerline', OPTIONS), 49, 51)).toBeGreaterThan(0.999);
  });

  it('makes motion noise bursty: mostly quiet, with a few large swings', () => {
    const noise = generateNoise(60 * FS, FS, 'motion', OPTIONS);
    const peak = Math.max(...noise.map(Math.abs));
    const quiet = noise.filter((value) => Math.abs(value) < 0.01 * peak).length / noise.length;
    expect(quiet).toBeGreaterThan(0.5);
  });

  it.each(KINDS)('is repeatable for %s noise and handles an empty length', (kind) => {
    expect(Array.from(generateNoise(500, FS, kind, OPTIONS))).toEqual(
      Array.from(generateNoise(500, FS, kind, OPTIONS)),
    );
    expect(generateNoise(0, FS, kind, OPTIONS)).toHaveLength(0);
  });
});

describe('addNoise', () => {
  const clean = syntheticEcg(regularBeats(16, 70), 16, FS);

  it.each(KINDS.flatMap((kind) => [24, 6, 0, -6].map((snr) => [kind, snr] as const)))(
    'hits the requested SNR for %s noise at %d dB',
    (kind, snr) => {
      expect(measureSnrDb(clean, addNoise(clean, FS, kind, snr, OPTIONS))).toBeCloseTo(snr, 9);
    },
  );

  it('doubles the noise amplitude for every 6.02 dB less', () => {
    const at12 = addNoise(clean, FS, 'emg', 12, OPTIONS).map((value, i) => value - clean[i]);
    const at6 = addNoise(clean, FS, 'emg', 12 - 20 * Math.log10(2), OPTIONS).map(
      (value, i) => value - clean[i],
    );
    expect(at6[100] / at12[100]).toBeCloseTo(2, 9);
  });

  it('does not modify its input and is repeatable', () => {
    const copy = Float64Array.from(clean);
    const first = addNoise(clean, FS, 'motion', 6, OPTIONS);
    expect(Array.from(clean)).toEqual(Array.from(copy));
    expect(Array.from(addNoise(clean, FS, 'motion', 6, OPTIONS))).toEqual(Array.from(first));
    expect(Array.from(addNoise(clean, FS, 'motion', 6, { mainsHz: 50, seed: 2 }))).not.toEqual(
      Array.from(first),
    );
  });

  it('returns empty and constant signals unchanged', () => {
    expect(addNoise(new Float64Array(0), FS, 'emg', 6, OPTIONS)).toHaveLength(0);
    expect(Array.from(addNoise(new Float64Array(100).fill(3), FS, 'emg', 6, OPTIONS))).toEqual(
      new Array(100).fill(3),
    );
  });
});

describe('runNoiseExperiment', () => {
  const fs = 250;
  const beats = regularBeats(60, 72);
  const clean = syntheticEcg(beats, 60, fs);
  const options = { preprocess: defaultPreprocessOptions('ecg') };
  const reference = analyzeRecording(clean, fs, 'ecg', options).beatTimesS;
  const run = (kind: NoiseKind, levels: number[], preview = levels[0]) =>
    runNoiseExperiment(clean, fs, 'ecg', options, reference, kind, OPTIONS, levels, preview);

  it('scores perfectly when the noise is negligible', () => {
    const { trials } = run('emg', [60]);
    expect(trials[0].score).toMatchObject({ falsePositives: 0, falseNegatives: 0, f1: 1 });
  });

  it('shows detection getting worse as muscle noise grows', () => {
    const { trials } = run('emg', [24, 0, -12]);
    expect(trials.map((trial) => trial.snrDb)).toEqual([24, 0, -12]);
    expect(trials[0].score.f1).toBe(1);
    expect(trials[2].score.f1).toBeLessThan(trials[0].score.f1);
  });

  it('shows that mains hum and baseline wander are removed by the filters even when loud', () => {
    for (const kind of ['powerline', 'baseline'] as const) {
      const { trials } = run(kind, [-6]);
      expect(trials[0].score.f1).toBe(1);
    }
    // The reason: the default chain attenuates 50 Hz by far more than the noise exceeds the signal.
    const { magnitudeDb } = magnitudeResponse(
      analyzeRecording(clean, fs, 'ecg', options).sos,
      fs,
      [50],
      2,
    );
    expect(magnitudeDb[0]).toBeLessThan(-100);
  });

  it('returns the noisy signal, its filtered version and its beats for the preview level', () => {
    const { preview } = run('emg', [24, 6], 6);
    expect(preview.noisy).toHaveLength(clean.length);
    expect(preview.filtered).toHaveLength(clean.length);
    expect(measureSnrDb(clean, preview.noisy)).toBeCloseTo(6, 9);
    expect(preview.beatTimesS.length).toBeGreaterThan(0.8 * beats.length);
  });

  it('handles no SNR levels', () => {
    expect(run('emg', [], 12).trials).toEqual([]);
  });
});
