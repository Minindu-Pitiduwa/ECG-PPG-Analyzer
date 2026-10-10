import type { Signal } from '../types';
import type { Sos, SosSection } from './types';

/** The two delay-line values of one biquad. */
type SectionState = [number, number];

/**
 * Run a signal through a cascade of biquads (causal, one pass).
 *
 * Each section uses the transposed direct form II structure, which needs only
 * two state values and has good round-off behaviour.
 *
 * @param initialState optional starting state per section; without it the
 *   filter starts at rest (as if preceded by zeros). Not modified.
 */
export function sosfilt(sos: Sos, x: Signal, initialState?: readonly SectionState[]): Signal {
  const y = Float64Array.from(x);
  sos.forEach(([b0, b1, b2, , a1, a2], index) => {
    let [z0, z1] = initialState?.[index] ?? [0, 0];
    for (let i = 0; i < y.length; i++) {
      const input = y[i];
      const output = b0 * input + z0;
      z0 = b1 * input - a1 * output + z1;
      z1 = b2 * input - a2 * output;
      y[i] = output;
    }
  });
  return y;
}

/**
 * The state each section settles into for a constant input of 1.
 *
 * Starting the filter in this state (scaled by the first sample) instead of at
 * rest removes the start-up transient: the filter behaves as if the signal had
 * been sitting at its first value forever. Same as `scipy.signal.sosfilt_zi`.
 */
export function steadyState(sos: Sos): SectionState[] {
  let inputLevel = 1; // DC level reaching each section, after the gain of the ones before it
  return sos.map(([b0, b1, b2, , a1, a2]: SosSection): SectionState => {
    const z0 = (b1 - a1 * b0 + (b2 - a2 * b0)) / (1 + a1 + a2);
    const z1 = b2 - a2 * b0 - a2 * z0;
    const state: SectionState = [z0 * inputLevel, z1 * inputLevel];
    inputLevel *= (b0 + b1 + b2) / (1 + a1 + a2);
    return state;
  });
}

/** Samples of padding per side, by the same rule as `scipy.signal.sosfiltfilt`. */
function defaultPadLength(sos: Sos): number {
  // A section with b2 = 0 and a2 = 0 is really first order and needs less padding.
  const zeroB2 = sos.filter((section) => section[2] === 0).length;
  const zeroA2 = sos.filter((section) => section[5] === 0).length;
  return 3 * (2 * sos.length + 1 - Math.min(zeroB2, zeroA2));
}

/**
 * Extend both ends by reflecting the signal through its end points
 * (a point reflection, "odd" padding). Value and slope stay continuous at the
 * joins, so the filter sees no step at the edges.
 */
function padOdd(x: Signal, pad: number): Float64Array {
  const n = x.length;
  const out = new Float64Array(n + 2 * pad);
  out.set(x, pad);
  for (let i = 0; i < pad; i++) {
    out[i] = 2 * x[0] - x[pad - i];
    out[pad + n + i] = 2 * x[n - 1] - x[n - 2 - i];
  }
  return out;
}

function filterFromSteadyState(
  sos: Sos,
  x: Float64Array,
  unit: readonly SectionState[],
): Float64Array {
  const state = unit.map(([z0, z1]): SectionState => [z0 * x[0], z1 * x[0]]);
  return sosfilt(sos, x, state);
}

/**
 * Zero-phase filtering: filter forwards, then filter the result backwards.
 *
 * A causal IIR filter delays different frequencies by different amounts, which
 * smears and shifts waveform features. For ECG that would move R-peaks and
 * distort the QRS and ST shapes. Running the same filter again in reverse
 * cancels the delay exactly, so every feature stays where it was. The price is
 * that the magnitude response is applied twice: a filter that is -3 dB at its
 * cutoff becomes -6 dB, and the roll-off is twice as steep. It also needs the
 * whole recording, so it cannot be used on a live stream.
 *
 * Edge handling follows `scipy.signal.sosfiltfilt` (odd padding, steady-state
 * start), and results agree with it to round-off. One difference: for a signal
 * shorter than the padding SciPy raises an error, while this shortens the
 * padding so that short signals still work.
 *
 * Reference: Gustafsson, "Determining the initial states in forward-backward
 * filtering", IEEE Trans. Signal Processing 44(4), 1996.
 */
export function sosfiltfilt(sos: Sos, x: Signal): Signal {
  if (x.length === 0 || sos.length === 0) return Float64Array.from(x);

  const pad = Math.min(defaultPadLength(sos), x.length - 1);
  const unit = steadyState(sos);

  const forward = filterFromSteadyState(sos, padOdd(x, pad), unit);
  forward.reverse();
  const backward = filterFromSteadyState(sos, forward, unit);
  backward.reverse();
  return backward.slice(pad, pad + x.length);
}
