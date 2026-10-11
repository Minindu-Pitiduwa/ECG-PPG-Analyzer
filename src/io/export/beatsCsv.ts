import type { IntervalLabel } from '../../dsp/hrv/intervals';

export interface ExportBeat {
  timeS: number;
  source: 'auto' | 'manual';
  flagged: boolean;
}

const HEADER = 'beat,time_s,interval_ms,interval_label,source,flagged';

/**
 * One row per beat, for further analysis in a spreadsheet or script.
 *
 * `interval_ms` is the interval that ends at this beat (empty for the first
 * beat) and `interval_label` says whether it was used for the variability
 * metrics (`normal`) or why not. `flagged` marks beats that arrived early or at
 * an impossible time. Times keep microsecond precision, well below one sample.
 *
 * @param intervalsMs interval `i` lies between beats `i` and `i + 1`
 */
export function buildBeatsCsv(
  beats: readonly ExportBeat[],
  intervalsMs: ArrayLike<number>,
  labels: readonly IntervalLabel[],
): string {
  const rows = beats.map((beat, i) =>
    [
      i + 1,
      beat.timeS.toFixed(6),
      i > 0 ? intervalsMs[i - 1].toFixed(3) : '',
      i > 0 ? labels[i - 1] : '',
      beat.source,
      beat.flagged ? 1 : 0,
    ].join(','),
  );
  return [HEADER, ...rows].join('\n') + '\n';
}
