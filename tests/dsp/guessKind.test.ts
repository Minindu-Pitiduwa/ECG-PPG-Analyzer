import { describe, expect, it } from 'vitest';
import { guessSignalKind } from '@/dsp/util/guessKind';
import { SAMPLE_INDEX, readSample } from '../helpers/samples';

describe('guessSignalKind', () => {
  it.each(SAMPLE_INDEX.map((info) => [info.id, info.kind] as const))(
    'recognizes the bundled sample %s as %s',
    (id, kind) => {
      const { info, samples } = readSample(id);
      expect(guessSignalKind(samples, info.fs)).toBe(kind);
    },
  );

  it('gives the same answer after resampling to half the rate', () => {
    const { info, samples } = readSample('ecg-normal');
    const half = samples.filter((_, i) => i % 2 === 0);
    expect(guessSignalKind(half, info.fs / 2)).toBe('ecg');
  });

  it('declines to guess for empty, very short or constant signals', () => {
    expect(guessSignalKind(new Float64Array(0), 250)).toBeNull();
    expect(guessSignalKind(new Float64Array(100), 250)).toBeNull();
    expect(guessSignalKind(new Float64Array(5000).fill(1), 250)).toBeNull();
  });
});
