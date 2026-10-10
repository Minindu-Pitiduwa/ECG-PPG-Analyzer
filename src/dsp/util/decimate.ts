import type { Signal } from '../types';

export interface DecimatedSeries {
  /** Time of each kept sample, in seconds. */
  t: Float64Array;
  y: Float64Array;
}

/**
 * Reduce a slice of a signal to at most `2 * buckets` points for drawing.
 *
 * The slice is split into equal-width buckets and only the minimum and maximum
 * sample of each bucket are kept, in their original order. Unlike averaging or
 * LTTB, this can never drop an extreme, so narrow R-peaks keep their true height
 * at any zoom level. This is the same envelope a digital oscilloscope draws.
 *
 * @param start first sample index (inclusive); clamped to the signal
 * @param end last sample index (exclusive); clamped to the signal
 * @param buckets number of buckets, typically the plot width in pixels
 */
export function decimateMinMax(
  x: Signal,
  fs: number,
  start: number,
  end: number,
  buckets: number,
): DecimatedSeries {
  const from = Math.max(0, Math.floor(start));
  const to = Math.min(x.length, Math.ceil(end));
  const count = to - from;
  if (count <= 0 || buckets < 1) return { t: new Float64Array(0), y: new Float64Array(0) };

  if (count <= 2 * buckets) {
    const t = new Float64Array(count);
    for (let i = 0; i < count; i++) t[i] = (from + i) / fs;
    return { t, y: x.slice(from, to) };
  }

  const t = new Float64Array(2 * buckets);
  const y = new Float64Array(2 * buckets);
  let written = 0;
  for (let b = 0; b < buckets; b++) {
    const bucketStart = from + Math.floor((b * count) / buckets);
    const bucketEnd = from + Math.floor(((b + 1) * count) / buckets);
    let minIndex = bucketStart;
    let maxIndex = bucketStart;
    for (let i = bucketStart + 1; i < bucketEnd; i++) {
      if (x[i] < x[minIndex]) minIndex = i;
      else if (x[i] > x[maxIndex]) maxIndex = i;
    }
    const first = Math.min(minIndex, maxIndex);
    const second = Math.max(minIndex, maxIndex);
    t[written] = first / fs;
    y[written++] = x[first];
    if (second !== first) {
      t[written] = second / fs;
      y[written++] = x[second];
    }
  }
  return { t: t.subarray(0, written), y: y.subarray(0, written) };
}

/** Smallest and largest value in `x[start, end)`. Returns `[NaN, NaN]` for an empty range. */
export function extent(x: ArrayLike<number>, start = 0, end = x.length): [number, number] {
  if (end <= start) return [NaN, NaN];
  let lo = x[start];
  let hi = x[start];
  for (let i = start + 1; i < end; i++) {
    if (x[i] < lo) lo = x[i];
    else if (x[i] > hi) hi = x[i];
  }
  return [lo, hi];
}
