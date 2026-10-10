import { describe, expect, it } from 'vitest';
import { kurtosis, mean, median } from '@/dsp/util/stats';

describe('mean', () => {
  it('averages the values', () => expect(mean([1, 2, 3, 6])).toBe(3));
  it('is NaN for an empty input', () => expect(mean([])).toBeNaN());
});

describe('median', () => {
  it('handles odd and even lengths', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  it('does not reorder its input', () => {
    const x = [3, 1, 2];
    median(x);
    expect(x).toEqual([3, 1, 2]);
  });
  it('is NaN for an empty input', () => expect(median([])).toBeNaN());
});

describe('kurtosis', () => {
  it('is 1.5 for a sine wave over whole periods', () => {
    const x = Float64Array.from({ length: 1000 }, (_, i) => Math.sin((2 * Math.PI * i) / 100));
    expect(kurtosis(x)).toBeCloseTo(1.5, 6);
  });
  it('is 1 for a two-valued symmetric signal', () => expect(kurtosis([-1, 1, -1, 1])).toBe(1));
  it('is NaN for a constant or empty signal', () => {
    expect(kurtosis([2, 2, 2])).toBeNaN();
    expect(kurtosis([])).toBeNaN();
  });
});
