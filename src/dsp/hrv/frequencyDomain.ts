import { fft, floorPowerOfTwo } from '../util/fft';
import type { IntervalLabel } from './intervals';

/** A power spectral density of the NN interval series. */
export interface Psd {
  freqHz: Float64Array;
  /** Power density in ms^2 per Hz. Integrating it over frequency gives variance in ms^2. */
  power: Float64Array;
}

export interface BandPowers {
  /** Very low frequency, 0.0033–0.04 Hz, ms^2. Only meaningful for 5 minutes or more. */
  vlf: number;
  /** Low frequency, 0.04–0.15 Hz, ms^2. */
  lf: number;
  /** High frequency, 0.15–0.4 Hz, ms^2: the breathing-related (vagal) band. */
  hf: number;
  /** LF / HF. */
  lfHfRatio: number;
  /** LF and HF as a percentage of LF + HF ("normalised units"). */
  lfNu: number;
  hfNu: number;
}

/** Band limits of the Task Force standard (1996), in Hz. */
export const HRV_BANDS = {
  vlf: [0.0033, 0.04],
  lf: [0.04, 0.15],
  hf: [0.15, 0.4],
} as const;

/** Usable data needed before LF and HF are shown: about ten cycles of the slowest LF rhythm. */
export const MIN_SPECTRAL_DURATION_S = 120;
/** Usable data needed before VLF is shown: the Task Force's short-term recording length. */
export const MIN_VLF_DURATION_S = 300;
/** With more than this share of intervals excluded, a spectrum no longer describes the recording. */
export const MAX_EXCLUDED_FRACTION = 0.2;

const MAX_FREQUENCY_HZ = 0.5;
const MAX_GRID_POINTS = 2000;
/** Rate at which the interval series is resampled for Welch's method (Task Force recommends 2–4 Hz). */
const RESAMPLE_HZ = 4;
/** Longest Welch segment, in samples at 4 Hz (256 s), giving 0.004 Hz resolution. */
const MAX_SEGMENT = 1024;

export interface NnSeries {
  /** Time of the beat that ends each normal interval, s. */
  timeS: Float64Array;
  /** The normal intervals, ms. */
  nnMs: Float64Array;
}

/** The normal intervals with their times: an unevenly sampled series. */
export function nnSeries(
  beatTimesS: ArrayLike<number>,
  intervalsMs: ArrayLike<number>,
  labels: readonly IntervalLabel[],
): NnSeries {
  const timeS: number[] = [];
  const nnMs: number[] = [];
  for (let i = 0; i < intervalsMs.length; i++) {
    if (labels[i] === 'normal') {
      timeS.push(beatTimesS[i + 1]);
      nnMs.push(intervalsMs[i]);
    }
  }
  return { timeS: Float64Array.from(timeS), nnMs: Float64Array.from(nnMs) };
}

function removeMean(values: Float64Array): Float64Array {
  let sum = 0;
  for (const value of values) sum += value;
  const mean = values.length > 0 ? sum / values.length : 0;
  return values.map((value) => value - mean);
}

/**
 * Lomb–Scargle periodogram of an unevenly sampled series.
 *
 * Heartbeats are not evenly spaced in time, and after removing ectopic beats
 * the series has holes as well. An FFT needs evenly spaced samples, which means
 * interpolating first, and interpolation acts as a low-pass filter that
 * removes HF power. Lomb–Scargle instead fits a sine and a cosine to the data
 * at each frequency by least squares, using the samples where they actually
 * are, so no interpolation is needed.
 *
 * Returns the classical (unnormalised) periodogram, identical to
 * `scipy.signal.lombscargle(t, x, 2*pi*f)`: a sinusoid of amplitude A sampled
 * N times gives a peak of N * A^2 / 4. The series should have its mean removed
 * first.
 *
 * References: Lomb, Astrophys. Space Sci. 39:447–462, 1976; Scargle,
 * Astrophys. J. 263:835–853, 1982; for HRV: Laguna, Moody & Mark, IEEE Trans.
 * Biomed. Eng. 45(6):698–715, 1998.
 */
