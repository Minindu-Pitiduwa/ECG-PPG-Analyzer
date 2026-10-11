import { Braces, FileDown, LoaderCircle, Table } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { decimateMinMax } from '@/dsp/util/decimate';
import { heartRateSeries } from '@/dsp/hrv/heartRate';
import { useAnalysis, type Analysis } from '@/features/analyze/useAnalysis';
import { buildBeatsCsv } from '@/io/export/beatsCsv';
import { UNIT_LABELS, type Recording } from '@/io/types';
import { downloadBlob, fileBaseName } from '@/lib/download';
import { useAnalysisStore } from '@/store/analysis';
import { useBeatEditStore } from '@/store/beats';
import { useSettingsStore } from '@/store/settings';
import { useViewStore } from '@/store/view';
import type { ReportCharts } from './pdf';
import {
  buildReportModel,
  buildSettingsExport,
  type ReportSettings,
  type Row,
} from './reportModel';

/** Points kept for the signal snapshot; twice this many are drawn at most. */
const SNAPSHOT_BUCKETS = 700;

/** Gather the plot data for the PDF: the signal in the main plot's current window, and the trends. */
function buildCharts(
  recording: Recording,
  analysis: Analysis,
  filtered: Float64Array,
): ReportCharts {
  const { fs } = recording;
  const { min, max } = useViewStore.getState();
  const { t, y } = decimateMinMax(filtered, fs, min * fs, max * fs + 1, SNAPSHOT_BUCKETS);
  const trend = heartRateSeries(analysis.beatTimesS);
  return {
    signal: {
      timeS: t,
      values: y,
      fromS: min,
      toS: max,
      units: UNIT_LABELS[recording.units],
      beats: analysis.beats
        .filter((beat) => beat.timeS >= min && beat.timeS <= max)
        .map((beat) => ({
          timeS: beat.timeS,
          value: filtered[Math.min(filtered.length - 1, Math.round(beat.timeS * fs))],
          flagged: beat.flagged,
        })),
    },
    intervals: {
      timeS: trend.timeS,
      bpm: trend.bpm,
      ms: analysis.intervalsMs,
      excluded: analysis.labels.map((label) => label !== 'normal'),
    },
    poincare: analysis.poincare,
    durationS: recording.samples.length / fs,
    rateLabel: recording.kind === 'ecg' ? 'Heart rate' : 'Pulse rate',
  };
}

function Rows({ rows }: { rows: Row[] }) {
  return (
    <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
      {rows.map(([label, value], index) => (
        <div key={`${label}-${index}`} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

interface ReportViewProps {
  recording: Recording;
}

export function ReportView({ recording }: ReportViewProps) {
  const analysis = useAnalysis(recording);
  const filtered = useAnalysisStore((state) => state.filtered);
  const skipped = useAnalysisStore((state) => state.skipped);
  const preprocess = useSettingsStore((state) => state.preprocess);
  const spectralMethod = useSettingsStore((state) => state.spectralMethod);
  const rhythm = useSettingsStore((state) => state.rhythm);
  const beatEdits = useBeatEditStore((state) => state.edits);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settings: ReportSettings = { preprocess, spectralMethod, rhythm, beatEdits };
  // The date only appears in the files; the on-screen summary does not depend on it.
  const model = buildReportModel(recording, analysis, settings, skipped, new Date());
  const baseName = fileBaseName(recording.name);

  const downloadPdf = async () => {
    if (!filtered) return;
    setBusy(true);
    setError(null);
    try {
      const { renderReportPdf } = await import('./pdf');
      const pdf = await renderReportPdf(model, buildCharts(recording, analysis, filtered));
      downloadBlob(pdf, `${baseName}-report.pdf`);
    } catch (cause) {
      console.error(cause);
      setError('The PDF could not be created. The CSV and JSON exports are still available.');
    } finally {
      setBusy(false);
    }
  };

  const downloadCsv = () => {
    const csv = buildBeatsCsv(analysis.beats, analysis.intervalsMs, analysis.labels);
    downloadBlob(new Blob([csv], { type: 'text/csv' }), `${baseName}-beats.csv`);
  };

  const downloadJson = () => {
    const json = JSON.stringify(
      buildSettingsExport(recording, analysis, settings, new Date()),
      null,
      2,
    );
    downloadBlob(new Blob([json], { type: 'application/json' }), `${baseName}-settings.json`);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Card className="space-y-3 p-4 sm:p-5">
        <div>
          <h1 className="text-lg font-semibold">Report</h1>
          <p className="text-muted-foreground text-sm">
            Save the results of this analysis. Files are created in your browser; nothing is
            uploaded.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy || !filtered} onClick={() => void downloadPdf()}>
            {busy ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : (
              <FileDown aria-hidden />
            )}
            Download PDF report
          </Button>
          <Button onClick={downloadCsv}>
            <Table aria-hidden />
            Beats (CSV)
          </Button>
          <Button onClick={downloadJson}>
            <Braces aria-hidden />
            Settings (JSON)
          </Button>
        </div>
        <ul className="text-muted-foreground list-disc space-y-0.5 pl-5 text-xs">
          <li>
            The PDF holds everything below, plus the signal as currently shown in the Analyze step,
            the rate trend, the tachogram and the Poincaré plot.
          </li>
          <li>The CSV lists every beat with its time, interval and whether it was used.</li>
          <li>
            The JSON records all settings and manual edits, so the analysis can be reproduced.
          </li>
        </ul>
        {error && (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-3 p-4 sm:p-5">
          <h2 className="text-sm font-medium">Recording</h2>
          <Rows rows={model.recording} />
        </Card>
        <Card className="space-y-3 p-4 sm:p-5">
          <h2 className="text-sm font-medium">Settings used</h2>
          <Rows rows={model.settings} />
        </Card>
      </div>

      <Card className="space-y-4 p-4 sm:p-5">
        <h2 className="text-sm font-medium">Results</h2>
        <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
          {model.metrics.map(({ group, rows, note }) => (
            <section key={group} className="space-y-1.5">
              <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {group}
              </h3>
              <table className="w-full text-sm">
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.label} className="border-t first:border-t-0">
                      <th scope="row" className="py-1 pr-2 text-left font-normal">
                        {row.label}
                      </th>
                      <td className="py-1 text-right font-medium tabular-nums">{row.value}</td>
                      <td className="text-muted-foreground w-10 py-1 pl-1.5 text-xs">{row.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {note && <p className="text-muted-foreground text-xs">{note}</p>}
            </section>
          ))}
        </div>
      </Card>

      <Card className="space-y-3 p-4 sm:p-5">
        <h2 className="text-sm font-medium">Rhythm flags</h2>
        <p className="text-muted-foreground text-xs">
          Screening hints from simple rules, not a diagnosis.
        </p>
        {model.flags.length === 0 ? (
          <p className="text-sm">No patterns were flagged by the rules.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {model.flags.map((flag) => (
              <li key={flag.title}>
                <span className="font-medium">{flag.title}.</span> {flag.summary}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
