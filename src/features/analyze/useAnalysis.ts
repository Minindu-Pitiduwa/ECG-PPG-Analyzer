import { useMemo } from 'react';
import type { PlotBeat, TimeSpan } from '@/components/plot/SignalPlot';
import { spectralHrv, type SpectralHrv } from '@/dsp/hrv/frequencyDomain';
import { beatIntervalsMs, heartRateStats, type HeartRateStats } from '@/dsp/hrv/heartRate';
import {
  classifyIntervals,
  countExclusions,
  type ExclusionCounts,
  type IntervalLabel,
} from '@/dsp/hrv/intervals';
import { poincare, type Poincare } from '@/dsp/hrv/poincare';
import { normalIntervals, timeDomainHrv, type TimeDomainHrv } from '@/dsp/hrv/timeDomain';
import {
  defaultQualityOptions,
  goodFraction,
  intervalsInLowQuality,
  templateSqi,
  type SegmentQuality,
} from '@/dsp/quality/templateSqi';
import { detectFlags, type RhythmFlag } from '@/dsp/rhythm/flags';
import type { Recording } from '@/io/types';
import { useAnalysisStore } from '@/store/analysis';
import { useBeats } from '@/store/beats';
import { useSettingsStore } from '@/store/settings';

export interface Analysis {
  beats: PlotBeat[];
  beatTimesS: number[];
  /** Interval ending at beat `i + 1`, in ms, with its label. */
  intervalsMs: Float64Array;
  labels: IntervalLabel[];
  exclusions: ExclusionCounts;
  /** Heart rate from the normal intervals only, so one bad beat cannot set the minimum or maximum. */
  heartRate: HeartRateStats;
  timeDomain: TimeDomainHrv;
  spectral: SpectralHrv;
  poincare: Poincare;
  quality: SegmentQuality[];
  /** Share of segments with good signal quality, 0 to 1. */
  goodFraction: number;
  lowQualitySpans: TimeSpan[];
  /** Rhythm screening hints that were raised. */
  flags: RhythmFlag[];
}

/**
 * Everything derived from the beats: quality, interval labels and all metrics.
 *
 * This runs on the main thread, not in the worker, because it must respond to
 * every manual beat edit at once and is cheap: it works on a few thousand beat
 * times, not on the millions of signal samples.
 */
export function useAnalysis(recording: Recording): Analysis {
  const beats = useBeats();
  const filtered = useAnalysisStore((state) => state.filtered);
  const spectralMethod = useSettingsStore((state) => state.spectralMethod);
  const rhythmOptions = useSettingsStore((state) => state.rhythm);
  const { fs, kind } = recording;

  const core = useMemo(() => {
    const beatTimesS = beats.map((beat) => beat.timeS);
    const intervalsMs = beatIntervalsMs(beatTimesS);
    const options = defaultQualityOptions(kind);
    const quality = filtered ? templateSqi(filtered, fs, beatTimesS, options) : [];
    const lowQuality = intervalsInLowQuality(beatTimesS, quality, options.segmentS);
    const labels = classifyIntervals(intervalsMs, undefined, lowQuality);
    return { beatTimesS, intervalsMs, labels, quality };
  }, [beats, filtered, fs, kind]);

  const spectral = useMemo(
    () => spectralHrv(core.beatTimesS, core.intervalsMs, core.labels, spectralMethod),
    [core, spectralMethod],
  );

  return useMemo((): Analysis => {
    const { intervalsMs, labels, quality } = core;
    return {
      ...core,
      // A beat is flagged when it arrives early or at an impossible time; the interval ending at it says so.
      beats: beats.map((beat, i) => ({
        ...beat,
        flagged: i > 0 && (labels[i - 1] === 'short' || labels[i - 1] === 'implausible'),
      })),
      exclusions: countExclusions(labels),
      heartRate: heartRateStats(normalIntervals(intervalsMs, labels)),
      timeDomain: timeDomainHrv(intervalsMs, labels),
      spectral,
      poincare: poincare(intervalsMs, labels),
      goodFraction: goodFraction(quality),
      lowQualitySpans: quality.filter((segment) => !segment.good),
      flags: detectFlags(core.beatTimesS, intervalsMs, labels, rhythmOptions),
    };
  }, [core, beats, spectral, rhythmOptions]);
}
