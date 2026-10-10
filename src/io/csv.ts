/**
 * CSV import for signal recordings.
 *
 * Importing happens in two steps so the user can confirm what was guessed:
 *   1. `sniffCsv` looks at the first lines only and guesses the delimiter, the
 *      header and which columns hold time and signal. It is cheap enough to run
 *      on the main thread.
 *   2. `extractCsvColumns` reads the whole file with the confirmed settings. It
 *      runs in the Web Worker because a 30-minute recording has ~1M rows.
 *
 * Quoted fields containing the delimiter are not supported; signal exports
 * do not use them.
 */

import { mean, median } from '@/dsp/util/stats';
import { ImportError } from './types';

export type Delimiter = ',' | ';' | '\t' | ' ';

/**
 * Tried in this order. Tab and semicolon never appear inside numbers, so a
 * consistent match is conclusive. Comma comes after semicolon because European
 * exports use ';' between fields and ',' as the decimal mark.
 */
const DELIMITER_PRIORITY: readonly Delimiter[] = ['\t', ';', ',', ' '];

const SNIFF_LINES = 50;
const PREVIEW_ROWS = 5;
/** Share of unreadable signal values we are willing to bridge by interpolation. */
const MAX_INVALID_FRACTION = 0.05;
/** A sample interval this many times the typical one is a recording gap, not jitter. */
const GAP_FACTOR = 3;

const TIME_NAME = /^(t|time|timestamp|elapsed|seconds?|secs?|ms|millis(econds)?)\b/i;
const SIGNAL_NAME = /ecg|ekg|ppg|pleth|mlii|lead|signal|value|ir|red|adc|volt/i;

export interface CsvColumn {
  index: number;
  name: string;
  /** True when most preview values in this column parse as numbers. */
  numeric: boolean;
}

export interface CsvPreview {
  delimiter: Delimiter;
  hasHeader: boolean;
  /** True when numbers use ',' as the decimal mark (e.g. "0,125"). */
  decimalComma: boolean;
  columns: CsvColumn[];
  /** First few data rows, as text, for the on-screen preview. */
  rows: string[][];
  /** Guessed time column index, or `null` when no column looks like time. */
  timeColumn: number | null;
  signalColumn: number;
}

export interface CsvExtractOptions {
  delimiter: Delimiter;
  hasHeader: boolean;
  decimalComma: boolean;
  timeColumn: number | null;
  signalColumn: number;
}

export interface CsvColumns {
  signal: Float64Array;
  /** Present only when a time column was selected. May contain NaN for unreadable cells. */
  time: Float64Array | null;
  /** Number of unreadable signal values that were filled by linear interpolation. */
  interpolatedCount: number;
}

export type TimeUnit = 's' | 'ms' | 'us';

export interface SamplingRateEstimate {
  fs: number;
  /** Unit the time column appears to be in. */
  unit: TimeUnit;
  /** Spread of the sample intervals relative to their median; 0 means perfectly even. */
  jitter: number;
}

function splitLine(line: string, delimiter: Delimiter): string[] {
  if (delimiter === ' ') return line.trim().split(/\s+/);
  return line.split(delimiter).map((field) => field.trim().replace(/^"(.*)"$/, '$1'));
}

function parseNumber(field: string | undefined, decimalComma: boolean): number {
  if (field === undefined || field === '') return NaN;
  const value = Number(decimalComma ? field.replace(',', '.') : field);
  return Number.isFinite(value) ? value : NaN;
}

function isDataLine(line: string): boolean {
  return line.trim() !== '' && !line.startsWith('#');
}

/** Visit each line without building an array of every line (matters for 1M-row files). */
function forEachLine(text: string, visit: (line: string) => void): void {
  let start = text.charCodeAt(0) === 0xfeff ? 1 : 0; // skip a UTF-8 byte-order mark
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    const lineEnd = end > start && text.charCodeAt(end - 1) === 13 ? end - 1 : end;
    visit(text.slice(start, lineEnd));
    start = end + 1;
  }
}

function firstDataLines(text: string, limit: number): string[] {
  const lines: string[] = [];
  // Only scan the head of the file; sniffing must stay instant for huge files.
  forEachLine(text.slice(0, 256 * 1024), (line) => {
    if (lines.length < limit && isDataLine(line)) lines.push(line);
  });
  return lines;
}

