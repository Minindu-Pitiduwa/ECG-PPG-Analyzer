import { describe, expect, it } from 'vitest';
import { classifyIntervals, type IntervalLabel } from '@/dsp/hrv/intervals';
import { coefficientOfSampleEntropy, sampleEntropy } from '@/dsp/rhythm/entropy';
import { detectFlags, isIrregularWindow, type FlagKind, type RhythmFlag } from '@/dsp/rhythm/flags';
import { createRandom } from '@/dsp/util/random';

/** Beat times (starting at 0) for the given intervals in milliseconds. */
function beatsFrom(intervalsMs: number[]): number[] {
  const beats = [0];
  for (const interval of intervalsMs) beats.push(beats[beats.length - 1] + interval / 1000);
  return beats;
}

function flagsFor(intervalsMs: number[], labels = classifyIntervals(intervalsMs)): RhythmFlag[] {
  return detectFlags(beatsFrom(intervalsMs), intervalsMs, labels);
}

const kinds = (flags: RhythmFlag[]): FlagKind[] => flags.map((flag) => flag.kind);
const find = (flags: RhythmFlag[], kind: FlagKind) => flags.find((flag) => flag.kind === kind);

/** Intervals with the erratic spread of atrial fibrillation. */
function fibrillation(n: number, seed = 5): number[] {
  const random = createRandom(seed);
  return Array.from({ length: n }, () => 450 + 500 * random.uniform());
}

/** A steady rhythm with gentle breathing-related variation. */
function sinus(n: number, meanMs = 800): number[] {
  return Array.from({ length: n }, (_, i) => meanMs + 25 * Math.sin(i / 2.5));
}

describe('sampleEntropy', () => {
  it('is zero for a perfectly repeating series', () => {
    expect(sampleEntropy(new Array<number>(30).fill(800), 1, 30)).toBe(0);
    expect(
      sampleEntropy(
        Array.from({ length: 40 }, (_, i) => (i % 2 ? 900 : 700)),
        1,
        30,
      ),
    ).toBe(0);
  });

  it('is higher for an erratic series than for a smooth one', () => {
    expect(sampleEntropy(fibrillation(60), 1, 30)).toBeGreaterThan(
      sampleEntropy(sinus(60), 1, 30) + 0.5,
    );
  });

  it('matches a hand count', () => {
    // m = 1, r = 0.5 on [1, 2, 1, 2, 1]: templates x[0..3] = 1, 2, 1, 2.
    // Matching pairs at length 1: (0,2) and (1,3) -> B = 2; both still match at the next point -> A = 2.
    expect(sampleEntropy([1, 2, 1, 2, 1], 1, 0.5)).toBe(0);
    // [1, 2, 1, 3, 1]: pair (0,2) matches at length 1 (B = 1), next points 2 vs 3 do not (A = 0).
    expect(sampleEntropy([1, 2, 1, 3, 1], 1, 0.5)).toBe(Infinity);
  });

  it('is NaN when nothing matches or the series is too short', () => {
    expect(sampleEntropy([1, 10, 100, 1000], 1, 0.5)).toBeNaN();
    expect(sampleEntropy([], 1, 30)).toBeNaN();
    expect(sampleEntropy([800], 1, 30)).toBeNaN();
  });
});

describe('coefficientOfSampleEntropy', () => {
  it('equals sample entropy plus ln(2r) minus ln(mean)', () => {
    const intervals = fibrillation(30);
    const mean = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
    expect(coefficientOfSampleEntropy(intervals)).toBeCloseTo(
      sampleEntropy(intervals, 1, 30) + Math.log(60) - Math.log(mean),
      12,
    );
  });

  it('does not depend on the time unit', () => {
    const ms = fibrillation(30);
    const seconds = ms.map((value) => value / 1000);
    expect(coefficientOfSampleEntropy(seconds, 1, 0.03)).toBeCloseTo(
      coefficientOfSampleEntropy(ms, 1, 30),
      9,
    );
  });
});

describe('isIrregularWindow', () => {
  it('flags fibrillation-like intervals and not a steady rhythm', () => {
    expect(isIrregularWindow(fibrillation(30))).toBe(true);
    expect(isIrregularWindow(sinus(30))).toBe(false);
  });

  it('does not flag bigeminy: large changes, but in a strict pattern', () => {
    expect(isIrregularWindow(Array.from({ length: 30 }, (_, i) => (i % 2 ? 1050 : 550)))).toBe(
      false,
    );
  });

  it('handles windows too short to judge', () => {
    expect(isIrregularWindow([])).toBe(false);
    expect(isIrregularWindow([800])).toBe(false);
  });
});

