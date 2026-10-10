/**
 * Agreement with SciPy.
 *
 * Every filter is designed here in TypeScript, run on the same input SciPy was
 * given, and compared with SciPy's output stored in tests/fixtures/filters.json.
 *
 * Stated tolerance: 1e-9 absolute, on signals of amplitude ~1 (so also ~1e-9
 * relative). Measured worst case when this was written: 2e-11, for the narrow
 * 0.5 Hz high-pass at 1000 Hz; most cases agree to about 1e-14. The margin
 * allows for a different order of floating-point operations, mainly because
 * the biquad sections are not necessarily in the same order as SciPy's.
 */
import { describe, expect, it } from 'vitest';
import { butterSos } from '@/dsp/filters/butter';
import { magnitudeResponse } from '@/dsp/filters/freqResponse';
import { medianFilter } from '@/dsp/filters/median';
import { notchSos } from '@/dsp/filters/notch';
import { defaultPreprocessOptions, preprocess } from '@/dsp/filters/preprocess';
import { sosfilt, sosfiltfilt } from '@/dsp/filters/sosfilt';
import type { Sos } from '@/dsp/filters/types';
import { loadFilterFixture, maxAbsDiff } from '../helpers/fixtures';
import { readSample } from '../helpers/samples';

const TOLERANCE = 1e-9;

const fixture = loadFilterFixture();
const input = Float64Array.from(fixture.input);

function expectMatchesScipy(
  sos: Sos,
  reference: {
    fs: number;
    freqHz: number[];
    magnitude: number[];
    filtfilt: number[];
    causal: number[];
  },
) {
  const { magnitudeDb } = magnitudeResponse(sos, reference.fs, reference.freqHz);
  const magnitude = magnitudeDb.map((db) => 10 ** (db / 20));
  expect(maxAbsDiff(magnitude, reference.magnitude)).toBeLessThan(TOLERANCE);
  expect(maxAbsDiff(sosfilt(sos, input), reference.causal)).toBeLessThan(TOLERANCE);
  expect(maxAbsDiff(sosfiltfilt(sos, input), reference.filtfilt)).toBeLessThan(TOLERANCE);
}

describe('butterSos vs scipy.signal.butter', () => {
  it.each(fixture.butter.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    const sos = butterSos(entry.order, entry.cutoffHz, entry.band, entry.fs);
    const expectedOrder = entry.band === 'band' ? 2 * entry.order : entry.order;
    expect(sos).toHaveLength(Math.ceil(expectedOrder / 2));
    expectMatchesScipy(sos, entry);
  });
});

describe('notchSos vs scipy.signal.iirnotch', () => {
  it.each(fixture.notch.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    expectMatchesScipy(notchSos(entry.f0Hz, entry.q, entry.fs), entry);
  });
});

describe('medianFilter vs scipy.ndimage.median_filter', () => {
  it.each(fixture.median.map((entry) => [entry.size, entry.output] as const))(
    'window of %d samples',
    (size, output) => {
      // A median only selects input values, so the match must be exact.
      expect(maxAbsDiff(medianFilter(input, size), output)).toBe(0);
    },
  );
});

describe('default ECG chain vs scipy.signal.sosfiltfilt', () => {
  it('matches on 10 s of real ECG (MIT-BIH record 100)', () => {
    const { info, samples } = readSample(fixture.ecgDefaultChain.sample);
    const x = samples.slice(0, fixture.ecgDefaultChain.length);
    const { filtered, skipped } = preprocess(x, info.fs, defaultPreprocessOptions('ecg'));
    expect(skipped).toEqual([]);
    expect(maxAbsDiff(filtered, fixture.ecgDefaultChain.filtfilt)).toBeLessThan(TOLERANCE);
  });
});
