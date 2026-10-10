import { describe, expect, it } from 'vitest';
import { decimateMinMax, extent } from '@/dsp/util/decimate';

function ramp(n: number): Float64Array {
  return Float64Array.from({ length: n }, (_, i) => i);
}

describe('decimateMinMax', () => {
  it('returns an empty series for an empty signal or range', () => {
    expect(decimateMinMax(new Float64Array(0), 100, 0, 10, 50).t).toHaveLength(0);
    expect(decimateMinMax(ramp(100), 100, 40, 40, 50).t).toHaveLength(0);
    expect(decimateMinMax(ramp(100), 100, 0, 100, 0).t).toHaveLength(0);
  });

  it('passes the samples through untouched when there are few enough', () => {
    const { t, y } = decimateMinMax(ramp(10), 2, 2, 6, 100);
    expect(Array.from(y)).toEqual([2, 3, 4, 5]);
    expect(Array.from(t)).toEqual([1, 1.5, 2, 2.5]);
  });

  it('clamps a range that extends past the signal', () => {
    const { y } = decimateMinMax(ramp(10), 1, -5, 50, 100);
    expect(y).toHaveLength(10);
  });

  it('never loses a narrow spike, wherever it falls', () => {
    for (const spikeAt of [0, 1234, 5000, 9999]) {
      const x = new Float64Array(10_000);
      x[spikeAt] = 7;
      const { t, y } = decimateMinMax(x, 100, 0, x.length, 50);
      expect(y.length).toBeLessThanOrEqual(100);
      expect(Math.max(...y)).toBe(7);
      expect(t[y.indexOf(7)]).toBe(spikeAt / 100);
    }
  });

  it('keeps both extremes of every bucket and keeps time increasing', () => {
    const x = Float64Array.from({ length: 10_000 }, (_, i) => Math.sin(i / 7) * (1 + i / 1000));
    const { t, y } = decimateMinMax(x, 250, 0, x.length, 100);
    expect(extent(y)).toEqual(extent(x));
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
  });

  it('emits one point per bucket for a constant signal', () => {
    const { y } = decimateMinMax(new Float64Array(1000).fill(3), 100, 0, 1000, 10);
    expect(Array.from(y)).toEqual(new Array(10).fill(3));
  });
});

describe('extent', () => {
  it('finds the smallest and largest value', () => {
    expect(extent([3, -1, 4, 1, 5])).toEqual([-1, 5]);
  });

  it('respects the sub-range', () => {
    expect(extent([9, 1, 2, 3, -9], 1, 4)).toEqual([1, 3]);
  });

  it('returns NaN for an empty range', () => {
    expect(extent([])).toEqual([NaN, NaN]);
  });
});
