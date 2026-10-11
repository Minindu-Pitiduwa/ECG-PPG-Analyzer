import {
  LoaderCircle,
  Maximize2,
  Pencil,
  RotateCcw,
  SlidersHorizontal,
  TriangleAlert,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { InfoTip } from '@/components/InfoTip';
import { Minimap } from '@/components/plot/Minimap';
import { SignalPlot, type PlotClick, type PlotTrace } from '@/components/plot/SignalPlot';
import { TrendPlot } from '@/components/plot/TrendPlot';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { GLOSSARY } from '@/content/glossary';
import { snapToPeak } from '@/dsp/detect/edits';
import { beatIntervalsMs, heartRateSeries, heartRateStats } from '@/dsp/hrv/heartRate';
import type { Recording } from '@/io/types';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { useAnalysisStore } from '@/store/analysis';
import { useBeatEditStore, useBeats } from '@/store/beats';
import { useViewStore } from '@/store/view';
import { SettingsPanel } from './SettingsPanel';

const ZOOM_STEP = 0.5;
/** Tailwind's `lg` breakpoint: from here up there is room for the settings beside the plot. */
const WIDE_SCREEN = '(min-width: 1024px)';
/** A click this close to a marker, in screen pixels, is aimed at that marker. */
const MARKER_HIT_PX = 10;

type ViewMode = 'filtered' | 'raw' | 'both';

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: 'filtered', label: 'Filtered' },
  { id: 'raw', label: 'Raw' },
  { id: 'both', label: 'Both' },
];

interface MetricCardProps {
  label: string;
  value: string;
  unit?: string;
  tip: string;
}

