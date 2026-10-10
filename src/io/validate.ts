import type { Signal, SignalKind } from '@/dsp/types';
import { extent } from '@/dsp/util/decimate';
import { ImportError } from './types';

export const MIN_SAMPLING_RATE_HZ = 20;
export const MAX_SAMPLING_RATE_HZ = 10_000;
/** Below this there are too few beats to detect a rhythm at all. */
const MIN_DURATION_S = 3;
/** Below this, results exist but most statistics are not meaningful. */
const SHORT_DURATION_S = 10;
/** QRS complexes carry energy up to ~40 Hz; sampling below this visibly distorts them. */
const LOW_ECG_SAMPLING_RATE_HZ = 100;

/** Returns an error message for an unusable sampling rate, or `null` when it is acceptable. */
export function samplingRateError(fs: number): string | null {
  if (!Number.isFinite(fs) || fs <= 0) return 'Enter the sampling rate as a positive number.';
  if (fs < MIN_SAMPLING_RATE_HZ) {
    return `${fs} Hz is too low to capture heartbeats. Use at least ${MIN_SAMPLING_RATE_HZ} Hz.`;
  }
  if (fs > MAX_SAMPLING_RATE_HZ) {
    return `${fs} Hz is unusually high. Check the value (maximum ${MAX_SAMPLING_RATE_HZ} Hz).`;
  }
  return null;
}

/**
 * Reject recordings that cannot be analyzed and collect warnings for ones that
 * can, but with caveats.
 * @throws ImportError when the recording is unusable
 */
export function checkRecording(samples: Signal, fs: number, kind: SignalKind): string[] {
  const rateError = samplingRateError(fs);
  if (rateError) throw new ImportError(rateError);

  if (samples.length === 0) throw new ImportError('The recording contains no samples.');

  const durationS = samples.length / fs;
  if (durationS < MIN_DURATION_S) {
    throw new ImportError(
      `The recording is only ${durationS.toFixed(1)} s long. At least ${MIN_DURATION_S} s is needed.`,
    );
  }

  const [lo, hi] = extent(samples);
  if (lo === hi) {
    throw new ImportError('Every sample has the same value, so there is no signal to analyze.');
  }

  const warnings: string[] = [];
  if (durationS < SHORT_DURATION_S) {
    warnings.push(
      `Short recording (${durationS.toFixed(1)} s). Heart rate works, but variability metrics need more data.`,
    );
  }
  if (kind === 'ecg' && fs < LOW_ECG_SAMPLING_RATE_HZ) {
    warnings.push(
      `${fs} Hz is low for ECG. Beat timing will be coarse; ${LOW_ECG_SAMPLING_RATE_HZ} Hz or more is recommended.`,
    );
  }
  return warnings;
}
