import { LoaderCircle } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { InfoTip } from '@/components/InfoTip';
import { SignalPlot, type PlotBeat, type PlotTrace } from '@/components/plot/SignalPlot';
import { Label, Select } from '@/components/ui/field';
import { GLOSSARY } from '@/content/glossary';
import type { NoiseExperiment, NoiseTrial } from '@/dsp/noise/experiment';
import type { NoiseKind } from '@/dsp/noise/generate';
import type { Recording } from '@/io/types';
import { useSettingsStore } from '@/store/settings';
import { runInWorker } from '@/workers/client';

/** Noise levels tested, loudest last. The slider moves through the same values. */
const SNR_LEVELS_DB = [24, 18, 12, 6, 0, -6, -12, -18];
const DEFAULT_SNR_DB = 0;
const DEBOUNCE_MS = 250;
const NOISE_SEED = 1;

const NOISE_KINDS: { id: NoiseKind; label: string; lesson: string }[] = [
  {
    id: 'emg',
    label: 'Muscle noise (EMG)',
    lesson:
      'Broadband noise overlaps the frequencies of the heartbeat itself, so filters can only remove part of it. Detection degrades gradually as it grows.',
  },
  {
    id: 'motion',
    label: 'Motion artifacts',
    lesson:
      'Short, large swings in the same frequency range as the beats. They are the hardest noise to remove and typically cause both missed and false beats.',
  },
  {
    id: 'baseline',
    label: 'Baseline wander',
    lesson:
      'Slow drift below the frequencies of the heartbeat. The high-pass filter removes it almost completely, so detection usually survives even when the drift is larger than the signal. Try switching baseline removal off in Settings.',
  },
  {
    id: 'powerline',
    label: 'Mains hum',
    lesson:
      'A single frequency, which the notch filter removes when it is set to the same frequency. Try setting the mains filter to the other frequency, or off, in Settings.',
  },
];

const percent = (value: number) => (Number.isFinite(value) ? `${(100 * value).toFixed(1)}%` : '–');

const CHART = { width: 320, height: 170, left: 38, right: 10, top: 10, bottom: 30 };

