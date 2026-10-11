import { median } from '../util/stats';

/**
 * Why an interval is or is not used for variability analysis.
 *  - `normal`: a plausible interval between two normal beats (an "NN" interval)
 *  - `short`: much shorter than its neighbours (early beat or false detection)
 *  - `long`: much longer than its neighbours (pause after an early beat, or a missed beat)
 *  - `implausible`: outside what a human heart can do
 *  - `lowQuality`: lies in a stretch of signal too noisy to trust
 */
export type IntervalLabel = 'normal' | 'short' | 'long' | 'implausible' | 'lowQuality';

export interface IntervalOptions {
  /** An interval further than this fraction from the local median is excluded. */
  tolerance: number;
  /** Number of neighbouring intervals on each side that form the local median. */
  neighbours: number;
  /** Shortest and longest interval accepted at all, in milliseconds. */
  minMs: number;
  maxMs: number;
}

/**
 * 20% is the long-standing rule of thumb for ectopic-beat filtering in HRV
 * analysis (e.g. Kleiger et al. 1987). 300–2000 ms is 200 down to 30 beats per
 * minute.
 */
export const INTERVAL_DEFAULTS: IntervalOptions = {
  tolerance: 0.2,
  neighbours: 5,
  minMs: 300,
  maxMs: 2000,
};

/**
 * Label each beat-to-beat interval as usable for HRV or not.
 *
 * HRV describes how the sinus node's rhythm is modulated. An ectopic beat does
 * not come from the sinus node, and a missed or false detection is not a
 * heartbeat interval at all; a single one can double RMSSD. So each interval
 * is compared with the median of its neighbours and excluded when it differs
 * by more than the tolerance. The median is used because, unlike the mean, it
 * is not pulled along by the outliers it is meant to expose.
 *
 * @param lowQuality optional flag per interval, set where the signal quality is poor
 */
export function classifyIntervals(
  intervalsMs: ArrayLike<number>,
  options: IntervalOptions = INTERVAL_DEFAULTS,
  lowQuality?: ArrayLike<boolean | number>,
): IntervalLabel[] {
  const n = intervalsMs.length;
  const labels: IntervalLabel[] = new Array<IntervalLabel>(n);
  for (let i = 0; i < n; i++) {
    const interval = intervalsMs[i];
    if (lowQuality?.[i]) {
      labels[i] = 'lowQuality';
      continue;
    }
    if (!(interval >= options.minMs && interval <= options.maxMs)) {
      labels[i] = 'implausible';
      continue;
    }
    const around: number[] = [];
    for (
      let j = Math.max(0, i - options.neighbours);
      j <= Math.min(n - 1, i + options.neighbours);
      j++
    ) {
      if (j !== i) around.push(intervalsMs[j]);
    }
    // A lone interval has nothing to be compared with.
    const reference = around.length > 0 ? median(around) : interval;
    const deviation = (interval - reference) / reference;
    labels[i] =
      deviation < -options.tolerance ? 'short' : deviation > options.tolerance ? 'long' : 'normal';
  }
  return labels;
}

export type ExclusionCounts = Record<Exclude<IntervalLabel, 'normal'>, number> & {
  /** Number of intervals in total, used or not. */
  total: number;
  /** Number of excluded intervals. */
  excluded: number;
};

/** How many intervals were excluded, by reason, so the user can see what was left out. */
export function countExclusions(labels: readonly IntervalLabel[]): ExclusionCounts {
  const counts: ExclusionCounts = {
    short: 0,
    long: 0,
    implausible: 0,
    lowQuality: 0,
    total: labels.length,
    excluded: 0,
  };
  for (const label of labels) {
    if (label === 'normal') continue;
    counts[label]++;
    counts.excluded++;
  }
  return counts;
}
