import { describe, expect, it } from 'vitest';
import {
  HRV_BANDS,
  bandPower,
  bandPowers,
  lombScargle,
  lombScarglePsd,
  nnSeries,
  resampleLinear,
  spectralHrv,
  welch,
  welchPsd,
  type NnSeries,
} from '@/dsp/hrv/frequencyDomain';
import { classifyIntervals, countExclusions, type IntervalLabel } from '@/dsp/hrv/intervals';
import { poincare } from '@/dsp/hrv/poincare';
import { normalIntervals, successiveDifferences, timeDomainHrv } from '@/dsp/hrv/timeDomain';
import { fft, floorPowerOfTwo } from '@/dsp/util/fft';

const normal = (n: number): IntervalLabel[] => new Array<IntervalLabel>(n).fill('normal');

/** Beat times and intervals for a rhythm whose interval is modulated by one sinusoid. */
function modulatedRhythm(durationS: number, meanMs: number, amplitudeMs: number, freqHz: number) {
  const beats = [0];
  while (beats[beats.length - 1] < durationS) {
    const t = beats[beats.length - 1];
    beats.push(t + (meanMs + amplitudeMs * Math.sin(2 * Math.PI * freqHz * t)) / 1000);
  }
  const intervals = beats.slice(1).map((time, i) => 1000 * (time - beats[i]));
  return { beats, intervals };
}

describe('classifyIntervals', () => {
  it('accepts a steady rhythm with natural variation', () => {
    const intervals = Array.from({ length: 50 }, (_, i) => 800 + 40 * Math.sin(i / 3));
    expect(classifyIntervals(intervals).every((label) => label === 'normal')).toBe(true);
  });

  it('flags a premature beat and the pause after it, and nothing else', () => {
    const intervals = new Array<number>(21).fill(800);
    intervals[10] = 500; // early beat
    intervals[11] = 1100; // compensatory pause
    const labels = classifyIntervals(intervals);
    expect(labels[10]).toBe('short');
    expect(labels[11]).toBe('long');
    expect(labels.filter((label) => label !== 'normal')).toHaveLength(2);
  });

  it('flags a missed beat as one long interval', () => {
    const intervals = new Array<number>(15).fill(900);
    intervals[7] = 1800;
    expect(classifyIntervals(intervals)[7]).toBe('long');
  });

  it('uses the 20% boundary of the local median', () => {
    const base = new Array<number>(11).fill(1000);
    expect(classifyIntervals(base.map((v, i) => (i === 5 ? 1190 : v)))[5]).toBe('normal');
    expect(classifyIntervals(base.map((v, i) => (i === 5 ? 1210 : v)))[5]).toBe('long');
    expect(classifyIntervals(base.map((v, i) => (i === 5 ? 790 : v)))[5]).toBe('short');
  });

  it('follows a gradual change of heart rate without flagging it', () => {
    const intervals = Array.from({ length: 100 }, (_, i) => 1000 - 5 * i); // 60 to 120 bpm
    expect(classifyIntervals(intervals).every((label) => label === 'normal')).toBe(true);
  });

  it('flags intervals no heart could produce', () => {
    const labels = classifyIntervals([250, 250, 250, 2500, 2500, NaN]);
    expect(labels.every((label) => label === 'implausible')).toBe(true);
  });

  it('gives low quality precedence', () => {
    const labels = classifyIntervals([800, 800, 800], undefined, [false, true, false]);
    expect(labels).toEqual(['normal', 'lowQuality', 'normal']);
  });

  it('handles empty input and a single interval', () => {
    expect(classifyIntervals([])).toEqual([]);
    expect(classifyIntervals([800])).toEqual(['normal']);
  });

  it('counts exclusions by reason', () => {
    const counts = countExclusions([
      'normal',
      'short',
      'long',
      'long',
      'implausible',
      'lowQuality',
      'normal',
    ]);
    expect(counts).toEqual({
      short: 1,
      long: 2,
      implausible: 1,
      lowQuality: 1,
      total: 7,
      excluded: 5,
    });
  });
});

