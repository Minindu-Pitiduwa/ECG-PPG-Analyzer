/**
 * The whole automatic pipeline (default filters + detection) on the bundled
 * recordings, checked against references that do not come from this project:
 * the MIT-BIH beat annotations for the ECG samples and the bedside monitor's
 * pulse rate for the PPG sample. See validation/gen_sample_refs.py.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { matchBeats } from '@/dsp/eval/matchBeats';
import { defaultPreprocessOptions } from '@/dsp/filters/preprocess';
import { beatIntervalsMs } from '@/dsp/hrv/heartRate';
import { analyzeRecording } from '@/dsp/pipeline';
import { median } from '@/dsp/util/stats';
import { readSample } from '../helpers/samples';

interface SampleRefs {
  [sampleId: string]: { beatTimesS?: number[]; monitorMeanPulseBpm?: number };
}

const refs = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/sample_refs.json', import.meta.url)), 'utf8'),
) as SampleRefs;

function analyzeSample(id: string) {
  const { info, samples } = readSample(id);
  const options = { preprocess: defaultPreprocessOptions(info.kind) };
  return { info, result: analyzeRecording(samples, info.fs, info.kind, options) };
}

describe('pipeline on the bundled ECG samples (150 ms tolerance)', () => {
  // [sample, most false positives allowed, most missed beats allowed]
  it.each([
    ['ecg-normal', 0, 0],
    // Two T waves that follow wide ventricular beats are counted as beats: a wide
    // beat has a gentle slope, so the slope-based T-wave check lets its T wave through.
    ['ecg-ectopic', 2, 0],
    ['ecg-noisy', 4, 0],
  ] as const)('%s', (id, maxFalsePositives, maxFalseNegatives) => {
    const { result } = analyzeSample(id);
    const score = matchBeats(refs[id].beatTimesS ?? [], result.beatTimesS);
    expect(score.falsePositives).toBeLessThanOrEqual(maxFalsePositives);
    expect(score.falseNegatives).toBeLessThanOrEqual(maxFalseNegatives);
  });

  it('places beats within 20 ms of the annotated position on the clean sample', () => {
    const { result } = analyzeSample('ecg-normal');
    expect(
      matchBeats(refs['ecg-normal'].beatTimesS ?? [], result.beatTimesS, 0.02).sensitivity,
    ).toBe(1);
  });

  it('marks upright R waves and reports sub-sample beat times', () => {
    const { info, result } = analyzeSample('ecg-normal');
    expect(result.polarity).toBe(1);
    expect(result.beatTimesS).toHaveLength(result.peaks.length);
    result.peaks.forEach((peak, i) => {
      expect(Math.abs(result.beatTimesS[i] - peak / info.fs)).toBeLessThanOrEqual(0.5 / info.fs);
    });
  });
});

describe('pipeline on the bundled PPG sample', () => {
  // The sensor signal is disturbed from about 1:32 to 1:44 (flat stretches and
  // irregular bumps), so few real pulses can be found there. The median is used
  // because it is not affected by those few long gaps.
  const ARTIFACT_S = [88, 106] as const;

  it('gives the same typical pulse rate as the bedside monitor, within 1 bpm', () => {
    const { result } = analyzeSample('ppg-finger');
    const medianBpm = 60_000 / median(beatIntervalsMs(result.beatTimesS));
    expect(Math.abs(medianBpm - (refs['ppg-finger'].monitorMeanPulseBpm ?? NaN))).toBeLessThan(1);
  });

  it('finds steady intervals outside the disturbed stretch, with at most one missed pulse', () => {
    const { result } = analyzeSample('ppg-finger');
    const times = Array.from(result.beatTimesS).filter(
      (t) => t < ARTIFACT_S[0] || t > ARTIFACT_S[1],
    );
    // Dropping the artifact window joins its two ends into one long interval; leave that one out.
    const intervals = Array.from(beatIntervalsMs(times)).filter((interval) => interval < 5000);
    expect(intervals.length).toBeGreaterThan(400);
    expect(Math.min(...intervals)).toBeGreaterThan(500);
    // One weak pulse near 0:44 is missed, which shows up as a single double-length interval.
    expect(intervals.filter((interval) => interval > 900)).toHaveLength(1);
  });
});
