export function mean(x: ArrayLike<number>): number {
  if (x.length === 0) return NaN;
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i];
  return sum / x.length;
}

/** Median of the values; does not modify the input. NaN for an empty input. */
export function median(x: ArrayLike<number>): number {
  if (x.length === 0) return NaN;
  const sorted = Float64Array.from(x).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Pearson kurtosis (normal distribution = 3). Returns NaN when the variance is
 * zero, because the ratio is undefined for a constant signal.
 */
export function kurtosis(x: ArrayLike<number>): number {
  const n = x.length;
  if (n === 0) return NaN;
  const mu = mean(x);
  let m2 = 0;
  let m4 = 0;
  for (let i = 0; i < n; i++) {
    const d2 = (x[i] - mu) ** 2;
    m2 += d2;
    m4 += d2 * d2;
  }
  m2 /= n;
  m4 /= n;
  return m2 === 0 ? NaN : m4 / (m2 * m2);
}
