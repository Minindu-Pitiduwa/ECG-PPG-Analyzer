import { FLAG_TITLES } from '@/content/glossary';
import type { BeatEdit } from '@/dsp/detect/edits';
import { ELGENDI_DEFAULTS } from '@/dsp/detect/elgendi';
import { PAN_TOMPKINS_DEFAULTS } from '@/dsp/detect/panTompkins';
import type { PreprocessOptions } from '@/dsp/filters/preprocess';
import type { SpectralMethod } from '@/dsp/hrv/frequencyDomain';
import { INTERVAL_DEFAULTS } from '@/dsp/hrv/intervals';
import { defaultQualityOptions } from '@/dsp/quality/templateSqi';
import type { RhythmOptions } from '@/dsp/rhythm/flags';
import { flagMethod, flagSummary } from '@/features/analyze/flagText';
import type { Analysis } from '@/features/analyze/useAnalysis';
import { UNIT_LABELS, type Recording } from '@/io/types';
import { APP_NAME, APP_VERSION, DISCLAIMER } from '@/lib/appInfo';
import { formatDuration } from '@/lib/format';

/** Everything the user can change that affects the results. */
export interface ReportSettings {
  preprocess: PreprocessOptions;
  spectralMethod: SpectralMethod;
  rhythm: RhythmOptions;
  beatEdits: readonly BeatEdit[];
}

export type Row = [label: string, value: string];

export interface MetricRow {
  label: string;
  value: string;
  unit: string;
}

export interface ReportModel {
  title: string;
  generated: string;
  recording: Row[];
  settings: Row[];
  metrics: { group: string; rows: MetricRow[]; note?: string }[];
  flags: { title: string; summary: string; method: string }[];
  notes: string[];
  disclaimer: string;
}

const fixed = (value: number, digits: number) =>
  Number.isFinite(value) ? value.toFixed(digits) : 'n/a';
const whole = (value: number) =>
  Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : 'n/a';

function settingsRows(recording: Recording, settings: ReportSettings, skipped: string[]): Row[] {
  const { preprocess, rhythm } = settings;
  const baseline =
    preprocess.baseline === 'highpass'
      ? `High-pass at ${preprocess.highpassHz} Hz`
      : preprocess.baseline === 'median'
        ? 'Two-stage median filter (200 ms, 600 ms)'
        : 'Off';
  const detector =
    recording.kind === 'ecg'
      ? `Pan-Tompkins, ${PAN_TOMPKINS_DEFAULTS.bandHz.join('-')} Hz band, ${1000 * PAN_TOMPKINS_DEFAULTS.refractoryS} ms refractory`
      : `Elgendi two moving averages, ${ELGENDI_DEFAULTS.bandHz.join('-')} Hz band, max ${ELGENDI_DEFAULTS.maxHeartRateBpm} bpm`;
  const quality = defaultQualityOptions(recording.kind);
  const adds = settings.beatEdits.filter((edit) => edit.type === 'add').length;
  const removes = settings.beatEdits.length - adds;
  return [
    ['Baseline removal', baseline],
    ['Low-pass', preprocess.lowpassHz === null ? 'Off' : `${preprocess.lowpassHz} Hz`],
    ['Mains notch', preprocess.notchHz === null ? 'Off' : `${preprocess.notchHz} Hz`],
    ['Filter order', `${preprocess.order} (Butterworth, applied forwards and backwards)`],
    ...skipped.map((note): Row => ['Filter note', note]),
    ['Beat detection', detector],
    [
      'Manual beat edits',
      settings.beatEdits.length === 0 ? 'None' : `${adds} added, ${removes} removed`,
    ],
    [
      'Interval exclusion',
      `More than ${100 * INTERVAL_DEFAULTS.tolerance}% from the median of ${2 * INTERVAL_DEFAULTS.neighbours} neighbours; outside ${INTERVAL_DEFAULTS.minMs}-${INTERVAL_DEFAULTS.maxMs} ms; in low-quality signal`,
    ],
    [
      'Signal quality',
      `Beat-to-template correlation per ${quality.segmentS} s, threshold ${quality.threshold}`,
    ],
    [
      'Spectrum',
      settings.spectralMethod === 'welch'
        ? 'Welch on 4 Hz linear resampling'
        : 'Lomb-Scargle periodogram',
    ],
    [
      'Flag thresholds',
      `Fast above ${rhythm.tachycardiaBpm} bpm, slow below ${rhythm.bradycardiaBpm} bpm, pause above ${rhythm.pauseS} s`,
    ],
  ];
}

/**
 * Collect everything a report states, as plain labelled text. The on-screen
 * summary and the PDF are both drawn from this one model, so they cannot
 * disagree.
 *
 * @param skipped filter stages that could not be applied at this sampling rate
 */
