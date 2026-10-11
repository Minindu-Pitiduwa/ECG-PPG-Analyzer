import type { IntervalLabel } from './intervals';

export interface Poincare {
  /** Each point is one pair of successive NN intervals: (NN[i], NN[i+1]), in ms. */
  x: Float64Array;
  y: Float64Array;
  /** Spread across the line of identity, ms: short-term (beat-to-beat) variability. */
  sd1: number;
  /** Spread along the line of identity, ms: longer-term variability. */
  sd2: number;
  /** Centre of the cloud (mean NN), ms. */
  center: number;
}

function sampleStd(values: Float64Array): number {
  if (values.length < 2) return NaN;
  let sum = 0;
  for (const value of values) sum += value;
  const mean = sum / values.length;
  let squares = 0;
  for (const value of values) squares += (value - mean) ** 2;
  return Math.sqrt(squares / (values.length - 1));
}

/**
 * Poincaré plot: every NN interval plotted against the next one.
 *
 * A steady rhythm gives a tight cloud on the diagonal `y = x`. Rotating the
 * cloud by 45 degrees separates two kinds of variability: SD1, the spread
 * perpendicular to the diagonal, measures how much each interval differs from
 * the one before it; SD2, the spread along the diagonal, measures how the
 * interval level wanders over longer times. SD1 carries the same information
 * as RMSSD: SD1^2 is half the variance of the successive differences.
 *
 * As for RMSSD, only pairs of normal intervals that directly follow each
 * other are used.
 *
 * Reference: Brennan, Palaniswami & Kamen, "Do existing measures of Poincaré
 * plot geometry reflect nonlinear features of heart rate variability?", IEEE
 * Trans. Biomed. Eng. 48(11):1342–1347, 2001.
 */
export function poincare(
  intervalsMs: ArrayLike<number>,
  labels: readonly IntervalLabel[],
): Poincare {
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 1; i < intervalsMs.length; i++) {
    if (labels[i] === 'normal' && labels[i - 1] === 'normal') {
      x.push(intervalsMs[i - 1]);
      y.push(intervalsMs[i]);
    }
  }
  const across = Float64Array.from(x, (value, i) => (y[i] - value) / Math.SQRT2);
  const along = Float64Array.from(x, (value, i) => (y[i] + value) / Math.SQRT2);
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i] + y[i];
  return {
    x: Float64Array.from(x),
    y: Float64Array.from(y),
    sd1: sampleStd(across),
    sd2: sampleStd(along),
    center: x.length > 0 ? sum / (2 * x.length) : NaN,
  };
}
