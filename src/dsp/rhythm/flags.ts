import type { IntervalLabel } from '../hrv/intervals';
import { coefficientOfSampleEntropy } from './entropy';

export type FlagKind = 'tachycardia' | 'bradycardia' | 'pause' | 'premature' | 'irregular';

export interface FlagLocation {
  startS: number;
  endS: number;
}

/** One screening hint: what was seen and where. Wording for the user lives in the UI layer. */
export interface RhythmFlag {
  kind: FlagKind;
  /** Where it was found, in time order. */
  locations: FlagLocation[];
  /** The number that summarises the finding (see each detector). */
  value: number;
}

export interface RhythmOptions {
  /** A run of beats faster than this is flagged as fast. */
  tachycardiaBpm: number;
  /** A run of beats slower than this is flagged as slow. */
  bradycardiaBpm: number;
  /** A beat-to-beat interval longer than this is a pause. */
  pauseS: number;
}

export const RHYTHM_DEFAULTS: RhythmOptions = {
  tachycardiaBpm: 100,
  bradycardiaBpm: 60,
  pauseS: 2,
};

/** A fast or slow stretch must last this many beats in a row, so one odd interval is not an episode. */
const MIN_RUN_BEATS = 10;

/** Intervals per window when looking for an irregular rhythm, and the step between windows. */
export const IRREGULARITY_WINDOW = 30;
const IRREGULARITY_STEP = 10;
/**
 * A window is irregular when its beat-to-beat changes are large (RMSSD above
 * 10% of the mean interval) and also unpredictable (COSEn above -1.4). The
 * second condition is what separates atrial fibrillation from rhythms that
 * vary a lot but in a pattern, such as every second beat arriving early.
 * These two cut-offs are this project's choice; how they perform on annotated
 * recordings is measured by validation/benchmark/run_irregular.ts.
 */
export const NORMALIZED_RMSSD_THRESHOLD = 0.1;
export const COSEN_THRESHOLD = -1.4;
/** Irregular windows must cover at least this long before a flag is raised. */
const MIN_IRREGULAR_S = 30;

const usable = (label: IntervalLabel) => label !== 'implausible' && label !== 'lowQuality';

/** Stretches of at least `MIN_RUN_BEATS` consecutive usable intervals for which `test` holds. */
function runs(
  beatTimesS: ArrayLike<number>,
  intervalsMs: ArrayLike<number>,
  labels: readonly IntervalLabel[],
  test: (intervalMs: number) => boolean,
): FlagLocation[] {
  const found: FlagLocation[] = [];
  let start = -1;
  for (let i = 0; i <= intervalsMs.length; i++) {
    const inRun = i < intervalsMs.length && usable(labels[i]) && test(intervalsMs[i]);
    if (inRun && start === -1) start = i;
    if (!inRun && start !== -1) {
      // Interval k lies between beats k and k + 1.
      if (i - start >= MIN_RUN_BEATS)
        found.push({ startS: beatTimesS[start], endS: beatTimesS[i] });
      start = -1;
    }
  }
  return found;
}

function normalizedRmssd(intervalsMs: ArrayLike<number>): number {
  let sum = 0;
  let squares = 0;
  for (let i = 0; i < intervalsMs.length; i++) {
    sum += intervalsMs[i];
    if (i > 0) squares += (intervalsMs[i] - intervalsMs[i - 1]) ** 2;
  }
  return Math.sqrt(squares / (intervalsMs.length - 1)) / (sum / intervalsMs.length);
}

/**
 * Whether a window of consecutive intervals looks irregularly irregular.
 * Exposed for validation against annotated recordings.
 */
export function isIrregularWindow(intervalsMs: ArrayLike<number>): boolean {
  if (intervalsMs.length < 2) return false;
  return (
    normalizedRmssd(intervalsMs) > NORMALIZED_RMSSD_THRESHOLD &&
    coefficientOfSampleEntropy(intervalsMs) > COSEN_THRESHOLD
  );
}