describe('timeDomainHrv', () => {
  it('computes the textbook values for a small example', () => {
    const result = timeDomainHrv([800, 900, 800, 900], normal(4));
    expect(result.count).toBe(4);
    expect(result.meanNN).toBe(850);
    expect(result.sdnn).toBeCloseTo(Math.sqrt(10000 / 3), 10);
    expect(result.rmssd).toBeCloseTo(100, 10);
    expect(result.pnn50).toBe(100);
  });

  it('counts only differences strictly above 50 ms for pNN50', () => {
    expect(timeDomainHrv([800, 850, 800, 851], normal(4)).pnn50).toBeCloseTo(100 / 3, 10);
  });

  it('is zero variability for a perfectly regular rhythm', () => {
    const result = timeDomainHrv(new Array<number>(20).fill(1000), normal(20));
    expect(result).toMatchObject({ meanNN: 1000, sdnn: 0, rmssd: 0, pnn50: 0 });
  });

  it('does not bridge an excluded interval when forming successive differences', () => {
    const intervals = [800, 810, 400, 1200, 800, 790];
    const labels: IntervalLabel[] = ['normal', 'normal', 'short', 'long', 'normal', 'normal'];
    expect(Array.from(successiveDifferences(intervals, labels))).toEqual([10, -10]);
    expect(Array.from(normalIntervals(intervals, labels))).toEqual([800, 810, 800, 790]);
    const result = timeDomainHrv(intervals, labels);
    expect(result.count).toBe(4);
    expect(result.rmssd).toBeCloseTo(10, 10);
    expect(result.meanNN).toBe(800);
  });

  it('is far smaller with an ectopic beat excluded than with it left in', () => {
    const intervals = new Array<number>(60).fill(0).map((_, i) => 800 + 10 * Math.sin(i));
    intervals[30] = 450;
    intervals[31] = 1150;
    const kept = timeDomainHrv(intervals, normal(60)).rmssd;
    const excluded = timeDomainHrv(intervals, classifyIntervals(intervals)).rmssd;
    expect(kept).toBeGreaterThan(5 * excluded);
  });

  it('returns NaN where there is too little data', () => {
    const none = timeDomainHrv([], []);
    expect(none.count).toBe(0);
    expect(none.meanNN).toBeNaN();
    const one = timeDomainHrv([800], normal(1));
    expect(one.meanNN).toBe(800);
    expect(one.sdnn).toBeNaN();
    expect(one.rmssd).toBeNaN();
    expect(one.pnn50).toBeNaN();
    expect(timeDomainHrv([800, 900], ['short', 'long']).count).toBe(0);
  });
});

describe('poincare', () => {
  it('pairs each interval with the next', () => {
    const { x, y, center } = poincare([800, 900, 850], normal(3));
    expect(Array.from(x)).toEqual([800, 900]);
    expect(Array.from(y)).toEqual([900, 850]);
    expect(center).toBe(862.5);
  });

  it('satisfies SD1^2 = SDSD^2 / 2', () => {
    const intervals = Array.from(
      { length: 200 },
      (_, i) => 850 + 30 * Math.sin(i / 2) + 12 * Math.cos(i * 1.7),
    );
    const differences = successiveDifferences(intervals, normal(200));
    const mean = differences.reduce((sum, value) => sum + value, 0) / differences.length;
    const sdsd = Math.sqrt(
      differences.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (differences.length - 1),
    );
    expect(poincare(intervals, normal(200)).sd1).toBeCloseTo(sdsd / Math.SQRT2, 10);
  });

  it('has no SD1 for a rhythm that only drifts, and no SD2 for one that only alternates', () => {
    const drift = poincare(
      Array.from({ length: 50 }, (_, i) => 800 + 2 * i),
      normal(50),
    );
    expect(drift.sd1).toBeCloseTo(0, 9);
    expect(drift.sd2).toBeGreaterThan(20);
    const alternate = poincare(
      Array.from({ length: 50 }, (_, i) => (i % 2 ? 900 : 800)),
      normal(50),
    );
    expect(alternate.sd2).toBeCloseTo(0, 9);
    expect(alternate.sd1).toBeGreaterThan(50);
  });

  it('skips pairs that touch an excluded interval', () => {
    const labels: IntervalLabel[] = ['normal', 'normal', 'long', 'normal', 'normal'];
    expect(poincare([800, 810, 1600, 805, 795], labels).x).toHaveLength(2);
  });

  it('returns NaN spreads with fewer than two pairs', () => {
    expect(poincare([], []).sd1).toBeNaN();
    expect(poincare([800, 810], normal(2)).sd1).toBeNaN();
    expect(poincare([], []).center).toBeNaN();
  });
});

