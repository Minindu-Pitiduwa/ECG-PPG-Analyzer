import type { Signal, SignalKind } from '../types';
import { kurtosis } from './stats';

/** Seconds of signal inspected; enough to cover several beats at any plausible heart rate. */
const INSPECT_SECONDS = 30;

/**
 * Sample-to-sample differences of an ECG are near zero except during the brief
 * QRS complex, which gives them a very heavy-tailed distribution (kurtosis in
 * the tens). A PPG pulse is smooth, so its differences stay close to a
 * sinusoid's (kurtosis of a few). On the bundled samples the PPG measures
 * about 5 and the ECGs 13 (noisy) to 30 (clean); the threshold sits between.
 */
const ECG_DIFF_KURTOSIS_THRESHOLD = 9;

/**
 * Guess whether a recording is an ECG or a PPG from its shape.
 *
 * This is a hint used to pre-select the signal type in the import form. It is
 * easily fooled by noise or unusual leads, so the user can always override it.
 * Returns `null` when the signal is too short or flat to say anything.
 */
export function guessSignalKind(x: Signal, fs: number): SignalKind | null {
  const n = Math.min(x.length, Math.round(INSPECT_SECONDS * fs));
  if (n < 2 * fs) return null;

  // Compare samples ~10 ms apart so the result does not depend on the sampling rate.
  const lag = Math.max(1, Math.round(fs / 100));
  const diff = new Float64Array(n - lag);
  for (let i = 0; i < diff.length; i++) diff[i] = x[i + lag] - x[i];

  const k = kurtosis(diff);
  if (Number.isNaN(k)) return null;
  return k > ECG_DIFF_KURTOSIS_THRESHOLD ? 'ecg' : 'ppg';
}
