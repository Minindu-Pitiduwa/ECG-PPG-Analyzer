import { LoaderCircle } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { InfoTip } from '@/components/InfoTip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/field';
import type { SignalKind } from '@/dsp/types';
import { inferSamplingRate, type CsvPreview } from '@/io/csv';
import { ImportError, UNIT_LABELS, type Recording, type SignalUnits } from '@/io/types';
import { checkRecording, samplingRateError } from '@/io/validate';
import { useRecordingStore } from '@/store/recording';
import { runInWorker } from '@/workers/client';
import { estimateFromHead, extractOptions } from './csvDefaults';

/** Above this spread of sample intervals, treating the signal as evenly sampled is questionable. */
const UNEVEN_SAMPLING_JITTER = 0.2;
const NO_TIME_COLUMN = 'none';

interface CsvImportFormProps {
  fileName: string;
  text: string;
  preview: CsvPreview;
  onCancel: () => void;
}

export function CsvImportForm({ fileName, text, preview, onCancel }: CsvImportFormProps) {
  const id = useId();
  const setRecording = useRecordingStore((state) => state.setRecording);

  const [timeColumn, setTimeColumn] = useState(preview.timeColumn);
  const [signalColumn, setSignalColumn] = useState(preview.signalColumn);
  // null means "not edited": the field then follows the suggestion for the chosen columns.
  const [rateInput, setRateInput] = useState<string | null>(null);
  const [kindChoice, setKindChoice] = useState<SignalKind | null>(null);
  const [units, setUnits] = useState<SignalUnits>('mV');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const estimate = useMemo(
    () => estimateFromHead(text, preview, timeColumn, signalColumn),
    [text, preview, timeColumn, signalColumn],
  );

  const rateText = rateInput ?? (estimate.rate ? String(estimate.rate.fs) : '');
  const kind = kindChoice ?? estimate.kind ?? 'ecg';
  const rateProblem = rateText === '' ? null : samplingRateError(Number(rateText));
  const numericColumns = preview.columns.filter((column) => column.numeric);

  const importFile = async () => {
    if (rateText === '') {
      setError('Enter the sampling rate of the recording.');
      return;
    }
    if (rateProblem) return;
    const fs = Number(rateText);
    setBusy(true);
    setError(null);
    try {
      const columns = await runInWorker('extractCsv', {
        text,
        options: extractOptions(preview, timeColumn, signalColumn),
      });
      const warnings = checkRecording(columns.signal, fs, kind);
      if (columns.interpolatedCount > 0) {
        warnings.push(
          `${columns.interpolatedCount} missing or non-numeric value(s) were filled by linear interpolation.`,
        );
      }
      const timing = columns.time ? inferSamplingRate(columns.time) : null;
      if (timing && timing.jitter > UNEVEN_SAMPLING_JITTER) {
        warnings.push(
          'The time column shows uneven sample spacing. The signal is treated as evenly sampled, so timing may be slightly off.',
        );
      }
      const recording: Recording = {
        name: fileName,
        kind,
        fs,
        samples: columns.signal,
        units,
        channel: preview.columns[signalColumn]?.name,
        origin: 'CSV upload',
        warnings,
      };
      setRecording(recording);
    } catch (cause) {
      if (cause instanceof ImportError) {
        setError(cause.message);
      } else {
        console.error(cause);
        setError(
          'Something went wrong while reading this file. Check that it is a plain text CSV.',
        );
      }
      setBusy(false);
    }
  };

  return (
    <Card className="mx-auto max-w-2xl p-5 sm:p-6">
      <h1 className="text-lg font-semibold">Import {fileName}</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Check that the columns were recognized correctly, then import.
      </p>

      <div className="mt-4 overflow-x-auto rounded-md border">
        <table className="w-full text-left text-xs tabular-nums">
          <caption className="sr-only">First rows of the file</caption>
          <thead className="bg-muted">
            <tr>
              {preview.columns.map((column) => (
                <th key={column.index} scope="col" className="px-3 py-2 font-medium">
                  {column.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-t">
                {preview.columns.map((column) => (
                  <td key={column.index} className="px-3 py-1.5">
                    {row[column.index] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form
        className="mt-5 grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void importFile();
        }}
        noValidate
      >
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-signal`}>Signal column</Label>
          <Select
            id={`${id}-signal`}
            value={signalColumn}
            onChange={(event) => setSignalColumn(Number(event.target.value))}
          >
            {numericColumns.map((column) => (
              <option
                key={column.index}
                value={column.index}
                disabled={column.index === timeColumn}
              >
                {column.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1">
            <Label htmlFor={`${id}-time`}>Time column</Label>
            <InfoTip label="About the time column">
              Optional. If the file has timestamps, the sampling rate is worked out from them.
            </InfoTip>
          </div>
          <Select
            id={`${id}-time`}
            value={timeColumn ?? NO_TIME_COLUMN}
            onChange={(event) => {
              const value = event.target.value;
              setTimeColumn(value === NO_TIME_COLUMN ? null : Number(value));
              setRateInput(null);
            }}
          >
            <option value={NO_TIME_COLUMN}>None</option>
            {numericColumns.map((column) => (
              <option
                key={column.index}
                value={column.index}
                disabled={column.index === signalColumn}
              >
                {column.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1">
            <Label htmlFor={`${id}-rate`}>Sampling rate (Hz)</Label>
            <InfoTip label="About the sampling rate">
              How many samples your device records per second. Every time and frequency result
              depends on it, so check your hardware settings if unsure. Typical: 100–1000 Hz for
              ECG, 25–500 Hz for PPG.
            </InfoTip>
          </div>
          <Input
            id={`${id}-rate`}
            type="number"
            inputMode="decimal"
            min={1}
            step="any"
            required
            placeholder="e.g. 250"
            value={rateText}
            onChange={(event) => setRateInput(event.target.value)}
            aria-invalid={rateProblem !== null}
            aria-describedby={`${id}-rate-help`}
          />
          <p
            id={`${id}-rate-help`}
            className={rateProblem ? 'text-danger text-xs' : 'text-muted-foreground text-xs'}
          >
            {rateProblem ??
              (rateInput === null && estimate.rate
                ? `Worked out from the time column (in ${estimate.rate.unit === 'us' ? 'µs' : estimate.rate.unit}).`
                : 'Required.')}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${id}-units`}>Units</Label>
          <Select
            id={`${id}-units`}
            value={units}
            onChange={(event) => setUnits(event.target.value as SignalUnits)}
          >
            {(Object.keys(UNIT_LABELS) as SignalUnits[]).map((unit) => (
              <option key={unit} value={unit}>
                {unit === 'a.u.' ? 'Arbitrary (a.u.)' : UNIT_LABELS[unit]}
              </option>
            ))}
          </Select>
        </div>

        <fieldset className="space-y-1.5 sm:col-span-2">
          <legend className="text-sm font-medium">Signal type</legend>
          <div className="flex gap-4 text-sm">
            {(['ecg', 'ppg'] as const).map((option) => (
              <label key={option} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`${id}-kind`}
                  checked={kind === option}
                  onChange={() => setKindChoice(option)}
                />
                {option === 'ecg' ? 'ECG (electrical)' : 'PPG (optical pulse)'}
              </label>
            ))}
          </div>
          {kindChoice === null && estimate.kind && (
            <p className="text-muted-foreground text-xs">
              Suggested from the data. Change it if this is wrong.
            </p>
          )}
        </fieldset>

        {error && (
          <p role="alert" className="text-danger text-sm sm:col-span-2">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy && <LoaderCircle className="animate-spin" aria-hidden />}
            {busy ? 'Reading file…' : 'Import'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
