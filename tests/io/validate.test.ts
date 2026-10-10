import { describe, expect, it } from 'vitest';
import { ImportError } from '@/io/types';
import { checkRecording, samplingRateError } from '@/io/validate';

const noisy = (n: number) => Float64Array.from({ length: n }, (_, i) => Math.sin(i / 5));

describe('samplingRateError', () => {
  it('accepts realistic rates', () => {
    for (const fs of [25, 125, 360, 500, 1000]) expect(samplingRateError(fs)).toBeNull();
  });

  it('rejects missing, non-positive and unrealistic rates', () => {
    for (const fs of [NaN, 0, -250, 5, 50_000, Infinity])
      expect(samplingRateError(fs)).not.toBeNull();
  });
});

describe('checkRecording', () => {
  it('returns no warnings for a normal recording', () => {
    expect(checkRecording(noisy(250 * 60), 250, 'ecg')).toEqual([]);
  });

  it('rejects empty, too-short and constant recordings', () => {
    expect(() => checkRecording(new Float64Array(0), 250, 'ecg')).toThrow(ImportError);
    expect(() => checkRecording(noisy(250), 250, 'ecg')).toThrow(/only 1.0 s/);
    expect(() => checkRecording(new Float64Array(5000).fill(2), 250, 'ecg')).toThrow(/same value/);
  });

  it('rejects an unrealistic sampling rate', () => {
    expect(() => checkRecording(noisy(5000), 2, 'ecg')).toThrow(ImportError);
  });

  it('warns about short recordings', () => {
    const warnings = checkRecording(noisy(250 * 5), 250, 'ecg');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Short recording/);
  });

  it('warns about a low sampling rate for ECG but not for PPG', () => {
    expect(checkRecording(noisy(50 * 60), 50, 'ecg')[0]).toMatch(/low for ECG/);
    expect(checkRecording(noisy(50 * 60), 50, 'ppg')).toEqual([]);
  });
});
