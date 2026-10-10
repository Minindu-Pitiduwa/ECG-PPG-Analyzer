import { describe, expect, it } from 'vitest';
import { decodeInt16Samples } from '@/io/samples';
import { SAMPLE_INDEX, readSample } from '../helpers/samples';

describe('decodeInt16Samples', () => {
  it('converts little-endian ADC counts to physical units', () => {
    const bytes = new Uint8Array([0x00, 0x04, 0xc8, 0x04, 0x38, 0x03]); // 1024, 1224, 824
    expect(Array.from(decodeInt16Samples(bytes.buffer, 200, 1024))).toEqual([0, 1, -1]);
  });

  it('returns an empty signal for an empty buffer', () => {
    expect(decodeInt16Samples(new ArrayBuffer(0), 200, 0)).toHaveLength(0);
  });
});

describe('bundled samples', () => {
  it.each(SAMPLE_INDEX.map((info) => info.id))('%s matches its index entry', (id) => {
    const { info, samples } = readSample(id);
    expect(samples).toHaveLength(info.length);
    expect(samples.every(Number.isFinite)).toBe(true);
    expect(info.license).toContain('Open Data Commons');
  });
});
