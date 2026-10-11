import { describe, expect, it } from 'vitest';
import { elgendiPpg } from '@/dsp/detect/elgendi';
import { PAN_TOMPKINS_DEFAULTS, panTompkins, panTompkinsStages } from '@/dsp/detect/panTompkins';
import { enforceMinDistance, extremumIndex, parabolicOffset, peakTimes } from '@/dsp/detect/refine';
import { matchBeats } from '@/dsp/eval/matchBeats';
import { movingAverage } from '@/dsp/util/movingAverage';
import { regularBeats, seededNoise, syntheticEcg, syntheticPpg } from '../helpers/synth';

const times = (peaks: Int32Array, fs: number) => Array.from(peaks, (index) => index / fs);

/** Largest distance, in seconds, between each true beat and the detection matched to it. */
function worstTimingError(truth: number[], detected: number[]): number {
  return Math.max(...truth.map((beat) => Math.min(...detected.map((d) => Math.abs(d - beat)))));
}

describe('movingAverage', () => {
  it('averages a centred window and shrinks it at the edges', () => {
    const y = movingAverage(Float64Array.from([1, 2, 3, 4, 5]), 3);
    expect(Array.from(y)).toEqual([1.5, 2, 3, 4, 4.5]);
  });

  it('is the identity for a window of one and keeps a constant constant', () => {
    expect(Array.from(movingAverage(Float64Array.from([3, 1, 2]), 1))).toEqual([3, 1, 2]);
    expect(Array.from(movingAverage(new Float64Array(6).fill(2), 5))).toEqual(new Array(6).fill(2));
  });

  it('handles empty input and windows longer than the signal', () => {
    expect(movingAverage(new Float64Array(0), 3)).toHaveLength(0);
    expect(Array.from(movingAverage(Float64Array.from([1, 3]), 99))).toEqual([2, 2]);
  });

  it('rejects a window below one sample', () => {
    expect(() => movingAverage(new Float64Array(3), 0)).toThrow(RangeError);
  });
});

describe('peak refinement helpers', () => {
  it('finds the maximum or minimum in a clamped range', () => {
    const x = Float64Array.from([0, 5, -3, 2, 9]);
    expect(extremumIndex(x, 0, 3, 1)).toBe(1);
    expect(extremumIndex(x, 0, 3, -1)).toBe(2);
    expect(extremumIndex(x, -10, 99, 1)).toBe(4);
  });

  it('locates a peak between samples', () => {
    // Samples of a parabola whose vertex is at 10.3.
    const x = Float64Array.from({ length: 21 }, (_, i) => -((i - 10.3) ** 2));
    expect(parabolicOffset(x, 10)).toBeCloseTo(0.3, 10);
    expect(peakTimes(x, [10], 100)[0]).toBeCloseTo(0.103, 10);
  });

  it('returns no offset at the edges, on flat tops, and never more than half a sample', () => {
    const x = Float64Array.from([1, 2, 3]);
    expect(parabolicOffset(x, 0)).toBe(0);
    expect(parabolicOffset(x, 2)).toBe(0);
    expect(parabolicOffset(x, 1)).toBe(0); // collinear
    expect(parabolicOffset(Float64Array.from([0, 1, 0.999]), 1)).toBeLessThanOrEqual(0.5);
  });

  it('keeps the stronger of two peaks that are too close', () => {
    const strength = (index: number) => ({ 10: 1, 14: 5, 40: 2, 41: 1 })[index] ?? 0;
    expect(enforceMinDistance([40, 10, 14, 41], 10, strength)).toEqual([14, 40]);
    expect(enforceMinDistance([], 10, strength)).toEqual([]);
  });
});

describe('panTompkinsStages', () => {
  it('turns each QRS into one bump of the integrated signal, aligned with the R peak', () => {
    const fs = 360;
    const beats = regularBeats(10, 60);
    const { integrated, bandpassed } = panTompkinsStages(syntheticEcg(beats, 10, fs), fs);
    expect(integrated).toHaveLength(10 * fs);
    expect(bandpassed).toHaveLength(10 * fs);
    expect(integrated.every((value) => value >= 0)).toBe(true);
    for (const beat of beats) {
      const atBeat = integrated[Math.round(beat * fs)];
      const between = integrated[Math.round((beat + 0.5) * fs)];
      expect(atBeat).toBeGreaterThan(20 * between);
    }
  });
});

