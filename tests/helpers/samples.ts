import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeInt16Samples, type SampleInfo } from '@/io/samples';

const SAMPLES_DIR = fileURLToPath(new URL('../../public/samples/', import.meta.url));

export const SAMPLE_INDEX = JSON.parse(
  readFileSync(`${SAMPLES_DIR}index.json`, 'utf8'),
) as SampleInfo[];

/** Load a bundled sample recording from disk, in physical units. */
export function readSample(id: string): { info: SampleInfo; samples: Float64Array } {
  const info = SAMPLE_INDEX.find((entry) => entry.id === id);
  if (!info) throw new Error(`Unknown sample: ${id}`);
  const file = readFileSync(`${SAMPLES_DIR}${info.file}`);
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  return { info, samples: decodeInt16Samples(buffer, info.gain, info.baseline) };
}
