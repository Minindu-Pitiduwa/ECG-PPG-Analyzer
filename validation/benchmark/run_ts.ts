/**
 * Run the TypeScript Pan–Tompkins detector on every exported MIT-BIH record
 * and score it against the reference beat annotations (150 ms tolerance).
 *
 * Prerequisite:  python validation/benchmark/export_mitdb.py
 * Usage:         npx tsx validation/benchmark/run_ts.ts [--out results.json]
 *
 * This is the same detector code the browser runs; nothing is reimplemented.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { panTompkins } from '../../src/dsp/detect/panTompkins';
import { matchBeats, summarize, type DetectionScore } from '../../src/dsp/eval/matchBeats';

const EXPORT_DIR = fileURLToPath(new URL('../data/mitdb-export/', import.meta.url));
const TOLERANCE_S = 0.15;

interface ExportedRecord {
  record: string;
  fs: number;
  length: number;
  gain: number;
  baseline: number;
  lead: string;
  paced: boolean;
  beats: number[];
}

interface RecordResult extends DetectionScore {
  record: string;
  lead: string;
  paced: boolean;
  referenceBeats: number;
  detectedBeats: number;
}

function readSignal(entry: ExportedRecord): Float64Array {
  const file = readFileSync(`${EXPORT_DIR}${entry.record}.i16`);
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  return Float64Array.from(
    { length: entry.length },
    (_, i) => (view.getInt16(2 * i, true) - entry.baseline) / entry.gain,
  );
}

function total(results: RecordResult[]): DetectionScore {
  const sum = (pick: (result: RecordResult) => number) =>
    results.reduce((acc, result) => acc + pick(result), 0);
  return summarize(
    sum((result) => result.truePositives),
    sum((result) => result.falsePositives),
    sum((result) => result.falseNegatives),
  );
}

const percent = (value: number) => (100 * value).toFixed(2).padStart(7);

function printRow(label: string, score: DetectionScore, extra = ''): void {
  console.log(
    `${label.padEnd(8)} ${String(score.truePositives).padStart(7)} ${String(score.falsePositives).padStart(6)} ` +
      `${String(score.falseNegatives).padStart(6)} ${percent(score.sensitivity)} ${percent(score.positivePredictivity)} ` +
      `${percent(score.f1)}  ${extra}`,
  );
}

const records = JSON.parse(readFileSync(`${EXPORT_DIR}records.json`, 'utf8')) as ExportedRecord[];
const started = performance.now();

const results = records.map((entry): RecordResult => {
  const detected = panTompkins(readSignal(entry), entry.fs);
  const score = matchBeats(
    entry.beats.map((sample) => sample / entry.fs),
    Array.from(detected, (sample) => sample / entry.fs),
    TOLERANCE_S,
  );
  return {
    record: entry.record,
    lead: entry.lead,
    paced: entry.paced,
    referenceBeats: entry.beats.length,
    detectedBeats: detected.length,
    ...score,
  };
});

console.log('record        TP     FP     FN     Se%    PPV%     F1%');
for (const result of results)
  printRow(result.record, result, `${result.lead}${result.paced ? ' (paced)' : ''}`);
console.log('-'.repeat(58));
const all = total(results);
const unpaced = total(results.filter((result) => !result.paced));
printRow('all 48', all);
printRow('44 unpaced', unpaced);
console.log(
  `\n${results.length} records in ${((performance.now() - started) / 1000).toFixed(1)} s`,
);

const outFlag = process.argv.indexOf('--out');
if (outFlag !== -1) {
  const path = process.argv[outFlag + 1];
  writeFileSync(
    path,
    JSON.stringify({ toleranceS: TOLERANCE_S, records: results, all, unpaced }, null, 2) + '\n',
  );
  console.log(`wrote ${path}`);
}
