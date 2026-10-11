import { useEffect, useRef, useState } from 'react';
import uPlot from 'uplot';
import type { Beat } from '@/dsp/detect/edits';
import { decimateMinMax, extent } from '@/dsp/util/decimate';
import { UNIT_LABELS, type SignalUnits } from '@/io/types';
import { decimalsForStep, formatTime, formatValue } from '@/lib/format';
import { useThemeStore } from '@/store/theme';
import { useViewStore } from '@/store/view';
import { readPlotColors, type PlotColors } from './colors';

const PLOT_HEIGHT = 340;
/** Empty space above and below the trace, as a fraction of its visible range. */
const Y_PADDING = 0.08;
const KEY_PAN_FRACTION = 0.1;
const KEY_ZOOM_FACTOR = 0.7;
/** Converts wheel delta (pixels) to a zoom factor; one mouse-wheel notch is roughly 20%. */
const WHEEL_ZOOM_RATE = 0.002;
/** A press that moves less than this many pixels is a click, not a drag. */
const CLICK_SLOP_PX = 4;
const MARKER_RADIUS_PX = 4;
/** With markers closer together than this they would merge into a band, so ticks are drawn instead. */
const MIN_MARKER_SPACING_PX = 6;

interface Hover {
  time: number;
  value: number;
}

export interface PlotTrace {
  samples: Float64Array;
  /** Which palette entry to draw with. */
  color: 'signal' | 'raw';
}

/** A beat as drawn: flagged beats (ectopic or artifact) get the warning color. */
export interface PlotBeat extends Beat {
  flagged: boolean;
}

export interface TimeSpan {
  startS: number;
  endS: number;
}

export interface PlotClick {
  timeS: number;
  /** Seconds covered by one screen pixel at the current zoom, to judge what a click was aimed at. */
  secondsPerPixel: number;
}

interface SignalPlotProps {
  /** Traces drawn back to front; the hover readout and beat markers follow the last one. All share `fs`. */
  traces: PlotTrace[];
  fs: number;
  units: SignalUnits;
  /** Beats to mark on the front trace, in time order. */
  beats: PlotBeat[];
  /** Stretches of low signal quality, shaded grey. */
  lowQuality: TimeSpan[];
  /** Called for a click (not a drag) on the plot area. */
  onClick?: (click: PlotClick) => void;
  /** Plot height in CSS pixels. */
  height?: number;
  /** Accessible name; set it when a page shows more than one signal plot. */
  label?: string;
  testId?: string;
}

/** Index of the first beat at or after `timeS`. */
function firstBeatFrom(beats: PlotBeat[], timeS: number): number {
  let lo = 0;
  let hi = beats.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid].timeS < timeS) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Shade the low-quality stretches that overlap the visible window. */
function drawLowQuality(plot: uPlot, spans: TimeSpan[], colors: PlotColors): void {
  const min = plot.scales.x.min;
  const max = plot.scales.x.max;
  if (min === undefined || max === undefined) return;
  const { ctx, bbox } = plot;
  ctx.save();
  ctx.fillStyle = colors.lowQuality;
  ctx.globalAlpha = 0.22;
  for (const span of spans) {
    if (span.endS <= min || span.startS >= max) continue;
    const left = plot.valToPos(Math.max(span.startS, min), 'x', true);
    const right = plot.valToPos(Math.min(span.endS, max), 'x', true);
    ctx.fillRect(left, bbox.top, right - left, bbox.height);
  }
  ctx.restore();
}

