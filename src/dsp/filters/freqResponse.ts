import type { Sos } from './types';

export interface FrequencyResponse {
  freqHz: Float64Array;
  /** Gain in decibels: 0 dB passes unchanged, -6 dB halves the amplitude. */
  magnitudeDb: Float64Array;
}

/** Floor for the plot; a notch is exactly zero at its centre, which is -infinity dB. */
const MIN_DB = -200;

/** |H(e^jw)|^2 of the whole cascade at angular frequency `w` (radians per sample). */
function powerGain(sos: Sos, w: number): number {
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  let power = 1;
  for (const [b0, b1, b2, , a1, a2] of sos) {
    const numerator = (b0 + b1 * c1 + b2 * c2) ** 2 + (b1 * s1 + b2 * s2) ** 2;
    const denominator = (1 + a1 * c1 + a2 * c2) ** 2 + (a1 * s1 + a2 * s2) ** 2;
    power *= numerator / denominator;
  }
  return power;
}

/**
 * Magnitude response of a filter at the given frequencies.
 *
 * @param passes 1 for ordinary causal filtering, 2 for zero-phase
 *   (forward-backward) filtering, which applies the magnitude response twice.
 */
export function magnitudeResponse(
  sos: Sos,
  fs: number,
  freqHz: ArrayLike<number>,
  passes: 1 | 2 = 1,
): FrequencyResponse {
  const frequencies = Float64Array.from(freqHz);
  const magnitudeDb = frequencies.map((f) => {
    const db = passes * 10 * Math.log10(powerGain(sos, (2 * Math.PI * f) / fs));
    return Math.max(db, MIN_DB);
  });
  return { freqHz: frequencies, magnitudeDb };
}

/** `count` frequencies spaced evenly on a logarithmic axis from `minHz` to `maxHz`. */
export function logSpace(minHz: number, maxHz: number, count: number): Float64Array {
  const ratio = Math.log(maxHz / minHz);
  return Float64Array.from({ length: count }, (_, i) =>
    count === 1 ? minHz : minHz * Math.exp((ratio * i) / (count - 1)),
  );
}
