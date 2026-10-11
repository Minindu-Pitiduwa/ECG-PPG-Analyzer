import type { Signal } from '../types';

/**
 * Centred moving average. Each output is the mean of the `windowSize` samples
 * around it, so features are smoothed without being shifted in time. Near the
 * ends the window shrinks to the samples that exist.
 *
 * @param windowSize window length in samples, at least 1; an even length is
 *   rounded up to the next odd number so the window has a centre
 */
export function movingAverage(x: Signal, windowSize: number): Signal {
  if (!(windowSize >= 1))
    throw new RangeError(`Window must be at least 1 sample, got ${windowSize}.`);
  const n = x.length;
  const half = Math.floor(windowSize / 2);
  const out = new Float64Array(n);
  if (n === 0) return out;

  // prefix[i] is the sum of x[0..i), so any window sum is one subtraction.
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + x[i];
  for (let i = 0; i < n; i++) {
    const from = Math.max(0, i - half);
    const to = Math.min(n, i + half + 1);
    out[i] = (prefix[to] - prefix[from]) / (to - from);
  }
  return out;
}
