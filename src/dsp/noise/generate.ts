import { butterSos } from '../filters/butter';
import { sosfilt } from '../filters/sosfilt';
import type { Signal } from '../types';
import { createRandom, type Random } from '../util/random';

export type NoiseKind = 'baseline' | 'powerline' | 'emg' | 'motion';

export interface NoiseOptions {
  /** Mains frequency for powerline noise. */
  mainsHz: 50 | 60;
  /** Seed for the random generator; the same seed gives the same noise. */
  seed: number;
}

const BASELINE_COMPONENTS = 6;
const BASELINE_BAND_HZ = [0.05, 0.6] as const;
/** Surface EMG has most of its energy above 20 Hz. */
const EMG_HIGHPASS_HZ = 20;
/** Average number of motion artifacts per minute and how long each lasts. */
const MOTION_EVENTS_PER_MINUTE = 6;
const MOTION_DURATION_S = [0.4, 1.5] as const;

/** Slow drift, as caused by breathing and electrode or sensor movement: a sum of slow sinusoids. */
function baselineWander(n: number, fs: number, random: Random): Float64Array {
  const out = new Float64Array(n);
  for (let c = 0; c < BASELINE_COMPONENTS; c++) {
    const [lo, hi] = BASELINE_BAND_HZ;
    const freq = lo + (hi - lo) * random.uniform();
    const phase = 2 * Math.PI * random.uniform();
    const amplitude = 0.5 + random.uniform();
    for (let i = 0; i < n; i++)
      out[i] += amplitude * Math.sin((2 * Math.PI * freq * i) / fs + phase);
  }
  return out;
}

/** Mains hum: the mains frequency plus a weaker third harmonic, as rectifiers and transformers produce. */
function powerline(n: number, fs: number, mainsHz: number, random: Random): Float64Array {
  const phase = 2 * Math.PI * random.uniform();
  // A harmonic above Nyquist would alias to a false frequency, so it is left out.
  const harmonic = 3 * mainsHz < fs / 2 ? 0.2 : 0;
  return Float64Array.from({ length: n }, (_, i) => {
    const angle = (2 * Math.PI * mainsHz * i) / fs + phase;
    return Math.sin(angle) + harmonic * Math.sin(3 * angle);
  });
}

/** Muscle (EMG) noise: broadband random noise without its low frequencies. */
function emg(n: number, fs: number, random: Random): Float64Array {
  const white = Float64Array.from({ length: n }, () => random.gaussian());
  if (EMG_HIGHPASS_HZ >= 0.45 * fs) return white;
  return sosfilt(butterSos(2, EMG_HIGHPASS_HZ, 'high', fs), white);
}

/**
 * Motion artifacts: occasional large, smooth swings lasting around a second,
 * as when an electrode is tugged or a finger moves in a pulse-oximeter clip.
 * Unlike the other kinds, this noise comes in bursts with quiet in between.
 */
function motion(n: number, fs: number, random: Random): Float64Array {
  const out = new Float64Array(n);
  const events = Math.max(1, Math.round((MOTION_EVENTS_PER_MINUTE * n) / fs / 60));
  for (let e = 0; e < events; e++) {
    const [shortest, longest] = MOTION_DURATION_S;
    const length = Math.max(
      2,
      Math.round((shortest + (longest - shortest) * random.uniform()) * fs),
    );
    const start = Math.floor(random.uniform() * Math.max(1, n - length));
    const amplitude = (0.5 + random.uniform()) * (random.uniform() < 0.5 ? -1 : 1);
    const cycles = 1 + 2 * random.uniform();
    for (let i = 0; i < length && start + i < n; i++) {
      // A Hann envelope makes the burst start and end smoothly.
      const envelope = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (length - 1));
      out[start + i] += amplitude * envelope * Math.sin((2 * Math.PI * cycles * i) / length);
    }
  }
  return out;
}

function variance(x: Float64Array): number {
  let sum = 0;
  for (const value of x) sum += value;
  const mean = x.length > 0 ? sum / x.length : 0;
  let squares = 0;
  for (const value of x) squares += (value - mean) ** 2;
  return x.length > 0 ? squares / x.length : 0;
}

/** A noise waveform of the given kind with arbitrary amplitude. */
export function generateNoise(
  n: number,
  fs: number,
  kind: NoiseKind,
  options: NoiseOptions,
): Float64Array {
  const random = createRandom(options.seed);
  switch (kind) {
    case 'baseline':
      return baselineWander(n, fs, random);
    case 'powerline':
      return powerline(n, fs, options.mainsHz, random);
    case 'emg':
      return emg(n, fs, random);
    case 'motion':
      return motion(n, fs, random);
  }
}

/**
 * Signal-to-noise ratio in decibels between a clean signal and a noisy version of it:
 * `10 log10(signal power / noise power)`, with both powers measured around their mean.
 */
export function measureSnrDb(clean: Signal, noisy: Signal): number {
  const noise = noisy.map((value, i) => value - clean[i]);
  return 10 * Math.log10(variance(Float64Array.from(clean)) / variance(noise));
}

/**
 * Add synthetic noise to a recording at a chosen signal-to-noise ratio.
 *
 * The noise is scaled so that the ratio of the signal's power to the noise's
 * power is exactly `snrDb`. Every 6 dB less doubles the noise amplitude; at
 * 0 dB the noise has as much power as the signal. Power is averaged over the
 * whole recording, so for bursty motion noise the bursts themselves are much
 * larger than the figure suggests.
 *
 * A constant or empty signal has no power to compare with and is returned unchanged.
 */
export function addNoise(
  x: Signal,
  fs: number,
  kind: NoiseKind,
  snrDb: number,
  options: NoiseOptions,
): Float64Array {
  const noise = generateNoise(x.length, fs, kind, options);
  const signalPower = variance(Float64Array.from(x));
  const noisePower = variance(noise);
  if (signalPower === 0 || noisePower === 0) return Float64Array.from(x);
  const gain = Math.sqrt(signalPower / (noisePower * 10 ** (snrDb / 10)));
  return Float64Array.from(x, (value, i) => value + gain * noise[i]);
}
