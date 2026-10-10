import type { Sos } from './types';

/**
 * Design a second-order notch that removes one frequency (mains hum) and
 * leaves the rest almost untouched.
 *
 * The zeros sit on the unit circle exactly at the notch frequency, so that
 * frequency is cancelled completely. A pole pair just inside the circle at the
 * same angle pulls the response back up to 1 everywhere else. The quality
 * factor sets how close the poles are, and so how narrow the notch is:
 * the -3 dB width is `f0 / q`.
 *
 * Matches `scipy.signal.iirnotch`. Reference: Orfanidis, Introduction to
 * Signal Processing (1996), section 11.3.
 *
 * @throws RangeError when `f0Hz` is not below the Nyquist frequency or `q` is not positive
 */
export function notchSos(f0Hz: number, q: number, fs: number): Sos {
  if (!(f0Hz > 0 && f0Hz < fs / 2)) {
    throw new RangeError(
      `Notch frequency ${f0Hz} Hz must be between 0 and the Nyquist frequency ${fs / 2} Hz.`,
    );
  }
  if (!(q > 0)) throw new RangeError(`Notch quality factor must be positive, got ${q}.`);

  const w0 = (2 * Math.PI * f0Hz) / fs;
  const bandwidth = w0 / q;
  const gain = 1 / (1 + Math.tan(bandwidth / 2));
  const cosW0 = Math.cos(w0);
  return [[gain, -2 * gain * cosW0, gain, 1, -2 * gain * cosW0, 2 * gain - 1]];
}
