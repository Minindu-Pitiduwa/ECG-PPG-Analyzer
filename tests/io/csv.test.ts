import { describe, expect, it } from 'vitest';
import {
  extractCsvColumns,
  inferSamplingRate,
  interpolateGaps,
  sniffCsv,
  type CsvExtractOptions,
} from '@/io/csv';
import { ImportError } from '@/io/types';

function optionsFrom(text: string): CsvExtractOptions {
  const { delimiter, hasHeader, decimalComma, timeColumn, signalColumn } = sniffCsv(text);
  return { delimiter, hasHeader, decimalComma, timeColumn, signalColumn };
}

describe('sniffCsv', () => {
  it('reads a comma-separated file with a header', () => {
    const preview = sniffCsv('time,ecg\n0.000,0.12\n0.004,0.15\n0.008,0.11\n');
    expect(preview.delimiter).toBe(',');
    expect(preview.hasHeader).toBe(true);
    expect(preview.columns.map((column) => column.name)).toEqual(['time', 'ecg']);
    expect(preview.timeColumn).toBe(0);
    expect(preview.signalColumn).toBe(1);
    expect(preview.rows[0]).toEqual(['0.000', '0.12']);
  });

  it('reads a single headerless column', () => {
    const preview = sniffCsv('512\n514\n520\n');
    expect(preview.hasHeader).toBe(false);
    expect(preview.columns).toHaveLength(1);
    expect(preview.columns[0].name).toBe('Column 1');
    expect(preview.timeColumn).toBeNull();
    expect(preview.signalColumn).toBe(0);
  });

  it.each([
    ['tab', 't\tppg\n0\t1.5\n1\t1.6\n', '\t'],
    ['semicolon', 't;ppg\n0;1.5\n1;1.6\n', ';'],
    ['space', '0 1.5\n1   1.6\n2 1.7\n', ' '],
  ])('detects a %s delimiter', (_name, text, delimiter) => {
    expect(sniffCsv(text).delimiter).toBe(delimiter);
  });

  it('recognizes decimal commas in semicolon-separated files', () => {
    const text = 'Zeit;EKG\n0,000;0,12\n0,004;-0,15\n';
    const preview = sniffCsv(text);
    expect(preview.delimiter).toBe(';');
    expect(preview.decimalComma).toBe(true);
    const { signal } = extractCsvColumns(text, optionsFrom(text));
    expect(Array.from(signal)).toEqual([0.12, -0.15]);
  });

  it('treats an increasing unnamed first column as time', () => {
    const preview = sniffCsv('0,512\n4,530\n8,498\n12,505\n');
    expect(preview.timeColumn).toBe(0);
    expect(preview.signalColumn).toBe(1);
  });

  it('prefers a column whose name looks like a signal', () => {
    const preview = sniffCsv('time,temperature,ecg_mv\n0,36.5,0.1\n1,36.5,0.2\n');
    expect(preview.signalColumn).toBe(2);
  });

  it('skips text columns when choosing the signal', () => {
    const preview = sniffCsv('label,value\na,1\nb,2\nc,3\n');
    expect(preview.columns[0].numeric).toBe(false);
    expect(preview.signalColumn).toBe(1);
  });

  it('ignores a byte-order mark, comment lines, blank lines and Windows line endings', () => {
    const preview = sniffCsv('﻿# exported by device\r\n\r\ntime,ecg\r\n0,1\r\n1,2\r\n');
    expect(preview.columns.map((column) => column.name)).toEqual(['time', 'ecg']);
    expect(preview.rows).toEqual([
      ['0', '1'],
      ['1', '2'],
    ]);
  });

  it('strips quotes around header names', () => {
    expect(sniffCsv('"time","ecg"\n0,1\n1,2\n').columns[1].name).toBe('ecg');
  });

  it('rejects empty files, header-only files and files without numbers', () => {
    expect(() => sniffCsv('')).toThrow(ImportError);
    expect(() => sniffCsv('  \n\n')).toThrow(/empty/);
    expect(() => sniffCsv('a,b\nx,y\nz,w\n')).toThrow(/No numeric signal column/);
  });
});

