/**
 * QRS detection benchmark on the MIT-BIH Arrhythmia Database.
 *
 * Runs the app's TypeScript Pan–Tompkins detector on the first channel of all
 * 48 records and scores it against the reference beat annotations with a
 * 150 ms tolerance. This is the same detector code the browser runs; nothing
 * is reimplemented for the benchmark.
 *
 * Options:
 *   --external <peaks.json>  also score detections made by other tools (the
 *                            file written by run_neurokit.py), with the same
 *                            scoring code
 *   --ablation               also run the detector with parts switched off
 *   --out <dir>              write results.json and results.md into <dir>
 *
 * Prerequisite:  python validation/benchmark/export_mitdb.py
 * Usage:         npx tsx validation/benchmark/run_ts.ts
 * Full run:      npm run benchmark
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PAN_TOMPKINS_DEFAULTS,
  panTompkins,
  type PanTompkinsOptions,
} from '../../src/dsp/detect/panTompkins';
import { summarize, type DetectionScore } from '../../src/dsp/eval/matchBeats';

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
  /** One annotation code per beat. */
  symbols: string;
  rhythms: { sample: number; rhythm: string }[];
}

interface RecordResult extends DetectionScore {
  record: string;
  lead: string;
  paced: boolean;
}

interface Errors {
  /** Missed reference beats, by annotation code. */
  missedByType: Map<string, number>;
  /** Extra detections, by the annotated rhythm at that moment. */
  extraByRhythm: Map<string, number>;
}

interface DetectorResult {
  name: string;
  records: RecordResult[];
  all: DetectionScore;
  unpaced: DetectionScore;
  errors: Map<string, Errors>;
}

function readSignal(entry: ExportedRecord): Float64Array {
  const file = readFileSync(`${EXPORT_DIR}${entry.record}.i16`);
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  return Float64Array.from(
    { length: entry.length },
    (_, i) => (view.getInt16(2 * i, true) - entry.baseline) / entry.gain,
  );
}

function rhythmAt(entry: ExportedRecord, sample: number): string {
  let current = 'unlabelled';
  for (const change of entry.rhythms) {
    if (change.sample > sample) break;
    current = change.rhythm;
  }
  return current;
}

const count = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

/**
 * Score one record. The matching rule is the one in `matchBeats` (walk both
 * lists in time order; a detection within the tolerance of the next unmatched
 * reference beat is a hit), repeated here so that each miss and each extra
 * detection can also be attributed to a beat type or rhythm.
 */
