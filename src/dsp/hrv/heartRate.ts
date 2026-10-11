export interface HeartRateStats {
  /** Average rate in beats per minute: 60 000 / mean interval. */
  meanBpm: number;
  /** Slowest instantaneous rate (from the longest interval). */
  minBpm: number;
  /** Fastest instantaneous rate (from the shortest interval). */
  maxBpm: number;
}

/**
 * Intervals between successive beats, in milliseconds. For an ECG these are
 * the RR intervals. `n` beats give `n - 1` intervals.
 */
export function beatIntervalsMs(beatTimesS: ArrayLike<number>): Float64Array {
  const count = Math.max(0, beatTimesS.length - 1);
  return Float64Array.from({ length: count }, (_, i) => 1000 * (beatTimesS[i + 1] - beatTimesS[i]));
}

/**
 * Heart rate summary from beat-to-beat intervals.
 *
 * The mean rate is computed from the mean interval, not as the mean of the
 * instantaneous rates: the latter weights fast beats too heavily and no longer
 * equals "beats counted divided by time".
 *
 * All values are NaN when there are no intervals.
 */
export function heartRateStats(intervalsMs: ArrayLike<number>): HeartRateStats {
  if (intervalsMs.length === 0) return { meanBpm: NaN, minBpm: NaN, maxBpm: NaN };
  let sum = 0;
  let shortest = Infinity;
  let longest = -Infinity;
  for (let i = 0; i < intervalsMs.length; i++) {
    sum += intervalsMs[i];
    shortest = Math.min(shortest, intervalsMs[i]);
    longest = Math.max(longest, intervalsMs[i]);
  }
  return {
    meanBpm: 60_000 / (sum / intervalsMs.length),
    minBpm: 60_000 / longest,
    maxBpm: 60_000 / shortest,
  };
}

export interface HeartRateSeries {
  /** Time of the beat that ends each interval, in seconds. */
  timeS: Float64Array;
  /** Instantaneous heart rate for that interval, in beats per minute. */
  bpm: Float64Array;
}

/** Instantaneous heart rate over time: one point per beat-to-beat interval. */
export function heartRateSeries(beatTimesS: ArrayLike<number>): HeartRateSeries {
  const intervals = beatIntervalsMs(beatTimesS);
  return {
    timeS: Float64Array.from(intervals, (_, i) => beatTimesS[i + 1]),
    bpm: intervals.map((interval) => 60_000 / interval),
  };
}
