import {
  LoaderCircle,
  Maximize2,
  RotateCcw,
  SlidersHorizontal,
  TriangleAlert,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { InfoTip } from '@/components/InfoTip';
import { Minimap } from '@/components/plot/Minimap';
import { SignalPlot, type PlotTrace } from '@/components/plot/SignalPlot';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { GLOSSARY } from '@/content/glossary';
import { extent } from '@/dsp/util/decimate';
import { UNIT_LABELS, type Recording } from '@/io/types';
import { cn } from '@/lib/cn';
import { formatDuration, formatValue } from '@/lib/format';
import { useAnalysisStore } from '@/store/analysis';
import { useViewStore } from '@/store/view';
import { SettingsPanel } from './SettingsPanel';

const ZOOM_STEP = 0.5;
/** Tailwind's `lg` breakpoint: from here up there is room for the settings beside the plot. */
const WIDE_SCREEN = '(min-width: 1024px)';

type ViewMode = 'filtered' | 'raw' | 'both';

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: 'filtered', label: 'Filtered' },
  { id: 'raw', label: 'Raw' },
  { id: 'both', label: 'Both' },
];

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
  const filtered = useAnalysisStore((state) => state.filtered);
  const filtering = useAnalysisStore((state) => state.status === 'running');
  const [viewMode, setViewMode] = useState<ViewMode>('filtered');
  const [settingsOpen, setSettingsOpen] = useState(() => window.matchMedia(WIDE_SCREEN).matches);
  const [lo, hi] = useMemo(() => extent(samples), [samples]);

  // Until the first filter run finishes there is only the raw signal to show.
  const traces = useMemo((): PlotTrace[] => {
    const raw: PlotTrace = { samples, color: 'raw' };
    if (!filtered || viewMode === 'raw') return [{ samples, color: 'signal' }];
    const clean: PlotTrace = { samples: filtered, color: 'signal' };
    return viewMode === 'both' ? [raw, clean] : [clean];
  }, [samples, filtered, viewMode]);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">{recording.name}</h1>
          <p className="text-muted-foreground text-sm">
            {recording.kind.toUpperCase()}
            {recording.channel && ` · ${recording.channel}`} · {recording.origin}
          </p>
        </div>
        <Button
          aria-expanded={settingsOpen}
          aria-controls="settings-panel"
          onClick={() => setSettingsOpen((open) => !open)}
        >
          <SlidersHorizontal aria-hidden />
          Settings
        </Button>
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

      <div className={cn('grid gap-4', settingsOpen && 'lg:grid-cols-[minmax(0,1fr)_18rem]')}>
        <div className="min-w-0 space-y-4">
          <Card className="space-y-2 p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-1">
              <div
                role="radiogroup"
                aria-label="Signal shown"
                className="bg-muted flex rounded-md p-0.5 text-sm"
              >
                {VIEW_MODES.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={viewMode === id}
                    onClick={() => setViewMode(id)}
                    className={cn(
                      'rounded px-3 py-1',
                      viewMode === id ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <InfoTip label="About the signal views">{GLOSSARY.viewMode}</InfoTip>
              {viewMode === 'both' && filtered && (
                <span className="text-muted-foreground ml-1 flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1">
                    <span className="h-0.5 w-4 bg-(--raw)" aria-hidden /> Raw
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-0.5 w-4 bg-(--signal)" aria-hidden /> Filtered
                  </span>
                </span>
              )}
              {filtering && (
                <span
                  role="status"
                  className="text-muted-foreground flex items-center gap-1 text-xs"
                >
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                  Filtering…
                </span>
              )}
              <div className="ml-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Zoom in"
                  onClick={() => zoom(ZOOM_STEP)}
                >
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
            </div>
            <SignalPlot traces={traces} fs={fs} units={units} />
            <Minimap samples={traces[traces.length - 1].samples} fs={fs} />
          </Card>

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <FactCard
              label="Duration"
              value={formatDuration(samples.length / fs)}
              tip={GLOSSARY.duration}
            />
            <FactCard
              label="Sampling rate"
              value={String(fs)}
              unit="Hz"
              tip={GLOSSARY.samplingRate}
            />
            <FactCard
              label="Samples"
              value={samples.length.toLocaleString('en-US')}
              tip={GLOSSARY.sampleCount}
            />
            <FactCard
              label="Raw amplitude range"
              value={`${formatValue(lo)} to ${formatValue(hi)}`}
              unit={UNIT_LABELS[units]}
              tip={GLOSSARY.amplitudeRange}
            />
          </div>
        </div>

        {settingsOpen && (
          <aside id="settings-panel">
            <SettingsPanel recording={recording} />
          </aside>
        )}
      </div>
    </div>
  );
}
