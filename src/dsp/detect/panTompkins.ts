/**
 * QRS detection after Pan & Tompkins.
 *
 * Reference: J. Pan and W. J. Tompkins, "A real-time QRS detection algorithm",
 * IEEE Trans. Biomed. Eng. BME-32(3):230–236, 1985.
 *
 * The idea: turn each QRS complex into one smooth bump, then decide with
 * thresholds that keep adapting to the signal which bumps are heartbeats.
 *
 *   ECG -> band-pass 5–15 Hz -> derivative -> square -> moving-window integral
 *       -> peaks -> adaptive thresholds, refractory period, T-wave check,
 *          search-back -> R-peak refinement
 *
 * What is kept from the paper: the whole decision logic. Two sets of
 * signal/noise level estimates (on the integrated and on the band-passed
 * signal), the threshold formulas and their coefficients, the 200 ms
 * refractory period, T-wave discrimination by slope for beats closer than
 * 360 ms, the two RR-interval averages, and search-back with the halved
 * thresholds when no beat arrives within 166% of the expected interval.
 *
 * What is adapted, and why:
 *  - The paper's filters have integer coefficients hard-wired to 200 Hz for an
 *    8-bit microprocessor. Here the 5–15 Hz band is a Butterworth filter and
 *    the derivative and integration window are scaled to the sampling rate, so
 *    any sampling rate works.
 *  - The paper filters causally and compensates for the delays. This runs
 *    offline, so it uses zero-phase filtering and centred windows; every stage
 *    stays aligned with the ECG and no delay bookkeeping is needed.
 */

import { butterSos } from '../filters/butter';
import { sosfiltfilt } from '../filters/sosfilt';
import type { Signal } from '../types';
import { movingAverage } from '../util/movingAverage';
import { mean } from '../util/stats';
import { enforceMinDistance, extremumIndex, isNumericallyFlat } from './refine';

export interface PanTompkinsOptions {
  /** Pass band that isolates QRS energy from P/T waves, drift and muscle noise. */
  bandHz: readonly [number, number];
  /** Integration window; about the width of the widest normal QRS. */
  integrationWindowS: number;
  /** Shortest physiologically possible interval between beats. */
  refractoryS: number;
  /** A beat closer than this to the previous one must pass the T-wave slope check. */
  tWaveWindowS: number;
  /** Look back for a missed beat when none arrives in time. */
  searchBack: boolean;
}

export const PAN_TOMPKINS_DEFAULTS: PanTompkinsOptions = {
  bandHz: [5, 15],
  integrationWindowS: 0.15,
  refractoryS: 0.2,
  tWaveWindowS: 0.36,
  searchBack: true,
};

const BAND_ORDER = 2;
/** The paper's 5-point derivative assumes 5 ms between samples. */
const DERIVATIVE_REFERENCE_HZ = 200;
/** Length of the start-up segment used to initialise the level estimates. */
const LEARNING_S = 2;
/** How far from the integrator peak the band-passed QRS peak may lie. */
const QRS_SEARCH_S = 0.1;
/** How far the R peak on the ECG may lie from the band-passed peak. */
const R_REFINE_S = 0.05;

/** Weights of the running level estimates (paper, eq. 12–13 and 17–18). */
const LEVEL_WEIGHT = 0.125;
const SEARCH_BACK_LEVEL_WEIGHT = 0.25;
/** Threshold position between the noise level and the signal level (eq. 14). */
const THRESHOLD_FRACTION = 0.25;
const SECOND_THRESHOLD_FACTOR = 0.5;
/** Limits around the regular-rhythm RR average (eq. 26–28). */
const RR_LOW = 0.92;
const RR_HIGH = 1.16;
const RR_MISSED = 1.66;
const RR_HISTORY = 8;
/** A candidate with less than this share of the previous beat's slope is a T wave. */
const T_WAVE_SLOPE_RATIO = 0.5;

export interface PanTompkinsStages {
  bandpassed: Signal;
  derivative: Signal;
  squared: Signal;
  integrated: Signal;
}

/**
 * Five-point derivative (paper, eq. 4), with the sample spacing widened at
 * higher sampling rates so it responds to the same slopes as at 200 Hz.
 */
function derivative(x: Signal, fs: number): Signal {
  const step = Math.max(1, Math.round(fs / DERIVATIVE_REFERENCE_HZ));
  const n = x.length;
  const at = (index: number) => x[Math.min(Math.max(index, 0), n - 1)];
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = (2 * at(i + step) + at(i + 2 * step) - 2 * at(i - step) - at(i - 2 * step)) / 8;
  }
  return out;
}

/**
 * The signal-conditioning half of the algorithm. Exposed so the intermediate
 * signals can be inspected and tested.
 */
