/** Synthetic signals with known beat positions, for testing the detectors. */

function gaussian(t: number, center: number, sigma: number): number {
  return Math.exp(-0.5 * ((t - center) / sigma) ** 2);
}

/** Evenly spaced beat times, starting half an interval in. */
export function regularBeats(durationS: number, bpm: number): number[] {
  const interval = 60 / bpm;
  const beats: number[] = [];
  for (let t = interval / 2; t < durationS - interval / 2; t += interval) beats.push(t);
  return beats;
}

export interface EcgShape {
  /** R-wave height. Negative for an inverted lead. */
  rAmplitude?: number;
  /** T-wave height; a tall T wave is the classic false-positive trap. */
  tAmplitude?: number;
}

/**
 * A simple ECG: each beat is a small P wave, a narrow QRS (Q dip, R spike,
 * S dip) and a broad T wave, built from Gaussian bumps.
 *
 * @param amplitudes optional per-beat scale factors (1 = normal)
 */
export function syntheticEcg(
  beatTimesS: readonly number[],
  durationS: number,
  fs: number,
  shape: EcgShape = {},
  amplitudes?: readonly number[],
): Float64Array {
  const { rAmplitude = 1, tAmplitude = 0.25 } = shape;
  const x = new Float64Array(Math.round(durationS * fs));
  beatTimesS.forEach((beat, k) => {
    const scale = amplitudes?.[k] ?? 1;
    const from = Math.max(0, Math.floor((beat - 0.3) * fs));
    const to = Math.min(x.length, Math.ceil((beat + 0.5) * fs));
    for (let i = from; i < to; i++) {
      const t = i / fs;
      x[i] +=
        scale *
        (0.1 * gaussian(t, beat - 0.17, 0.025) +
          rAmplitude *
            (gaussian(t, beat, 0.01) -
              0.12 * gaussian(t, beat - 0.025, 0.008) -
              0.2 * gaussian(t, beat + 0.028, 0.01)) +
          tAmplitude * gaussian(t, beat + 0.26, 0.045));
    }
  });
  return x;
}

/** A simple PPG: each pulse is a systolic peak followed by a smaller, later diastolic bump. */
export function syntheticPpg(
  beatTimesS: readonly number[],
  durationS: number,
  fs: number,
  amplitudes?: readonly number[],
): Float64Array {
  const x = new Float64Array(Math.round(durationS * fs));
  beatTimesS.forEach((beat, k) => {
    const scale = amplitudes?.[k] ?? 1;
    const from = Math.max(0, Math.floor((beat - 0.4) * fs));
    const to = Math.min(x.length, Math.ceil((beat + 0.8) * fs));
    for (let i = from; i < to; i++) {
      const t = i / fs;
      x[i] += scale * (gaussian(t, beat, 0.07) + 0.35 * gaussian(t, beat + 0.28, 0.09));
    }
  });
  return x;
}

/** Deterministic pseudo-random numbers in [-1, 1), so noisy tests are repeatable. */
export function seededNoise(n: number, seed = 1): Float64Array {
  let state = seed >>> 0;
  return Float64Array.from({ length: n }, () => {
    // Mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return (((z ^ (z >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  });
}
