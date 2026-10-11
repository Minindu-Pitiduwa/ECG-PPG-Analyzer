import type { Signal, SignalKind } from '../types';
import { median } from '../util/stats';

export interface SegmentQuality {
  startS: number;
  endS: number;
  /** 0 (unusable) to 1 (every beat looks like the others). */
  score: number;
  good: boolean;
}

export interface QualityOptions {
  /** Length of the segments that are scored, in seconds. */
  segmentS: number;
  /** A segment scoring below this is low quality. */
  threshold: number;
  /** A segment with a silent stretch longer than this is low quality whatever its score. */
  maxGapS: number;
}

/**
 * Thresholds from Orphanidou et al.: an average beat-to-template correlation
 * below 0.66 (ECG) or 0.86 (PPG) marked signals from which a heart rate could
 * not be trusted. PPG pulses are smooth and all look alike, so even a poor PPG
 * correlates well and its threshold has to be higher.
 */
export function defaultQualityOptions(kind: SignalKind): QualityOptions {
  return { segmentS: 10, threshold: kind === 'ecg' ? 0.66 : 0.86, maxGapS: 3 };
}

/** Each beat is compared over this share of the typical beat-to-beat interval, centred on the beat. */
const WINDOW_FRACTION = 0.6;
const MIN_HALF_WINDOW_S = 0.1;
const MAX_HALF_WINDOW_S = 0.35;
/** Fewer beats than this cannot form a template to compare against. */
const MIN_BEATS = 3;

function correlation(a: Float64Array, b: Float64Array): number {
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < a.length; i++) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= a.length;
  meanB /= a.length;
  let cross = 0;
  let powerA = 0;
  let powerB = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cross += da * db;
    powerA += da * da;
    powerB += db * db;
  }
  const denominator = Math.sqrt(powerA * powerB);
  return denominator > 0 ? cross / denominator : 0;
}

/** Score one segment from the beats that fall inside it. */
function scoreSegment(x: Signal, fs: number, beatTimesS: number[]): number {
  if (beatTimesS.length < MIN_BEATS) return 0;
  const intervals = beatTimesS.slice(1).map((time, i) => time - beatTimesS[i]);
  const halfWindowS = Math.min(
    MAX_HALF_WINDOW_S,
    Math.max(MIN_HALF_WINDOW_S, (WINDOW_FRACTION * median(intervals)) / 2),
  );
  const half = Math.round(halfWindowS * fs);

  const windows: Float64Array[] = [];
  for (const time of beatTimesS) {
    const center = Math.round(time * fs);
    if (center - half >= 0 && center + half < x.length)
      windows.push(x.subarray(center - half, center + half + 1));
  }
  if (windows.length < MIN_BEATS) return 0;

  const template = new Float64Array(2 * half + 1);
  for (const window of windows)
    for (let i = 0; i < template.length; i++) template[i] += window[i] / windows.length;

  // The median keeps a few genuinely different beats (ectopics) from marking a clean segment as noisy.
  const score = median(windows.map((window) => correlation(window, template)));
  return Math.min(1, Math.max(0, score));
}

/**
 * Signal quality index by template matching.
 *
 * Real heartbeats repeat: within a few seconds every beat has nearly the same
 * shape. Noise and motion artifacts do not. So the recording is cut into short
 * segments; in each, the beats are averaged into a template and every beat is
 * correlated with it. The typical correlation is the score. A segment is also
 * marked low quality when beats are missing for several seconds, because then
 * there is nothing to correlate.
 *
 * Reference: Orphanidou et al., "Signal-quality indices for the
 * electrocardiogram and photoplethysmogram: derivation and applications to
 * wireless monitoring", IEEE J. Biomed. Health Inform. 19(3):832–838, 2015.
 *
 * @param x the filtered signal the beats were detected on
 * @param beatTimesS beat times in seconds, increasing
 */
export function templateSqi(
  x: Signal,
  fs: number,
  beatTimesS: ArrayLike<number>,
  options: QualityOptions,
): SegmentQuality[] {
  const durationS = x.length / fs;
  const segments: SegmentQuality[] = [];
  let beat = 0;
  for (let startS = 0; startS < durationS; startS += options.segmentS) {
    const endS = Math.min(durationS, startS + options.segmentS);
    const inside: number[] = [];
    while (beat < beatTimesS.length && beatTimesS[beat] < endS) inside.push(beatTimesS[beat++]);

    // Silence at the segment edges counts too, measured from the segment boundaries.
    const marks = [startS, ...inside, endS];
    let longestGap = 0;
    for (let i = 1; i < marks.length; i++)
      longestGap = Math.max(longestGap, marks[i] - marks[i - 1]);
    // A final segment shorter than the gap limit cannot be judged by gaps or hold enough beats.
    const tooShortToJudge = endS - startS < options.maxGapS;

    const score = scoreSegment(x, fs, inside);
    const good = score >= options.threshold && longestGap <= options.maxGapS;
    segments.push({
      startS,
      endS,
      score,
      good: tooShortToJudge ? (segments.at(-1)?.good ?? good) : good,
    });
  }
  return segments;
}

/** Share of the recording's segments that are good quality, 0 to 1. NaN without segments. */
export function goodFraction(segments: readonly SegmentQuality[]): number {
  if (segments.length === 0) return NaN;
  return segments.filter((segment) => segment.good).length / segments.length;
}

/** For each interval (ending at beat i + 1), whether that beat lies in a low-quality segment. */
export function intervalsInLowQuality(
  beatTimesS: ArrayLike<number>,
  segments: readonly SegmentQuality[],
  segmentS: number,
): boolean[] {
  const flags: boolean[] = [];
  for (let i = 1; i < beatTimesS.length; i++) {
    const segment = segments[Math.min(segments.length - 1, Math.floor(beatTimesS[i] / segmentS))];
    const previous =
      segments[Math.min(segments.length - 1, Math.floor(beatTimesS[i - 1] / segmentS))];
    // An interval is only trustworthy when both of its beats are.
    flags.push(segment !== undefined && previous !== undefined && !(segment.good && previous.good));
  }
  return flags;
}
