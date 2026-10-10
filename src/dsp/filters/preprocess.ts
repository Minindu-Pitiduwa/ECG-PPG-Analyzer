import type { Signal, SignalKind } from '../types';
import { butterSos } from './butter';
import { medianBaseline } from './median';
import { notchSos } from './notch';
import { sosfiltfilt } from './sosfilt';
import type { Sos } from './types';

export type BaselineMethod = 'highpass' | 'median' | 'none';

export interface PreprocessOptions {
  /** How slow baseline drift is removed. */
  baseline: BaselineMethod;
  /** High-pass cutoff in Hz; used when `baseline` is `'highpass'`. */
  highpassHz: number;
  /** Low-pass cutoff in Hz, or `null` to keep all high frequencies. */
  lowpassHz: number | null;
  /** Mains frequency to notch out, or `null` for no notch. */
  notchHz: 50 | 60 | null;
  /** Butterworth order of the high-pass and of the low-pass (each is applied twice by zero-phase filtering). */
  order: number;
}

/**
 * Quality factor of the mains notch. 30 gives a -3 dB width of about 1.7 Hz at
 * 50 Hz: wide enough to follow small drifts in mains frequency, narrow enough
 * to leave the QRS spectrum alone.
 */
const NOTCH_Q = 30;

/**
 * Design frequencies must stay clear of the Nyquist frequency: the bilinear
 * transform maps Nyquist to infinity, so a cutoff right next to it produces a
 * degenerate filter.
 */
const MAX_NYQUIST_FRACTION = 0.95;

/**
 * Defaults by signal type.
 *
 * ECG: 0.5 Hz removes breathing drift while keeping the slowest heart-rate
 * component; 40 Hz keeps the QRS complex (most energy is below 40 Hz) and
 * removes muscle noise above it. PPG: the pulse wave is smooth, with nearly
 * all of its energy below 8 Hz.
 */
export function defaultPreprocessOptions(kind: SignalKind): PreprocessOptions {
  return {
    baseline: 'highpass',
    highpassHz: 0.5,
    lowpassHz: kind === 'ecg' ? 40 : 8,
    notchHz: 50,
    order: 2,
  };
}

const MAX_ORDER = 8;

/**
 * Check user-chosen options before designing anything.
 * Returns a plain-language problem description, or `null` when the options are usable.
 */
export function preprocessOptionsError(fs: number, options: PreprocessOptions): string | null {
  const { baseline, highpassHz, lowpassHz, order } = options;
  if (!Number.isInteger(order) || order < 1 || order > MAX_ORDER) {
    return `Filter order must be a whole number from 1 to ${MAX_ORDER}.`;
  }
  if (baseline === 'highpass') {
    if (!(highpassHz > 0)) return 'The high-pass cutoff must be greater than 0 Hz.';
    if (highpassHz >= fs / 2) {
      return `The high-pass cutoff must be below ${fs / 2} Hz (half the sampling rate).`;
    }
  }
  if (lowpassHz !== null) {
    if (!(lowpassHz > 0)) return 'The low-pass cutoff must be greater than 0 Hz.';
    if (baseline === 'highpass' && lowpassHz <= highpassHz) {
      return 'The low-pass cutoff must be above the high-pass cutoff, or nothing would get through.';
    }
  }
  return null;
}

export interface FilterDesign {
  /** High-pass, notch and low-pass sections as one cascade; may be empty. */
  sos: Sos;
  /** Plain-language notes about stages that could not be applied at this sampling rate. */
  skipped: string[];
}

/**
 * Build the linear part of the preprocessing chain.
 *
 * High-pass and low-pass are separate Butterworth filters joined into one
 * cascade rather than a single band-pass design. The result is practically the
 * same when the two edges are far apart, and each edge keeps its own cutoff
 * and can be switched off independently.
 */
export function designFilter(fs: number, options: PreprocessOptions): FilterDesign {
  const limit = (fs / 2) * MAX_NYQUIST_FRACTION;
  const sections: Sos[number][] = [];
  const skipped: string[] = [];

  if (options.baseline === 'highpass') {
    sections.push(...butterSos(options.order, options.highpassHz, 'high', fs));
  }
  if (options.notchHz !== null) {
    if (options.notchHz < limit) sections.push(...notchSos(options.notchHz, NOTCH_Q, fs));
    else {
      skipped.push(
        `The ${options.notchHz} Hz notch was skipped: at ${fs} Hz sampling the recording contains no frequencies that high.`,
      );
    }
  }
  if (options.lowpassHz !== null) {
    if (options.lowpassHz < limit)
      sections.push(...butterSos(options.order, options.lowpassHz, 'low', fs));
    else {
      skipped.push(
        `The ${options.lowpassHz} Hz low-pass was skipped: it is at or above the highest frequency this recording can contain (${fs / 2} Hz).`,
      );
    }
  }
  return { sos: sections, skipped };
}

export interface PreprocessResult extends FilterDesign {
  filtered: Signal;
}

/**
 * Clean a raw recording: remove baseline wander, mains hum and out-of-band
 * noise, without shifting any waveform feature in time (zero-phase).
 *
 * @throws RangeError when a cutoff or the order is not usable
 */
export function preprocess(x: Signal, fs: number, options: PreprocessOptions): PreprocessResult {
  const design = designFilter(fs, options);
  let signal = x;
  if (options.baseline === 'median' && x.length > 0) {
    const baseline = medianBaseline(x, fs);
    signal = x.map((value, i) => value - baseline[i]);
  }
  return { ...design, filtered: sosfiltfilt(design.sos, signal) };
}
