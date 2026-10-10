import { describe, expect, it } from 'vitest';
import { butterSos } from '@/dsp/filters/butter';
import { logSpace, magnitudeResponse } from '@/dsp/filters/freqResponse';
import { medianBaseline, medianFilter, oddWindow } from '@/dsp/filters/median';
import { notchSos } from '@/dsp/filters/notch';
import {
  defaultPreprocessOptions,
  designFilter,
  preprocess,
  preprocessOptionsError,
  type PreprocessOptions,
} from '@/dsp/filters/preprocess';
import { sosfilt, sosfiltfilt, steadyState } from '@/dsp/filters/sosfilt';
import type { Sos } from '@/dsp/filters/types';

const FS = 360;

function sine(freqHz: number, n: number, fs = FS, amplitude = 1): Float64Array {
  return Float64Array.from(
    { length: n },
    (_, i) => amplitude * Math.sin((2 * Math.PI * freqHz * i) / fs),
  );
}

/** Amplitude of a sinusoid, from the RMS of its middle half (away from edge effects). */
function steadyAmplitude(x: Float64Array): number {
  const middle = x.subarray(x.length >> 2, (3 * x.length) >> 2);
  const meanSquare = middle.reduce((sum, value) => sum + value * value, 0) / middle.length;
  return Math.sqrt(2 * meanSquare);
}

function gainDb(sos: Sos, freqHz: number, passes: 1 | 2 = 1, fs = FS): number {
  return magnitudeResponse(sos, fs, [freqHz], passes).magnitudeDb[0];
}

function isStable(sos: Sos): boolean {
  // Both poles of 1 + a1 z^-1 + a2 z^-2 are inside the unit circle iff |a2| < 1 and |a1| < 1 + a2.
  return sos.every(([, , , , a1, a2]) => Math.abs(a2) < 1 && Math.abs(a1) < 1 + a2);
}

describe('butterSos', () => {
  it('is -3 dB at the cutoff for every band type', () => {
    expect(gainDb(butterSos(4, 40, 'low', FS), 40)).toBeCloseTo(-3.0103, 3);
    expect(gainDb(butterSos(3, 0.5, 'high', FS), 0.5)).toBeCloseTo(-3.0103, 3);
    const band = butterSos(2, [5, 15], 'band', FS);
    expect(gainDb(band, 5)).toBeCloseTo(-3.0103, 3);
    expect(gainDb(band, 15)).toBeCloseTo(-3.0103, 3);
  });

  it('has unit gain in the passband and blocks the stopband', () => {
    const low = butterSos(4, 40, 'low', FS);
    expect(gainDb(low, 1)).toBeCloseTo(0, 6);
    expect(gainDb(low, 170)).toBeLessThan(-80);
    const high = butterSos(4, 5, 'high', FS);
    expect(gainDb(high, 100)).toBeCloseTo(0, 4);
    expect(gainDb(high, 0.05)).toBeLessThan(-80);
  });

  it('rolls off at about 6 dB per octave per order', () => {
    for (const order of [1, 2, 4]) {
      const sos = butterSos(order, 1, 'low', 1000);
      const slope = gainDb(sos, 16, 1, 1000) - gainDb(sos, 8, 1, 1000);
      expect(slope).toBeCloseTo(-6.02 * order, 0);
    }
  });

  it('produces stable sections, even for a very low cutoff', () => {
    expect(isStable(butterSos(6, 0.05, 'high', 1000))).toBe(true);
    expect(isStable(butterSos(8, [0.5, 40], 'band', 500))).toBe(true);
    expect(isStable(butterSos(7, 170, 'low', FS))).toBe(true);
  });

  it('uses a first-order section for the odd pole', () => {
    const sos = butterSos(3, 40, 'low', FS);
    expect(sos).toHaveLength(2);
    expect(sos.filter((section) => section[2] === 0 && section[5] === 0)).toHaveLength(1);
  });

  it('rejects unusable parameters', () => {
    expect(() => butterSos(0, 40, 'low', FS)).toThrow(RangeError);
    expect(() => butterSos(2.5, 40, 'low', FS)).toThrow(RangeError);
    expect(() => butterSos(2, 0, 'low', FS)).toThrow(/Nyquist/);
    expect(() => butterSos(2, 180, 'low', FS)).toThrow(/Nyquist/);
    expect(() => butterSos(2, NaN, 'high', FS)).toThrow(RangeError);
    expect(() => butterSos(2, [15, 5], 'band', FS)).toThrow(/below the upper/);
    expect(() => butterSos(2, 10, 'band', FS)).toThrow(/two cutoffs/);
    expect(() => butterSos(2, [5, 15], 'low', FS)).toThrow(/one cutoff/);
  });
});

