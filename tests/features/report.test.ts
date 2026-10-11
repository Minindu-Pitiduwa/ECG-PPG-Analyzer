import { describe, expect, it } from 'vitest';
import { applyBeatEdits, type BeatEdit } from '@/dsp/detect/edits';
import { defaultPreprocessOptions } from '@/dsp/filters/preprocess';
import { analyzeRecording } from '@/dsp/pipeline';
import { RHYTHM_DEFAULTS } from '@/dsp/rhythm/flags';
import { deriveAnalysis } from '@/features/analyze/useAnalysis';
import { renderReportPdf, type ReportCharts } from '@/features/report/pdf';
import {
  buildReportModel,
  buildSettingsExport,
  type ReportSettings,
} from '@/features/report/reportModel';
import { buildBeatsCsv } from '@/io/export/beatsCsv';
import type { Recording } from '@/io/types';
import { DISCLAIMER } from '@/lib/appInfo';
import { fileBaseName } from '@/lib/download';
import { readSample } from '../helpers/samples';

const NOW = new Date('2026-10-11T09:30:00Z');

/** Run the same steps the app runs for a bundled sample. */
function analyzeSample(id: string, beatEdits: BeatEdit[] = []) {
  const { info, samples } = readSample(id);
  const preprocess = defaultPreprocessOptions(info.kind);
  const result = analyzeRecording(samples, info.fs, info.kind, { preprocess });
  const recording: Recording = {
    name: info.title,
    kind: info.kind,
    fs: info.fs,
    samples,
    units: info.units,
    channel: info.channel,
    origin: info.source,
    warnings: [],
  };
  const settings: ReportSettings = {
    preprocess,
    spectralMethod: 'lombScargle',
    rhythm: RHYTHM_DEFAULTS,
    beatEdits,
  };
  const analysis = deriveAnalysis(
    applyBeatEdits(result.beatTimesS, beatEdits),
    result.filtered,
    info.fs,
    info.kind,
    settings.spectralMethod,
    settings.rhythm,
  );
  return { recording, settings, analysis, filtered: result.filtered, skipped: result.skipped };
}

describe('buildBeatsCsv', () => {
  it('writes one row per beat with the interval that ends at it', () => {
    const csv = buildBeatsCsv(
      [
        { timeS: 0.5, source: 'auto', flagged: false },
        { timeS: 1.3, source: 'auto', flagged: false },
        { timeS: 1.75, source: 'manual', flagged: true },
      ],
      [800, 450],
      ['normal', 'short'],
    );
    expect(csv).toBe(
      [
        'beat,time_s,interval_ms,interval_label,source,flagged',
        '1,0.500000,,,auto,0',
        '2,1.300000,800.000,normal,auto,0',
        '3,1.750000,450.000,short,manual,1',
        '',
      ].join('\n'),
    );
  });

  it('writes only the header when there are no beats', () => {
    expect(buildBeatsCsv([], [], [])).toBe(
      'beat,time_s,interval_ms,interval_label,source,flagged\n',
    );
  });

  it('lists every beat of a real recording', () => {
    const { analysis } = analyzeSample('ecg-normal');
    const lines = buildBeatsCsv(analysis.beats, analysis.intervalsMs, analysis.labels)
      .trim()
      .split('\n');
    expect(lines).toHaveLength(1 + 371);
    expect(lines.filter((line) => line.includes(',normal,'))).toHaveLength(364);
  });
});

describe('fileBaseName', () => {
  it('makes a safe file name from a recording name', () => {
    expect(fileBaseName('my recording (2).csv')).toBe('my-recording-2');
    expect(fileBaseName('ECG: normal sinus rhythm')).toBe('ecg-normal-sinus-rhythm');
    expect(fileBaseName('100 · MLII')).toBe('100-mlii');
    expect(fileBaseName('???')).toBe('recording');
  });
});

