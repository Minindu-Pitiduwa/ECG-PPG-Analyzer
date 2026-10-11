import type { IntervalLabel } from './intervals';

export interface TimeDomainHrv {
  /** Number of normal (NN) intervals used. */
  count: number;
  /** Mean NN interval, ms. */
  meanNN: number;
  /** Standard deviation of NN intervals, ms: overall variability. */
  sdnn: number;
  /** Root mean square of successive differences, ms: beat-to-beat (vagal) variability. */
  rmssd: number;
  /** Percentage of successive differences larger than 50 ms. */
  pnn50: number;
}

const EMPTY: TimeDomainHrv = { count: 0, meanNN: NaN, sdnn: NaN, rmssd: NaN, pnn50: NaN };

/**
 * Differences between neighbouring NN intervals. A difference is only formed
 * when both intervals are normal and directly follow each other: after an
 * excluded interval the next one is not its successor, and bridging the gap
 * would invent a "successive difference" that never happened.
 */
export function successiveDifferences(
  intervalsMs: ArrayLike<number>,
  labels: readonly IntervalLabel[],
): Float64Array {
  const differences: number[] = [];
  for (let i = 1; i < intervalsMs.length; i++) {
    if (labels[i] === 'normal' && labels[i - 1] === 'normal') {
      differences.push(intervalsMs[i] - intervalsMs[i - 1]);
    }
  }
  return Float64Array.from(differences);
}

/** The intervals labelled normal, in order. */
export function normalIntervals(
  intervalsMs: ArrayLike<number>,
  labels: readonly IntervalLabel[],
): Float64Array {
  return Float64Array.from(Array.from(intervalsMs).filter((_, i) => labels[i] === 'normal'));
}

/**
 * Time-domain HRV measures, as defined by the Task Force standard.
 *
 *   SDNN  = standard deviation of the NN intervals (sample form, N - 1)
 *   RMSSD = sqrt( mean( (NN[i+1] - NN[i])^2 ) )
 *   pNN50 = share of successive differences with |difference| > 50 ms
 *
 * pNN50 is taken over the successive differences, which are what is being
 * counted. Some tools divide by the number of intervals instead, which gives a
 * value smaller by the factor (N - 1) / N.
 *
 * Measures that cannot be computed (fewer than two intervals for SDNN, no
 * successive pair for RMSSD and pNN50) are NaN.
 *
 * Reference: Task Force of the European Society of Cardiology and the North
 * American Society of Pacing and Electrophysiology, "Heart rate variability:
 * standards of measurement, physiological interpretation, and clinical use",
 * Circulation 93(5):1043–1065, 1996.
 */
export function timeDomainHrv(
  intervalsMs: ArrayLike<number>,
  labels: readonly IntervalLabel[],
): TimeDomainHrv {
  const nn = normalIntervals(intervalsMs, labels);
  if (nn.length === 0) return EMPTY;

  let sum = 0;
  for (const interval of nn) sum += interval;
  const meanNN = sum / nn.length;

  let squares = 0;
  for (const interval of nn) squares += (interval - meanNN) ** 2;
  const sdnn = nn.length > 1 ? Math.sqrt(squares / (nn.length - 1)) : NaN;

  const differences = successiveDifferences(intervalsMs, labels);
  let squaredDifferences = 0;
  let over50 = 0;
  for (const difference of differences) {
    squaredDifferences += difference * difference;
    if (Math.abs(difference) > 50) over50++;
  }
  const pairs = differences.length;
  return {
    count: nn.length,
    meanNN,
    sdnn,
    rmssd: pairs > 0 ? Math.sqrt(squaredDifferences / pairs) : NaN,
    pnn50: pairs > 0 ? (100 * over50) / pairs : NaN,
  };
}
