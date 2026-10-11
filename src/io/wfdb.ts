/**
 * Reader for PhysioNet WFDB records: a text header (`.hea`) describing the
 * signals and a binary file (`.dat`) holding the samples.
 *
 * Supported: single-segment records in storage format 212 (two 12-bit samples
 * packed into three bytes, used by the MIT-BIH databases) and format 16
 * (16-bit little-endian integers). That covers most PhysioNet ECG and PPG
 * waveform records. Multi-segment records and signals stored with several
 * samples per frame are refused with an explanation.
 *
 * Format reference: https://physionet.org/physiotools/wag/header-5.htm and
 * https://physionet.org/physiotools/wag/signal-5.htm
 */

import { ImportError } from './types';

export interface WfdbSignal {
  /** Name of the binary file holding this signal. */
  fileName: string;
  /** Storage format code, e.g. 212 or 16. */
  format: number;
  /** ADC units per physical unit. */
  gain: number;
  /** ADC value that corresponds to zero physical units. */
  baseline: number;
  /** Physical units, e.g. "mV". */
  units: string;
  /** Free-text label, usually the lead name. */
  description: string;
  /** Bytes to skip at the start of the file before the samples. */
  byteOffset: number;
}

export interface WfdbHeader {
  recordName: string;
  /** Sampling rate in Hz. */
  fs: number;
  /** Samples per signal, or `null` when the header does not say. */
  sampleCount: number | null;
  signals: WfdbSignal[];
}

/** WFDB defaults, used when a header leaves a field out. */
const DEFAULT_FS = 250;
const DEFAULT_GAIN = 200;
const SUPPORTED_FORMATS = [16, 212];

function parseSignalLine(line: string): WfdbSignal {
  const fields = line.split(/\s+/);
  const [fileName, formatField, gainField, , adcZeroField] = fields;
  if (!fileName || !formatField)
    throw new ImportError(`The header has an incomplete signal line: "${line}".`);

  // Format field: format[xSamplesPerFrame][:skew][+byteOffset]
  const format = /^(\d+)(?:x(\d+))?(?::\d+)?(?:\+(\d+))?$/.exec(formatField);
  if (!format)
    throw new ImportError(`The header has an unreadable storage format: "${formatField}".`);
  if (format[2] && Number(format[2]) !== 1) {
    throw new ImportError(
      'This record stores some signals at a multiple of the frame rate, which is not supported.',
    );
  }

  // Gain field: gain[(baseline)][/units]
  const gain = /^([-+\d.eE]+)(?:\(([-+]?\d+)\))?(?:\/(.+))?$/.exec(gainField ?? '');
  const gainValue = gain ? Number(gain[1]) : 0;
  const adcZero =
    adcZeroField !== undefined && /^[-+]?\d+$/.test(adcZeroField) ? Number(adcZeroField) : 0;

  return {
    fileName,
    format: Number(format[1]),
    // A gain of zero means "not calibrated"; WFDB then assumes 200 units per mV.
    gain: gainValue > 0 ? gainValue : DEFAULT_GAIN,
    // Without an explicit baseline, the ADC zero is the baseline.
    baseline: gain?.[2] !== undefined ? Number(gain[2]) : adcZero,
    units: gain?.[3] ?? 'mV',
    // Fields 0-7 are fixed; whatever follows is the description and may contain spaces.
    description: fields.slice(8).join(' ').replace(/,+$/, '') || fileName,
    byteOffset: format[3] ? Number(format[3]) : 0,
  };
}

/**
 * Parse the text of a `.hea` file.
 * @throws ImportError when the header is malformed or describes an unsupported record
 */
