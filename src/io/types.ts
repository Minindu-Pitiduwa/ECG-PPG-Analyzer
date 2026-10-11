// Relative, not the '@/' alias: the WFDB reader is also run directly in Node by the validation scripts.
import type { Signal, SignalKind } from '../dsp/types';

export type SignalUnits = 'mV' | 'adc' | 'a.u.';

export const UNIT_LABELS: Record<SignalUnits, string> = {
  mV: 'mV',
  adc: 'ADC counts',
  'a.u.': 'a.u.',
};

/**
 * One loaded channel, ready for analysis. Every input path (sample, CSV, WFDB,
 * and later a live serial stream) produces this same shape, so nothing
 * downstream needs to know where the data came from.
 */
export interface Recording {
  name: string;
  kind: SignalKind;
  /** Sampling rate in Hz. */
  fs: number;
  samples: Signal;
  units: SignalUnits;
  /** Lead or channel label, when the source provides one. */
  channel?: string;
  /** Where the data came from, shown in the UI and the report. */
  origin: string;
  /** Non-fatal issues found while importing, in plain language. */
  warnings: string[];
}

/** An import problem with a message that is safe and useful to show to the user. */
export class ImportError extends Error {
  override name = 'ImportError';
}