describe('notchSos', () => {
  it('removes its centre frequency and passes the rest', () => {
    const sos = notchSos(50, 30, FS);
    expect(gainDb(sos, 50)).toBeLessThan(-100);
    expect(gainDb(sos, 10)).toBeCloseTo(0, 2);
    expect(gainDb(sos, 100)).toBeCloseTo(0, 1);
    expect(isStable(sos)).toBe(true);
  });

  it('has a -3 dB width of f0 / q', () => {
    const sos = notchSos(50, 25, 1000);
    // The band edges are not exactly symmetric, so only their spacing is checked.
    const freqs = Float64Array.from({ length: 4001 }, (_, i) => 48 + i * 0.001);
    const { magnitudeDb } = magnitudeResponse(sos, 1000, freqs);
    const inside = Array.from(freqs).filter((_, i) => magnitudeDb[i] < -3.0103);
    expect(inside[inside.length - 1] - inside[0]).toBeCloseTo(50 / 25, 2);
  });

  it('rejects a frequency at or above Nyquist and a non-positive q', () => {
    expect(() => notchSos(60, 30, 120)).toThrow(/Nyquist/);
    expect(() => notchSos(50, 0, FS)).toThrow(/quality factor/);
  });
});

describe('sosfilt', () => {
  it('returns the impulse response of a simple section', () => {
    // y[n] = x[n] + 0.5 y[n-1]
    const sos: Sos = [[1, 0, 0, 1, -0.5, 0]];
    expect(Array.from(sosfilt(sos, Float64Array.from([1, 0, 0, 0])))).toEqual([
      1, 0.5, 0.25, 0.125,
    ]);
  });

  it('does not modify its input or the initial state', () => {
    const x = Float64Array.from([1, 2, 3]);
    const state: [number, number][] = [[0.5, 0.25]];
    sosfilt(butterSos(2, 40, 'low', FS), x, state);
    expect(Array.from(x)).toEqual([1, 2, 3]);
    expect(state).toEqual([[0.5, 0.25]]);
  });

  it('handles empty input and an empty cascade', () => {
    expect(sosfilt(butterSos(2, 40, 'low', FS), new Float64Array(0))).toHaveLength(0);
    expect(Array.from(sosfilt([], Float64Array.from([1, 2])))).toEqual([1, 2]);
  });

  it('started from its steady state, passes a constant with no transient', () => {
    const sos = [...butterSos(3, 40, 'low', FS), ...notchSos(50, 30, FS)];
    const state = steadyState(sos).map(([z0, z1]): [number, number] => [7 * z0, 7 * z1]);
    const y = sosfilt(sos, new Float64Array(50).fill(7), state);
    for (const value of y) expect(value).toBeCloseTo(7, 10);
  });
});

