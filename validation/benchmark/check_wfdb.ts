/**
 * Read all 48 original MIT-BIH record files with the app's TypeScript WFDB
 * reader and compare every sample of the first channel with what the `wfdb`
 * Python package read (the export made by export_mitdb.py).
 *
 * Prerequisite:  python validation/benchmark/export_mitdb.py
 * Usage:         npx tsx validation/benchmark/check_wfdb.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeWfdbSignal, parseWfdbHeader } from '../../src/io/wfdb';

const RAW_DIR = fileURLToPath(new URL('../data/mitdb/', import.meta.url));
const EXPORT_DIR = fileURLToPath(new URL('../data/mitdb-export/', import.meta.url));

interface ExportedRecord {
  record: string;
  length: number;
  gain: number;
  baseline: number;
}

const records = JSON.parse(readFileSync(`${EXPORT_DIR}records.json`, 'utf8')) as ExportedRecord[];
let samples = 0;
let mismatches = 0;

for (const entry of records) {
  const header = parseWfdbHeader(readFileSync(`${RAW_DIR}${entry.record}.hea`, 'utf8'));
  const dat = readFileSync(`${RAW_DIR}${entry.record}.dat`);
  const decoded = decodeWfdbSignal(
    header,
    dat.buffer.slice(dat.byteOffset, dat.byteOffset + dat.byteLength),
    0,
  );

  const reference = readFileSync(`${EXPORT_DIR}${entry.record}.i16`);
  const view = new DataView(reference.buffer, reference.byteOffset, reference.byteLength);
  let recordMismatches =
    decoded.length === entry.length ? 0 : Math.abs(decoded.length - entry.length);
  for (let i = 0; i < Math.min(decoded.length, entry.length); i++) {
    const expected = (view.getInt16(2 * i, true) - entry.baseline) / entry.gain;
    if (decoded[i] !== expected) recordMismatches++;
  }
  samples += entry.length;
  mismatches += recordMismatches;
  if (recordMismatches > 0)
    console.log(`record ${entry.record}: ${recordMismatches} samples differ`);
}

console.log(
  `${records.length} records, ${samples.toLocaleString('en-US')} samples compared, ${mismatches} differences`,
);
process.exitCode = mismatches === 0 ? 0 : 1;
