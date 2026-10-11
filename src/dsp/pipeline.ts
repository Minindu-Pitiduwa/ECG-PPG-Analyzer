import { dominantPolarity } from './detect/edits';
import { elgendiPpg } from './detect/elgendi';
import { panTompkins } from './detect/panTompkins';
import { peakTimes } from './detect/refine';
import { preprocess, type PreprocessOptions, type PreprocessResult } from './filters/preprocess';
import type { Signal, SignalKind } from './types';

export interface AnalysisOptions {
  preprocess: PreprocessOptions;
}

export interface AnalysisResult extends PreprocessResult {
  /** Sample index of each detected beat. */
  peaks: Int32Array;
  /** Time of each detected beat in seconds, with sub-sample precision. */
  beatTimesS: Float64Array;
  /** Whether beats are marked at maxima (1) or minima (-1) of the filtered signal. */
  polarity: 1 | -1;
}

/**
 * The full automatic analysis of one recording: clean the signal, then find
 * the beats on the cleaned signal. Everything downstream (heart rate,
 * variability, flags) is derived from the beat times.
 *
 * Detection runs on the filtered signal so that the markers sit exactly on the
 * peaks of the trace the user sees.
 */
export function analyzeRecording(
  x: Signal,
  fs: number,
  kind: SignalKind,
  options: AnalysisOptions,
): AnalysisResult {
  const cleaned = preprocess(x, fs, options.preprocess);
  const peaks =
    kind === 'ecg' ? panTompkins(cleaned.filtered, fs) : elgendiPpg(cleaned.filtered, fs);
  return {
    ...cleaned,
    peaks,
    beatTimesS: peakTimes(cleaned.filtered, peaks, fs),
    polarity: kind === 'ecg' ? dominantPolarity(cleaned.filtered, peaks, fs) : 1,
  };
}