describe('fft', () => {
  it('finds a cosine in its own bin', () => {
    const n = 64;
    const re = Float64Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 5 * i) / n));
    const im = new Float64Array(n);
    fft(re, im);
    const magnitude = Array.from(re, (value, k) => Math.hypot(value, im[k]));
    expect(magnitude[5]).toBeCloseTo(n / 2, 9);
    expect(magnitude[n - 5]).toBeCloseTo(n / 2, 9);
    expect(Math.max(...magnitude.filter((_, k) => k !== 5 && k !== n - 5))).toBeLessThan(1e-9);
  });

  it('turns an impulse into a flat spectrum, and handles length 1', () => {
    const re = Float64Array.from([1, 0, 0, 0]);
    const im = new Float64Array(4);
    fft(re, im);
    expect(Array.from(re)).toEqual([1, 1, 1, 1]);
    const one = Float64Array.from([3]);
    fft(one, new Float64Array(1));
    expect(one[0]).toBe(3);
  });

  it('rejects lengths that are not a power of two', () => {
    expect(() => fft(new Float64Array(6), new Float64Array(6))).toThrow(RangeError);
    expect(() => fft(new Float64Array(0), new Float64Array(0))).toThrow(RangeError);
    expect(() => fft(new Float64Array(4), new Float64Array(8))).toThrow(RangeError);
  });

  it('rounds down to a power of two', () => {
    expect(floorPowerOfTwo(1)).toBe(1);
    expect(floorPowerOfTwo(1023)).toBe(512);
    expect(floorPowerOfTwo(1024)).toBe(1024);
    expect(floorPowerOfTwo(0)).toBe(0);
  });
});

describe('Lomb–Scargle', () => {
  it('peaks at N A^2 / 4 for a sinusoid, even with uneven sampling and gaps', () => {
    const times: number[] = [];
    for (let t = 0; t < 300; t += 0.7 + 0.3 * Math.sin(t)) if (t < 100 || t > 130) times.push(t);
    const amplitude = 30;
    const values = times.map((t) => amplitude * Math.sin(2 * Math.PI * 0.1 * t + 1));
    const freqs = Float64Array.from({ length: 200 }, (_, i) => 0.05 + i * 0.0005);
    const power = lombScargle(times, values, freqs);
    const peak = power.indexOf(Math.max(...power));
    expect(freqs[peak]).toBeCloseTo(0.1, 3);
    expect(power[peak] / ((times.length * amplitude ** 2) / 4)).toBeCloseTo(1, 1);
  });

  it('returns zeros for a zero signal and nothing for no frequencies', () => {
    expect(Array.from(lombScargle([0, 1, 2], [0, 0, 0], [0.1, 0.2]))).toEqual([0, 0]);
    expect(lombScargle([0, 1, 2], [1, 2, 3], [])).toHaveLength(0);
  });

  it('gives a density whose band power equals the variance of the modulation', () => {
    // A 40 ms sinusoidal modulation has variance 40^2 / 2 = 800 ms^2.
    const { beats, intervals } = modulatedRhythm(600, 850, 40, 0.1);
    const psd = lombScarglePsd(nnSeries(beats, intervals, normal(intervals.length)));
    expect(bandPower(psd, ...HRV_BANDS.lf) / 800).toBeCloseTo(1, 1);
    expect(bandPower(psd, ...HRV_BANDS.hf)).toBeLessThan(20);
  });

  it('returns an empty spectrum for fewer than three intervals', () => {
    const series: NnSeries = {
      timeS: Float64Array.from([1, 2]),
      nnMs: Float64Array.from([800, 810]),
    };
    expect(lombScarglePsd(series).freqHz).toHaveLength(0);
  });
});

