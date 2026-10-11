import { useId, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label, Select } from '@/components/ui/field';
import type { SignalKind } from '@/dsp/types';
import { guessSignalKind } from '@/dsp/util/guessKind';
import { ImportError, type Recording } from '@/io/types';
import { checkRecording } from '@/io/validate';
import { decodeWfdbSignal, type WfdbHeader } from '@/io/wfdb';
import { formatDuration } from '@/lib/format';
import { useRecordingStore } from '@/store/recording';

const PPG_NAME = /ppg|pleth|spo2/i;

export interface PendingWfdb {
  header: WfdbHeader;
  /** Contents of the selected data files, by file name. */
  dataFiles: Map<string, ArrayBuffer>;
}

interface WfdbImportFormProps extends PendingWfdb {
  onCancel: () => void;
}

interface Decoded {
  samples: Float64Array | null;
  error: string | null;
}

export function WfdbImportForm({ header, dataFiles, onCancel }: WfdbImportFormProps) {
  const id = useId();
  const setRecording = useRecordingStore((state) => state.setRecording);
  const hasData = (index: number) => dataFiles.has(header.signals[index].fileName);
  const [signalIndex, setSignalIndex] = useState(() =>
    Math.max(
      0,
      header.signals.findIndex((_, i) => hasData(i)),
    ),
  );
  const [kindChoice, setKindChoice] = useState<SignalKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const signal = header.signals[signalIndex];

  // Decoding a lead takes milliseconds, so it is done as soon as one is chosen:
  // problems show up at once and the signal type can be suggested from the data.
  const decoded = useMemo((): Decoded => {
    const data = dataFiles.get(signal.fileName);
    if (!data)
      return { samples: null, error: `Select ${signal.fileName} together with the header.` };
    try {
      return { samples: decodeWfdbSignal(header, data, signalIndex), error: null };
    } catch (cause) {
      if (cause instanceof ImportError) return { samples: null, error: cause.message };
      console.error(cause);
      return { samples: null, error: 'This data file could not be read.' };
    }
  }, [header, dataFiles, signal.fileName, signalIndex]);

  const suggestedKind = useMemo((): SignalKind | null => {
    if (PPG_NAME.test(signal.description)) return 'ppg';
    return decoded.samples ? guessSignalKind(decoded.samples, header.fs) : null;
  }, [signal.description, decoded.samples, header.fs]);
  const kind = kindChoice ?? suggestedKind ?? 'ecg';

  const importSignal = () => {
    if (!decoded.samples) return;
    try {
      const recording: Recording = {
        name: `${header.recordName} · ${signal.description}`,
        kind,
        fs: header.fs,
        samples: decoded.samples,
        units: signal.units === 'mV' ? 'mV' : 'a.u.',
        channel: signal.description,
        origin: 'WFDB upload',
        warnings: checkRecording(decoded.samples, header.fs, kind),
      };
      setRecording(recording);
    } catch (cause) {
      if (cause instanceof ImportError) setError(cause.message);
      else throw cause;
    }
  };

  const problem = decoded.error ?? error;

  return (
    <Card className="mx-auto max-w-2xl p-5 sm:p-6">
      <h1 className="text-lg font-semibold">Import WFDB record {header.recordName}</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        {header.signals.length} signal{header.signals.length === 1 ? '' : 's'} at {header.fs} Hz
        {decoded.samples && `, ${formatDuration(decoded.samples.length / header.fs)} long`}. Choose
        the one to analyze.
      </p>

      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          importSignal();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-lead`}>Signal</Label>
          <Select
            id={`${id}-lead`}
            value={signalIndex}
            onChange={(event) => {
              setSignalIndex(Number(event.target.value));
              setError(null);
            }}
          >
            {header.signals.map((entry, index) => (
              <option key={index} value={index} disabled={!hasData(index)}>
                {entry.description} ({entry.units}){!hasData(index) && ` – needs ${entry.fileName}`}
              </option>
            ))}
          </Select>
        </div>

        <fieldset className="space-y-1.5">
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
          {kindChoice === null && suggestedKind && (
            <p className="text-muted-foreground text-xs">
              Suggested from the signal. Change it if this is wrong.
            </p>
          )}
        </fieldset>

        {problem && (
          <p role="alert" className="text-danger text-sm">
            {problem}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!decoded.samples}>
            Import
          </Button>
        </div>
      </form>
    </Card>
  );
}