describe('sosfiltfilt', () => {
  it('introduces no delay: a filtered pulse stays centred where it was', () => {
    const n = 2001;
    const x = Float64Array.from({ length: n }, (_, i) => Math.exp(-(((i - 1000) / 12) ** 2)));
    const sos = butterSos(4, 15, 'low', FS);
    const zeroPhase = sosfiltfilt(sos, x);
    const causal = sosfilt(sos, x);
    expect(zeroPhase.indexOf(Math.max(...zeroPhase))).toBe(1000);
    expect(causal.indexOf(Math.max(...causal))).toBeGreaterThan(1005);
    // The output is symmetric around the pulse, like the input.
    for (let k = 1; k < 200; k++) expect(zeroPhase[1000 + k]).toBeCloseTo(zeroPhase[1000 - k], 9);
  });

  it('applies the magnitude response twice (-6 dB at the cutoff)', () => {
    const sos = butterSos(2, 20, 'low', FS);
    const amplitude = steadyAmplitude(sosfiltfilt(sos, sine(20, 7200)));
    expect(20 * Math.log10(amplitude)).toBeCloseTo(-6.0206, 3);
    expect(gainDb(sos, 20, 2)).toBeCloseTo(-6.0206, 3);
  });

  it('leaves a constant signal unchanged through a low-pass and zeroes it through a high-pass', () => {
    const constant = new Float64Array(500).fill(3.3);
    for (const value of sosfiltfilt(butterSos(4, 40, 'low', FS), constant))
      expect(value).toBeCloseTo(3.3, 9);
    for (const value of sosfiltfilt(butterSos(2, 0.5, 'high', FS), constant))
      expect(value).toBeCloseTo(0, 9);
  });

  it('has no start-up transient on a signal with a large offset', () => {
    const x = sine(5, 3600).map((value) => value + 100);
    const y = sosfiltfilt(butterSos(2, 40, 'low', FS), x);
    expect(Math.abs(y[0] - x[0])).toBeLessThan(0.05);
    expect(Math.abs(y[y.length - 1] - x[x.length - 1])).toBeLessThan(0.05);
  });

  it('handles empty, single-sample and shorter-than-padding signals', () => {
    const sos = butterSos(4, 40, 'low', FS);
    expect(sosfiltfilt(sos, new Float64Array(0))).toHaveLength(0);
    expect(Array.from(sosfiltfilt(sos, Float64Array.from([2])))).toHaveLength(1);
    const short = sosfiltfilt(sos, Float64Array.from([1, 2, 3, 4, 5]));
    expect(short).toHaveLength(5);
    expect(short.every(Number.isFinite)).toBe(true);
  });

  it('returns a copy when the cascade is empty', () => {
    const x = Float64Array.from([1, 2, 3]);
    const y = sosfiltfilt([], x);
    expect(Array.from(y)).toEqual([1, 2, 3]);
    expect(y).not.toBe(x);
  });
});

describe('magnitudeResponse and logSpace', () => {
  it('doubles the decibels for two passes', () => {
    const sos = butterSos(2, 40, 'low', FS);
    expect(gainDb(sos, 80, 2)).toBeCloseTo(2 * gainDb(sos, 80, 1), 9);
  });

  it('floors the response instead of returning -Infinity', () => {
    const { magnitudeDb } = magnitudeResponse(butterSos(2, 40, 'low', FS), FS, [FS / 2]);
    expect(magnitudeDb[0]).toBe(-200);
  });

  it('is 0 dB everywhere for an empty cascade', () => {
    expect(Array.from(magnitudeResponse([], FS, [1, 10, 100]).magnitudeDb)).toEqual([0, 0, 0]);
  });

  it('spaces frequencies evenly in ratio', () => {
    const f = logSpace(1, 100, 3);
    expect(f[0]).toBeCloseTo(1, 12);
    expect(f[1]).toBeCloseTo(10, 12);
    expect(f[2]).toBeCloseTo(100, 12);
    expect(Array.from(logSpace(5, 50, 1))).toEqual([5]);
  });
});

