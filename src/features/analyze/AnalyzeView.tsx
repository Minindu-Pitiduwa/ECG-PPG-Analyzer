import { Maximize2, RotateCcw, TriangleAlert, ZoomIn, ZoomOut } from 'lucide-react';
import { useMemo } from 'react';
import { InfoTip } from '@/components/InfoTip';
import { Minimap } from '@/components/plot/Minimap';
import { SignalPlot } from '@/components/plot/SignalPlot';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { extent } from '@/dsp/util/decimate';
import { UNIT_LABELS, type Recording } from '@/io/types';
import { formatDuration, formatValue } from '@/lib/format';
import { useViewStore } from '@/store/view';

const ZOOM_STEP = 0.5;

interface FactCardProps {
  label: string;
  value: string;
  unit?: string;
  tip: string;
}

function FactCard({ label, value, unit, tip }: FactCardProps) {
  return (
    <Card className="p-4">
      <div className="text-muted-foreground flex items-center justify-between text-xs">
        <span>{label}</span>
        <InfoTip label={`About ${label.toLowerCase()}`}>{tip}</InfoTip>
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums">
        {value}
        {unit && <span className="text-muted-foreground ml-1 text-sm font-normal">{unit}</span>}
      </p>
    </Card>
  );
}

interface AnalyzeViewProps {
  recording: Recording;
}

export function AnalyzeView({ recording }: AnalyzeViewProps) {
  const { samples, fs, units } = recording;
  const zoom = useViewStore((state) => state.zoom);
  const reset = useViewStore((state) => state.reset);
  const showAll = useViewStore((state) => state.showAll);
  const [lo, hi] = useMemo(() => extent(samples), [samples]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">{recording.name}</h1>
        <p className="text-muted-foreground text-sm">
          {recording.kind.toUpperCase()}
          {recording.channel && ` · ${recording.channel}`} · {recording.origin}
        </p>
      </div>

      {recording.warnings.length > 0 && (
        <div
          role="status"
          className="bg-warning-bg text-warning-fg flex gap-2 rounded-md p-3 text-sm"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <ul className="space-y-1">
            {recording.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <Card className="space-y-2 p-3 sm:p-4">
        <div className="flex items-center gap-1">
          <h2 className="mr-auto text-sm font-medium">Signal</h2>
          <Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => zoom(ZOOM_STEP)}>
            <ZoomIn aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Zoom out"
            onClick={() => zoom(1 / ZOOM_STEP)}
          >
            <ZoomOut aria-hidden />
          </Button>
          {/* Labels collapse to icons on narrow screens; the accessible name stays the same. */}
          <Button
            variant="ghost"
            className="px-2.5 sm:px-4"
            aria-label="Show all"
            onClick={showAll}
          >
            <Maximize2 aria-hidden />
            <span className="hidden sm:inline">Show all</span>
          </Button>
          <Button
            variant="ghost"
            className="px-2.5 sm:px-4"
            aria-label="Reset view"
            onClick={reset}
          >
            <RotateCcw aria-hidden />
            <span className="hidden sm:inline">Reset view</span>
          </Button>
        </div>
        <SignalPlot recording={recording} />
        <Minimap recording={recording} />
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <FactCard
          label="Duration"
          value={formatDuration(samples.length / fs)}
          tip="Length of the recording. Heart rate variability needs at least 2 minutes; 5 minutes is the standard for short-term analysis."
        />
        <FactCard
          label="Sampling rate"
          value={String(fs)}
          unit="Hz"
          tip="Samples per second. Beat timing can be no more precise than one sample, so 250 Hz or more is preferred for variability analysis."
        />
        <FactCard
          label="Samples"
          value={samples.length.toLocaleString('en-US')}
          tip="Total number of data points. Analysis always uses all of them; only the plot is thinned for drawing."
        />
        <FactCard
          label="Amplitude range"
          value={`${formatValue(lo)} to ${formatValue(hi)}`}
          unit={UNIT_LABELS[units]}
          tip="Smallest and largest value in the recording. A range stuck at a limit of your ADC suggests clipping."
        />
      </div>
    </div>
  );
}
