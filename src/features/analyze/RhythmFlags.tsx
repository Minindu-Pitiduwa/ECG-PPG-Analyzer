import { useId, useState } from 'react';
import { InfoTip } from '@/components/InfoTip';
import { Input, Label } from '@/components/ui/field';
import { FLAG_TITLES, GLOSSARY } from '@/content/glossary';
import type { FlagLocation, RhythmFlag, RhythmOptions } from '@/dsp/rhythm/flags';
import { formatTime } from '@/lib/format';
import { useSettingsStore } from '@/store/settings';
import { flagMethod, flagSummary } from './flagText';

/** Locations listed before the rest are folded behind a "show all" button. */
const LOCATIONS_SHOWN = 12;

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
      <p className="text-sm">{flagSummary(flag, options, beatCount)}</p>
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
        <p className="mt-1">{flagMethod(flag.kind, options)}</p>
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