describe('Welch', () => {
  it('interpolates linearly onto an even grid', () => {
    expect(Array.from(resampleLinear([0, 1, 3], [0, 10, 30], 2))).toEqual([
      0, 5, 10, 15, 20, 25, 30,
    ]);
    expect(resampleLinear([5], [1], 4)).toHaveLength(0);
  });

  it('integrates to the variance of the signal (Parseval)', () => {
    const fs = 4;
    const x = Float64Array.from(
      { length: 4096 },
      (_, i) => 30 * Math.sin((2 * Math.PI * 0.25 * i) / fs),
    );
    const psd = welch(x, fs, 1024);
    expect(bandPower(psd, 0, 2) / 450).toBeCloseTo(1, 2);
    expect(psd.freqHz[psd.power.indexOf(Math.max(...psd.power))]).toBeCloseTo(0.25, 2);
  });

  it('returns an empty spectrum when the signal is shorter than a segment', () => {
    expect(welch(new Float64Array(100), 4, 256).power).toHaveLength(0);
  });

  it('agrees with Lomb–Scargle on which band holds the power', () => {
    const { beats, intervals } = modulatedRhythm(600, 850, 40, 0.25);
    const series = nnSeries(beats, intervals, normal(intervals.length));
    const lomb = bandPowers(lombScarglePsd(series));
    const classic = bandPowers(welchPsd(series));
    expect(lomb.hf).toBeGreaterThan(20 * lomb.lf);
    expect(classic.hf).toBeGreaterThan(20 * classic.lf);
    // Interpolation before Welch attenuates fast rhythms, so it reads lower than Lomb–Scargle.
    expect(classic.hf).toBeLessThan(lomb.hf);
    expect(classic.hf / lomb.hf).toBeGreaterThan(0.7);
  });
});

describe('bandPower and bandPowers', () => {
  const flat = {
    freqHz: Float64Array.from({ length: 51 }, (_, i) => i * 0.01),
    power: new Float64Array(51).fill(1000),
  };

  it('integrates a flat density to density times bandwidth, cutting between grid points', () => {
    expect(bandPower(flat, 0.04, 0.15)).toBeCloseTo(110, 9);
    expect(bandPower(flat, 0.0033, 0.04)).toBeCloseTo(36.7, 9);
    expect(bandPower(flat, 0.6, 0.7)).toBe(0);
  });

  it('derives the ratio and normalised units', () => {
    const bands = bandPowers(flat);
    expect(bands.lf).toBeCloseTo(110, 9);
    expect(bands.hf).toBeCloseTo(250, 9);
    expect(bands.lfHfRatio).toBeCloseTo(0.44, 9);
    expect(bands.lfNu + bands.hfNu).toBeCloseTo(100, 9);
  });

  it('is zero for an empty spectrum', () => {
    expect(bandPower({ freqHz: new Float64Array(0), power: new Float64Array(0) }, 0, 1)).toBe(0);
  });
});

describe('spectralHrv', () => {
  it('refuses recordings under two minutes and says why', () => {
    const { beats, intervals } = modulatedRhythm(60, 850, 30, 0.1);
    const result = spectralHrv(beats, intervals, normal(intervals.length));
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toMatch(/at least 2 minutes/);
  });

  it('offers LF and HF from two minutes and VLF from five', () => {
    const short = modulatedRhythm(180, 850, 30, 0.1);
    const medium = spectralHrv(short.beats, short.intervals, normal(short.intervals.length));
    expect(medium.available && !medium.vlfAvailable).toBe(true);
    const long = modulatedRhythm(400, 850, 30, 0.1);
    const full = spectralHrv(long.beats, long.intervals, normal(long.intervals.length));
    expect(full.available && full.vlfAvailable).toBe(true);
  });

  it('refuses when too many intervals were excluded', () => {
    const { beats, intervals } = modulatedRhythm(400, 850, 30, 0.1);
    const labels = intervals.map((_, i): IntervalLabel => (i % 3 === 0 ? 'short' : 'normal'));
    const result = spectralHrv(beats, intervals, labels);
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toMatch(/33% of the intervals were excluded/);
  });

  it('finds an LF rhythm with either method', () => {
    const { beats, intervals } = modulatedRhythm(400, 850, 40, 0.1);
    for (const method of ['lombScargle', 'welch'] as const) {
      const result = spectralHrv(beats, intervals, normal(intervals.length), method);
      expect(result.available && result.bands.lfHfRatio > 10).toBe(true);
    }
  });

  it('handles no beats at all', () => {
    expect(spectralHrv([], [], []).available).toBe(false);
  });
});
