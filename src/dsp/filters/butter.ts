import { abs, add, complex, div, mul, product, scale, sqrt, sub, type Complex } from './complex';
import type { Sos, SosSection } from './types';

export type ButterBand = 'low' | 'high' | 'band';

/**
 * The bilinear transform below is written for a sampling rate of 2, so that
 * the Nyquist frequency is 1 and cutoffs can be given as a fraction of it.
 * `s = 2 fs (z - 1) / (z + 1)` then has the constant `2 fs = 4`.
 */
const BILINEAR_K = 4;
/** Poles closer to the real axis than this (relative) are treated as real. */
const REAL_TOLERANCE = 1e-10;

/**
 * Poles of the analog Butterworth low-pass prototype (cutoff 1 rad/s).
 * They are spaced evenly on the left half of the unit circle, which is what
 * makes the passband "maximally flat": no ripple, at the cost of a gentle
 * roll-off.
 */
function prototypePoles(order: number): Complex[] {
  const poles: Complex[] = [];
  for (let m = -order + 1; m < order; m += 2) {
    const angle = (Math.PI * m) / (2 * order);
    poles.push(complex(-Math.cos(angle), -Math.sin(angle)));
  }
  return poles;
}

/**
 * The bilinear transform squeezes the infinite analog frequency axis into
 * 0..Nyquist, which bends frequencies. Pre-warping picks the analog cutoff
 * that lands exactly on the requested digital cutoff after the squeeze.
 */
function prewarp(normalizedCutoff: number): number {
  return BILINEAR_K * Math.tan((Math.PI * normalizedCutoff) / 2);
}

interface Zpk {
  /** Analog zeros; every Butterworth design here has them only at s = 0. */
  zerosAtOrigin: number;
  poles: Complex[];
  gain: number;
}

function toLowPass(poles: Complex[], cutoff: number): Zpk {
  return {
    zerosAtOrigin: 0,
    poles: poles.map((pole) => scale(pole, cutoff)),
    gain: cutoff ** poles.length,
  };
}

function toHighPass(poles: Complex[], cutoff: number): Zpk {
  // s -> cutoff / s mirrors the response; each pole gains a zero at the origin.
  return {
    zerosAtOrigin: poles.length,
    poles: poles.map((pole) => div(complex(cutoff), pole)),
    gain: 1,
  };
}

function toBandPass(poles: Complex[], low: number, high: number): Zpk {
  const bandwidth = high - low;
  const centerSquared = complex(low * high);
  // s -> (s^2 + w0^2) / (s * bw) turns every prototype pole into two.
  const out: Complex[] = [];
  for (const pole of poles) {
    const half = scale(pole, bandwidth / 2);
    const root = sqrt(sub(mul(half, half), centerSquared));
    out.push(add(half, root), sub(half, root));
  }
  return { zerosAtOrigin: poles.length, poles: out, gain: bandwidth ** poles.length };
}

function coefficientsFor(poleA: Complex, poleB: Complex | null): [number, number] {
  if (poleB === null) return [-poleA.re, 0];
  // (1 - pA z^-1)(1 - pB z^-1); for a conjugate pair the result is exactly real.
  return [-(poleA.re + poleB.re), mul(poleA, poleB).re];
}

/** Group digital poles into conjugate pairs, pairs of real poles, and at most one single. */
function pairPoles(poles: Complex[]): [Complex, Complex | null][] {
  const pairs: [Complex, Complex | null][] = [];
  const reals: Complex[] = [];
  for (const pole of poles) {
    if (Math.abs(pole.im) <= REAL_TOLERANCE * abs(pole)) reals.push(complex(pole.re));
    else if (pole.im > 0) pairs.push([pole, complex(pole.re, -pole.im)]);
  }
  reals.sort((a, b) => a.re - b.re);
  for (let i = 0; i < reals.length; i += 2) pairs.push([reals[i], reals[i + 1] ?? null]);
  return pairs;
}

