/**
 * Systolic peak detection in a PPG after Elgendi et al.
 *
 * Reference: M. Elgendi, I. Norton, M. Brearley, D. Abbott, D. Schuurmans,
 * "Systolic peak detection in acceleration photoplethysmograms measured from
 * emergency responders in tropical conditions", PLoS ONE 8(10):e76585, 2013.
 *
 * The idea: compare a short moving average, about as wide as one systolic
 * peak, with a long one, about as wide as one whole beat. Wherever the short
 * average rises above the long one there is a pulse; the highest point of the
 * signal inside each such block is the systolic peak. Because both averages
 * follow the local signal level, the method keeps working when the pulse
 * amplitude changes, which a fixed threshold does not.
 */

import { butterSos } from '../filters/butter';
import { sosfiltfilt } from '../filters/sosfilt';
import type { Signal } from '../types';
import { movingAverage } from '../util/movingAverage';
import { mean } from '../util/stats';
import { enforceMinDistance, extremumIndex, isNumericallyFlat } from './refine';

export interface ElgendiOptions {
  /** Pass band holding the pulse wave. */
  bandHz: readonly [number, number];
  /** Short window, about the duration of a systolic peak (W1 in the paper). */
  peakWindowS: number;
  /** Long window, about the duration of one beat (W2 in the paper). */
  beatWindowS: number;
  /** Raises the long average by this share of the mean signal energy (beta in the paper). */
  offset: number;
  /** Fastest heart rate considered possible; sets the minimum distance between peaks. */
  maxHeartRateBpm: number;
}

export const ELGENDI_DEFAULTS: ElgendiOptions = {
  bandHz: [0.5, 8],
  peakWindowS: 0.111,
  beatWindowS: 0.667,
  offset: 0.02,
  maxHeartRateBpm: 200,
};

const BAND_ORDER = 2;
/** How far the peak on the caller's signal may lie from the peak of the band-passed signal. */
const REFINE_S = 0.05;

/**
 * Detect the systolic peaks of a PPG.
 *
 * @param x the PPG, raw or already cleaned; the detector applies its own band-pass
 * @returns sample indices of the systolic peaks, in increasing order
 */
export function elgendiPpg(
  x: Signal,
  fs: number,
  options: ElgendiOptions = ELGENDI_DEFAULTS,
): Int32Array {
  const peakWindow = Math.max(1, Math.round(options.peakWindowS * fs));
  const beatWindow = Math.max(1, Math.round(options.beatWindowS * fs));
  if (x.length < beatWindow) return new Int32Array(0);

  const upper = Math.min(options.bandHz[1], 0.45 * fs);
  const filtered = sosfiltfilt(butterSos(BAND_ORDER, [options.bandHz[0], upper], 'band', fs), x);
  // Keep only the upstroke side: clip below zero, then square to emphasise the systolic peak.
  const energy = filtered.map((value) => (value > 0 ? value * value : 0));
  const meanEnergy = mean(energy);
  if (meanEnergy === 0 || isNumericallyFlat(filtered, x)) return new Int32Array(0);

  const peakAverage = movingAverage(energy, peakWindow);
  const beatAverage = movingAverage(energy, beatWindow);
  const offset = options.offset * meanEnergy;

  const peaks: number[] = [];
  let blockStart = -1;
  for (let i = 0; i <= x.length; i++) {
    const inside = i < x.length && peakAverage[i] > beatAverage[i] + offset;
    if (inside && blockStart === -1) blockStart = i;
    if (!inside && blockStart !== -1) {
      // A block narrower than a systolic peak is noise (the paper's second threshold).
      if (i - blockStart >= peakWindow) peaks.push(extremumIndex(filtered, blockStart, i - 1, 1));
      blockStart = -1;
    }
  }

  const minDistance = Math.round((60 / options.maxHeartRateBpm) * fs);
  const refine = Math.round(REFINE_S * fs);
  const separated = enforceMinDistance(peaks, minDistance, (index) => filtered[index]);
  const refined = separated.map((index) => extremumIndex(x, index - refine, index + refine, 1));
  return Int32Array.from(enforceMinDistance(refined, minDistance, (index) => x[index]));
}