export function parseWfdbHeader(text: string): WfdbHeader {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  if (lines.length === 0) throw new ImportError('The header file is empty.');

  // Record line: name[/segments] signals [fs[/counterFs][(baseCounter)]] [samples] [time] [date]
  const [nameField, signalCountField, fsField, sampleCountField] = lines[0].split(/\s+/);
  if (nameField.includes('/')) {
    throw new ImportError(
      'This is a multi-segment WFDB record, which is not supported. Use one of its segments.',
    );
  }
  const signalCount = Number(signalCountField);
  if (!Number.isInteger(signalCount) || signalCount < 1) {
    throw new ImportError('The header does not list any signals. Is this a WFDB .hea file?');
  }
  if (lines.length < 1 + signalCount) {
    throw new ImportError(
      `The header announces ${signalCount} signals but describes only ${lines.length - 1}.`,
    );
  }
  const fs = fsField ? Number.parseFloat(fsField) : DEFAULT_FS;
  if (!(fs > 0)) throw new ImportError(`The header has an unreadable sampling rate: "${fsField}".`);
  const sampleCount = sampleCountField ? Number(sampleCountField) : 0;

  return {
    recordName: nameField,
    fs,
    sampleCount: Number.isInteger(sampleCount) && sampleCount > 0 ? sampleCount : null,
    signals: lines.slice(1, 1 + signalCount).map(parseSignalLine),
  };
}

/** Bytes used by one sample of one signal. Format 212 packs two samples into three bytes. */
const bytesPerSample = (format: number) => (format === 212 ? 1.5 : 2);

/**
 * Read sample `index` of an interleaved format-212 stream.
 *
 * Each 3-byte group holds two 12-bit two's-complement samples:
 *
 *   byte 0: low 8 bits of sample A
 *   byte 1: low nibble = high 4 bits of sample A, high nibble = high 4 bits of sample B
 *   byte 2: low 8 bits of sample B
 */
function read212(bytes: Uint8Array, index: number): number {
  const group = 3 * (index >> 1);
  const middle = bytes[group + 1];
  const value =
    index % 2 === 0
      ? ((middle & 0x0f) << 8) | bytes[group]
      : ((middle & 0xf0) << 4) | bytes[group + 2];
  return value > 2047 ? value - 4096 : value; // sign-extend 12 bits
}

/**
 * Decode one signal of a WFDB record into physical units:
 * `physical = (adc - baseline) / gain`.
 *
 * The samples of all signals that share a file are interleaved, one "frame"
 * (one sample of each signal) after another.
 *
 * @param data contents of the binary file named by the chosen signal
 * @param signalIndex index into `header.signals`
 * @throws ImportError when the format is unsupported or the file does not match the header
 */
export function decodeWfdbSignal(
  header: WfdbHeader,
  data: ArrayBuffer,
  signalIndex: number,
): Float64Array {
  const signal = header.signals[signalIndex];
  if (!signal) throw new ImportError('That signal does not exist in this record.');
  if (!SUPPORTED_FORMATS.includes(signal.format)) {
    throw new ImportError(
      `This record is stored in WFDB format ${signal.format}. Only formats 16 and 212 are supported.`,
    );
  }

  // The signals stored in the same file, in header order, form one frame.
  const group = header.signals.filter((other) => other.fileName === signal.fileName);
  if (group.some((other) => other.format !== signal.format)) {
    throw new ImportError(
      'The signals in this file use different storage formats, which is not supported.',
    );
  }
  const position = group.indexOf(signal);
  const frameBytes = group.length * bytesPerSample(signal.format);
  const available = Math.floor((data.byteLength - signal.byteOffset) / frameBytes);
  const frames = header.sampleCount ?? available;
  if (frames < 1) throw new ImportError('The data file contains no samples.');
  if (frames > available) {
    throw new ImportError(
      `The data file is too short for this header: it holds ${available} samples per signal, the header expects ${frames}. ` +
        `Check that ${signal.fileName} belongs to this header.`,
    );
  }

  const out = new Float64Array(frames);
  if (signal.format === 212) {
    const bytes = new Uint8Array(data, signal.byteOffset);
    for (let i = 0; i < frames; i++) {
      out[i] = (read212(bytes, i * group.length + position) - signal.baseline) / signal.gain;
    }
  } else {
    const view = new DataView(data, signal.byteOffset);
    for (let i = 0; i < frames; i++) {
      out[i] =
        (view.getInt16(2 * (i * group.length + position), true) - signal.baseline) / signal.gain;
    }
  }
  return out;
}
