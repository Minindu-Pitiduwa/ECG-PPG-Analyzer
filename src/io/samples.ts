import type { SignalKind } from '@/dsp/types';
import { ImportError, type Recording, type SignalUnits } from './types';

/** One entry of `public/samples/index.json`, written by `validation/make_samples.py`. */
export interface SampleInfo {
  id: string;
  title: string;
  description: string;
  kind: SignalKind;
  file: string;
  fs: number;
  length: number;
  gain: number;
  baseline: number;
  units: SignalUnits;
  channel: string;
  record: string;
  startS: number;
  source: string;
  license: string;
  /** A caution about this recording, shown when it is loaded. Empty when there is none. */
  note: string;
}

const SAMPLES_URL = `${import.meta.env.BASE_URL}samples/`;

async function fetchOk(url: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new ImportError('Could not download the sample. Check your connection and try again.');
  }
  if (!response.ok)
    throw new ImportError(`Could not download the sample (HTTP ${response.status}).`);
  return response;
}

export async function listSamples(): Promise<SampleInfo[]> {
  const response = await fetchOk(`${SAMPLES_URL}index.json`);
  return (await response.json()) as SampleInfo[];
}

/** Convert little-endian int16 ADC counts to physical units: `(adc - baseline) / gain`. */
export function decodeInt16Samples(
  buffer: ArrayBuffer,
  gain: number,
  baseline: number,
): Float64Array {
  const view = new DataView(buffer);
  const count = buffer.byteLength >> 1;
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) out[i] = (view.getInt16(2 * i, true) - baseline) / gain;
  return out;
}

export async function loadSample(info: SampleInfo): Promise<Recording> {
  const response = await fetchOk(`${SAMPLES_URL}${info.file}`);
  const samples = decodeInt16Samples(await response.arrayBuffer(), info.gain, info.baseline);
  if (samples.length !== info.length) {
    throw new ImportError('The sample file is incomplete. Reload the page and try again.');
  }
  return {
    name: info.title,
    kind: info.kind,
    fs: info.fs,
    samples,
    units: info.units,
    channel: info.channel,
    origin: info.source,
    warnings: info.note ? [info.note] : [],
  };
}