export function lombScargle(
  timeS: ArrayLike<number>,
  values: ArrayLike<number>,
  freqHz: ArrayLike<number>,
): Float64Array {
  const n = timeS.length;
  const out = new Float64Array(freqHz.length);
  for (let k = 0; k < freqHz.length; k++) {
    const w = 2 * Math.PI * freqHz[k];
    // The offset tau makes the sine and cosine terms orthogonal on these particular sample times.
    let sin2 = 0;
    let cos2 = 0;
    for (let i = 0; i < n; i++) {
      sin2 += Math.sin(2 * w * timeS[i]);
      cos2 += Math.cos(2 * w * timeS[i]);
    }
    const tau = Math.atan2(sin2, cos2) / (2 * w);

    let xc = 0;
    let xs = 0;
    let cc = 0;
    let ss = 0;
    for (let i = 0; i < n; i++) {
      const phase = w * (timeS[i] - tau);
      const c = Math.cos(phase);
      const s = Math.sin(phase);
      xc += values[i] * c;
      xs += values[i] * s;
      cc += c * c;
      ss += s * s;
    }
    out[k] = 0.5 * ((cc > 0 ? (xc * xc) / cc : 0) + (ss > 0 ? (xs * xs) / ss : 0));
  }
  return out;
}

/**
 * Power spectral density of the NN series by the Lomb–Scargle method.
 *
 * The periodogram P relates to the Fourier transform X by P = |X|^2 / N, so a
 * one-sided density is 2 P / fs. With uneven sampling the mean sampling rate
 * N / T takes the place of fs, giving `2 P T / N` in ms^2/Hz.
 */
export function lombScarglePsd(series: NnSeries): Psd {
  const n = series.nnMs.length;
  if (n < 3) return { freqHz: new Float64Array(0), power: new Float64Array(0) };

  const durationS = series.timeS[n - 1] - series.timeS[0];
  // Four points per independent frequency (1 / duration) draw smooth peaks without wasted work.
  const step = Math.max(1 / (4 * durationS), MAX_FREQUENCY_HZ / MAX_GRID_POINTS);
  const count = Math.floor(MAX_FREQUENCY_HZ / step);
  const freqHz = Float64Array.from({ length: count }, (_, i) => (i + 1) * step);

  const periodogram = lombScargle(series.timeS, removeMean(series.nnMs), freqHz);
  const scale = (2 * durationS) / n;
  return { freqHz, power: periodogram.map((value) => value * scale) };
}

/** Resample an uneven series onto an even grid by linear interpolation (like `numpy.interp`). */
export function resampleLinear(
  timeS: ArrayLike<number>,
  values: ArrayLike<number>,
  rateHz: number,
): Float64Array {
  const n = timeS.length;
  if (n < 2) return new Float64Array(0);
  const count = Math.floor((timeS[n - 1] - timeS[0]) * rateHz) + 1;
  const out = new Float64Array(count);
  let segment = 0;
  for (let i = 0; i < count; i++) {
    const t = timeS[0] + i / rateHz;
    while (segment < n - 2 && timeS[segment + 1] < t) segment++;
    const span = timeS[segment + 1] - timeS[segment];
    const fraction = span > 0 ? Math.min(1, Math.max(0, (t - timeS[segment]) / span)) : 0;
    out[i] = values[segment] + fraction * (values[segment + 1] - values[segment]);
  }
  return out;
}

/**
 * Welch's averaged periodogram of an evenly sampled signal: split into
 * half-overlapping segments, remove each segment's mean, apply a Hann window,
 * and average the squared FFT magnitudes. Averaging trades frequency
 * resolution for a much less noisy estimate.
 *
 * Matches `scipy.signal.welch(x, fs, window="hann", nperseg=segment,
 * noverlap=segment // 2, detrend="constant", scaling="density")`.
 *
 * Reference: Welch, IEEE Trans. Audio Electroacoust. 15(2):70–73, 1967.
 *
 * @param segment segment length in samples; must be a power of two
 */
export function welch(x: Float64Array, fs: number, segment: number): Psd {
  const half = segment >> 1;
  if (segment < 2 || x.length < segment)
    return { freqHz: new Float64Array(0), power: new Float64Array(0) };

  // Periodic ("DFT-even") Hann window, as SciPy uses for spectral analysis.
  const window = Float64Array.from(
    { length: segment },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / segment),
  );
  let windowPower = 0;
  for (const w of window) windowPower += w * w;

  const power = new Float64Array(half + 1);
  let segments = 0;
  for (let start = 0; start + segment <= x.length; start += half) {
    const re = removeMean(x.slice(start, start + segment));
    for (let i = 0; i < segment; i++) re[i] *= window[i];
    const im = new Float64Array(segment);
    fft(re, im);
    for (let k = 0; k <= half; k++) power[k] += re[k] * re[k] + im[k] * im[k];
    segments++;
  }

  const scale = 1 / (fs * windowPower * segments);
  for (let k = 0; k <= half; k++) {
    // One-sided: fold the negative frequencies onto the positive ones, except at DC and Nyquist.
    power[k] *= k === 0 || k === half ? scale : 2 * scale;
  }
  return { freqHz: Float64Array.from({ length: half + 1 }, (_, k) => (k * fs) / segment), power };
}

