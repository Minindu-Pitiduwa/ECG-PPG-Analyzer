import type { SignalKind } from '@/dsp/types';
import { guessSignalKind } from '@/dsp/util/guessKind';
import {
  extractCsvColumns,
  inferSamplingRate,
  type CsvExtractOptions,
  type CsvPreview,
  type SamplingRateEstimate,
} from '@/io/csv';

/** Enough of the file to estimate the sampling rate and signal type without reading it all. */
const HEAD_CHARS = 256 * 1024;

const PPG_NAME = /ppg|pleth|spo2|\bir\b|\bred\b/i;
const ECG_NAME = /ecg|ekg|mlii|lead/i;

export function extractOptions(
  preview: CsvPreview,
  timeColumn: number | null,
  signalColumn: number,
): CsvExtractOptions {
  const { delimiter, hasHeader, decimalComma } = preview;
  return { delimiter, hasHeader, decimalComma, timeColumn, signalColumn };
}

export interface HeadEstimate {
  rate: SamplingRateEstimate | null;
  kind: SignalKind | null;
}

/**
 * Suggest a sampling rate and signal type from the first part of the file, so
 * the import form can be pre-filled the moment the user changes a column.
 */
export function estimateFromHead(
  text: string,
  preview: CsvPreview,
  timeColumn: number | null,
  signalColumn: number,
): HeadEstimate {
  try {
    const head = extractCsvColumns(
      text.slice(0, HEAD_CHARS),
      extractOptions(preview, timeColumn, signalColumn),
    );
    const rate = head.time ? inferSamplingRate(head.time) : null;
    const name = preview.columns[signalColumn]?.name ?? '';
    const kindFromName: SignalKind | null = PPG_NAME.test(name)
      ? 'ppg'
      : ECG_NAME.test(name)
        ? 'ecg'
        : null;
    // The shape-based guess needs a sampling rate; a column name is the stronger hint anyway.
    const kind = kindFromName ?? (rate ? guessSignalKind(head.signal, rate.fs) : null);
    return { rate, kind };
  } catch {
    // Unreadable columns are reported when the user presses Import; here it just means no suggestion.
    return { rate: null, kind: null };
  }
}