export function panTompkinsStages(
  x: Signal,
  fs: number,
  options: PanTompkinsOptions = PAN_TOMPKINS_DEFAULTS,
): PanTompkinsStages {
  // Keep the upper edge clear of Nyquist for low sampling rates.
  const upper = Math.min(options.bandHz[1], 0.45 * fs);
  const lower = Math.min(options.bandHz[0], upper / 2);
  const bandpassed = sosfiltfilt(butterSos(BAND_ORDER, [lower, upper], 'band', fs), x);
  const slope = derivative(bandpassed, fs);
  // Squaring makes everything positive and emphasises the steep QRS slopes over P and T waves.
  const squared = slope.map((value) => value * value);
  const integrated = movingAverage(
    squared,
    Math.max(1, Math.round(options.integrationWindowS * fs)),
  );
  return { bandpassed, derivative: slope, squared, integrated };
}

/** Local maxima of the integrated signal, at most one per refractory period. */
function candidatePeaks(integrated: Signal, refractory: number): number[] {
  const maxima: number[] = [];
  for (let i = 1; i < integrated.length - 1; i++) {
    if (integrated[i] > integrated[i - 1] && integrated[i] >= integrated[i + 1]) maxima.push(i);
  }
  return enforceMinDistance(maxima, refractory, (index) => integrated[index]);
}

function maxAbs(x: Signal, from: number, to: number): number {
  let best = 0;
  for (let i = Math.max(0, from); i <= Math.min(x.length - 1, to); i++) {
    const value = Math.abs(x[i]);
    if (value > best) best = value;
  }
  return best;
}

interface Candidate {
  index: number;
  /** Peak height in the integrated signal. */
  integratedPeak: number;
  /** Peak height in the band-passed signal. */
  filteredPeak: number;
  /** Steepest slope of the band-passed signal around the peak. */
  slope: number;
}

/** A running estimate of the signal-peak and noise-peak levels of one signal. */
class LevelTracker {
  constructor(
    private signal: number,
    private noise: number,
  ) {}

  /** Threshold a peak must exceed to count as a beat (paper, eq. 14 and 19). */
  get threshold(): number {
    return this.noise + THRESHOLD_FRACTION * (this.signal - this.noise);
  }

  addSignal(peak: number, weight = LEVEL_WEIGHT): void {
    this.signal = weight * peak + (1 - weight) * this.signal;
  }

  addNoise(peak: number): void {
    this.noise = LEVEL_WEIGHT * peak + (1 - LEVEL_WEIGHT) * this.noise;
  }
}

/** The two RR-interval averages that define when a beat counts as missed. */
class RhythmTracker {
  private recent: number[] = [];
  private regular: number[] = [];

  add(interval: number): void {
    this.recent.push(interval);
    if (this.recent.length > RR_HISTORY) this.recent.shift();
    // Only intervals near the current average update it, so one ectopic beat cannot drag it away.
    const average = this.regularAverage;
    if (average === null || (interval >= RR_LOW * average && interval <= RR_HIGH * average)) {
      this.regular.push(interval);
      if (this.regular.length > RR_HISTORY) this.regular.shift();
    }
  }

  private get regularAverage(): number | null {
    return this.regular.length > 0 ? mean(this.regular) : null;
  }

  /** Longest gap, in samples, before a beat is presumed missed; `null` until a rhythm is known. */
  get missedLimit(): number | null {
    const average = this.regularAverage ?? (this.recent.length > 0 ? mean(this.recent) : null);
    return average === null ? null : RR_MISSED * average;
  }

  /**
   * True when the last eight intervals are not all near the regular average.
   * The paper then halves the detection thresholds to avoid missing beats.
   */
  get irregular(): boolean {
    const average = this.regularAverage;
    if (average === null || this.recent.length < RR_HISTORY) return false;
    return this.recent.some(
      (interval) => interval < RR_LOW * average || interval > RR_HIGH * average,
    );
  }
}

