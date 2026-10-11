/**
 * Check the irregular-rhythm rule against the rhythm annotations of the
 * MIT-BIH Arrhythmia Database.
 *
 * The reference beat annotations are cut into consecutive windows of 30
 * intervals. A window counts as atrial fibrillation when it lies entirely
 * inside an annotated AFIB episode, and as another rhythm when it lies
 * entirely outside; windows that straddle a rhythm change are left out. The
 * rule under test (`isIrregularWindow`) sees only the intervals.
 *
 * Using the reference beats isolates the rule from detector errors.
 *
 * Prerequisite:  python validation/benchmark/export_mitdb.py
 * Usage:         npx tsx validation/benchmark/run_irregular.ts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { IRREGULARITY_WINDOW, isIrregularWindow } from '../../src/dsp/rhythm/flags';

const EXPORT_DIR = fileURLToPath(new URL('../data/mitdb-export/', import.meta.url));

interface ExportedRecord {
  record: string;
  fs: number;
  length: number;
  beats: number[];
  rhythms: { sample: number; rhythm: string }[];
}

/** The annotated rhythm in force at a sample, or null before the first annotation. */
function rhythmAt(entry: ExportedRecord, sample: number): string | null {
  let current: string | null = null;
  for (const change of entry.rhythms) {
    if (change.sample > sample) break;
    current = change.rhythm;
  }
  return current;
}

const records = JSON.parse(readFileSync(`${EXPORT_DIR}records.json`, 'utf8')) as ExportedRecord[];
/** rhythm -> [windows flagged irregular, windows in total] */
const byRhythm = new Map<string, [number, number]>();

for (const entry of records) {
  for (
    let start = 0;
    start + IRREGULARITY_WINDOW < entry.beats.length;
    start += IRREGULARITY_WINDOW
  ) {
    const beats = entry.beats.slice(start, start + IRREGULARITY_WINDOW + 1);
    const rhythm = rhythmAt(entry, beats[0]);
    const changesInside = entry.rhythms.some(
      (change) => change.sample > beats[0] && change.sample <= beats[beats.length - 1],
    );
    if (rhythm === null || changesInside) continue;
    const intervalsMs = beats.slice(1).map((sample, i) => (1000 * (sample - beats[i])) / entry.fs);
    const tally = byRhythm.get(rhythm) ?? [0, 0];
    tally[0] += isIrregularWindow(intervalsMs) ? 1 : 0;
    tally[1] += 1;
    byRhythm.set(rhythm, tally);
  }
}

const [afFlagged, afTotal] = byRhythm.get('AFIB') ?? [0, 0];
let otherFlagged = 0;
let otherTotal = 0;
console.log('rhythm   windows  flagged  share');
for (const [rhythm, [flagged, total]] of [...byRhythm].sort((a, b) => b[1][1] - a[1][1])) {
  if (rhythm !== 'AFIB') {
    otherFlagged += flagged;
    otherTotal += total;
  }
  console.log(
    `${rhythm.padEnd(8)} ${String(total).padStart(7)} ${String(flagged).padStart(8)}  ${((100 * flagged) / total).toFixed(1).padStart(5)}%`,
  );
}
console.log('');
console.log(
  `Atrial fibrillation windows flagged (sensitivity): ${afFlagged}/${afTotal} = ${((100 * afFlagged) / afTotal).toFixed(1)}%`,
);
console.log(
  `Other-rhythm windows not flagged (specificity):    ${otherTotal - otherFlagged}/${otherTotal} = ${((100 * (otherTotal - otherFlagged)) / otherTotal).toFixed(1)}%`,
);