/**
 * Design a digital Butterworth filter as second-order sections.
 *
 * Steps, following the classical method (and `scipy.signal.butter`):
 *   1. take the analog low-pass prototype poles;
 *   2. pre-warp the cutoff(s);
 *   3. transform the prototype to the wanted band (low, high or band-pass);
 *   4. map the s-plane to the z-plane with the bilinear transform;
 *   5. pair the poles into biquads.
 *
 * For `'band'` the resulting filter has order `2 * order`, as in SciPy.
 * The section order may differ from SciPy's, which changes nothing but the
 * last bits of round-off.
 *
 * Reference: Oppenheim & Schafer, Discrete-Time Signal Processing, 3rd ed.,
 * sections 7.1–7.2 (bilinear transformation, Butterworth design).
 *
 * @param order prototype order, a positive integer
 * @param cutoffHz one cutoff for low/high-pass, `[low, high]` for band-pass
 * @throws RangeError when the order or a cutoff is not usable
 */
export function butterSos(
  order: number,
  cutoffHz: number | readonly [number, number],
  band: ButterBand,
  fs: number,
): Sos {
  if (!Number.isInteger(order) || order < 1) {
    throw new RangeError(`Filter order must be a positive integer, got ${order}.`);
  }
  const cutoffs = typeof cutoffHz === 'number' ? [cutoffHz] : [...cutoffHz];
  if (cutoffs.length !== (band === 'band' ? 2 : 1)) {
    throw new RangeError(
      `A ${band}-pass filter needs ${band === 'band' ? 'two cutoffs' : 'one cutoff'}.`,
    );
  }
  const nyquist = fs / 2;
  for (const cutoff of cutoffs) {
    if (!(cutoff > 0 && cutoff < nyquist)) {
      throw new RangeError(
        `Cutoff ${cutoff} Hz must be between 0 and the Nyquist frequency ${nyquist} Hz.`,
      );
    }
  }
  if (band === 'band' && cutoffs[0] >= cutoffs[1]) {
    throw new RangeError('The lower band-pass cutoff must be below the upper one.');
  }

  const prototype = prototypePoles(order);
  const warped = cutoffs.map((cutoff) => prewarp(cutoff / nyquist));
  const analog =
    band === 'low'
      ? toLowPass(prototype, warped[0])
      : band === 'high'
        ? toHighPass(prototype, warped[0])
        : toBandPass(prototype, warped[0], warped[1]);

  // Bilinear transform: z = (K + s) / (K - s). Analog zeros at s = 0 land on
  // z = +1 (DC); the "missing" zeros at s = infinity land on z = -1 (Nyquist).
  const k = complex(BILINEAR_K);
  const digitalPoles = analog.poles.map((pole) => div(add(k, pole), sub(k, pole)));
  const denominator = product(analog.poles.map((pole) => sub(k, pole)));
  const gain = (analog.gain * BILINEAR_K ** analog.zerosAtOrigin) / denominator.re;

  let zerosAtDc = analog.zerosAtOrigin;
  let zerosAtNyquist = analog.poles.length - analog.zerosAtOrigin;

  const sections = pairPoles(digitalPoles).map(([poleA, poleB]): SosSection => {
    const [a1, a2] = coefficientsFor(poleA, poleB);
    const zeros: number[] = [];
    const wanted = poleB === null ? 1 : 2;
    // Give each section one zero of each kind while both remain (band-pass),
    // which keeps every section's gain moderate.
    while (zeros.length < wanted) {
      if (zerosAtDc > 0 && (zerosAtDc >= zerosAtNyquist || zeros.includes(-1))) {
        zeros.push(1);
        zerosAtDc--;
      } else {
        zeros.push(-1);
        zerosAtNyquist--;
      }
    }
    const b1 = -(zeros[0] + (zeros[1] ?? 0));
    const b2 = zeros.length === 2 ? zeros[0] * zeros[1] : 0;
    return [1, b1, b2, 1, a1, a2];
  });

  // Put the overall gain in the first section, as SciPy does.
  const [first, ...rest] = sections;
  return [[first[0] * gain, first[1] * gain, first[2] * gain, 1, first[4], first[5]], ...rest];
}