describe('buildReportModel', () => {
  const { recording, settings, analysis, skipped } = analyzeSample('ecg-normal');
  const model = buildReportModel(recording, analysis, settings, skipped, NOW);
  const metric = (label: string) =>
    model.metrics.flatMap((group) => group.rows).find((row) => row.label === label);

  it('describes the recording and when the report was made', () => {
    expect(model.generated).toContain('2026-10-11 09:30 UTC');
    expect(model.recording).toContainEqual(['Duration', '5 min']);
    expect(model.recording).toContainEqual(['Sampling rate', '360 Hz']);
    expect(model.recording).toContainEqual(['Channel', 'MLII']);
  });

  it('states the settings that produced the results', () => {
    expect(model.settings).toContainEqual(['Baseline removal', 'High-pass at 0.5 Hz']);
    expect(model.settings).toContainEqual(['Low-pass', '40 Hz']);
    expect(model.settings).toContainEqual(['Mains notch', '50 Hz']);
    expect(model.settings).toContainEqual(['Manual beat edits', 'None']);
    expect(model.settings.find(([label]) => label === 'Beat detection')?.[1]).toMatch(
      /Pan-Tompkins, 5-15 Hz/,
    );
  });

  it('reports the same numbers the app shows', () => {
    expect(metric('Beats')?.value).toBe('371');
    expect(metric('Mean heart rate')).toMatchObject({ value: '74.2', unit: 'bpm' });
    expect(metric('SDNN')).toMatchObject({ value: '27.5', unit: 'ms' });
    expect(metric('RMSSD')).toMatchObject({ value: '27.8', unit: 'ms' });
    expect(metric('Normal intervals used')?.value).toBe('364');
    expect(metric('Good segments')?.value).toBe('100');
  });

  it('says how many intervals were excluded and why VLF is missing', () => {
    const notes = model.metrics.map((group) => group.note ?? '').join(' ');
    expect(notes).toContain('6 of 370 intervals (1.6%) were excluded: 3 too short, 3 too long');
    expect(notes).toContain('VLF power is not reported');
    expect(metric('VLF power (0.0033-0.04 Hz)')).toBeUndefined();
    expect(metric('LF/HF')).toBeDefined();
  });

  it('lists the flags with what was found and how, and always carries the disclaimer', () => {
    expect(model.flags).toHaveLength(1);
    expect(model.flags[0].title).toBe('Premature beats');
    expect(model.flags[0].summary).toMatch(/2 early beats/);
    expect(model.flags[0].method).toMatch(/20% shorter/);
    expect(model.disclaimer).toBe(DISCLAIMER);
  });

  it('gives the reason when frequency analysis is not possible', () => {
    const ectopic = analyzeSample('ecg-ectopic');
    const report = buildReportModel(ectopic.recording, ectopic.analysis, ectopic.settings, [], NOW);
    const frequency = report.metrics.find((group) => group.group.includes('frequency'));
    expect(frequency?.rows).toEqual([]);
    expect(frequency?.note).toMatch(/of the intervals were excluded/);
  });

  it('counts manual edits, names the PPG detector and labels pulse rate', () => {
    const edits: BeatEdit[] = [
      { type: 'add', timeS: 44.1 },
      { type: 'remove', timeS: 10 },
    ];
    const ppg = analyzeSample('ppg-finger', edits);
    const report = buildReportModel(
      ppg.recording,
      ppg.analysis,
      ppg.settings,
      ['The 60 Hz notch was skipped.'],
      NOW,
    );
    expect(report.settings).toContainEqual(['Manual beat edits', '1 added, 1 removed']);
    expect(report.settings).toContainEqual(['Filter note', 'The 60 Hz notch was skipped.']);
    expect(report.settings.find(([label]) => label === 'Beat detection')?.[1]).toMatch(/Elgendi/);
    expect(report.metrics[0].group).toBe('Pulse rate');
    expect(report.recording).toContainEqual(['Signal type', 'PPG']);
  });
});