/**
 * Power spectral density of the NN series by resampling at 4 Hz and Welch's
 * method: the classical approach, offered as an alternative to Lomb–Scargle.
 */
export function welchPsd(series: NnSeries): Psd {
  const resampled = resampleLinear(series.timeS, series.nnMs, RESAMPLE_HZ);
  const segment = Math.min(MAX_SEGMENT, floorPowerOfTwo(resampled.length));
  return welch(resampled, RESAMPLE_HZ, segment);
}

/** Integrate a density between two frequencies with the trapezoid rule. */
export function bandPower(psd: Psd, lowHz: number, highHz: number): number {
  let total = 0;
  for (let i = 1; i < psd.freqHz.length; i++) {
    const from = Math.max(psd.freqHz[i - 1], lowHz);
    const to = Math.min(psd.freqHz[i], highHz);
    if (to <= from) continue;
    // Clip the trapezoid to the band, interpolating the density at the cut.
    const slope = (psd.power[i] - psd.power[i - 1]) / (psd.freqHz[i] - psd.freqHz[i - 1]);
    const atFrom = psd.power[i - 1] + slope * (from - psd.freqHz[i - 1]);
    const atTo = psd.power[i - 1] + slope * (to - psd.freqHz[i - 1]);
    total += 0.5 * (atFrom + atTo) * (to - from);
  }
  return total;
}

/** Power in the standard HRV bands, and the ratios derived from them. */
export function bandPowers(psd: Psd): BandPowers {
  const vlf = bandPower(psd, ...HRV_BANDS.vlf);
  const lf = bandPower(psd, ...HRV_BANDS.lf);
  const hf = bandPower(psd, ...HRV_BANDS.hf);
  return {
    vlf,
    lf,
    hf,
    lfHfRatio: lf / hf,
    lfNu: (100 * lf) / (lf + hf),
    hfNu: (100 * hf) / (lf + hf),
  };
}

export type SpectralMethod = 'lombScargle' | 'welch';

export type SpectralHrv =
  | { available: true; psd: Psd; bands: BandPowers; vlfAvailable: boolean; usableS: number }
  | { available: false; reason: string };

/**
 * Frequency-domain HRV, or the reason it cannot be shown.
 *
 * A spectrum of a short recording looks as authoritative as any other but is
 * not: the LF band's slowest rhythm takes 25 s per cycle, and a couple of
 * minutes are needed to see enough cycles. So the analysis is refused, with an
 * explanation, when there is too little usable data.
 */
export function spectralHrv(
  beatTimesS: ArrayLike<number>,
  intervalsMs: ArrayLike<number>,
  labels: readonly IntervalLabel[],
  method: SpectralMethod = 'lombScargle',
): SpectralHrv {
  const series = nnSeries(beatTimesS, intervalsMs, labels);
  let usableS = 0;
  for (const interval of series.nnMs) usableS += interval / 1000;

  if (usableS < MIN_SPECTRAL_DURATION_S) {
    return {
      available: false,
      reason:
        `Frequency analysis needs at least ${MIN_SPECTRAL_DURATION_S / 60} minutes of usable beats; ` +
        `this recording has ${usableS < 60 ? `${Math.round(usableS)} seconds` : `${(usableS / 60).toFixed(1)} minutes`}. ` +
        'The slowest rhythm it measures takes 25 seconds per cycle, and several cycles are needed to measure it.',
    };
  }
  const excluded = labels.length - series.nnMs.length;
  if (excluded > MAX_EXCLUDED_FRACTION * labels.length) {
    return {
      available: false,
      reason:
        `${Math.round((100 * excluded) / labels.length)}% of the intervals were excluded as ectopic, implausible or noisy. ` +
        'With that many gaps a spectrum would describe the gaps more than the heart rhythm.',
    };
  }

  const psd = method === 'welch' ? welchPsd(series) : lombScarglePsd(series);
  return {
    available: true,
    psd,
    bands: bandPowers(psd),
    vlfAvailable: usableS >= MIN_VLF_DURATION_S,
    usableS,
  };
}