function scoreRecord(
  entry: ExportedRecord,
  detected: ArrayLike<number>,
): { score: DetectionScore; errors: Errors } {
  const tolerance = TOLERANCE_S * entry.fs;
  const errors: Errors = { missedByType: new Map(), extraByRhythm: new Map() };
  let truePositives = 0;
  let r = 0;
  let d = 0;
  const miss = () => count(errors.missedByType, entry.symbols[r++]);
  const extra = () => count(errors.extraByRhythm, rhythmAt(entry, detected[d++]));
  while (r < entry.beats.length && d < detected.length) {
    const difference = detected[d] - entry.beats[r];
    if (Math.abs(difference) <= tolerance) {
      truePositives++;
      r++;
      d++;
    } else if (difference < 0) extra();
    else miss();
  }
  while (r < entry.beats.length) miss();
  while (d < detected.length) extra();
  const sum = (map: Map<string, number>) => [...map.values()].reduce((a, b) => a + b, 0);
  return {
    score: summarize(truePositives, sum(errors.extraByRhythm), sum(errors.missedByType)),
    errors,
  };
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

function evaluate(
  name: string,
  records: ExportedRecord[],
  detect: (entry: ExportedRecord) => ArrayLike<number>,
): DetectorResult {
  const errors = new Map<string, Errors>();
  const results = records.map((entry): RecordResult => {
    const scored = scoreRecord(entry, detect(entry));
    errors.set(entry.record, scored.errors);
    return { record: entry.record, lead: entry.lead, paced: entry.paced, ...scored.score };
  });
  return {
    name,
    records: results,
    all: total(results),
    unpaced: total(results.filter((result) => !result.paced)),
    errors,
  };
}

const percent = (value: number) => (100 * value).toFixed(2);

function printRecords(result: DetectorResult): void {
  console.log('record        TP     FP     FN     Se%    PPV%     F1%');
  const row = (label: string, score: DetectionScore, note = '') =>
    console.log(
      `${label.padEnd(10)} ${String(score.truePositives).padStart(6)} ${String(score.falsePositives).padStart(6)} ` +
        `${String(score.falseNegatives).padStart(6)} ${percent(score.sensitivity).padStart(7)} ` +
        `${percent(score.positivePredictivity).padStart(7)} ${percent(score.f1).padStart(7)}  ${note}`,
    );
  for (const record of result.records)
    row(record.record, record, `${record.lead}${record.paced ? ' (paced)' : ''}`);
  console.log('-'.repeat(58));
  row('all 48', result.all);
  row('44 unpaced', result.unpaced);
}

const summaryRow = (label: string, score: DetectionScore) =>
  `| ${label} | ${score.truePositives.toLocaleString('en-US')} | ${score.falsePositives.toLocaleString('en-US')} | ` +
  `${score.falseNegatives.toLocaleString('en-US')} | ${percent(score.sensitivity)} | ${percent(score.positivePredictivity)} | ${percent(score.f1)} |`;

const SUMMARY_HEADER =
  '| Detector | TP | FP | FN | Se % | PPV % | F1 % |\n|---|---:|---:|---:|---:|---:|---:|';

const describe = (map: Map<string, number>) =>
  [...map]
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ') || 'none';

function markdown(
  detectors: DetectorResult[],
  ablations: DetectorResult[],
  generated: string,
): string {
  const [ours] = detectors;
  const worst = [...ours.records].sort((a, b) => a.f1 - b.f1).slice(0, 6);
  const lines = [
    '# QRS detection benchmark: MIT-BIH Arrhythmia Database',
    '',
    `Generated by \`validation/benchmark/run_ts.ts\` on ${generated}. Do not edit by hand.`,
    '',
    `First channel of each record, beat annotations only, ${1000 * TOLERANCE_S} ms tolerance, whole record (no learning period excluded).`,
    '',
    '## All 48 records',
    '',
    SUMMARY_HEADER,
    ...detectors.map((detector) => summaryRow(detector.name, detector.all)),
    '',
    '## 44 records without paced beats (102, 104, 107 and 217 left out)',
    '',
    SUMMARY_HEADER,
    ...detectors.map((detector) => summaryRow(detector.name, detector.unpaced)),
    '',
  ];
  if (ablations.length > 0) {
    lines.push(
      '## What each part of the algorithm contributes (all 48 records)',
      '',
      SUMMARY_HEADER,
      summaryRow(`${ours.name}, complete`, ours.all),
      ...ablations.map((ablation) => summaryRow(ablation.name, ablation.all)),
      '',
    );
  }
  lines.push(
    `## Records where ${ours.name} does worst`,
    '',
    '| Record | Lead | FP | FN | F1 % | Missed beats by annotation code | Extra detections by annotated rhythm |',
    '|---|---|---:|---:|---:|---|---|',
    ...worst.map((record) => {
      const errors = ours.errors.get(record.record);
      return `| ${record.record} | ${record.lead} | ${record.falsePositives} | ${record.falseNegatives} | ${percent(record.f1)} | ${describe(errors?.missedByType ?? new Map())} | ${describe(errors?.extraByRhythm ?? new Map())} |`;
    }),
    '',
    'Annotation codes: N normal, V premature ventricular, A atrial premature, L/R bundle branch block, / paced, F fusion, a aberrated atrial premature, ! is not a beat code. Rhythms: N normal sinus, VFL ventricular flutter, B bigeminy, T trigeminy, AFIB atrial fibrillation, VT ventricular tachycardia, P paced.',
    '',
    `## Per record: ${ours.name}`,
    '',
    '| Record | Lead | TP | FP | FN | Se % | PPV % | F1 % |',
    '|---|---|---:|---:|---:|---:|---:|---:|',
    ...ours.records.map(
      (record) =>
        `| ${record.record}${record.paced ? ' (paced)' : ''} | ${record.lead} | ${record.truePositives} | ${record.falsePositives} | ${record.falseNegatives} | ${percent(record.sensitivity)} | ${percent(record.positivePredictivity)} | ${percent(record.f1)} |`,
    ),
    '',
  );
  return lines.join('\n');
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const records = JSON.parse(readFileSync(`${EXPORT_DIR}records.json`, 'utf8')) as ExportedRecord[];
const signals = new Map(records.map((entry) => [entry.record, readSignal(entry)]));
const runOurs = (name: string, options: PanTompkinsOptions) =>
  evaluate(name, records, (entry) =>
    panTompkins(signals.get(entry.record) ?? new Float64Array(0), entry.fs, options),
  );

const started = performance.now();
const ours = runOurs('PulseScope Pan–Tompkins (TypeScript)', PAN_TOMPKINS_DEFAULTS);
const seconds = (performance.now() - started) / 1000;
printRecords(ours);
console.log(`\n${records.length} records in ${seconds.toFixed(1)} s`);

const detectors = [ours];
const externalPath = option('--external');
if (externalPath) {
  if (!existsSync(externalPath))
    throw new Error(`${externalPath} not found. Run run_neurokit.py first.`);
  const external = JSON.parse(readFileSync(externalPath, 'utf8')) as {
    generator: string;
    methods: Record<string, Record<string, number[]>>;
  };
  for (const [method, peaks] of Object.entries(external.methods)) {
    detectors.push(
      evaluate(
        `${external.generator}, method "${method}"`,
        records,
        (entry) => peaks[entry.record] ?? [],
      ),
    );
  }
}

const ablations = process.argv.includes('--ablation')
  ? [
      runOurs('without the T-wave check', { ...PAN_TOMPKINS_DEFAULTS, tWaveWindowS: 0 }),
      runOurs('without search-back', { ...PAN_TOMPKINS_DEFAULTS, searchBack: false }),
    ]
  : [];

if (detectors.length > 1 || ablations.length > 0) {
  console.log('\nSummary, all 48 records:');
  for (const detector of [...detectors, ...ablations]) {
    console.log(
      `  ${detector.name.padEnd(44)} Se ${percent(detector.all.sensitivity)}  PPV ${percent(detector.all.positivePredictivity)}  F1 ${percent(detector.all.f1)}`,
    );
  }
}

const outDir = option('--out');
if (outDir) {
  mkdirSync(outDir, { recursive: true });
  const generated = new Date().toISOString().slice(0, 10);
  const plain = (detector: DetectorResult) => ({
    name: detector.name,
    all: detector.all,
    unpaced: detector.unpaced,
    records: detector.records,
  });
  writeFileSync(
    `${outDir}/results.json`,
    JSON.stringify(
      {
        generated,
        toleranceS: TOLERANCE_S,
        detectors: detectors.map(plain),
        ablations: ablations.map(plain),
      },
      null,
      2,
    ) + '\n',
  );
  writeFileSync(`${outDir}/results.md`, markdown(detectors, ablations, generated));
  console.log(`\nwrote ${outDir}/results.json and ${outDir}/results.md`);
}
