import {
  COSEN_THRESHOLD,
  IRREGULARITY_WINDOW,
  NORMALIZED_RMSSD_THRESHOLD,
  type FlagKind,
  type RhythmFlag,
  type RhythmOptions,
} from '@/dsp/rhythm/flags';
import { formatDuration } from '@/lib/format';

const plural = (count: number, word: string, many = `${word}s`) =>
  `${count} ${count === 1 ? word : many}`;

/** What was found, in one sentence. */
export function flagSummary(flag: RhythmFlag, options: RhythmOptions, beatCount: number): string {
  const count = flag.locations.length;
  switch (flag.kind) {
    case 'tachycardia':
      return `${plural(count, 'stretch', 'stretches')} faster than ${options.tachycardiaBpm} bpm, ${formatDuration(flag.value)} in total.`;
    case 'bradycardia':
      return `${plural(count, 'stretch', 'stretches')} slower than ${options.bradycardiaBpm} bpm, ${formatDuration(flag.value)} in total. Common and normal in athletes and during sleep.`;
    case 'pause':
      return `${plural(count, 'gap')} between beats longer than ${options.pauseS} s; the longest is ${flag.value.toFixed(1)} s. A missed detection looks the same, so check each one on the plot.`;
    case 'premature':
      return `${plural(count, 'early beat')} followed by a longer gap (${((100 * count) / Math.max(1, beatCount)).toFixed(1)}% of all beats). This is the pattern of ectopic (extra) beats.`;
    case 'irregular':
      return `${formatDuration(flag.value)} of rhythm that varies strongly and unpredictably from beat to beat. Atrial fibrillation looks like this, but so do frequent ectopic beats and noise.`;
  }
}

/** How it was computed, so the user can judge and reproduce it. */
export function flagMethod(kind: FlagKind, options: RhythmOptions): string {
  switch (kind) {
    case 'tachycardia':
      return `At least 10 beats in a row with every interval shorter than ${Math.round(60_000 / options.tachycardiaBpm)} ms (${options.tachycardiaBpm} bpm). Intervals that are implausible or in low-quality signal end a run.`;
    case 'bradycardia':
      return `At least 10 beats in a row with every interval longer than ${Math.round(60_000 / options.bradycardiaBpm)} ms (${options.bradycardiaBpm} bpm). Intervals that are implausible or in low-quality signal end a run.`;
    case 'pause':
      return `Any beat-to-beat interval longer than ${options.pauseS} s, except in segments marked as low signal quality.`;
    case 'premature':
      return 'An interval more than 20% shorter than the median of its ten neighbours, immediately followed by one more than 20% longer.';
    case 'irregular':
      return `Windows of ${IRREGULARITY_WINDOW} intervals in which RMSSD exceeds ${100 * NORMALIZED_RMSSD_THRESHOLD}% of the mean interval and the coefficient of sample entropy (Lake & Moorman 2011) exceeds ${COSEN_THRESHOLD}. Flagged when such windows cover at least 30 s. Windows containing implausible or low-quality intervals are skipped.`;
  }
}
