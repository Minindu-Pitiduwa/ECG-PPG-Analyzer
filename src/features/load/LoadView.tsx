import { HeartPulse, LoaderCircle, Upload, Waves } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { sniffCsv, type CsvPreview } from '@/io/csv';
import { listSamples, loadSample, type SampleInfo } from '@/io/samples';
import { ImportError } from '@/io/types';
import { parseWfdbHeader } from '@/io/wfdb';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { useRecordingStore } from '@/store/recording';
import { CsvImportForm } from './CsvImportForm';
import { WfdbImportForm, type PendingWfdb } from './WfdbImportForm';

/** Far beyond a 30-minute recording; a larger file is almost certainly the wrong file. */
const MAX_FILE_BYTES = 200 * 1024 * 1024;

interface PendingCsv {
  fileName: string;
  text: string;
  preview: CsvPreview;
}

function messageFor(cause: unknown, fallback: string): string {
  if (cause instanceof ImportError) return cause.message;
  console.error(cause);
  return fallback;
}

export function LoadView() {
  const setRecording = useRecordingStore((state) => state.setRecording);
  const [samples, setSamples] = useState<SampleInfo[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [pendingCsv, setPendingCsv] = useState<PendingCsv | null>(null);
  const [pendingWfdb, setPendingWfdb] = useState<PendingWfdb | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listSamples()
      .then((list) => {
        if (!cancelled) setSamples(list);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageFor(cause, 'Could not load the list of samples.'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openSample = async (info: SampleInfo) => {
    setLoadingId(info.id);
    setError(null);
    try {
      setRecording(await loadSample(info));
    } catch (cause) {
      setError(messageFor(cause, 'Could not load the sample.'));
      setLoadingId(null);
    }
  };

  const openCsv = async (file: File) => {
    const text = await file.text();
    setPendingCsv({ fileName: file.name, text, preview: sniffCsv(text) });
  };

  /** A WFDB record is a text header plus the binary file(s) it names; both must be chosen together. */
  const openWfdb = async (headerFile: File, files: File[]) => {
    const header = parseWfdbHeader(await headerFile.text());
    const dataFiles = new Map<string, ArrayBuffer>();
    for (const file of files) {
      if (header.signals.some((signal) => signal.fileName === file.name)) {
        dataFiles.set(file.name, await file.arrayBuffer());
      }
    }
    if (dataFiles.size === 0) {
      const needed = [...new Set(header.signals.map((signal) => signal.fileName))].join(' or ');
      throw new ImportError(
        `A WFDB header needs its data file. Select ${headerFile.name} and ${needed} together (hold Ctrl or Cmd to pick both).`,
      );
    }
    setPendingWfdb({ header, dataFiles });
  };

  const openFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    setError(null);
    if (files.some((file) => file.size === 0)) {
      setError('The file is empty.');
      return;
    }
    if (files.some((file) => file.size > MAX_FILE_BYTES)) {
      setError('This file is larger than 200 MB. Export a shorter section and try again.');
      return;
    }
    const headerFile = files.find((file) => file.name.toLowerCase().endsWith('.hea'));
    try {
      if (headerFile) {
        await openWfdb(headerFile, files);
      } else if (files.every((file) => file.name.toLowerCase().endsWith('.dat'))) {
        throw new ImportError(
          'A WFDB .dat file cannot be read on its own. Select it together with its .hea header file.',
        );
      } else {
        await openCsv(files[0]);
      }
    } catch (cause) {
      setError(
        messageFor(cause, 'Could not read this file. Check that it is a CSV or a WFDB record.'),
      );
    }
  };

  if (pendingWfdb) {
    return <WfdbImportForm {...pendingWfdb} onCancel={() => setPendingWfdb(null)} />;
  }
  if (pendingCsv) {
    return <CsvImportForm {...pendingCsv} onCancel={() => setPendingCsv(null)} />;
  }

  const firstEcg = samples.find((sample) => sample.kind === 'ecg');
  const firstPpg = samples.find((sample) => sample.kind === 'ppg');
  const busy = loadingId !== null;

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-4 sm:py-8">
      <section className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Look inside a heartbeat recording
        </h1>
        <p className="text-muted-foreground mx-auto mt-3 max-w-xl">
          PulseScope cleans an ECG or PPG signal, finds each heartbeat, and measures heart rate and
          its variability. Everything runs in your browser; your data never leaves this computer.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button
            variant="primary"
            size="lg"
            disabled={!firstEcg || busy}
            onClick={() => firstEcg && void openSample(firstEcg)}
          >
            {loadingId === firstEcg?.id ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : (
              <HeartPulse aria-hidden />
            )}
            Try a sample ECG
          </Button>
          <Button
            size="lg"
            disabled={!firstPpg || busy}
            onClick={() => firstPpg && void openSample(firstPpg)}
          >
            {loadingId === firstPpg?.id ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : (
              <Waves aria-hidden />
            )}
            Try a sample PPG
          </Button>
        </div>
      </section>

      {error && (
        <p role="alert" className="text-danger text-center text-sm">
          {error}
        </p>
      )}

      <section aria-labelledby="upload-heading">
        <h2 id="upload-heading" className="text-sm font-medium">
          Use your own recording
        </h2>
        <label
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void openFiles(event.dataTransfer.files);
          }}
          className={cn(
            'bg-card mt-2 flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed p-6 text-center',
            'hover:bg-muted has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-(--ring)',
            dragging && 'border-primary bg-muted',
          )}
        >
          <Upload className="text-muted-foreground size-5" aria-hidden />
          <span className="text-sm font-medium">Drop a file here, or click to choose one</span>
          <span className="text-muted-foreground text-xs">
            CSV with one column of samples (a time column is optional), or a PhysioNet WFDB record:
            select the .hea and .dat files together.
          </span>
          <input
            type="file"
            multiple
            accept=".csv,.tsv,.txt,.hea,.dat,text/csv,text/plain"
            className="sr-only"
            onChange={(event) => {
              void openFiles(event.target.files);
              event.target.value = ''; // allow choosing the same file again
            }}
          />
        </label>
      </section>

      {samples.length > 0 && (
        <section aria-labelledby="samples-heading">
          <h2 id="samples-heading" className="text-sm font-medium">
            All sample recordings
          </h2>
          <ul className="mt-2 grid gap-3 sm:grid-cols-2">
            {samples.map((sample) => (
              <li key={sample.id}>
                <Card className="h-full p-0">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void openSample(sample)}
                    className="hover:bg-muted size-full rounded-lg p-4 text-left disabled:opacity-60"
                  >
                    <span className="text-sm font-medium">{sample.title}</span>
                    <span className="text-muted-foreground mt-1 block text-xs">
                      {sample.description}
                    </span>
                    <span className="text-muted-foreground mt-2 block text-xs">
                      {formatDuration(sample.length / sample.fs)} · {sample.fs} Hz
                    </span>
                  </button>
                </Card>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground mt-3 text-xs">
            Samples are excerpts from the MIT-BIH Arrhythmia Database and the BIDMC PPG and
            Respiration Dataset on PhysioNet, used under the Open Data Commons Attribution License
            v1.0.
          </p>
        </section>
      )}
    </div>
  );
}