function MetricCard({ label, value, unit, tip }: MetricCardProps) {
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

const formatBpm = (bpm: number) => (Number.isFinite(bpm) ? bpm.toFixed(0) : '–');

interface AnalyzeViewProps {
  recording: Recording;
}

export function AnalyzeView({ recording }: AnalyzeViewProps) {
  const { samples, fs, units, kind } = recording;
  const durationS = samples.length / fs;
  const zoom = useViewStore((state) => state.zoom);
  const reset = useViewStore((state) => state.reset);
  const showAll = useViewStore((state) => state.showAll);
  const filtered = useAnalysisStore((state) => state.filtered);
  const polarity = useAnalysisStore((state) => state.polarity);
  const analyzing = useAnalysisStore((state) => state.status === 'running');
  const beats = useBeats();
  const editCount = useBeatEditStore((state) => state.edits.length);
  const undo = useBeatEditStore((state) => state.undo);
  const [viewMode, setViewMode] = useState<ViewMode>('filtered');
  const [editing, setEditing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(() => window.matchMedia(WIDE_SCREEN).matches);

  // Until the first analysis finishes there is only the raw signal to show.
  const traces = useMemo((): PlotTrace[] => {
    const raw: PlotTrace = { samples, color: 'raw' };
    if (!filtered || viewMode === 'raw') return [{ samples, color: 'signal' }];
    const clean: PlotTrace = { samples: filtered, color: 'signal' };
    return viewMode === 'both' ? [raw, clean] : [clean];
  }, [samples, filtered, viewMode]);

  const beatTimes = useMemo(() => beats.map((beat) => beat.timeS), [beats]);
  const heartRate = useMemo(() => heartRateStats(beatIntervalsMs(beatTimes)), [beatTimes]);
  const trend = useMemo(() => heartRateSeries(beatTimes), [beatTimes]);
  const rateName = kind === 'ecg' ? 'heart rate' : 'pulse rate';

  const onPlotClick = useCallback(
    ({ timeS, secondsPerPixel }: PlotClick) => {
      if (!editing || !filtered) return;
      const { addBeat, removeBeat } = useBeatEditStore.getState();
      const nearest = beats.reduce<number | null>(
        (best, beat) =>
          best === null || Math.abs(beat.timeS - timeS) < Math.abs(best - timeS)
            ? beat.timeS
            : best,
        null,
      );
      if (nearest !== null && Math.abs(nearest - timeS) <= MARKER_HIT_PX * secondsPerPixel) {
        removeBeat(nearest);
      } else {
        addBeat(snapToPeak(filtered, fs, timeS, polarity));
      }
    },
    [editing, filtered, beats, fs, polarity],
  );

  useEffect(() => {
    if (!editing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing, undo]);

  const jumpTo = useCallback((timeS: number) => {
    const view = useViewStore.getState();
    const half = (view.max - view.min) / 2;
    view.setView(timeS - half, timeS + half);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">{recording.name}</h1>
          <p className="text-muted-foreground text-sm">
            {kind.toUpperCase()}
            {recording.channel && ` · ${recording.channel}`} · {formatDuration(durationS)} · {fs} Hz
            · {recording.origin}
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
          <Card className={cn('space-y-2 p-3 sm:p-4', editing && 'editing-beats')}>
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
              {analyzing && (
                <span
                  role="status"
                  className="text-muted-foreground flex items-center gap-1 text-xs"
                >
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                  Analyzing…
                </span>
              )}
              <div className="ml-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  aria-pressed={editing}
                  className={cn('px-2.5 sm:px-3', editing && 'bg-muted')}
                  onClick={() => setEditing((on) => !on)}
                >
                  <Pencil aria-hidden />
                  Edit beats
                </Button>
                <InfoTip label="About editing beats">{GLOSSARY.editBeats}</InfoTip>
                {(editing || editCount > 0) && (
                  <Button
                    variant="ghost"
                    className="px-2.5 sm:px-3"
                    disabled={editCount === 0}
                    onClick={undo}
                  >
                    <Undo2 aria-hidden />
                    Undo
                  </Button>
                )}
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
                <Button variant="ghost" size="icon" aria-label="Show all" onClick={showAll}>
                  <Maximize2 aria-hidden />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Reset view" onClick={reset}>
                  <RotateCcw aria-hidden />
                </Button>
              </div>
            </div>
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              {viewMode === 'both' && filtered && (
                <span className="flex items-center gap-1">
                  <span className="h-0.5 w-4 bg-(--raw)" aria-hidden /> Raw
                </span>
              )}
              <span className="flex items-center gap-1">
                <span className="h-0.5 w-4 bg-(--signal)" aria-hidden />{' '}
                {viewMode === 'raw' ? 'Raw' : 'Filtered'}
              </span>
              <span className="flex items-center gap-1">
                <span className="bg-beat size-2 rounded-full" aria-hidden /> Detected beat
              </span>
              {editCount > 0 && (
                <span className="flex items-center gap-1">
                  <span className="border-beat size-2 rounded-full border-2" aria-hidden /> Added by
                  hand
                </span>
              )}
              {editing && (
                <span role="status" className="text-foreground">
                  Editing: click a marker to remove it, or a peak to add a beat.
                </span>
              )}
            </div>
            <SignalPlot traces={traces} fs={fs} units={units} beats={beats} onClick={onPlotClick} />
            <Minimap samples={traces[traces.length - 1].samples} fs={fs} />
          </Card>

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <MetricCard
              label={`Mean ${rateName}`}
              value={formatBpm(heartRate.meanBpm)}
              unit="bpm"
              tip={GLOSSARY.meanHeartRate}
            />
            <MetricCard
              label={`Lowest ${rateName}`}
              value={formatBpm(heartRate.minBpm)}
              unit="bpm"
              tip={GLOSSARY.minHeartRate}
            />
            <MetricCard
              label={`Highest ${rateName}`}
              value={formatBpm(heartRate.maxBpm)}
              unit="bpm"
              tip={GLOSSARY.maxHeartRate}
            />
            <MetricCard
              label="Beats"
              value={beats.length.toLocaleString('en-US')}
              tip={GLOSSARY.beatCount}
            />
          </div>

          <Card className="space-y-2 p-3 sm:p-4">
            <div className="flex items-center gap-1">
              <h2 className="text-sm font-medium">
                {kind === 'ecg' ? 'Heart rate' : 'Pulse rate'} over time
              </h2>
              <InfoTip label={`About the ${rateName} trend`}>{GLOSSARY.heartRateTrend}</InfoTip>
            </div>
            {trend.bpm.length >= 2 ? (
              <TrendPlot
                timeS={trend.timeS}
                values={trend.bpm}
                durationS={durationS}
                yLabel="bpm"
                ariaLabel={`${rateName} in beats per minute over the recording`}
                onSelectTime={jumpTo}
              />
            ) : (
              <p className="text-muted-foreground py-6 text-center text-sm">
                {analyzing
                  ? 'Looking for beats…'
                  : 'Not enough beats were found to draw a trend. Check the filter settings, or add beats by hand.'}
              </p>
            )}
          </Card>
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