function detectDelimiter(lines: string[]): Delimiter {
  for (const delimiter of DELIMITER_PRIORITY) {
    const counts = lines.map((line) => splitLine(line, delimiter).length);
    const first = counts[0];
    if (first > 1 && counts.every((count) => count === first)) return delimiter;
  }
  return ','; // single-column file: any delimiter gives the same result
}

function pickTimeColumn(columns: CsvColumn[], dataRows: number[][]): number | null {
  const named = columns.find((column) => column.numeric && TIME_NAME.test(column.name));
  if (named) return named.index;
  if (columns.length < 2) return null;

  // An unnamed first column that only ever increases is almost certainly time or a sample index.
  const first = columns[0];
  if (!first.numeric || dataRows.length < 3) return null;
  const increasing = dataRows.every((row, i) => i === 0 || row[0] > dataRows[i - 1][0]);
  return increasing ? first.index : null;
}

function pickSignalColumn(columns: CsvColumn[], timeColumn: number | null): number {
  const candidates = columns.filter((column) => column.numeric && column.index !== timeColumn);
  if (candidates.length === 0) {
    throw new ImportError(
      'No numeric signal column was found. The file needs at least one column of numbers.',
    );
  }
  const named = candidates.find((column) => SIGNAL_NAME.test(column.name));
  return (named ?? candidates[0]).index;
}

/**
 * Inspect the start of a CSV file and guess how to read it.
 * @throws ImportError when the file is empty or has no numeric column
 */
export function sniffCsv(text: string): CsvPreview {
  const lines = firstDataLines(text, SNIFF_LINES);
  if (lines.length === 0) throw new ImportError('The file is empty.');

  const delimiter = detectDelimiter(lines);
  const table = lines.map((line) => splitLine(line, delimiter));

  const decimalComma =
    delimiter !== ',' && table.some((row) => row.some((field) => /^[-+]?\d+,\d+$/.test(field)));
  const isNumeric = (field: string) => !Number.isNaN(parseNumber(field, decimalComma));

  // A header is a first row with text in it, sitting above rows that are numbers.
  const firstRowHasText = table[0].some((field) => !isNumeric(field));
  const secondRowIsNumeric = table.length > 1 && table[1].some(isNumeric);
  const hasHeader = firstRowHasText && (table.length === 1 || secondRowIsNumeric);

  const dataTable = hasHeader ? table.slice(1) : table;
  if (dataTable.length === 0) throw new ImportError('The file has a header but no data rows.');

  const columns: CsvColumn[] = table[0].map((field, index) => {
    const numericCount = dataTable.filter((row) => isNumeric(row[index] ?? '')).length;
    return {
      index,
      name: hasHeader && field !== '' ? field : `Column ${index + 1}`,
      numeric: numericCount >= dataTable.length / 2,
    };
  });

  const numericRows = dataTable.map((row) => row.map((field) => parseNumber(field, decimalComma)));
  const timeColumn = pickTimeColumn(columns, numericRows);
  const signalColumn = pickSignalColumn(columns, timeColumn);

  return {
    delimiter,
    hasHeader,
    decimalComma,
    columns,
    rows: dataTable.slice(0, PREVIEW_ROWS),
    timeColumn,
    signalColumn,
  };
}

/** A Float64Array that grows by doubling, to avoid counting rows in a separate pass. */
class GrowableFloat64 {
  private data = new Float64Array(1 << 16);
  length = 0;