describe('buildSettingsExport', () => {
  it('survives a round trip through JSON and holds what is needed to reproduce the analysis', () => {
    const edits: BeatEdit[] = [{ type: 'add', timeS: 4.6 }];
    const { recording, settings, analysis } = analyzeSample('ecg-normal', edits);
    const exported = JSON.parse(
      JSON.stringify(buildSettingsExport(recording, analysis, settings, NOW)),
    );
    expect(exported).toMatchObject({
      format: 'pulsescope-analysis',
      formatVersion: 1,
      exportedAt: '2026-10-11T09:30:00.000Z',
      recording: { kind: 'ecg', samplingRateHz: 360, sampleCount: 108000, channel: 'MLII' },
      settings: {
        preprocess: { baseline: 'highpass', highpassHz: 0.5, lowpassHz: 40, notchHz: 50, order: 2 },
        detector: { method: 'pan-tompkins', bandHz: [5, 15] },
        spectralMethod: 'lombScargle',
        rhythmFlags: { tachycardiaBpm: 100, bradycardiaBpm: 60, pauseS: 2 },
      },
      beatEdits: [{ type: 'add', timeS: 4.6 }],
      results: { beats: 372 },
    });
    // The recording itself is not embedded: the file stays small and holds no signal data.
    expect(JSON.stringify(exported).length).toBeLessThan(5000);
  });
});

describe('renderReportPdf', () => {
  function chartsFor(sample: ReturnType<typeof analyzeSample>): ReportCharts {
    const { recording, analysis, filtered } = sample;
    const window = filtered.subarray(0, 10 * recording.fs);
    return {
      signal: {
        timeS: Float64Array.from(window, (_, i) => i / recording.fs),
        values: Float64Array.from(window),
        fromS: 0,
        toS: 10,
        units: 'mV',
        beats: analysis.beats
          .filter((beat) => beat.timeS < 10)
          .map((beat) => ({
            timeS: beat.timeS,
            value: filtered[Math.round(beat.timeS * recording.fs)],
            flagged: beat.flagged,
          })),
      },
      intervals: {
        timeS: Float64Array.from(analysis.beatTimesS.slice(1)),
        bpm: analysis.intervalsMs.map((interval) => 60_000 / interval),
        ms: analysis.intervalsMs,
        excluded: analysis.labels.map((label) => label !== 'normal'),
      },
      poincare: analysis.poincare,
      durationS: recording.samples.length / recording.fs,
      rateLabel: 'Heart rate',
    };
  }

  /** The PDF's bytes as text: enough to check its structure (page content itself is compressed). */
  async function pdfSource(blob: Blob): Promise<string> {
    return new TextDecoder('latin1').decode(await blob.arrayBuffer());
  }

  const pageCount = (source: string) => (source.match(/\/Type \/Page\b/g) ?? []).length;

  it('produces a compact, valid PDF with the recording in its metadata', async () => {
    const sample = analyzeSample('ecg-normal');
    const model = buildReportModel(sample.recording, sample.analysis, sample.settings, [], NOW);
    const blob = await renderReportPdf(model, chartsFor(sample));
    const source = await pdfSource(blob);
    expect(blob.type).toBe('application/pdf');
    expect(source.startsWith('%PDF-')).toBe(true);
    expect(source.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pageCount(source)).toBeGreaterThanOrEqual(1);
    expect(pageCount(source)).toBeLessThanOrEqual(3);
    expect(source).toContain('PulseScope report');
    expect(blob.size).toBeLessThan(200_000);
  });

  it('still produces a report for a recording with no beats', async () => {
    const sample = analyzeSample('ecg-normal');
    const empty = deriveAnalysis([], sample.filtered, 360, 'ecg', 'lombScargle', RHYTHM_DEFAULTS);
    const model = buildReportModel(sample.recording, empty, sample.settings, [], NOW);
    expect(model.flags).toEqual([]);
    const source = await pdfSource(
      await renderReportPdf(model, chartsFor({ ...sample, analysis: empty })),
    );
    expect(source.startsWith('%PDF-')).toBe(true);
    expect(pageCount(source)).toBeGreaterThanOrEqual(1);
  });
});