/** Merge overlapping or touching time spans. */
function mergeSpans(spans: FlagLocation[]): FlagLocation[] {
  const merged: FlagLocation[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.startS <= last.endS) last.endS = Math.max(last.endS, span.endS);
    else merged.push({ ...span });
  }
  return merged;
}

function irregularEpisodes(
  beatTimesS: ArrayLike<number>,
  intervalsMs: ArrayLike<number>,
  labels: readonly IntervalLabel[],
): FlagLocation[] {
  const spans: FlagLocation[] = [];
  for (
    let start = 0;
    start + IRREGULARITY_WINDOW <= intervalsMs.length;
    start += IRREGULARITY_STEP
  ) {
    const end = start + IRREGULARITY_WINDOW;
    let allUsable = true;
    for (let i = start; i < end; i++) allUsable &&= usable(labels[i]);
    // Noise produces erratic intervals too; only clean stretches are judged.
    if (!allUsable) continue;
    const window = Array.prototype.slice.call(intervalsMs, start, end) as number[];
    if (isIrregularWindow(window)) spans.push({ startS: beatTimesS[start], endS: beatTimesS[end] });
  }
  return mergeSpans(spans).filter((span) => span.endS - span.startS >= MIN_IRREGULAR_S);
}

const totalDuration = (locations: FlagLocation[]) =>
  locations.reduce((sum, location) => sum + (location.endS - location.startS), 0);

/**
 * Look for a few simple rhythm patterns. These are screening hints for
 * learning and for checking a recording; they are not a diagnosis.
 *
 * - tachycardia / bradycardia: at least ten beats in a row faster / slower
 *   than the threshold. `value` is the total time spent in such runs, s.
 * - pause: a beat-to-beat interval above the pause threshold, outside
 *   low-quality signal. `value` is the longest pause, s.
 * - premature: an early beat followed by a longer-than-usual interval (the
 *   compensatory pause). `value` is the number of such beats.
 * - irregular: at least 30 s of windows whose intervals vary a lot and
 *   unpredictably, as in atrial fibrillation. `value` is the total time, s.
 *
 * @param beatTimesS beat times in seconds; interval `i` lies between beats `i` and `i + 1`
 * @returns only the flags that were raised, in a fixed order
 */
export function detectFlags(
  beatTimesS: ArrayLike<number>,
  intervalsMs: ArrayLike<number>,
  labels: readonly IntervalLabel[],
  options: RhythmOptions = RHYTHM_DEFAULTS,
): RhythmFlag[] {
  const flags: RhythmFlag[] = [];
  const add = (kind: FlagKind, locations: FlagLocation[], value: number) => {
    if (locations.length > 0) flags.push({ kind, locations, value });
  };

  const fast = runs(beatTimesS, intervalsMs, labels, (ms) => ms < 60_000 / options.tachycardiaBpm);
  add('tachycardia', fast, totalDuration(fast));

  const slow = runs(beatTimesS, intervalsMs, labels, (ms) => ms > 60_000 / options.bradycardiaBpm);
  add('bradycardia', slow, totalDuration(slow));

  const pauses: FlagLocation[] = [];
  const premature: FlagLocation[] = [];
  let longestPause = 0;
  for (let i = 0; i < intervalsMs.length; i++) {
    if (labels[i] !== 'lowQuality' && intervalsMs[i] > 1000 * options.pauseS) {
      pauses.push({ startS: beatTimesS[i], endS: beatTimesS[i + 1] });
      longestPause = Math.max(longestPause, intervalsMs[i] / 1000);
    }
    if (labels[i] === 'short' && labels[i + 1] === 'long') {
      premature.push({ startS: beatTimesS[i], endS: beatTimesS[i + 2] });
    }
  }
  add('pause', pauses, longestPause);
  add('premature', premature, premature.length);

  const irregular = irregularEpisodes(beatTimesS, intervalsMs, labels);
  add('irregular', irregular, totalDuration(irregular));

  return flags;
}
