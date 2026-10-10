import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ButterBand } from '@/dsp/filters/butter';

interface FilterCase {
  name: string;
  fs: number;
  freqHz: number[];
  /** |H(f)| of SciPy's design (linear, single pass). */
  magnitude: number[];
  /** scipy.signal.sosfiltfilt output for the shared input. */
  filtfilt: number[];
  /** scipy.signal.sosfilt output for the shared input. */
  causal: number[];
}

export interface ButterCase extends FilterCase {
  order: number;
  band: ButterBand;
  cutoffHz: number | [number, number];
}

export interface NotchCase extends FilterCase {
  f0Hz: number;
  q: number;
}

export interface FilterFixture {
  generator: string;
  input: number[];
  butter: ButterCase[];
  notch: NotchCase[];
  median: { size: number; output: number[] }[];
  ecgDefaultChain: { sample: string; length: number; filtfilt: number[] };
}

/** SciPy reference outputs written by validation/gen_fixtures.py. */
export function loadFilterFixture(): FilterFixture {
  const path = fileURLToPath(new URL('../fixtures/filters.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as FilterFixture;
}

/** Largest absolute difference between two equally long sequences. */
export function maxAbsDiff(actual: ArrayLike<number>, expected: ArrayLike<number>): number {
  if (actual.length !== expected.length) {
    throw new Error(`Length mismatch: ${actual.length} vs ${expected.length}`);
  }
  let worst = 0;
  for (let i = 0; i < actual.length; i++)
    worst = Math.max(worst, Math.abs(actual[i] - expected[i]));
  return worst;
}
