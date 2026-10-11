import type { Signal } from '../types';

/**
 * Index of the largest (`polarity` 1) or smallest (`polarity` -1) sample in
 * `x[from, to]`, both ends inclusive and clamped to the signal.
 */
export function extremumIndex(x: Signal, from: number, to: number, polarity: 1 | -1): number {
  const last = Math.max(0, x.length - 1);
  const start = Math.min(Math.max(0, from), last);
  const end = Math.min(Math.max(0, to), last);
  let best = start;
  for (let i = start + 1; i <= end; i++) {
    if (polarity * x[i] > polarity * x[best]) best = i;
  }
  return best;
}

/**
 * Sub-sample position of a peak, as an offset in samples from `index`.
 *
 * A parabola is fitted through the peak sample and its two neighbours; its
 * vertex is the estimate of where the true peak fell between samples. This
 * matters for variability metrics: at 125 Hz one sample is 8 ms, which is as
 * large as a typical RMSSD difference between people.
 *
 * Returns 0 at the signal edges or when the three points are collinear.
 * The result is always within [-0.5, 0.5].
 */
export function parabolicOffset(x: Signal, index: number): number {
  if (index <= 0 || index >= x.length - 1) return 0;
  const left = x[index - 1];
  const right = x[index + 1];
  const curvature = left - 2 * x[index] + right;
  if (curvature === 0) return 0;
  const offset = (0.5 * (left - right)) / curvature;
  return Math.min(0.5, Math.max(-0.5, offset));
}

/** Beat times in seconds, with sub-sample precision, for peaks at the given sample indices. */
export function peakTimes(x: Signal, peaks: ArrayLike<number>, fs: number): Float64Array {
  return Float64Array.from(peaks, (index) => (index + parabolicOffset(x, index)) / fs);
}

/**
 * Sort peaks and drop any that follow another within `minDistance` samples,
 * keeping the one where `strength` is larger.
 */
export function enforceMinDistance(
  peaks: number[],
  minDistance: number,
  strength: (index: number) => number,
): number[] {
  const sorted = [...peaks].sort((a, b) => a - b);
  const kept: number[] = [];
  for (const peak of sorted) {
    const last = kept[kept.length - 1];
    if (last === undefined || peak - last >= minDistance) kept.push(peak);
    else if (strength(peak) > strength(last)) kept[kept.length - 1] = peak;
  }
  return kept;
}

/** Filter output smaller than this share of the input is round-off, not signal. */
const NUMERICAL_DUST = 1e-9;

/**
 * True when a filtered signal contains nothing but round-off residue, as
 * happens for a constant input. Detectors use this to return no beats instead
 * of "detecting" peaks in numerical dust.
 */
export function isNumericallyFlat(filtered: Signal, input: Signal): boolean {
  let filteredPeak = 0;
  let inputPeak = 0;
  for (let i = 0; i < input.length; i++) {
    filteredPeak = Math.max(filteredPeak, Math.abs(filtered[i]));
    inputPeak = Math.max(inputPeak, Math.abs(input[i]));
  }
  return filteredPeak <= NUMERICAL_DUST * inputPeak;
}
