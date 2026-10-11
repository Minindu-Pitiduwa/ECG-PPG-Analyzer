import { describe, expect, it } from 'vitest';
import { beatIntervalsMs, heartRateSeries, heartRateStats } from '@/dsp/hrv/heartRate';

describe('beatIntervalsMs', () => {
  it('returns the gaps between successive beats in milliseconds', () => {
    const intervals = beatIntervalsMs([0.5, 1.5, 2.3, 3.3]);
    expect(intervals).toHaveLength(3);
    expect(intervals[0]).toBeCloseTo(1000, 9);
    expect(intervals[1]).toBeCloseTo(800, 9);
    expect(intervals[2]).toBeCloseTo(1000, 9);
  });

  it('returns nothing for zero or one beat', () => {
    expect(beatIntervalsMs([])).toHaveLength(0);
    expect(beatIntervalsMs([1.2])).toHaveLength(0);
  });
});

describe('heartRateStats', () => {
  it('is 60 bpm for one-second intervals', () => {
    expect(heartRateStats([1000, 1000, 1000])).toEqual({ meanBpm: 60, minBpm: 60, maxBpm: 60 });
  });

  it('takes the mean rate from the mean interval', () => {
    // Two beats at 500 ms and two at 1500 ms: 4 beats in 4 s is 60 bpm,
    // whereas averaging the instantaneous rates (120 and 40) would give 80.
    const stats = heartRateStats([500, 1500, 500, 1500]);
    expect(stats.meanBpm).toBeCloseTo(60, 9);
    expect(stats.minBpm).toBeCloseTo(40, 9);
    expect(stats.maxBpm).toBeCloseTo(120, 9);
  });

  it('is NaN when there are no intervals', () => {
    const stats = heartRateStats([]);
    expect(stats.meanBpm).toBeNaN();
    expect(stats.minBpm).toBeNaN();
    expect(stats.maxBpm).toBeNaN();
  });

  it('handles a single interval', () => {
    expect(heartRateStats([750])).toEqual({ meanBpm: 80, minBpm: 80, maxBpm: 80 });
  });
});

describe('heartRateSeries', () => {
  it('places each rate at the beat that ends its interval', () => {
    const { timeS, bpm } = heartRateSeries([1, 2, 2.5]);
    expect(Array.from(timeS)).toEqual([2, 2.5]);
    expect(bpm[0]).toBeCloseTo(60, 9);
    expect(bpm[1]).toBeCloseTo(120, 9);
  });

  it('is empty for fewer than two beats', () => {
    expect(heartRateSeries([]).bpm).toHaveLength(0);
    expect(heartRateSeries([3]).timeS).toHaveLength(0);
  });
});
