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
import { Tabs } from 'radix-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InfoTip } from '@/components/InfoTip';
import { MetricCard } from '@/components/MetricCard';
import { Minimap } from '@/components/plot/Minimap';
import { SignalPlot, type PlotClick, type PlotTrace } from '@/components/plot/SignalPlot';
import { TrendPlot } from '@/components/plot/TrendPlot';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FLAG_TITLES, GLOSSARY } from '@/content/glossary';
import { snapToPeak } from '@/dsp/detect/edits';
import { heartRateSeries } from '@/dsp/hrv/heartRate';
import type { FlagLocation } from '@/dsp/rhythm/flags';
import type { Recording } from '@/io/types';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { useAnalysisStore } from '@/store/analysis';
import { useBeatEditStore } from '@/store/beats';
import { useViewStore } from '@/store/view';
import { HrvDetails } from './HrvDetails';
import { NoiseLab } from './NoiseLab';
import { RhythmFlags } from './RhythmFlags';
import { SettingsPanel } from './SettingsPanel';
import { useAnalysis } from './useAnalysis';

const ZOOM_STEP = 0.5;
/** Time shown on each side of a flagged location when jumping to it, and the least time shown in all. */
const JUMP_MARGIN_S = 2;
const JUMP_MIN_SPAN_S = 8;
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

const formatBpm = (bpm: number) => (Number.isFinite(bpm) ? bpm.toFixed(0) : '–');
const formatMs = (ms: number) => (Number.isFinite(ms) ? ms.toFixed(0) : '–');

