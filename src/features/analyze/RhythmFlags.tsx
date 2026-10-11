import { useId, useState } from 'react';
import { InfoTip } from '@/components/InfoTip';
import { Input, Label } from '@/components/ui/field';
import { FLAG_TITLES, GLOSSARY } from '@/content/glossary';
import {
  COSEN_THRESHOLD,
  IRREGULARITY_WINDOW,
  NORMALIZED_RMSSD_THRESHOLD,
  type FlagKind,
  type FlagLocation,
  type RhythmFlag,
  type RhythmOptions,
} from '@/dsp/rhythm/flags';
import { formatDuration, formatTime } from '@/lib/format';
import { useSettingsStore } from '@/store/settings';

/** Locations listed before the rest are folded behind a "show all" button. */
const LOCATIONS_SHOWN = 12;

const plural = (count: number, word: string, many = `${word}s`) =>
  `${count} ${count === 1 ? word : many}`;

/** What was found, in one sentence. */
function summary(flag: RhythmFlag, options: RhythmOptions, beatCount: number): string {
  const count = flag.locations.length;
  switch (flag.kind) {
    case 'tachycardia':
      return `${plural(count, 'stretch', 'stretches')} faster than ${options.tachycardiaBpm} bpm, ${formatDuration(flag.value)} in total.`;
    case 'bradycardia':
      return `${plural(count, 'stretch', 'stretches')} slower than ${options.bradycardiaBpm} bpm, ${formatDuration(flag.value)} in total. Common and normal in athletes and during sleep.`;
    case 'pause':
      return `${plural(count, 'gap')} between beats longer than ${options.pauseS} s; the longest is ${flag.value.toFixed(1)} s. A missed detection looks the same, so check each one on the plot.`;
    case 'premature':
      return `${plural(count, 'early beat')} followed by a longer gap (${((100 * count) / Math.max(1, beatCount)).toFixed(1)}% of all beats). This is the pattern of ectopic (extra) beats.`;
    case 'irregular':
      return `${formatDuration(flag.value)} of rhythm that varies strongly and unpredictably from beat to beat. Atrial fibrillation looks like this, but so do frequent ectopic beats and noise.`;
  }
}

/** How it was computed, so the user can judge and reproduce it. */
function method(kind: FlagKind, options: RhythmOptions): string {
  switch (kind) {
    case 'tachycardia':
      return `At least 10 beats in a row with every interval shorter than ${Math.round(60_000 / options.tachycardiaBpm)} ms (${options.tachycardiaBpm} bpm). Intervals that are implausible or in low-quality signal end a run.`;
    case 'bradycardia':
      return `At least 10 beats in a row with every interval longer than ${Math.round(60_000 / options.bradycardiaBpm)} ms (${options.bradycardiaBpm} bpm). Intervals that are implausible or in low-quality signal end a run.`;
    case 'pause':
      return `Any beat-to-beat interval longer than ${options.pauseS} s, except in segments marked as low signal quality.`;
    case 'premature':
      return 'An interval more than 20% shorter than the median of its ten neighbours, immediately followed by one more than 20% longer.';
    case 'irregular':
      return `Windows of ${IRREGULARITY_WINDOW} intervals in which RMSSD exceeds ${100 * NORMALIZED_RMSSD_THRESHOLD}% of the mean interval and the coefficient of sample entropy (Lake & Moorman 2011) exceeds ${COSEN_THRESHOLD}. Flagged when such windows cover at least 30 s. Windows containing implausible or low-quality intervals are skipped.`;
  }
}

interface ThresholdInputProps {
  id: string;
  label: string;
  value: number;
  isValid: (value: number) => boolean;
  onChange: (value: number) => void;
}

function ThresholdInput({ id, label, value, isValid, onChange }: ThresholdInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && !isValid(Number(draft));
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="block">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        className="w-28"
        value={draft ?? String(value)}
        aria-invalid={invalid}
        onChange={(event) => {
          setDraft(event.target.value);
          const parsed = Number(event.target.value);
          if (event.target.value !== '' && isValid(parsed)) onChange(parsed);
        }}
        onBlur={() => setDraft(null)}
      />
    </div>
  );
}

interface FlagItemProps {
  flag: RhythmFlag;
  options: RhythmOptions;
  beatCount: number;
  onJump: (location: FlagLocation) => void;
}

function FlagItem({ flag, options, beatCount, onJump }: FlagItemProps) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? flag.locations : flag.locations.slice(0, LOCATIONS_SHOWN);
  const hidden = flag.locations.length - shown.length;

  return (
    <li className="space-y-2 rounded-md border p-3">
      <h3 className="text-sm font-medium">{FLAG_TITLES[flag.kind]}</h3>
      <p className="text-sm">{summary(flag, options, beatCount)}</p>
      <div className="flex flex-wrap gap-1.5" aria-label={`Where: ${FLAG_TITLES[flag.kind]}`}>
        {shown.map((location) => (
          <button
            key={location.startS}
            type="button"
            onClick={() => onJump(location)}
            className="bg-muted hover:bg-border rounded px-2 py-0.5 text-xs tabular-nums"
            title="Show on the plot"
          >
            {formatTime(location.startS)}
          </button>
        ))}
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="px-2 py-0.5 text-xs underline"
          >
            Show {hidden} more
          </button>
        )}
      </div>
      <details className="text-muted-foreground text-xs">
        <summary className="cursor-pointer select-none">How this was computed</summary>
        <p className="mt-1">{method(flag.kind, options)}</p>
      </details>
    </li>
  );
}

interface RhythmFlagsProps {
  flags: RhythmFlag[];
  beatCount: number;
  onJump: (location: FlagLocation) => void;
}

export function RhythmFlags({ flags, beatCount, onJump }: RhythmFlagsProps) {
  const id = useId();
  const options = useSettingsStore((state) => state.rhythm);
  const setRhythm = useSettingsStore((state) => state.setRhythm);

  return (
    <div className="space-y-4">
      <p className="bg-warning-bg text-warning-fg rounded-md p-3 text-sm">
        These are screening hints from simple rules, to show you where to look. They are not a
        diagnosis. Noise and detection errors can raise a flag, and having no flags does not mean a
        normal rhythm.
      </p>

      <div className="flex flex-wrap items-end gap-4">
        <ThresholdInput
          id={`${id}-fast`}
          label="Fast above (bpm)"
          value={options.tachycardiaBpm}
          isValid={(value) => value > options.bradycardiaBpm && value <= 250}
          onChange={(tachycardiaBpm) => setRhythm({ tachycardiaBpm })}
        />
        <ThresholdInput
          id={`${id}-slow`}
          label="Slow below (bpm)"
          value={options.bradycardiaBpm}
          isValid={(value) => value >= 20 && value < options.tachycardiaBpm}
          onChange={(bradycardiaBpm) => setRhythm({ bradycardiaBpm })}
        />
        <span className="pb-2">
          <InfoTip label="About the rate thresholds">{GLOSSARY.rateThresholds}</InfoTip>
        </span>
      </div>

      {flags.length === 0 ? (
        <p className="text-muted-foreground py-4 text-sm">
          No patterns were flagged. The rules look only for fast and slow stretches, pauses,
          premature beats and sustained irregular rhythm.
        </p>
      ) : (
        <ul className="space-y-3">
          {flags.map((flag) => (
            <FlagItem
              key={flag.kind}
              flag={flag}
              options={options}
              beatCount={beatCount}
              onJump={onJump}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