/** F1 score against noise level, with the selected level marked. */
function ScoreChart({ trials, selectedDb }: { trials: NoiseTrial[]; selectedDb: number }) {
  const plotWidth = CHART.width - CHART.left - CHART.right;
  const plotHeight = CHART.height - CHART.top - CHART.bottom;
  const highest = Math.max(...SNR_LEVELS_DB);
  const lowest = Math.min(...SNR_LEVELS_DB);
  // Quiet on the left, loud on the right, so the curve reads as "adding noise".
  const xOf = (snrDb: number) => CHART.left + ((highest - snrDb) / (highest - lowest)) * plotWidth;
  const yOf = (f1: number) => CHART.top + (1 - (Number.isFinite(f1) ? f1 : 0)) * plotHeight;
  const path = trials
    .map(
      (trial, i) =>
        `${i === 0 ? 'M' : 'L'}${xOf(trial.snrDb).toFixed(1)},${yOf(trial.score.f1).toFixed(1)}`,
    )
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${CHART.width} ${CHART.height}`}
      className="w-full max-w-md"
      role="img"
      aria-label="Detection F1 score against signal-to-noise ratio"
    >
      {[0, 0.5, 1].map((level) => (
        <g key={level}>
          <line
            x1={CHART.left}
            x2={CHART.width - CHART.right}
            y1={yOf(level)}
            y2={yOf(level)}
            stroke="var(--grid)"
          />
          <text
            x={CHART.left - 5}
            y={yOf(level) + 3}
            textAnchor="end"
            fontSize="9"
            fill="var(--muted-foreground)"
          >
            {100 * level}%
          </text>
        </g>
      ))}
      {SNR_LEVELS_DB.map((snrDb) => (
        <text
          key={snrDb}
          x={xOf(snrDb)}
          y={CHART.height - CHART.bottom + 12}
          textAnchor="middle"
          fontSize="9"
          fill="var(--muted-foreground)"
        >
          {snrDb}
        </text>
      ))}
      <text
        x={CHART.left + plotWidth / 2}
        y={CHART.height - 3}
        textAnchor="middle"
        fontSize="9"
        fill="var(--muted-foreground)"
      >
        Signal-to-noise ratio (dB), more noise →
      </text>
      <path d={path} fill="none" stroke="var(--signal)" strokeWidth="1.5" />
      {trials.map((trial) => (
        <circle
          key={trial.snrDb}
          cx={xOf(trial.snrDb)}
          cy={yOf(trial.score.f1)}
          r={trial.snrDb === selectedDb ? 5 : 2.5}
          fill={trial.snrDb === selectedDb ? 'var(--beat)' : 'var(--signal)'}
        />
      ))}
    </svg>
  );
}

interface NoiseLabProps {
  recording: Recording;
  /** The beats of the recording as loaded (with manual corrections): the reference to score against. */
  referenceBeatsS: number[];
}

/**
 * A learning tool: add synthetic noise to the loaded recording and watch what
 * happens to beat detection. The noise goes onto the raw signal and the whole
 * pipeline is run again, so the effect of the filters is part of the result.
 */
export function NoiseLab({ recording, referenceBeatsS }: NoiseLabProps) {
  const id = useId();
  const preprocess = useSettingsStore((state) => state.preprocess);
  const [noiseKind, setNoiseKind] = useState<NoiseKind>('emg');
  const [snrIndex, setSnrIndex] = useState(SNR_LEVELS_DB.indexOf(DEFAULT_SNR_DB));
  const [experiment, setExperiment] = useState<NoiseExperiment | null>(null);
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);
  const snrDb = SNR_LEVELS_DB[snrIndex];
  const { samples, fs, kind, units } = recording;

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setRunning(true);
      setFailed(false);
      runInWorker('noiseExperiment', {
        samples,
        fs,
        kind,
        options: { preprocess },
        referenceBeatsS: Float64Array.from(referenceBeatsS),
        noiseKind,
        // Hum at the frequency the notch expects, so the notch setting visibly matters.
        noiseOptions: { mainsHz: preprocess.notchHz ?? 50, seed: NOISE_SEED },
        snrLevelsDb: SNR_LEVELS_DB,
        previewSnrDb: snrDb,
      })
        .then((result) => {
          if (!cancelled) setExperiment(result);
        })
        .catch((cause: unknown) => {
          console.error(cause);
          if (!cancelled) setFailed(true);
        })
        .finally(() => {
          if (!cancelled) setRunning(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [samples, fs, kind, preprocess, referenceBeatsS, noiseKind, snrDb]);

  const traces = useMemo(
    (): PlotTrace[] =>
      experiment
        ? [
            { samples: experiment.preview.noisy, color: 'raw' },
            { samples: experiment.preview.filtered, color: 'signal' },
          ]
        : [],
    [experiment],
  );
  const beats = useMemo(
    (): PlotBeat[] =>
      experiment
        ? Array.from(experiment.preview.beatTimesS, (timeS) => ({
            timeS,
            source: 'auto',
            flagged: false,
          }))
        : [],
    [experiment],
  );
  const selected = experiment?.trials.find((trial) => trial.snrDb === snrDb);
  const lesson = NOISE_KINDS.find((entry) => entry.id === noiseKind)?.lesson;

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Add synthetic noise to this recording and see how well the beats are still found. Detections
        on the noisy signal are compared with the beats of the recording as loaded, within 150 ms.
        The recording already contains some noise of its own, so the ratio is relative to it as
        loaded.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <div className="flex items-center gap-1">
            <Label htmlFor={`${id}-kind`}>Noise type</Label>
            <InfoTip label="About the noise types">{GLOSSARY.noiseKind}</InfoTip>
          </div>
          <Select
            id={`${id}-kind`}
            value={noiseKind}
            onChange={(event) => setNoiseKind(event.target.value as NoiseKind)}
          >
            {NOISE_KINDS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-1">
            <Label htmlFor={`${id}-snr`}>Signal-to-noise ratio: {snrDb} dB</Label>
            <InfoTip label="About the signal-to-noise ratio">{GLOSSARY.snr}</InfoTip>
          </div>
          <input
            id={`${id}-snr`}
            type="range"
            min={0}
            max={SNR_LEVELS_DB.length - 1}
            step={1}
            value={snrIndex}
            onChange={(event) => setSnrIndex(Number(event.target.value))}
            aria-valuetext={`${snrDb} decibels`}
            className="w-full accent-(--primary)"
          />
          <div className="text-muted-foreground flex justify-between text-xs">
            <span>Less noise</span>
            <span>More noise</span>
          </div>
        </div>
      </div>

      {lesson && <p className="bg-muted rounded-md p-3 text-sm">{lesson}</p>}
      {failed && (
        <p role="alert" className="text-danger text-sm">
          The experiment could not be run with the current filter settings.
        </p>
      )}

      {experiment && selected ? (
        <>
          <div className="grid gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
            <dl className="space-y-2 text-sm">
              {(
                [
                  ['Sensitivity', selected.score.sensitivity, GLOSSARY.sensitivity],
                  ['Positive predictive value', selected.score.positivePredictivity, GLOSSARY.ppv],
                  ['F1 score', selected.score.f1, GLOSSARY.f1],
                ] as const
              ).map(([label, value, tip]) => (
                <div key={label} className="flex items-center justify-between gap-2 border-b pb-2">
                  <dt className="flex items-center gap-1">
                    {label}
                    <InfoTip label={`About ${label.toLowerCase()}`}>{tip}</InfoTip>
                  </dt>
                  <dd className="font-medium tabular-nums">{percent(value)}</dd>
                </div>
              ))}
              <p className="text-muted-foreground text-xs">
                {selected.score.falseNegatives} missed, {selected.score.falsePositives} extra, out
                of {referenceBeatsS.length} beats.
              </p>
            </dl>
            <ScoreChart trials={experiment.trials} selectedDb={snrDb} />
          </div>

          <div className="space-y-1">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              Noisy signal at {snrDb} dB
              {running && (
                <LoaderCircle className="text-muted-foreground size-3.5 animate-spin" aria-hidden />
              )}
            </h3>
            <p className="text-muted-foreground flex flex-wrap gap-x-4 text-xs">
              <span className="flex items-center gap-1">
                <span className="h-0.5 w-4 bg-(--raw)" aria-hidden /> With noise added
              </span>
              <span className="flex items-center gap-1">
                <span className="h-0.5 w-4 bg-(--signal)" aria-hidden /> After filtering
              </span>
              <span className="flex items-center gap-1">
                <span className="bg-beat size-2 rounded-full" aria-hidden /> Beat found
              </span>
              <span>Shows the same time window as the main plot.</span>
            </p>
            <SignalPlot
              traces={traces}
              fs={fs}
              units={units}
              beats={beats}
              lowQuality={[]}
              height={240}
              label="Noisy signal plot"
              testId="noise-plot"
            />
          </div>
        </>
      ) : (
        !failed && (
          <p role="status" className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            Running the experiment…
          </p>
        )
      )}
    </div>
  );
}