/** Apply the adaptive decision rules to the candidate peaks, in time order. */
function classify(
  candidates: Candidate[],
  stages: PanTompkinsStages,
  fs: number,
  options: PanTompkinsOptions,
): Candidate[] {
  const refractory = Math.round(options.refractoryS * fs);
  const tWaveWindow = Math.round(options.tWaveWindowS * fs);
  const learning = Math.min(stages.integrated.length, Math.round(LEARNING_S * fs));

  // Start-up levels from the first two seconds, as in the widely used reference
  // implementations: a third of the largest peak as signal, half the mean as noise.
  const integratedStart = stages.integrated.subarray(0, learning);
  const filteredStart = stages.bandpassed.subarray(0, learning).map(Math.abs);
  const integratedLevel = new LevelTracker(
    maxAbs(integratedStart, 0, learning) / 3,
    mean(integratedStart) / 2,
  );
  const filteredLevel = new LevelTracker(
    maxAbs(filteredStart, 0, learning) / 3,
    mean(filteredStart) / 2,
  );

  const rhythm = new RhythmTracker();
  const beats: Candidate[] = [];
  /** Peaks rejected since the last beat; search-back chooses among these. */
  let rejected: Candidate[] = [];

  const lastBeat = () => beats[beats.length - 1];

  const accept = (candidate: Candidate, weight?: number) => {
    const previous = lastBeat();
    if (previous) rhythm.add(candidate.index - previous.index);
    integratedLevel.addSignal(candidate.integratedPeak, weight);
    filteredLevel.addSignal(candidate.filteredPeak, weight);
    beats.push(candidate);
    rejected = rejected.filter((other) => other.index - candidate.index >= refractory);
  };

  const reject = (candidate: Candidate) => {
    integratedLevel.addNoise(candidate.integratedPeak);
    filteredLevel.addNoise(candidate.filteredPeak);
    rejected.push(candidate);
  };

  /** If a beat is overdue at sample `now`, promote the best rejected peak that clears the second thresholds. */
  const searchBack = (now: number) => {
    if (!options.searchBack) return;
    for (;;) {
      const previous = lastBeat();
      const limit = rhythm.missedLimit;
      if (!previous || limit === null || now - previous.index <= limit) return;
      const secondIntegrated = SECOND_THRESHOLD_FACTOR * integratedLevel.threshold;
      const secondFiltered = SECOND_THRESHOLD_FACTOR * filteredLevel.threshold;
      let best: Candidate | null = null;
      for (const candidate of rejected) {
        const eligible =
          candidate.index - previous.index >= refractory &&
          candidate.integratedPeak > secondIntegrated &&
          candidate.filteredPeak > secondFiltered;
        if (eligible && (best === null || candidate.integratedPeak > best.integratedPeak))
          best = candidate;
      }
      if (best === null) return;
      accept(best, SEARCH_BACK_LEVEL_WEIGHT);
    }
  };

  for (const candidate of candidates) {
    const previous = lastBeat();
    // Nothing closer than the refractory period can be another beat; ignore it entirely.
    if (previous && candidate.index - previous.index < refractory) continue;
    searchBack(candidate.index);

    const sensitivity = rhythm.irregular ? SECOND_THRESHOLD_FACTOR : 1;
    const aboveThresholds =
      candidate.integratedPeak > sensitivity * integratedLevel.threshold &&
      candidate.filteredPeak > sensitivity * filteredLevel.threshold;
    const latest = lastBeat();
    // A T wave can be as tall as a QRS after integration, but it is much less steep.
    const looksLikeTWave =
      latest !== undefined &&
      candidate.index - latest.index < tWaveWindow &&
      candidate.slope < T_WAVE_SLOPE_RATIO * latest.slope;

    if (aboveThresholds && !looksLikeTWave) accept(candidate);
    else reject(candidate);
  }
  searchBack(stages.integrated.length);

  return beats.sort((a, b) => a.index - b.index);
}

/**
 * Move a detection from the integrator bump to the R peak itself.
 *
 * The largest lobe of the band-passed QRS gives both the position and the
 * polarity of the main deflection; the peak of that polarity is then located
 * on the caller's signal. Using the polarity means inverted complexes
 * (negative R waves) are marked at their tip too.
 */
function refineToRPeak(x: Signal, bandpassed: Signal, index: number, fs: number): number {
  const search = Math.round(QRS_SEARCH_S * fs);
  const from = Math.max(0, index - search);
  const to = Math.min(x.length - 1, index + search);
  let lobe = from;
  for (let i = from + 1; i <= to; i++) {
    if (Math.abs(bandpassed[i]) > Math.abs(bandpassed[lobe])) lobe = i;
  }
  const refine = Math.round(R_REFINE_S * fs);
  return extremumIndex(x, lobe - refine, lobe + refine, bandpassed[lobe] >= 0 ? 1 : -1);
}

/**
 * Detect the R peaks of an ECG.
 *
 * @param x the ECG, raw or already cleaned; the detector applies its own band-pass
 * @returns sample indices of the R peaks, in increasing order
 */
export function panTompkins(
  x: Signal,
  fs: number,
  options: PanTompkinsOptions = PAN_TOMPKINS_DEFAULTS,
): Int32Array {
  const refractory = Math.round(options.refractoryS * fs);
  // Too short to hold even one beat and its surroundings.
  if (x.length < 2 * refractory) return new Int32Array(0);

  const stages = panTompkinsStages(x, fs, options);
  if (isNumericallyFlat(stages.bandpassed, x)) return new Int32Array(0);
  const search = Math.round(QRS_SEARCH_S * fs);
  const candidates = candidatePeaks(stages.integrated, refractory).map((index): Candidate => ({
    index,
    integratedPeak: stages.integrated[index],
    filteredPeak: maxAbs(stages.bandpassed, index - search, index + search),
    slope: maxAbs(stages.derivative, index - search, index + search),
  }));
  const beats = classify(candidates, stages, fs, options);
  const refined = beats.map((beat) => refineToRPeak(x, stages.bandpassed, beat.index, fs));
  return Int32Array.from(
    enforceMinDistance(refined, refractory, (index) => Math.abs(stages.bandpassed[index])),
  );
}
