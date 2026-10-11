import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ImportError } from '@/io/types';
import { decodeWfdbSignal, parseWfdbHeader, type WfdbHeader } from '@/io/wfdb';

const DIR = fileURLToPath(new URL('../fixtures/wfdb/', import.meta.url));

interface ExpectedRecord {
  fs: number;
  sampleCount: number;
  signals: {
    description: string;
    units: string;
    gain: number;
    baseline: number;
    format: number;
    adc: number[];
    physical: number[];
  }[];
}

/** What the reference `wfdb` Python package reads from the same files. */
const expected = JSON.parse(readFileSync(`${DIR}expected.json`, 'utf8')) as Record<
  string,
  ExpectedRecord
>;

function load(name: string): { header: WfdbHeader; data: ArrayBuffer } {
  const file = readFileSync(`${DIR}${name}.dat`);
  return {
    header: parseWfdbHeader(readFileSync(`${DIR}${name}.hea`, 'utf8')),
    data: file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
  };
}

describe.each(Object.keys(expected))('%s matches the wfdb Python package', (name) => {
  const { header, data } = load(name);
  const reference = expected[name];

  it('reads the header', () => {
    expect(header.recordName).toBe(name);
    expect(header.fs).toBe(reference.fs);
    expect(header.sampleCount).toBe(reference.sampleCount);
    expect(header.signals).toHaveLength(reference.signals.length);
    header.signals.forEach((signal, i) => {
      expect(signal.description).toBe(reference.signals[i].description);
      expect(signal.units).toBe(reference.signals[i].units);
      expect(signal.gain).toBe(reference.signals[i].gain);
      expect(signal.baseline).toBe(reference.signals[i].baseline);
      expect(signal.format).toBe(reference.signals[i].format);
    });
  });

  it('decodes every sample of every signal exactly', () => {
    reference.signals.forEach((signal, i) => {
      const decoded = decodeWfdbSignal(header, data, i);
      expect(decoded).toHaveLength(reference.sampleCount);
      // Convert back to ADC counts: these must be the very same integers.
      const adc = Array.from(decoded, (value) => Math.round(value * signal.gain + signal.baseline));
      expect(adc).toEqual(signal.adc);
      decoded.forEach((value, k) => expect(value).toBeCloseTo(signal.physical[k], 10));
    });
  });
});

describe('parseWfdbHeader', () => {
  it('reads an original MIT-BIH header, including comments and CRLF line endings', () => {
    const header = parseWfdbHeader(
      [
        '100 2 360 650000',
        '100.dat 212 200 11 1024 995 -22131 0 MLII',
        '100.dat 212 200 11 1024 1011 20052 0 V5',
        '# 69 M 1085 1629 x1',
        '# Aldomet, Inderal',
        '',
      ].join('\r\n'),
    );
    expect(header).toMatchObject({ recordName: '100', fs: 360, sampleCount: 650000 });
    expect(header.signals[0]).toMatchObject({
      fileName: '100.dat',
      format: 212,
      gain: 200,
      baseline: 1024, // no explicit baseline, so the ADC zero is used
      units: 'mV',
      description: 'MLII',
      byteOffset: 0,
    });
    expect(header.signals[1].description).toBe('V5');
  });

  it('applies the WFDB defaults for missing fields', () => {
    const header = parseWfdbHeader('rec 1\nrec.dat 16');
    expect(header.fs).toBe(250);
    expect(header.sampleCount).toBeNull();
    expect(header.signals[0]).toMatchObject({
      gain: 200,
      baseline: 0,
      units: 'mV',
      description: 'rec.dat',
    });
  });

  it('treats a gain of zero as uncalibrated and keeps multi-word descriptions', () => {
    const header = parseWfdbHeader('rec 1 500 1000\nrec.dat 16 0 16 0 0 0 0 ECG lead II');
    expect(header.signals[0].gain).toBe(200);
    expect(header.signals[0].description).toBe('ECG lead II');
  });

  it('reads a byte offset, a counter frequency and scientific-notation gain', () => {
    const header = parseWfdbHeader(
      'rec 1 500/1000(0) 1000\nrec.dat 16+24 1.5e3(-10)/uV 16 0 0 0 0 X',
    );
    expect(header.fs).toBe(500);
    expect(header.signals[0]).toMatchObject({
      byteOffset: 24,
      gain: 1500,
      baseline: -10,
      units: 'uV',
    });
  });

  it('rejects headers it cannot use, with a reason', () => {
    expect(() => parseWfdbHeader('')).toThrow(ImportError);
    expect(() => parseWfdbHeader('# only a comment\n')).toThrow(/empty/);
    expect(() => parseWfdbHeader('hello world')).toThrow(/does not list any signals/);
    expect(() => parseWfdbHeader('rec/3 2 250 1000\nseg1 500')).toThrow(/multi-segment/);
    expect(() => parseWfdbHeader('rec 2 250 1000\nrec.dat 16 200')).toThrow(/describes only 1/);
    expect(() => parseWfdbHeader('rec 1 abc 1000\nrec.dat 16 200')).toThrow(/sampling rate/);
    expect(() => parseWfdbHeader('rec 1 250 1000\nrec.dat 16x4 200')).toThrow(
      /multiple of the frame rate/,
    );
    expect(() => parseWfdbHeader('rec 1 250 1000\nrec.dat sixteen 200')).toThrow(/storage format/);
  });
});