describe('panTompkins', () => {
  it.each([125, 250, 360, 500, 1000])('finds every beat of a clean ECG at %d Hz', (fs) => {
    const beats = regularBeats(30, 72);
    const detected = times(panTompkins(syntheticEcg(beats, 30, fs), fs), fs);
    expect(detected).toHaveLength(beats.length);
    // Within one sample of the true R peak.
    expect(worstTimingError(beats, detected)).toBeLessThanOrEqual(1 / fs + 1e-9);
  });

  it.each([40, 60, 100, 150, 200])('follows a heart rate of %d bpm', (bpm) => {
    const fs = 360;
    const beats = regularBeats(30, bpm);
    const score = matchBeats(beats, times(panTompkins(syntheticEcg(beats, 30, fs), fs), fs), 0.05);
    expect(score.falseNegatives).toBe(0);
    expect(score.falsePositives).toBe(0);
  });

  it('does not mistake tall T waves for beats', () => {
    const fs = 360;
    const beats = regularBeats(30, 70);
    const ecg = syntheticEcg(beats, 30, fs, { tAmplitude: 0.9 });
    const score = matchBeats(beats, times(panTompkins(ecg, fs), fs), 0.05);
    expect(score.falsePositives).toBe(0);
    expect(score.falseNegatives).toBe(0);
  });

  it('marks inverted complexes at the tip of the negative R wave', () => {
    const fs = 360;
    const beats = regularBeats(20, 70);
    const ecg = syntheticEcg(beats, 20, fs, { rAmplitude: -1 });
    const peaks = panTompkins(ecg, fs);
    expect(peaks).toHaveLength(beats.length);
    expect(worstTimingError(beats, times(peaks, fs))).toBeLessThanOrEqual(1 / fs + 1e-9);
    for (const peak of peaks) expect(ecg[peak]).toBeLessThan(-0.9);
  });

  it('recovers a weak beat by search-back, and misses it without', () => {
    const fs = 360;
    const beats = regularBeats(40, 60);
    // After squaring, 0.42 of the normal amplitude is 18% of the normal energy:
    // below the first threshold (about 25%) but above the second (half of that).
    const amplitudes = beats.map((_, k) => (k === 25 ? 0.42 : 1));
    const ecg = syntheticEcg(beats, 40, fs, {}, amplitudes);

    const withSearchBack = matchBeats(beats, times(panTompkins(ecg, fs), fs), 0.05);
    expect(withSearchBack.falseNegatives).toBe(0);
    expect(withSearchBack.falsePositives).toBe(0);

    const without = panTompkins(ecg, fs, { ...PAN_TOMPKINS_DEFAULTS, searchBack: false });
    expect(matchBeats(beats, times(without, fs), 0.05).falseNegatives).toBe(1);
  });

  it('adapts when the amplitude changes gradually by a factor of four', () => {
    const fs = 360;
    const beats = regularBeats(60, 75);
    const amplitudes = beats.map((_, k) => 2 - 1.5 * (k / beats.length));
    const score = matchBeats(
      beats,
      times(panTompkins(syntheticEcg(beats, 60, fs, {}, amplitudes), fs), fs),
      0.05,
    );
    expect(score.falseNegatives).toBe(0);
    expect(score.falsePositives).toBe(0);
  });

  it('tolerates baseline wander, mains hum and broadband noise', () => {
    const fs = 360;
    const beats = regularBeats(60, 80);
    const noise = seededNoise(60 * fs, 7);
    const ecg = syntheticEcg(beats, 60, fs).map(
      (value, i) =>
        value +
        0.8 * Math.sin((2 * Math.PI * 0.25 * i) / fs) +
        0.15 * Math.sin((2 * Math.PI * 50 * i) / fs) +
        0.08 * noise[i],
    );
    const score = matchBeats(beats, times(panTompkins(ecg, fs), fs), 0.05);
    expect(score.sensitivity).toBe(1);
    expect(score.positivePredictivity).toBe(1);
  });

  it('respects the refractory period', () => {
    const fs = 360;
    const ecg = syntheticEcg(regularBeats(30, 190), 30, fs);
    const peaks = panTompkins(ecg, fs);
    for (let i = 1; i < peaks.length; i++)
      expect(peaks[i] - peaks[i - 1]).toBeGreaterThanOrEqual(0.2 * fs);
  });

  it('returns peaks in increasing order as an Int32Array', () => {
    const fs = 250;
    const peaks = panTompkins(syntheticEcg(regularBeats(20, 90), 20, fs), fs);
    expect(peaks).toBeInstanceOf(Int32Array);
    for (let i = 1; i < peaks.length; i++) expect(peaks[i]).toBeGreaterThan(peaks[i - 1]);
  });

  it('finds nothing in empty, constant, very short or pure-ramp signals', () => {
    expect(panTompkins(new Float64Array(0), 360)).toHaveLength(0);
    expect(panTompkins(new Float64Array(3600).fill(1.2), 360)).toHaveLength(0);
    expect(panTompkins(Float64Array.from([0, 1, 0, 1]), 360)).toHaveLength(0);
    expect(panTompkins(new Float64Array(3600), 360)).toHaveLength(0);
  });

  it('does not modify its input', () => {
    const ecg = syntheticEcg(regularBeats(10, 70), 10, 360);
    const copy = Float64Array.from(ecg);
    panTompkins(ecg, 360);
    expect(Array.from(ecg)).toEqual(Array.from(copy));
  });
});