describe('medianFilter', () => {
  it('removes an isolated spike that a mean filter would only smear', () => {
    const x = new Float64Array(21).fill(1);
    x[10] = 100;
    expect(Array.from(medianFilter(x, 5))).toEqual(new Array(21).fill(1));
  });

  it('keeps a step edge sharp', () => {
    const x = Float64Array.from({ length: 20 }, (_, i) => (i < 10 ? 0 : 5));
    expect(Array.from(medianFilter(x, 7))).toEqual(Array.from(x));
  });

  it('is the identity for a window of one sample', () => {
    const x = Float64Array.from([3, 1, 2]);
    expect(Array.from(medianFilter(x, 1))).toEqual([3, 1, 2]);
  });

  it('handles empty input, constant input, and windows longer than the signal', () => {
    expect(medianFilter(new Float64Array(0), 5)).toHaveLength(0);
    expect(Array.from(medianFilter(new Float64Array(6).fill(2), 5))).toEqual(new Array(6).fill(2));
    expect(Array.from(medianFilter(Float64Array.from([1, 9, 2]), 9))).toEqual([1, 2, 2]);
  });

  it('rejects even, zero and fractional windows', () => {
    for (const size of [0, 4, 2.5, -3]) {
      expect(() => medianFilter(new Float64Array(10), size)).toThrow(RangeError);
    }
  });
});

describe('medianBaseline', () => {
  it('rounds windows to an odd number of samples', () => {
    expect(oddWindow(0.2, 360)).toBe(73);
    expect(oddWindow(0.6, 360)).toBe(217);
    expect(oddWindow(0.2, 125)).toBe(25);
    expect(oddWindow(0.001, 125)).toBe(1);
  });

  it('follows slow drift and ignores narrow beats', () => {
    const n = 20 * FS;
    const drift = sine(0.1, n, FS, 0.5);
    const x = Float64Array.from(drift);
    for (let beat = 100; beat < n; beat += FS) for (let k = 0; k < 20; k++) x[beat + k] += 1; // ~55 ms "QRS"
    const baseline = medianBaseline(x, FS);
    let worst = 0;
    for (let i = FS; i < n - FS; i++) worst = Math.max(worst, Math.abs(baseline[i] - drift[i]));
    expect(worst).toBeLessThan(0.05);
  });
});