describe('decodeWfdbSignal', () => {
  it('unpacks format 212, including negative values', () => {
    // Samples 1, -1, 2047 and -2048 as 12-bit two's complement: 0x001, 0xFFF, 0x7FF, 0x800.
    const bytes = Uint8Array.from([0x01, 0xf0, 0xff, 0xff, 0x87, 0x00]);
    const header = parseWfdbHeader('t 1 100 4\nt.dat 212 1 12 0 0 0 0 x');
    expect(Array.from(decodeWfdbSignal(header, bytes.buffer, 0))).toEqual([1, -1, 2047, -2048]);
  });

  it('honours a byte offset and de-interleaves format 16', () => {
    const view = new DataView(new ArrayBuffer(4 + 12));
    [10, -10, 20, -20, 30, -30].forEach((value, i) => view.setInt16(4 + 2 * i, value, true));
    const header = parseWfdbHeader(
      't 2 100 3\nt.dat 16+4 10 16 0 0 0 0 a\nt.dat 16+4 10(5) 16 0 0 0 0 b',
    );
    expect(Array.from(decodeWfdbSignal(header, view.buffer, 0))).toEqual([1, 2, 3]);
    expect(Array.from(decodeWfdbSignal(header, view.buffer, 1))).toEqual([-1.5, -2.5, -3.5]);
  });

  it('works out the length from the file when the header does not give it', () => {
    const header = parseWfdbHeader('t 1 100\nt.dat 16 1');
    expect(decodeWfdbSignal(header, new ArrayBuffer(20), 0)).toHaveLength(10);
  });

  it('only reads the signals stored in the chosen file', () => {
    const header = parseWfdbHeader('t 2 100 2\na.dat 16 1\nb.dat 16 1');
    const view = new DataView(new ArrayBuffer(4));
    view.setInt16(0, 7, true);
    view.setInt16(2, 8, true);
    expect(Array.from(decodeWfdbSignal(header, view.buffer, 1))).toEqual([7, 8]);
  });

  it('rejects unsupported formats, truncated files, empty files and bad indices', () => {
    const header = parseWfdbHeader('t 1 100 10\nt.dat 16 1');
    expect(() => decodeWfdbSignal(header, new ArrayBuffer(8), 0)).toThrow(/too short/);
    expect(() => decodeWfdbSignal(header, new ArrayBuffer(20), 3)).toThrow(/does not exist/);
    const format80 = parseWfdbHeader('t 1 100 10\nt.dat 80 1');
    expect(() => decodeWfdbSignal(format80, new ArrayBuffer(20), 0)).toThrow(/format 80/);
    const open = parseWfdbHeader('t 1 100\nt.dat 16 1');
    expect(() => decodeWfdbSignal(open, new ArrayBuffer(0), 0)).toThrow(/no samples/);
    const mixed = parseWfdbHeader('t 2 100 2\nt.dat 16 1\nt.dat 212 1');
    expect(() => decodeWfdbSignal(mixed, new ArrayBuffer(20), 0)).toThrow(
      /different storage formats/,
    );
  });
});
