import { describe, expect, it } from 'vitest';
import {
  defaultQualityOptions,
  goodFraction,
  intervalsInLowQuality,
  templateSqi,
  type SegmentQuality,
} from '@/dsp/quality/templateSqi';
import { regularBeats, seededNoise, syntheticEcg, syntheticPpg } from '../helpers/synth';

const FS = 250;
const ecgOptions = defaultQualityOptions('ecg');

describe('templateSqi', () => {
  it('scores a clean ECG close to 1 in every segment', () => {
    const beats = regularBeats(60, 70);
    const segments = templateSqi(syntheticEcg(beats, 60, FS), FS, beats, ecgOptions);
    expect(segments).toHaveLength(6);
    for (const segment of segments) {
      expect(segment.score).toBeGreaterThan(0.99);
      expect(segment.good).toBe(true);
    }
    expect(goodFraction(segments)).toBe(1);
  });

  it('covers the recording with consecutive segments', () => {
    const beats = regularBeats(35, 70);
    const segments = templateSqi(syntheticEcg(beats, 35, FS), FS, beats, ecgOptions);
    expect(segments.map((segment) => [segment.startS, segment.endS])).toEqual([
      [0, 10],
      [10, 20],
      [20, 30],
      [30, 35],
    ]);
  });

  it('marks only the stretch buried in noise as low quality', () => {
    const beats = regularBeats(60, 70);
    const noise = seededNoise(60 * FS, 11);
    const ecg = syntheticEcg(beats, 60, FS).map((value, i) =>
      i >= 20 * FS && i < 40 * FS ? value + 3 * noise[i] : value,
    );
    const segments = templateSqi(ecg, FS, beats, ecgOptions);
    expect(segments.map((segment) => segment.good)).toEqual([true, true, false, false, true, true]);
    expect(goodFraction(segments)).toBeCloseTo(4 / 6);
  });

  it('is not fooled by a few ectopic beats of a different shape', () => {
    const beats = regularBeats(30, 70);
    const amplitudes = beats.map((_, k) => (k % 5 === 2 ? -0.8 : 1)); // every fifth beat inverted
    const segments = templateSqi(
      syntheticEcg(beats, 30, FS, {}, amplitudes),
      FS,
      beats,
      ecgOptions,
    );
    expect(segments.every((segment) => segment.good)).toBe(true);
  });

  it('marks a segment with a long silence as low quality even if its beats look fine', () => {
    const beats = regularBeats(30, 70).filter((time) => time < 12 || time > 17);
    const segments = templateSqi(syntheticEcg(beats, 30, FS), FS, beats, ecgOptions);
    expect(segments.map((segment) => segment.good)).toEqual([true, false, true]);
  });

  it('scores a segment without enough beats as zero', () => {
    const segments = templateSqi(syntheticEcg([5], 10, FS), FS, [5], ecgOptions);
    expect(segments[0]).toMatchObject({ score: 0, good: false });
  });

  it('uses a stricter threshold for PPG and passes a clean pulse', () => {
    const options = defaultQualityOptions('ppg');
    expect(options.threshold).toBeGreaterThan(ecgOptions.threshold);
    const beats = regularBeats(30, 75);
    const segments = templateSqi(syntheticPpg(beats, 30, 125), 125, beats, options);
    expect(segments.every((segment) => segment.good)).toBe(true);
  });

  it('handles an empty signal, no beats and a constant signal', () => {
    expect(templateSqi(new Float64Array(0), FS, [], ecgOptions)).toEqual([]);
    const silent = templateSqi(new Float64Array(20 * FS), FS, [], ecgOptions);
    expect(silent.every((segment) => !segment.good && segment.score === 0)).toBe(true);
    const flat = templateSqi(
      new Float64Array(10 * FS).fill(2),
      FS,
      regularBeats(10, 70),
      ecgOptions,
    );
    expect(flat[0].score).toBe(0);
  });

  it('is NaN as a fraction when there are no segments', () => {
    expect(goodFraction([])).toBeNaN();
  });
});

describe('intervalsInLowQuality', () => {
  const segments: SegmentQuality[] = [
    { startS: 0, endS: 10, score: 1, good: true },
    { startS: 10, endS: 20, score: 0.2, good: false },
    { startS: 20, endS: 30, score: 1, good: true },
  ];

  it('flags an interval when either of its beats is in a low-quality segment', () => {
    const beats = [8, 9, 11, 19, 21, 22];
    expect(intervalsInLowQuality(beats, segments, 10)).toEqual([false, true, true, true, false]);
  });

  it('returns one flag per interval and handles fewer than two beats', () => {
    expect(intervalsInLowQuality([], segments, 10)).toEqual([]);
    expect(intervalsInLowQuality([5], segments, 10)).toEqual([]);
    expect(intervalsInLowQuality([5, 35], segments, 10)).toEqual([false]);
  });
});