/** Draw the beat markers of the visible window on top of the traces. */
function drawBeats(
  plot: uPlot,
  beats: PlotBeat[],
  front: Float64Array,
  fs: number,
  colors: PlotColors,
): void {
  const min = plot.scales.x.min;
  const max = plot.scales.x.max;
  if (min === undefined || max === undefined || beats.length === 0) return;

  const first = firstBeatFrom(beats, min);
  const end = firstBeatFrom(beats, max);
  const visible = end - first;
  if (visible === 0) return;

  const ratio = devicePixelRatio;
  const { ctx, bbox } = plot;
  const crowded = bbox.width / visible < MIN_MARKER_SPACING_PX * ratio;

  ctx.save();
  ctx.beginPath();
  ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height);
  ctx.clip();
  ctx.lineWidth = 1.5 * ratio;
  for (let i = first; i < end; i++) {
    const beat = beats[i];
    const x = plot.valToPos(beat.timeS, 'x', true);
    const color = beat.flagged ? colors.flagged : colors.beat;
    ctx.strokeStyle = color;
    if (crowded) {
      // Zoomed far out: a tick along the top edge still shows where beats are and where they are missing.
      ctx.beginPath();
      ctx.moveTo(x, bbox.top);
      ctx.lineTo(x, bbox.top + 6 * ratio);
      ctx.stroke();
      continue;
    }
    const sample = Math.min(front.length - 1, Math.max(0, Math.round(beat.timeS * fs)));
    const y = plot.valToPos(front[sample], 'y', true);
    ctx.beginPath();
    ctx.arc(x, y, MARKER_RADIUS_PX * ratio, 0, 2 * Math.PI);
    // Beats added by hand are drawn hollow so they can be told apart from detections.
    ctx.fillStyle = beat.source === 'manual' ? colors.card : color;
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The main time-series plot.
 *
 * The visible window lives in the view store. Every interaction (wheel, drag,
 * keyboard, mini-map, toolbar) only updates that window; one subscriber then
 * re-decimates the full-resolution signal for the new window and hands uPlot
 * about two points per pixel. uPlot therefore never holds more than a few
 * thousand points, however long the recording is.
 */
export function SignalPlot({
  traces,
  fs,
  units,
  beats,
  lowQuality,
  onClick,
  height = PLOT_HEIGHT,
  label = 'Signal plot',
  testId = 'signal-plot',
}: SignalPlotProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const theme = useThemeStore((state) => state.theme);
  const [hover, setHover] = useState<Hover | null>(null);

  // Beats and the click handler change often (every edit). They are read through
  // refs so that such changes repaint the plot instead of rebuilding it.
  const beatsRef = useRef(beats);
  const lowQualityRef = useRef(lowQuality);
  const onClickRef = useRef(onClick);
  useEffect(() => {
    beatsRef.current = beats;
    lowQualityRef.current = lowQuality;
    onClickRef.current = onClick;
    plotRef.current?.redraw(false);
  }, [beats, lowQuality, onClick]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || traces.length === 0) return;
    const front = traces[traces.length - 1].samples;

    const colors = readPlotColors();
    const axis: uPlot.Axis = {
      stroke: colors.text,
      grid: { stroke: colors.grid, width: 1 },
      ticks: { stroke: colors.grid, width: 1 },
    };

    const plot = new uPlot(
      {
        width: host.clientWidth,
        height,
        legend: { show: false },
        // Dragging pans (handled below), so uPlot's own drag-to-zoom is turned off.
        cursor: { drag: { x: false, y: false }, y: false, points: { show: false } },
        scales: { x: { time: false, auto: false }, y: { auto: false } },
        axes: [
          {
            ...axis,
            values: (_u, ticks) => {
              const decimals = decimalsForStep(ticks.length > 1 ? ticks[1] - ticks[0] : 1);
              return ticks.map((tick) => formatTime(tick, decimals));
            },
          },
          { ...axis, label: UNIT_LABELS[units], labelSize: 18, size: 60 },
        ],
        series: [
          {},
          ...traces.map((trace): uPlot.Series => ({
            stroke: colors[trace.color],
            width: 1.25,
            points: { show: false },
            // Traces are thinned separately, so their time points differ; draw through the gaps.
            spanGaps: true,
          })),
        ],
        hooks: {
          setCursor: [
            (u) => {
              const left = u.cursor.left;
              if (left === undefined || left < 0) {
                setHover(null);
                return;
              }
              // Read the value from the full-resolution signal, not the decimated trace.
              const index = Math.round(u.posToVal(left, 'x') * fs);
              if (index < 0 || index >= front.length) setHover(null);
              else setHover({ time: index / fs, value: front[index] });
            },
          ],
          draw: [
            (u) => {
              drawLowQuality(u, lowQualityRef.current, colors);
              drawBeats(u, beatsRef.current, front, fs, colors);
            },
          ],
        },
      },
      [[], ...traces.map(() => [])],
      host,
    );
    plotRef.current = plot;

    const draw = () => {
      const { min, max } = useViewStore.getState();
      const pixels = Math.max(1, Math.round(plot.bbox.width / devicePixelRatio));
      let lo = Infinity;
      let hi = -Infinity;
      const tables = traces.map((trace): uPlot.AlignedData => {
        const { t, y } = decimateMinMax(trace.samples, fs, min * fs, max * fs + 1, pixels);
        const [low, high] = extent(y);
        lo = Math.min(lo, low);
        hi = Math.max(hi, high);
        return [t, y];
      });
      const padding = (hi - lo) * Y_PADDING || 1;
      plot.batch(() => {
        // join() merges the per-trace time axes into the single shared axis uPlot needs.
        plot.setData(tables.length === 1 ? tables[0] : uPlot.join(tables), false);
        plot.setScale('x', { min, max });
        plot.setScale('y', { min: lo - padding, max: hi + padding });
      });
    };

    // Coalesce bursts of wheel/drag events into one redraw per frame.
    let frame = 0;
    const scheduleDraw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    };
    const unsubscribe = useViewStore.subscribe(scheduleDraw);

    const resizeObserver = new ResizeObserver(() => {
      plot.setSize({ width: host.clientWidth, height });
      scheduleDraw();
    });
    resizeObserver.observe(host);
    draw();

    const over = plot.over;
    let drag: { x: number; min: number; max: number; moved: boolean } | null = null;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const { min, max } = useViewStore.getState();
      drag = { x: event.clientX, min, max, moved: false };
      over.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!drag) return;
      const distance = event.clientX - drag.x;
      if (Math.abs(distance) > CLICK_SLOP_PX) drag.moved = true;
      if (!drag.moved) return;
      const shift = (distance / over.clientWidth) * (drag.max - drag.min);
      useViewStore.getState().setView(drag.min - shift, drag.max - shift);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (drag && !drag.moved) {
        const rect = over.getBoundingClientRect();
        const secondsPerPixel = (drag.max - drag.min) / rect.width;
        onClickRef.current?.({
          timeS: drag.min + (event.clientX - rect.left) * secondsPerPixel,
          secondsPerPixel,
        });
      }
      drag = null;
    };
    const cancelDrag = () => {
      drag = null;
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault(); // keep the page from scrolling while zooming the plot
      const view = useViewStore.getState();
      const span = view.max - view.min;
      const rect = over.getBoundingClientRect();
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        view.pan((event.deltaX / rect.width) * span); // sideways trackpad swipe
        return;
      }
      const anchor = view.min + ((event.clientX - rect.left) / rect.width) * span;
      view.zoom(Math.exp(event.deltaY * WHEEL_ZOOM_RATE), anchor);
    };

    over.addEventListener('pointerdown', onPointerDown);
    over.addEventListener('pointermove', onPointerMove);
    over.addEventListener('pointerup', onPointerUp);
    over.addEventListener('pointercancel', cancelDrag);
    over.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
      resizeObserver.disconnect();
      plotRef.current = null;
      plot.destroy(); // also removes the listeners attached to its elements
    };
    // The theme is a dependency because canvas colors are fixed when the plot is created.
  }, [traces, fs, units, height, theme]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const view = useViewStore.getState();
    const step = (view.max - view.min) * KEY_PAN_FRACTION * (event.shiftKey ? 5 : 1);
    const actions: Record<string, () => void> = {
      ArrowLeft: () => view.pan(-step),
      ArrowRight: () => view.pan(step),
      '+': () => view.zoom(KEY_ZOOM_FACTOR),
      '=': () => view.zoom(KEY_ZOOM_FACTOR),
      '-': () => view.zoom(1 / KEY_ZOOM_FACTOR),
      '0': () => view.reset(),
    };
    const action = actions[event.key];
    if (!action || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    action();
  };

  return (
    <div>
      <p className="text-muted-foreground h-5 text-right text-xs tabular-nums" aria-live="off">
        {hover
          ? `${formatTime(hover.time, 3)}  ·  ${formatValue(hover.value)} ${UNIT_LABELS[units]}`
          : 'Scroll to zoom · drag to pan'}
      </p>
      <div
        ref={hostRef}
        role="group"
        tabIndex={0}
        aria-label={`${label}. Use the left and right arrow keys to pan, plus and minus to zoom, zero to reset.`}
        onKeyDown={onKeyDown}
        className="rounded-md"
        style={{ height }}
        data-testid={testId}
      />
    </div>
  );
}