describe('detectFlags', () => {
  it('raises nothing for a normal resting rhythm', () => {
    expect(flagsFor(sinus(300))).toEqual([]);
  });

  it('flags a fast run and reports where and for how long', () => {
    const intervals = [...sinus(40), ...new Array<number>(30).fill(500), ...sinus(40)];
    const flags = flagsFor(intervals, new Array<IntervalLabel>(intervals.length).fill('normal'));
    expect(kinds(flags)).toEqual(['tachycardia']);
    const [location] = flags[0].locations;
    expect(location.endS - location.startS).toBeCloseTo(15, 6);
    expect(location.startS).toBeCloseTo(beatsFrom(intervals)[40], 6);
    expect(flags[0].value).toBeCloseTo(15, 6);
  });

  it('flags a slow run', () => {
    const flags = flagsFor(new Array<number>(40).fill(1200));
    expect(kinds(flags)).toEqual(['bradycardia']);
    expect(flags[0].value).toBeCloseTo(48, 6);
  });

  it('ignores fast or slow stretches shorter than ten beats', () => {
    const intervals = [...sinus(30), ...new Array<number>(9).fill(550), ...sinus(30)];
    expect(flagsFor(intervals, new Array<IntervalLabel>(intervals.length).fill('normal'))).toEqual(
      [],
    );
  });

  it('uses adjustable rate thresholds', () => {
    const intervals = new Array<number>(40).fill(700); // 86 bpm
    const labels = new Array<IntervalLabel>(40).fill('normal');
    const beats = beatsFrom(intervals);
    expect(detectFlags(beats, intervals, labels)).toEqual([]);
    const strict = detectFlags(beats, intervals, labels, {
      tachycardiaBpm: 80,
      bradycardiaBpm: 60,
      pauseS: 2,
    });
    expect(kinds(strict)).toEqual(['tachycardia']);
  });

  it('flags each pause with its length, but not a gap in low-quality signal', () => {
    const intervals = [...sinus(20), 2600, ...sinus(20), 3100, ...sinus(20)];
    const flags = flagsFor(intervals);
    const pause = find(flags, 'pause');
    expect(pause?.locations).toHaveLength(2);
    expect(pause?.value).toBeCloseTo(3.1, 6);

    const labels = classifyIntervals(intervals);
    labels[20] = 'lowQuality';
    labels[41] = 'lowQuality';
    expect(find(detectFlags(beatsFrom(intervals), intervals, labels), 'pause')).toBeUndefined();
  });

  it('counts premature beats: an early beat followed by a compensatory pause', () => {
    const intervals = sinus(100);
    for (const at of [20, 50, 80]) {
      intervals[at] = 500;
      intervals[at + 1] = 1100;
    }
    const premature = find(flagsFor(intervals), 'premature');
    expect(premature?.value).toBe(3);
    expect(premature?.locations).toHaveLength(3);
    // The location spans the early beat and its pause.
    const beats = beatsFrom(intervals);
    expect(premature?.locations[0].startS).toBeCloseTo(beats[20], 6);
    expect(premature?.locations[0].endS).toBeCloseTo(beats[22], 6);
  });

  it('does not call a lone long interval (a missed beat) premature', () => {
    const intervals = sinus(60);
    intervals[30] = 1600;
    expect(find(flagsFor(intervals), 'premature')).toBeUndefined();
  });

  it('flags a long stretch of fibrillation-like rhythm, and only that stretch', () => {
    const intervals = [...sinus(150), ...fibrillation(200), ...sinus(150)];
    const beats = beatsFrom(intervals);
    const irregular = find(
      detectFlags(beats, intervals, classifyIntervals(intervals)),
      'irregular',
    );
    expect(irregular?.locations).toHaveLength(1);
    const [episode] = irregular?.locations ?? [];
    // Within one window (30 beats) of the true boundaries.
    expect(Math.abs(episode.startS - beats[150])).toBeLessThan(25);
    expect(Math.abs(episode.endS - beats[350])).toBeLessThan(25);
  });

  it('does not flag a few seconds of irregularity or sustained bigeminy as irregular', () => {
    const brief = [...sinus(100), ...fibrillation(20), ...sinus(100)];
    expect(find(flagsFor(brief), 'irregular')).toBeUndefined();
    const bigeminy = Array.from({ length: 300 }, (_, i) => (i % 2 ? 1050 : 550));
    expect(find(flagsFor(bigeminy), 'irregular')).toBeUndefined();
  });

  it('does not judge rhythm in low-quality signal', () => {
    const intervals = fibrillation(200);
    const labels = new Array<IntervalLabel>(200).fill('lowQuality');
    expect(detectFlags(beatsFrom(intervals), intervals, labels)).toEqual([]);
  });

  it('handles no beats, one beat and one interval', () => {
    expect(detectFlags([], [], [])).toEqual([]);
    expect(detectFlags([1], [], [])).toEqual([]);
    expect(detectFlags([1, 1.8], [800], ['normal'])).toEqual([]);
  });
});