describe('elgendiPpg', () => {
  it.each([50, 125, 250, 500])('finds every pulse of a clean PPG at %d Hz', (fs) => {
    const beats = regularBeats(30, 72);
    const detected = times(elgendiPpg(syntheticPpg(beats, 30, fs), fs), fs);
    const score = matchBeats(beats, detected, 0.05);
    expect(score.falseNegatives).toBe(0);
    expect(score.falsePositives).toBe(0);
  });

  it.each([45, 70, 120, 170])('follows a pulse rate of %d bpm', (bpm) => {
    const fs = 125;
    const beats = regularBeats(40, bpm);
    const score = matchBeats(beats, times(elgendiPpg(syntheticPpg(beats, 40, fs), fs), fs), 0.06);
    expect(score.falseNegatives).toBe(0);
    expect(score.falsePositives).toBe(0);
  });

  it('marks the systolic peak, not the smaller diastolic bump', () => {
    const fs = 125;
    const beats = regularBeats(30, 60);
    const ppg = syntheticPpg(beats, 30, fs);
    const peaks = elgendiPpg(ppg, fs);
    expect(peaks).toHaveLength(beats.length);
    for (const peak of peaks) expect(ppg[peak]).toBeGreaterThan(0.9);
  });

  it('keeps working when the pulse amplitude drifts and the baseline wanders', () => {
    const fs = 125;
    const beats = regularBeats(60, 75);
    const amplitudes = beats.map((_, k) => 1 + 0.6 * Math.sin(k / 6));
    const noise = seededNoise(60 * fs, 3);
    const ppg = syntheticPpg(beats, 60, fs, amplitudes).map(
      (value, i) => value + 2 * Math.sin((2 * Math.PI * 0.1 * i) / fs) + 0.03 * noise[i] + 10,
    );
    const score = matchBeats(beats, times(elgendiPpg(ppg, fs), fs), 0.06);
    expect(score.sensitivity).toBe(1);
    expect(score.positivePredictivity).toBe(1);
  });

  it('never returns peaks closer than the maximum heart rate allows', () => {
    const fs = 125;
    const ppg = syntheticPpg(regularBeats(30, 110), 30, fs).map(
      (value, i) => value + 0.2 * seededNoise(1, i)[0],
    );
    const peaks = elgendiPpg(ppg, fs);
    for (let i = 1; i < peaks.length; i++)
      expect(peaks[i] - peaks[i - 1]).toBeGreaterThanOrEqual(0.3 * fs - 1);
  });

  it('finds nothing in empty, constant or very short signals', () => {
    expect(elgendiPpg(new Float64Array(0), 125)).toHaveLength(0);
    expect(elgendiPpg(new Float64Array(2000).fill(4), 125)).toHaveLength(0);
    expect(elgendiPpg(Float64Array.from([1, 2, 1]), 125)).toHaveLength(0);
  });
});

describe('matchBeats', () => {
  it('counts hits, misses and extras', () => {
    const score = matchBeats([1, 2, 3, 4], [1.05, 2.5, 3.1, 4.0, 5.0], 0.15);
    expect(score).toMatchObject({ truePositives: 3, falsePositives: 2, falseNegatives: 1 });
    expect(score.sensitivity).toBeCloseTo(0.75);
    expect(score.positivePredictivity).toBeCloseTo(0.6);
    expect(score.f1).toBeCloseTo((2 * 0.75 * 0.6) / 1.35);
  });

  it('matches each reference beat at most once', () => {
    const score = matchBeats([1], [0.95, 1.05], 0.15);
    expect(score).toMatchObject({ truePositives: 1, falsePositives: 1, falseNegatives: 0 });
  });

  it('treats the tolerance as inclusive', () => {
    expect(matchBeats([1], [1.15], 0.15).truePositives).toBe(1);
    expect(matchBeats([1], [1.16], 0.15).truePositives).toBe(0);
  });

  it('handles empty inputs', () => {
    expect(matchBeats([], [1, 2])).toMatchObject({
      truePositives: 0,
      falsePositives: 2,
      falseNegatives: 0,
    });
    expect(matchBeats([1, 2], [])).toMatchObject({
      truePositives: 0,
      falsePositives: 0,
      falseNegatives: 2,
    });
    expect(matchBeats([], []).sensitivity).toBeNaN();
    expect(matchBeats([1], []).sensitivity).toBe(0);
    expect(matchBeats([1], []).positivePredictivity).toBeNaN();
  });
});
