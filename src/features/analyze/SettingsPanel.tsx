import { RotateCcw } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { InfoTip } from '@/components/InfoTip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/field';
import { GLOSSARY } from '@/content/glossary';
import {
  designFilter,
  preprocessOptionsError,
  type BaselineMethod,
  type PreprocessOptions,
} from '@/dsp/filters/preprocess';
import type { Recording } from '@/io/types';
import { useAnalysisStore } from '@/store/analysis';
import { useSettingsStore } from '@/store/settings';
import { FrequencyResponsePlot } from './FrequencyResponsePlot';

const ORDERS = [1, 2, 3, 4];

interface FieldProps {
  id: string;
  label: string;
  tip: string;
  children: React.ReactNode;
}

function Field({ id, label, tip, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <Label htmlFor={id}>{label}</Label>
        <InfoTip label={`About ${label.toLowerCase()}`}>{tip}</InfoTip>
      </div>
      {children}
    </div>
  );
}

interface CutoffInputProps {
  id: string;
  value: number | null;
  /** When true, an empty field means "off" and reports `null`. */
  optional?: boolean;
  disabled?: boolean;
  onChange: (value: number | null) => void;
}

/**
 * A number field that keeps what the user typed while it is not yet a valid
 * number ("0." on the way to "0.5"), and only reports complete values.
 */
function CutoffInput({ id, value, optional = false, disabled, onChange }: CutoffInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === null ? '' : String(value));

  return (
    <Input
      id={id}
      type="number"
      inputMode="decimal"
      min={0}
      step="any"
      disabled={disabled}
      placeholder={optional ? 'Off' : undefined}
      value={shown}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        if (text === '') {
          if (optional) onChange(null);
          return;
        }
        const parsed = Number(text);
        if (Number.isFinite(parsed)) onChange(parsed);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

interface SettingsPanelProps {
  recording: Recording;
}

export function SettingsPanel({ recording }: SettingsPanelProps) {
  const id = useId();
  const options = useSettingsStore((state) => state.preprocess);
  const setPreprocess = useSettingsStore((state) => state.setPreprocess);
  const resetForKind = useSettingsStore((state) => state.resetForKind);
  const skipped = useAnalysisStore((state) => state.skipped);

  const problem = preprocessOptionsError(recording.fs, options);
  // Designed here as well as in the worker: it is instant, and the plot can then follow every keystroke.
  const design = useMemo(
    () => (problem ? null : designFilter(recording.fs, options)),
    [problem, recording.fs, options],
  );

  const set = <Key extends keyof PreprocessOptions>(key: Key, value: PreprocessOptions[Key]) =>
    setPreprocess({ [key]: value });

  return (
    <Card className="space-y-4 p-4" aria-label="Settings">
      <h2 className="text-sm font-medium">Filter settings</h2>

      <Field id={`${id}-mains`} label="Mains hum" tip={GLOSSARY.mains}>
        <Select
          id={`${id}-mains`}
          value={options.notchHz ?? 'off'}
          onChange={(event) => {
            const value = event.target.value;
            set('notchHz', value === 'off' ? null : value === '60' ? 60 : 50);
          }}
        >
          <option value="50">Remove 50 Hz</option>
          <option value="60">Remove 60 Hz</option>
          <option value="off">Off</option>
        </Select>
      </Field>

      <Field id={`${id}-baseline`} label="Baseline drift" tip={GLOSSARY.baseline}>
        <Select
          id={`${id}-baseline`}
          value={options.baseline}
          onChange={(event) => set('baseline', event.target.value as BaselineMethod)}
        >
          <option value="highpass">High-pass filter</option>
          <option value="median">Median filter</option>
          <option value="none">Off</option>
        </Select>
      </Field>

      <details className="group border-t pt-3">
        <summary className="cursor-pointer text-sm font-medium select-none">Advanced</summary>
        <div className="mt-3 space-y-4">
          <Field id={`${id}-highpass`} label="High-pass cutoff (Hz)" tip={GLOSSARY.highpass}>
            <CutoffInput
              id={`${id}-highpass`}
              value={options.highpassHz}
              disabled={options.baseline !== 'highpass'}
              onChange={(value) => value !== null && set('highpassHz', value)}
            />
          </Field>
          <Field id={`${id}-lowpass`} label="Low-pass cutoff (Hz)" tip={GLOSSARY.lowpass}>
            <CutoffInput
              id={`${id}-lowpass`}
              value={options.lowpassHz}
              optional
              onChange={(value) => set('lowpassHz', value)}
            />
          </Field>
          <Field id={`${id}-order`} label="Filter order" tip={GLOSSARY.order}>
            <Select
              id={`${id}-order`}
              value={options.order}
              onChange={(event) => set('order', Number(event.target.value))}
            >
              {ORDERS.map((order) => (
                <option key={order} value={order}>
                  {order}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            variant="ghost"
            className="-ml-2 px-2"
            onClick={() => resetForKind(recording.kind)}
          >
            <RotateCcw aria-hidden />
            Reset to defaults
          </Button>
        </div>
      </details>

      {problem && (
        <p role="alert" className="text-danger text-xs">
          {problem}
        </p>
      )}
      {skipped.map((note) => (
        <p key={note} className="text-muted-foreground text-xs">
          {note}
        </p>
      ))}

      <details className="border-t pt-3">
        <summary className="cursor-pointer text-sm font-medium select-none">
          Filter frequency response
        </summary>
        <div className="mt-2 space-y-1">
          {design && design.sos.length > 0 ? (
            <FrequencyResponsePlot sos={design.sos} fs={recording.fs} notchHz={options.notchHz} />
          ) : (
            <p className="text-muted-foreground text-xs">
              {problem
                ? 'Fix the setting above to see the response.'
                : 'No linear filter is active.'}
            </p>
          )}
          <p className="text-muted-foreground text-xs">
            {GLOSSARY.frequencyResponse}
            {options.baseline === 'median' &&
              ' The median baseline step is not a linear filter, so it is not part of this curve.'}
          </p>
        </div>
      </details>
    </Card>
  );
}