export function buildReportModel(
  recording: Recording,
  analysis: Analysis,
  settings: ReportSettings,
  skipped: string[],
  now: Date,
): ReportModel {
  const { heartRate, timeDomain, spectral, poincare, exclusions } = analysis;
  const rate = recording.kind === 'ecg' ? 'heart rate' : 'pulse rate';
  const excludedShare = exclusions.total > 0 ? (100 * exclusions.excluded) / exclusions.total : 0;

  return {
    title: `${APP_NAME} report`,
    generated: `Generated ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC by ${APP_NAME} ${APP_VERSION}`,
    recording: [
      ['Recording', recording.name],
      ['Signal type', recording.kind === 'ecg' ? 'ECG' : 'PPG'],
      ...(recording.channel ? [['Channel', recording.channel] as Row] : []),
      ['Duration', formatDuration(recording.samples.length / recording.fs)],
      ['Sampling rate', `${recording.fs} Hz`],
      ['Samples', recording.samples.length.toLocaleString('en-US')],
      ['Units', UNIT_LABELS[recording.units]],
      ['Source', recording.origin],
    ],
    settings: settingsRows(recording, settings, skipped),
    metrics: [
      {
        group: recording.kind === 'ecg' ? 'Heart rate' : 'Pulse rate',
        rows: [
          { label: `Mean ${rate}`, value: fixed(heartRate.meanBpm, 1), unit: 'bpm' },
          { label: `Lowest ${rate}`, value: fixed(heartRate.minBpm, 1), unit: 'bpm' },
          { label: `Highest ${rate}`, value: fixed(heartRate.maxBpm, 1), unit: 'bpm' },
          { label: 'Beats', value: whole(analysis.beats.length), unit: '' },
        ],
      },
      {
        group:
          recording.kind === 'ecg'
            ? 'Variability, time domain'
            : 'Pulse rate variability, time domain',
        rows: [
          { label: 'Normal intervals used', value: whole(timeDomain.count), unit: '' },
          { label: 'Mean NN', value: fixed(timeDomain.meanNN, 1), unit: 'ms' },
          { label: 'SDNN', value: fixed(timeDomain.sdnn, 1), unit: 'ms' },
          { label: 'RMSSD', value: fixed(timeDomain.rmssd, 1), unit: 'ms' },
          { label: 'pNN50', value: fixed(timeDomain.pnn50, 1), unit: '%' },
        ],
        note:
          exclusions.excluded === 0
            ? 'No intervals were excluded.'
            : `${exclusions.excluded} of ${exclusions.total} intervals (${excludedShare.toFixed(1)}%) were excluded: ` +
              `${exclusions.short} too short, ${exclusions.long} too long, ${exclusions.implausible} implausible, ` +
              `${exclusions.lowQuality} in low-quality signal.`,
      },
      {
        group: 'Variability, frequency domain',
        rows: spectral.available
          ? [
              ...(spectral.vlfAvailable
                ? [
                    {
                      label: 'VLF power (0.0033-0.04 Hz)',
                      value: whole(spectral.bands.vlf),
                      unit: 'ms²',
                    },
                  ]
                : []),
              { label: 'LF power (0.04-0.15 Hz)', value: whole(spectral.bands.lf), unit: 'ms²' },
              { label: 'HF power (0.15-0.4 Hz)', value: whole(spectral.bands.hf), unit: 'ms²' },
              { label: 'LF/HF', value: fixed(spectral.bands.lfHfRatio, 2), unit: '' },
            ]
          : [],
        note: spectral.available
          ? spectral.vlfAvailable
            ? undefined
            : 'VLF power is not reported: it needs at least 5 minutes of usable beats.'
          : spectral.reason,
      },
      {
        group: 'Poincaré plot',
        rows: [
          { label: 'SD1', value: fixed(poincare.sd1, 1), unit: 'ms' },
          { label: 'SD2', value: fixed(poincare.sd2, 1), unit: 'ms' },
        ],
      },
      {
        group: 'Signal quality',
        rows: [
          { label: 'Good segments', value: fixed(100 * analysis.goodFraction, 0), unit: '%' },
          {
            label: 'Low-quality segments',
            value: `${analysis.lowQualitySpans.length} of ${analysis.quality.length}`,
            unit: '',
          },
        ],
      },
    ],
    flags: analysis.flags.map((flag) => ({
      title: FLAG_TITLES[flag.kind],
      summary: flagSummary(flag, settings.rhythm, analysis.beats.length),
      method: flagMethod(flag.kind, settings.rhythm),
    })),
    notes: recording.warnings,
    disclaimer: DISCLAIMER,
  };
}

/**
 * The settings and headline results as a plain object, for the JSON export.
 * With the same recording, these settings reproduce the analysis.
 */
export function buildSettingsExport(
  recording: Recording,
  analysis: Analysis,
  settings: ReportSettings,
  now: Date,
) {
  const { spectral } = analysis;
  return {
    format: 'pulsescope-analysis',
    formatVersion: 1,
    app: { name: APP_NAME, version: APP_VERSION },
    exportedAt: now.toISOString(),
    recording: {
      name: recording.name,
      kind: recording.kind,
      channel: recording.channel ?? null,
      samplingRateHz: recording.fs,
      sampleCount: recording.samples.length,
      units: recording.units,
      origin: recording.origin,
    },
    settings: {
      preprocess: settings.preprocess,
      detector:
        recording.kind === 'ecg'
          ? { method: 'pan-tompkins', ...PAN_TOMPKINS_DEFAULTS }
          : { method: 'elgendi', ...ELGENDI_DEFAULTS },
      intervalExclusion: INTERVAL_DEFAULTS,
      signalQuality: defaultQualityOptions(recording.kind),
      spectralMethod: settings.spectralMethod,
      rhythmFlags: settings.rhythm,
    },
    beatEdits: settings.beatEdits,
    results: {
      beats: analysis.beats.length,
      heartRate: analysis.heartRate,
      intervals: analysis.exclusions,
      timeDomain: analysis.timeDomain,
      frequencyDomain: spectral.available
        ? {
            bands: spectral.bands,
            vlfReported: spectral.vlfAvailable,
            usableSeconds: spectral.usableS,
          }
        : { unavailable: spectral.reason },
      poincare: { sd1: analysis.poincare.sd1, sd2: analysis.poincare.sd2 },
      signalQualityGoodFraction: analysis.goodFraction,
      flags: analysis.flags,
    },
  };
}