  push(value: number): void {
    if (this.length === this.data.length) {
      const bigger = new Float64Array(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    this.data[this.length++] = value;
  }

  /** Copy out exactly the used part, so the result owns a right-sized buffer. */
  toArray(): Float64Array {
    return this.data.slice(0, this.length);
  }
}

/**
 * Replace NaN runs by straight lines between their valid neighbours. Runs at
 * either end copy the nearest valid value. Returns how many values were filled.
 */
export function interpolateGaps(x: Float64Array): number {
  let filled = 0;
  let lastValid = -1;
  for (let i = 0; i < x.length; i++) {
    if (Number.isNaN(x[i])) continue;
    const gap = i - lastValid - 1;
    if (gap > 0) {
      const from = lastValid === -1 ? x[i] : x[lastValid];
      for (let j = 1; j <= gap; j++) {
        x[lastValid + j] = from + ((x[i] - from) * j) / (gap + 1);
      }
      filled += gap;
    }
    lastValid = i;
  }
  if (lastValid !== -1 && lastValid < x.length - 1) {
    filled += x.length - 1 - lastValid;
    x.fill(x[lastValid], lastValid + 1);
  }
  return filled;
}

/**
 * Read the chosen columns from the whole file.
 * @throws ImportError when there is no usable data
 */
export function extractCsvColumns(text: string, options: CsvExtractOptions): CsvColumns {
  const { delimiter, decimalComma, timeColumn, signalColumn } = options;
  const signal = new GrowableFloat64();
  const time = timeColumn === null ? null : new GrowableFloat64();
  let invalid = 0;
  let headerPending = options.hasHeader;

  forEachLine(text, (line) => {
    if (!isDataLine(line)) return;
    if (headerPending) {
      headerPending = false;
      return;
    }
    const fields = splitLine(line, delimiter);
    const value = parseNumber(fields[signalColumn], decimalComma);
    if (Number.isNaN(value)) invalid++;
    signal.push(value);
    if (time !== null && timeColumn !== null)
      time.push(parseNumber(fields[timeColumn], decimalComma));
  });

  if (signal.length === 0) throw new ImportError('The file has no data rows.');
  if (invalid === signal.length) {
    throw new ImportError('The selected signal column contains no numbers. Pick another column.');
  }
  if (invalid > signal.length * MAX_INVALID_FRACTION) {
    const percent = ((100 * invalid) / signal.length).toFixed(0);
    throw new ImportError(
      `${percent}% of the values in the signal column are missing or not numbers. ` +
        'Check that the right column is selected.',
    );
  }

  const samples = signal.toArray();
  const interpolatedCount = interpolateGaps(samples);
  return { signal: samples, time: time?.toArray() ?? null, interpolatedCount };
}

/** Snap to an integer when within 0.5%, so 359.97 Hz from rounded timestamps reads as 360 Hz. */
function tidyRate(fs: number): number {
  const rounded = Math.round(fs);
  return rounded > 0 && Math.abs(fs - rounded) / rounded < 0.005
    ? rounded
    : Number(fs.toPrecision(6));
}

/**
 * Estimate the sampling rate from a time column.
 *
 * Averages the sample intervals after discarding gaps (anything over three
 * times the median), so dropped samples do not lower the estimate. A plain
 * median would be wrong for rounded timestamps: 360 Hz written in whole
 * milliseconds alternates between 2 and 3 ms steps, and only their mean gives
 * 360. The time unit is not known in advance, so it is taken to be the largest
 * unit (s, ms, µs) that gives a rate in a range plausible for cardiac signals.
 *
 * Returns `null` when the column is not usable as time (too short, or not increasing).
 */
export function inferSamplingRate(time: Float64Array): SamplingRateEstimate | null {
  const intervals: number[] = [];
  for (let i = 1; i < time.length; i++) {
    const dt = time[i] - time[i - 1];
    if (Number.isFinite(dt) && dt > 0) intervals.push(dt);
  }
  // Mostly non-increasing "time" is some other quantity.
  if (intervals.length < 2 || intervals.length < (time.length - 1) / 2) return null;

  const typical = median(intervals);
  const regular = intervals.filter((interval) => interval <= GAP_FACTOR * typical);
  const dt = mean(regular);
  const sorted = Float64Array.from(regular).sort();
  const p05 = sorted[Math.floor(0.05 * (sorted.length - 1))];
  const p95 = sorted[Math.ceil(0.95 * (sorted.length - 1))];
  const jitter = (p95 - p05) / dt;

  const unitScales: [TimeUnit, number][] = [
    ['s', 1],
    ['ms', 1e3],
    ['us', 1e6],
  ];
  for (const [unit, perSecond] of unitScales) {
    const fs = perSecond / dt;
    if (fs >= 20 && fs <= 10_000) return { fs: tidyRate(fs), unit, jitter };
  }
  return null;
}