const TAB_CLASS =
  'text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-foreground -mb-px border-b-2 border-transparent px-3 py-2 text-sm data-[state=active]:font-medium';

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
  const analysis = useAnalysis(recording);
  const { beats, beatTimesS, heartRate, timeDomain, exclusions, flags } = analysis;
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

  const trend = useMemo(() => heartRateSeries(beatTimesS), [beatTimesS]);
  const intervalFlags = useMemo(
    () => analysis.labels.map((label) => label !== 'normal'),
    [analysis.labels],
  );
  const intervalTimes = trend.timeS;
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

  const plotCardRef = useRef<HTMLDivElement>(null);
  const jumpToLocation = useCallback((location: FlagLocation) => {
    const center = (location.startS + location.endS) / 2;
    const half = Math.max(JUMP_MIN_SPAN_S, location.endS - location.startS + 2 * JUMP_MARGIN_S) / 2;
    useViewStore.getState().setView(center - half, center + half);
    // The flags sit below the plot; bring the plot back into view so the jump is seen.
    plotCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
          <Card
            ref={plotCardRef}
            className={cn('space-y-2 p-3 sm:p-4', editing && 'editing-beats')}
          >
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
                <span className="bg-beat size-2 rounded-full" aria-hidden /> Beat
              </span>
              {beats.some((beat) => beat.flagged) && (
                <span className="flex items-center gap-1">
                  <span className="bg-flagged size-2 rounded-full" aria-hidden /> Early or
                  implausible beat
                </span>
              )}
              {analysis.lowQualitySpans.length > 0 && (
                <span className="flex items-center gap-1">
                  <span className="bg-low-quality/40 h-3 w-4 rounded-sm" aria-hidden /> Low signal
                  quality
                </span>
              )}
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
            <SignalPlot
              traces={traces}
              fs={fs}
              units={units}
              beats={beats}
              lowQuality={analysis.lowQualitySpans}
              onClick={onPlotClick}
            />
            <Minimap samples={traces[traces.length - 1].samples} fs={fs} />
          </Card>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <MetricCard
              label={`Mean ${rateName}`}
              value={formatBpm(heartRate.meanBpm)}
              unit="bpm"
              detail={
                Number.isFinite(heartRate.minBpm)
                  ? `Range ${formatBpm(heartRate.minBpm)}–${formatBpm(heartRate.maxBpm)} bpm`
                  : undefined
              }
              tip={GLOSSARY.meanHeartRate}
            />
            <MetricCard
              label="SDNN"
              value={formatMs(timeDomain.sdnn)}
              unit="ms"
              tip={GLOSSARY.sdnn}
            />
            <MetricCard
              label="RMSSD"
              value={formatMs(timeDomain.rmssd)}
              unit="ms"
              tip={GLOSSARY.rmssd}
            />
            <MetricCard
              label="Signal quality"
              value={
                Number.isFinite(analysis.goodFraction)
                  ? (100 * analysis.goodFraction).toFixed(0)
                  : '–'
              }
              unit="% good"
              detail={
                analysis.lowQualitySpans.length > 0
                  ? `${analysis.lowQualitySpans.length} of ${analysis.quality.length} segments low`
                  : undefined
              }
              tip={GLOSSARY.signalQuality}
            />
            <MetricCard
              label="Beats"
              value={beats.length.toLocaleString('en-US')}
              detail={`${exclusions.excluded} interval${exclusions.excluded === 1 ? '' : 's'} excluded`}
              tip={`${GLOSSARY.beatCount} ${GLOSSARY.excluded}`}
            />
            <MetricCard
              label="Rhythm flags"
              value={String(flags.length)}
              detail={
                flags.length > 0
                  ? flags.map((flag) => FLAG_TITLES[flag.kind]).join(', ')
                  : 'None raised'
              }
              tip={GLOSSARY.flagCount}
            />
          </div>

          <Card className="p-3 sm:p-4">
            <Tabs.Root defaultValue="rate">
              <Tabs.List
                className="mb-4 flex overflow-x-auto border-b whitespace-nowrap"
                aria-label="Analysis details"
              >
                <Tabs.Trigger value="rate" className={TAB_CLASS}>
                  {kind === 'ecg' ? 'Heart rate' : 'Pulse rate'}
                </Tabs.Trigger>
                <Tabs.Trigger value="hrv" className={TAB_CLASS}>
                  HRV details
                </Tabs.Trigger>
                <Tabs.Trigger value="flags" className={TAB_CLASS}>
                  Rhythm flags{flags.length > 0 && ` (${flags.length})`}
                </Tabs.Trigger>
                <Tabs.Trigger value="noise" className={TAB_CLASS}>
                  Noise lab
                </Tabs.Trigger>
              </Tabs.List>

              <Tabs.Content value="rate" className="space-y-5">
                {trend.bpm.length >= 2 ? (
                  <>
                    <section className="space-y-1">
                      <div className="flex items-center gap-1">
                        <h3 className="text-sm font-medium">
                          {kind === 'ecg' ? 'Heart rate' : 'Pulse rate'} over time
                        </h3>
                        <InfoTip label={`About the ${rateName} trend`}>
                          {GLOSSARY.heartRateTrend}
                        </InfoTip>
                      </div>
                      <TrendPlot
                        timeS={intervalTimes}
                        values={trend.bpm}
                        durationS={durationS}
                        yLabel="bpm"
                        ariaLabel={`${rateName} in beats per minute over the recording`}
                        flagged={intervalFlags}
                        onSelectTime={jumpTo}
                      />
                    </section>
                    <section className="space-y-1">
                      <div className="flex items-center gap-1">
                        <h3 className="text-sm font-medium">Beat-to-beat intervals (tachogram)</h3>
                        <InfoTip label="About the tachogram">{GLOSSARY.tachogram}</InfoTip>
                      </div>
                      <TrendPlot
                        timeS={intervalTimes}
                        values={analysis.intervalsMs}
                        durationS={durationS}
                        yLabel="ms"
                        ariaLabel="Beat-to-beat intervals in milliseconds over the recording"
                        flagged={intervalFlags}
                        onSelectTime={jumpTo}
                      />
                    </section>
                  </>
                ) : (
                  <p className="text-muted-foreground py-6 text-center text-sm">
                    {analyzing
                      ? 'Looking for beats…'
                      : 'Not enough beats were found to draw a trend. Check the filter settings, or add beats by hand.'}
                  </p>
                )}
              </Tabs.Content>

              <Tabs.Content value="hrv">
                <HrvDetails analysis={analysis} kind={kind} />
              </Tabs.Content>

              <Tabs.Content value="flags">
                <RhythmFlags flags={flags} beatCount={beats.length} onJump={jumpToLocation} />
              </Tabs.Content>

              <Tabs.Content value="noise">
                <NoiseLab recording={recording} referenceBeatsS={beatTimesS} />
              </Tabs.Content>
            </Tabs.Root>
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
