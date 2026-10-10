import type { Signal } from '../types';

/** Index of the first element of `sorted[0, length)` that is not less than `value`. */
function lowerBound(sorted: Float64Array, length: number, value: number): number {
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Sliding-window median with the edges extended by repeating the end samples.
 *
 * The window contents are kept sorted; each step removes the sample that left
 * and inserts the one that entered, so the cost per sample is one short memory
 * move instead of a full sort.
 *
 * Matches `scipy.ndimage.median_filter(x, size, mode="nearest")`.
 *
 * @param windowSize number of samples in the window; must be odd and at least 1
 */
export function medianFilter(x: Signal, windowSize: number): Signal {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize % 2 === 0) {
    throw new RangeError(`Median window must be a positive odd integer, got ${windowSize}.`);
  }
  const n = x.length;
  const out = new Float64Array(n);
  if (n === 0) return out;

  const half = windowSize >> 1;
  const at = (index: number) => x[Math.min(Math.max(index, 0), n - 1)];

  const sorted = new Float64Array(windowSize);
  for (let k = 0; k < windowSize; k++) sorted[k] = at(k - half);
  sorted.sort();

  out[0] = sorted[half];
  for (let i = 1; i < n; i++) {
    const leaving = at(i - 1 - half);
    const entering = at(i + half);
    if (leaving !== entering) {
      const removeAt = lowerBound(sorted, windowSize, leaving);
      sorted.copyWithin(removeAt, removeAt + 1, windowSize);
      const insertAt = lowerBound(sorted, windowSize - 1, entering);
      sorted.copyWithin(insertAt + 1, insertAt, windowSize - 1);
      sorted[insertAt] = entering;
    }
    out[i] = sorted[half];
  }
  return out;
}

/** Nearest odd integer number of samples for a window of `seconds`. */
export function oddWindow(seconds: number, fs: number): number {
  return 2 * Math.floor((seconds * fs) / 2) + 1;
}

/**
 * Estimate the baseline of an ECG with two median filters in a row.
 *
 * A 200 ms median is wider than a QRS complex, so it erases QRS and P waves
 * and keeps everything slower. A 600 ms median on that result then erases the
 * T wave. What is left is the slow drift caused by breathing and electrode
 * movement. Subtract it from the signal to remove baseline wander.
 *
 * Compared with a high-pass filter, this does not ring after sharp QRS edges
 * and copes with sudden baseline jumps, but it is not a clean frequency cut.
 *
 * Reference: de Chazal, O'Dwyer & Reilly, "Automatic classification of
 * heartbeats using ECG morphology and heartbeat interval features", IEEE
 * Trans. Biomed. Eng. 51(7), 2004.
 */
export function medianBaseline(
  x: Signal,
  fs: number,
  firstWindowS = 0.2,
  secondWindowS = 0.6,
): Signal {
  const first = medianFilter(x, oddWindow(firstWindowS, fs));
  return medianFilter(first, oddWindow(secondWindowS, fs));
}
