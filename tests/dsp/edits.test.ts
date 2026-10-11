import { describe, expect, it } from 'vitest';
import { applyBeatEdits, dominantPolarity, snapToPeak, type BeatEdit } from '@/dsp/detect/edits';
import { regularBeats, syntheticEcg } from '../helpers/synth';

describe('applyBeatEdits', () => {
  const auto = [1, 2, 3, 4];

  it('returns the automatic beats when there are no edits', () => {
    expect(applyBeatEdits(auto, [])).toEqual(auto.map((timeS) => ({ timeS, source: 'auto' })));
  });

  it('adds manual beats in time order', () => {
    const beats = applyBeatEdits(auto, [{ type: 'add', timeS: 2.5 }]);
    expect(beats.map((beat) => beat.timeS)).toEqual([1, 2, 2.5, 3, 4]);
    expect(beats[2].source).toBe('manual');
  });

  it('removes the beat nearest to the given time', () => {
    const beats = applyBeatEdits(auto, [{ type: 'remove', timeS: 3.02 }]);
    expect(beats.map((beat) => beat.timeS)).toEqual([1, 2, 4]);
  });

  it('ignores edits that match nothing', () => {
    const edits: BeatEdit[] = [
      { type: 'remove', timeS: 2.5 }, // no beat there
      { type: 'add', timeS: 3.01 }, // a beat is already there
    ];
    expect(applyBeatEdits(auto, edits).map((beat) => beat.timeS)).toEqual(auto);
  });

  it('applies edits in order, so a manual beat can be removed again', () => {
    const edits: BeatEdit[] = [
      { type: 'add', timeS: 2.5 },
      { type: 'remove', timeS: 2.5 },
    ];
    expect(applyBeatEdits(auto, edits)).toHaveLength(4);
  });

  it('keeps corrections valid when detection moves slightly', () => {
    const edits: BeatEdit[] = [{ type: 'remove', timeS: 2 }];
    const redetected = [1.004, 2.003, 2.998, 4.001];
    expect(applyBeatEdits(redetected, edits).map((beat) => beat.timeS)).toEqual([
      1.004, 2.998, 4.001,
    ]);
  });

  it('works with no automatic beats and does not modify its inputs', () => {
    const edits: BeatEdit[] = [{ type: 'add', timeS: 1 }];
    expect(applyBeatEdits([], edits)).toEqual([{ timeS: 1, source: 'manual' }]);
    expect(applyBeatEdits(new Float64Array(0), [{ type: 'remove', timeS: 1 }])).toEqual([]);
    expect(edits).toEqual([{ type: 'add', timeS: 1 }]);
  });
});

describe('dominantPolarity', () => {
  const fs = 360;
  const beats = regularBeats(10, 60);
  const peaks = beats.map((beat) => Math.round(beat * fs));

  it('is 1 for upright and -1 for inverted R waves', () => {
    expect(dominantPolarity(syntheticEcg(beats, 10, fs), peaks, fs)).toBe(1);
    expect(dominantPolarity(syntheticEcg(beats, 10, fs, { rAmplitude: -1 }), peaks, fs)).toBe(-1);
  });

  it('defaults to 1 when there are no peaks', () => {
    expect(dominantPolarity(new Float64Array(100), [], fs)).toBe(1);
  });
});

describe('snapToPeak', () => {
  const fs = 360;
  const ecg = syntheticEcg([1, 2], 3, fs);

  it('moves a nearby click onto the R peak', () => {
    expect(snapToPeak(ecg, fs, 1.05, 1)).toBeCloseTo(1, 2);
    expect(snapToPeak(ecg, fs, 1.94, 1)).toBeCloseTo(2, 2);
  });

  it('snaps to minima for inverted signals', () => {
    const inverted = ecg.map((value) => -value);
    expect(snapToPeak(inverted, fs, 1.05, -1)).toBeCloseTo(1, 2);
  });

  it('stays inside the signal for clicks at the edges', () => {
    expect(snapToPeak(ecg, fs, -1, 1)).toBeGreaterThanOrEqual(0);
    expect(snapToPeak(ecg, fs, 99, 1)).toBeLessThanOrEqual(3);
  });
});