describe('extractCsvColumns', () => {
  it('extracts the signal and time columns', () => {
    const text = 'time,ecg\n0,1.5\n0.004,2.5\n0.008,3.5';
    const { signal, time, interpolatedCount } = extractCsvColumns(text, optionsFrom(text));
    expect(Array.from(signal)).toEqual([1.5, 2.5, 3.5]);
    expect(Array.from(time ?? [])).toEqual([0, 0.004, 0.008]);
    expect(interpolatedCount).toBe(0);
  });

  it('returns no time when no time column is selected', () => {
    expect(extractCsvColumns('1\n2\n3\n', optionsFrom('1\n2\n3\n')).time).toBeNull();
  });

  it('bridges a few bad values by interpolation and counts them', () => {
    const rows = Array.from({ length: 100 }, (_, i) => String(i));
    rows[10] = 'NaN';
    rows[50] = '';
    rows[51] = 'err';
    const text = rows.map((value, i) => `${i},${value}`).join('\n');
    const { signal, interpolatedCount } = extractCsvColumns(text, {
      delimiter: ',',
      hasHeader: false,
      decimalComma: false,
      timeColumn: 0,
      signalColumn: 1,
    });
    expect(interpolatedCount).toBe(3);
    expect(signal[10]).toBe(10);
    expect(signal[50]).toBeCloseTo(50);
    expect(signal[51]).toBeCloseTo(51);
  });

  it('treats infinite values as invalid', () => {
    const text = ['1', '2', 'Infinity', ...Array.from({ length: 60 }, () => '4')].join('\n');
    const { signal, interpolatedCount } = extractCsvColumns(text, optionsFrom('1\n2\n'));
    expect(interpolatedCount).toBe(1);
    expect(signal[2]).toBe(3);
  });

  it('rejects a column that is mostly unreadable', () => {
    const text = 'a,b\n1,x\n2,y\n3,5\n4,z\n';
    const options: CsvExtractOptions = {
      delimiter: ',',
      hasHeader: true,
      decimalComma: false,
      timeColumn: null,
      signalColumn: 1,
    };
    expect(() => extractCsvColumns(text, options)).toThrow(/75% of the values/);
  });

  it('rejects a column with no numbers and a file with no data rows', () => {
    const options: CsvExtractOptions = {
      delimiter: ',',
      hasHeader: true,
      decimalComma: false,
      timeColumn: null,
      signalColumn: 0,
    };
    expect(() => extractCsvColumns('name\nfoo\nbar\n', options)).toThrow(/contains no numbers/);
    expect(() => extractCsvColumns('name\n', options)).toThrow(/no data rows/);
  });

  it('handles more rows than the initial buffer', () => {
    const count = 70_000;
    const text = Array.from({ length: count }, (_, i) => i).join('\n');
    const { signal } = extractCsvColumns(text, optionsFrom('1\n2\n'));
    expect(signal).toHaveLength(count);
    expect(signal[count - 1]).toBe(count - 1);
  });
});

describe('interpolateGaps', () => {
  it('fills interior gaps linearly', () => {
    const x = Float64Array.from([1, NaN, NaN, 4]);
    expect(interpolateGaps(x)).toBe(2);
    expect(Array.from(x)).toEqual([1, 2, 3, 4]);
  });

  it('extends the nearest value into leading and trailing gaps', () => {
    const x = Float64Array.from([NaN, 2, 3, NaN, NaN]);
    expect(interpolateGaps(x)).toBe(3);
    expect(Array.from(x)).toEqual([2, 2, 3, 3, 3]);
  });

  it('leaves clean, empty and all-NaN arrays unchanged', () => {
    expect(interpolateGaps(Float64Array.from([1, 2]))).toBe(0);
    expect(interpolateGaps(new Float64Array(0))).toBe(0);
    const allNaN = Float64Array.from([NaN, NaN]);
    expect(interpolateGaps(allNaN)).toBe(0);
    expect(allNaN[0]).toBeNaN();
  });
});

describe('inferSamplingRate', () => {
  const timeAxis = (n: number, step: number) =>
    Float64Array.from({ length: n }, (_, i) => i * step);

  it('reads seconds, milliseconds and microseconds', () => {
    expect(inferSamplingRate(timeAxis(100, 0.004))).toMatchObject({ fs: 250, unit: 's' });
    expect(inferSamplingRate(timeAxis(100, 4))).toMatchObject({ fs: 250, unit: 'ms' });
    expect(inferSamplingRate(timeAxis(100, 2000))).toMatchObject({ fs: 500, unit: 'us' });
  });

  it('recovers the true rate from timestamps rounded to milliseconds', () => {
    // 360 Hz written with three decimals: intervals alternate between 2 and 3 ms.
    const time = Float64Array.from({ length: 3600 }, (_, i) => Number((i / 360).toFixed(3)));
    expect(inferSamplingRate(time)?.fs).toBe(360);
  });

  it('is not thrown off by a few dropped samples', () => {
    const time = timeAxis(500, 0.01);
    for (let i = 250; i < time.length; i++) time[i] += 0.5; // one long gap
    expect(inferSamplingRate(time)?.fs).toBe(100);
  });

  it('reports even sampling as zero jitter and uneven sampling as large jitter', () => {
    expect(inferSamplingRate(timeAxis(100, 0.004))?.jitter).toBeCloseTo(0, 6);
    let t = 0;
    const uneven = Float64Array.from({ length: 200 }, (_, i) => (t += i % 2 ? 0.002 : 0.006));
    expect(inferSamplingRate(uneven)?.jitter).toBeGreaterThan(0.5);
  });

  it('returns null when the column is not usable as time', () => {
    expect(inferSamplingRate(new Float64Array(0))).toBeNull();
    expect(inferSamplingRate(Float64Array.from([0, 1]))).toBeNull();
    expect(inferSamplingRate(new Float64Array(100).fill(5))).toBeNull();
    expect(inferSamplingRate(timeAxis(100, -0.004))).toBeNull();
    expect(inferSamplingRate(timeAxis(100, 60))).toBeNull(); // one sample per minute
  });
});