describe('designFilter and preprocess', () => {
  const ecg = defaultPreprocessOptions('ecg');

  it('uses a 0.5–40 Hz band for ECG and 0.5–8 Hz for PPG by default', () => {
    expect(ecg).toMatchObject({
      baseline: 'highpass',
      highpassHz: 0.5,
      lowpassHz: 40,
      notchHz: 50,
    });
    expect(defaultPreprocessOptions('ppg').lowpassHz).toBe(8);
  });

  it('combines high-pass, notch and low-pass into one cascade', () => {
    const { sos, skipped } = designFilter(FS, ecg);
    expect(sos).toHaveLength(3);
    expect(skipped).toEqual([]);
    expect(gainDb(sos, 10)).toBeCloseTo(0, 1);
    expect(gainDb(sos, 50)).toBeLessThan(-100);
    expect(gainDb(sos, 0.05)).toBeLessThan(-35);
  });

  it('skips stages that do not fit below Nyquist and says so', () => {
    // 60 Hz is below the 62.5 Hz Nyquist of a 125 Hz recording, but too close to it to design.
    const closeToNyquist = designFilter(125, { ...ecg, notchHz: 60 });
    expect(closeToNyquist.skipped).toHaveLength(1);
    expect(closeToNyquist.skipped[0]).toMatch(/60 Hz notch was skipped/);

    const slow = designFilter(60, ecg);
    expect(slow.skipped).toHaveLength(2);
    expect(slow.sos).toHaveLength(1); // only the high-pass is left
  });

  it('builds an empty cascade when everything is switched off', () => {
    const off: PreprocessOptions = { ...ecg, baseline: 'none', notchHz: null, lowpassHz: null };
    expect(designFilter(FS, off).sos).toHaveLength(0);
    const x = sine(3, 500);
    expect(Array.from(preprocess(x, FS, off).filtered)).toEqual(Array.from(x));
  });

  it('removes drift and mains hum while keeping the in-band signal', () => {
    const n = 30 * FS;
    const wanted = sine(8, n);
    const drift = sine(0.05, n, FS, 2);
    const hum = sine(50, n, FS, 0.5);
    const x = wanted.map((value, i) => value + drift[i] + hum[i] + 4);
    const { filtered } = preprocess(x, FS, ecg);
    let worst = 0;
    for (let i = 5 * FS; i < n - 5 * FS; i++)
      worst = Math.max(worst, Math.abs(filtered[i] - wanted[i]));
    expect(worst).toBeLessThan(0.02);
  });

  it('removes drift with the median method too', () => {
    const n = 20 * FS;
    const drift = sine(0.1, n, FS, 2);
    const x = Float64Array.from(drift, (value) => value + 3);
    for (let beat = 100; beat < n; beat += FS) for (let k = 0; k < 20; k++) x[beat + k] += 1;
    const { filtered } = preprocess(x, FS, {
      ...ecg,
      baseline: 'median',
      notchHz: null,
      lowpassHz: null,
    });
    const between = filtered.filter((_, i) => i > FS && i < n - FS && (i - 100 + FS) % FS > 60);
    for (const value of between) expect(Math.abs(value)).toBeLessThan(0.1);
  });

  it('does not modify its input', () => {
    const x = sine(3, 1000).map((value) => value + 1);
    const copy = Float64Array.from(x);
    preprocess(x, FS, ecg);
    preprocess(x, FS, { ...ecg, baseline: 'median' });
    expect(Array.from(x)).toEqual(Array.from(copy));
  });

  it('handles empty, constant and very short signals', () => {
    expect(preprocess(new Float64Array(0), FS, ecg).filtered).toHaveLength(0);
    expect(
      preprocess(new Float64Array(0), FS, { ...ecg, baseline: 'median' }).filtered,
    ).toHaveLength(0);
    for (const value of preprocess(new Float64Array(2000).fill(5), FS, ecg).filtered) {
      expect(value).toBeCloseTo(0, 9);
    }
    const short = preprocess(Float64Array.from([1, 2, 3]), FS, ecg).filtered;
    expect(short).toHaveLength(3);
    expect(short.every(Number.isFinite)).toBe(true);
  });

  it('explains unusable options in plain language', () => {
    expect(preprocessOptionsError(FS, ecg)).toBeNull();
    expect(preprocessOptionsError(FS, { ...ecg, baseline: 'median', highpassHz: -1 })).toBeNull();
    expect(preprocessOptionsError(FS, { ...ecg, lowpassHz: null })).toBeNull();
    expect(preprocessOptionsError(FS, { ...ecg, order: 0 })).toMatch(/order/);
    expect(preprocessOptionsError(FS, { ...ecg, order: 9 })).toMatch(/order/);
    expect(preprocessOptionsError(FS, { ...ecg, order: 1.5 })).toMatch(/order/);
    expect(preprocessOptionsError(FS, { ...ecg, highpassHz: 0 })).toMatch(/greater than 0/);
    expect(preprocessOptionsError(FS, { ...ecg, highpassHz: NaN })).toMatch(/greater than 0/);
    expect(preprocessOptionsError(FS, { ...ecg, highpassHz: 200, lowpassHz: null })).toMatch(
      /below 180 Hz/,
    );
    expect(preprocessOptionsError(FS, { ...ecg, lowpassHz: 0 })).toMatch(/greater than 0/);
    expect(preprocessOptionsError(FS, { ...ecg, highpassHz: 5, lowpassHz: 5 })).toMatch(
      /above the high-pass/,
    );
  });

  it('rejects an unusable cutoff', () => {
    expect(() => preprocess(sine(3, 100), FS, { ...ecg, highpassHz: 0 })).toThrow(RangeError);
    expect(() => preprocess(sine(3, 100), FS, { ...ecg, order: 0 })).toThrow(RangeError);
  });
});
