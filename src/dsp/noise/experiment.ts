import { matchBeats, type DetectionScore } from '../eval/matchBeats';
import { analyzeRecording, type AnalysisOptions } from '../pipeline';
import type { Signal, SignalKind } from '../types';
import { addNoise, type NoiseKind, type NoiseOptions } from './generate';

export interface NoiseTrial {
  snrDb: number;
  score: DetectionScore;
}

export interface NoiseExperiment {
  /** One result per requested SNR, in the order given. */
  trials: NoiseTrial[];
  /** The noisy recording at `previewSnrDb`, before and after filtering, with the beats found in it. */
  preview: { noisy: Float64Array; filtered: Float64Array; beatTimesS: Float64Array };
}

/**
 * Measure how beat detection holds up as noise is added.
 *
 * For each SNR the noise is added to the raw recording and the complete
 * pipeline (filters, then detector) is run on the result, exactly as it would
 * be for a recording that was noisy to begin with. The beats found are scored
 * against the reference beats with a 150 ms tolerance. The same seed is used
 * at every SNR, so the levels differ only in how loud the noise is.
 *
 * @param referenceBeatsS the beats of the recording without added noise
 * @param previewSnrDb the SNR whose noisy signal is returned for display
 */
export function runNoiseExperiment(
  x: Signal,
  fs: number,
  kind: SignalKind,
  options: AnalysisOptions,
  referenceBeatsS: ArrayLike<number>,
  noiseKind: NoiseKind,
  noiseOptions: NoiseOptions,
  snrLevelsDb: readonly number[],
  previewSnrDb: number,
): NoiseExperiment {
  const run = (snrDb: number) => {
    const noisy = addNoise(x, fs, noiseKind, snrDb, noiseOptions);
    const result = analyzeRecording(noisy, fs, kind, options);
    return { noisy, result, score: matchBeats(referenceBeatsS, result.beatTimesS) };
  };
  const trials = snrLevelsDb.map((snrDb): NoiseTrial => ({ snrDb, score: run(snrDb).score }));
  const shown = run(previewSnrDb);
  return {
    trials,
    preview: {
      noisy: shown.noisy,
      filtered: shown.result.filtered,
      beatTimesS: shown.result.beatTimesS,
    },
  };
}
