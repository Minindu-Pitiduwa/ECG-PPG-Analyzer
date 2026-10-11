/**
 * Agreement of the HRV measures with NeuroKit2 and SciPy on the same interval
 * series (tests/fixtures/hrv.json, written by validation/gen_hrv_fixtures.py).
 *
 * Stated tolerance: 1e-9 relative for everything that has one agreed formula.
 * Two measures are defined slightly differently here, on purpose, and are
 * compared through the known relation instead:
 *   - pNN50: this code divides by the number of successive differences (N - 1),
 *     NeuroKit2 by the number of intervals (N).
 *   - SD2: this code measures the spread of the Poincaré points along the
 *     diagonal directly; NeuroKit2 derives it from SDNN and SDSD, which is the
 *     same thing only for an infinitely long series. Agreement within 1%.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { lombScargle, resampleLinear, welch } from '@/dsp/hrv/frequencyDomain';
import type { IntervalLabel } from '@/dsp/hrv/intervals';
import { poincare } from '@/dsp/hrv/poincare';
import { timeDomainHrv } from '@/dsp/hrv/timeDomain';

interface HrvCase {
  name: string;
  rrMs: number[];
  timeS: number[];
  meanNN: number;
  sdnn: number;
  rmssd: number;
  pnn50: number;
  sd1: number;
  sd2: number;
  lombFreqHz: number[];
  lombPower: number[];
  resampled: number[];
  welchSegment: number;
  welchFreqHz: number[];
  welchPower: number[];
}

const RELATIVE_TOLERANCE = 1e-9;

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/hrv.json', import.meta.url)), 'utf8'),
) as { cases: HrvCase[] };

function expectClose(actual: number, expected: number, relative = RELATIVE_TOLERANCE): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(relative * Math.abs(expected));
}

function expectAllClose(actual: ArrayLike<number>, expected: number[], scale: number): void {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(Math.abs(actual[i] - expected[i])).toBeLessThanOrEqual(RELATIVE_TOLERANCE * scale);
  }
}

const allNormal = (n: number): IntervalLabel[] => new Array<IntervalLabel>(n).fill('normal');

describe.each(fixture.cases.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
  const labels = allNormal(entry.rrMs.length);

  it('time domain matches NeuroKit2', () => {
    const result = timeDomainHrv(entry.rrMs, labels);
    const n = entry.rrMs.length;
    expectClose(result.meanNN, entry.meanNN);
    expectClose(result.sdnn, entry.sdnn);
    expectClose(result.rmssd, entry.rmssd);
    expectClose((result.pnn50 * (n - 1)) / n, entry.pnn50);
  });

  it('Poincaré SD1 and SD2 match NeuroKit2', () => {
    const result = poincare(entry.rrMs, labels);
    expectClose(result.sd1, entry.sd1);
    expectClose(result.sd2, entry.sd2, 0.01);
  });

  it('Lomb–Scargle periodogram matches scipy.signal.lombscargle', () => {
    const mean = entry.rrMs.reduce((sum, value) => sum + value, 0) / entry.rrMs.length;
    const centred = entry.rrMs.map((value) => value - mean);
    const power = lombScargle(entry.timeS, centred, entry.lombFreqHz);
    expectAllClose(power, entry.lombPower, Math.max(...entry.lombPower));
  });

  it('4 Hz resampling matches numpy.interp', () => {
    const resampled = resampleLinear(entry.timeS, entry.rrMs, 4);
    expectAllClose(resampled, entry.resampled, 1000);
  });

  it('Welch spectrum matches scipy.signal.welch', () => {
    const psd = welch(Float64Array.from(entry.resampled), 4, entry.welchSegment);
    expectAllClose(psd.freqHz, entry.welchFreqHz, 1);
    expectAllClose(psd.power, entry.welchPower, Math.max(...entry.welchPower));
  });
});
