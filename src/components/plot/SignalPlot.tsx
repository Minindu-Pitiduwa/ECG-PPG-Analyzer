import { useEffect, useRef, useState } from 'react';
import uPlot from 'uplot';
import { decimateMinMax, extent } from '@/dsp/util/decimate';
import { UNIT_LABELS, type SignalUnits } from '@/io/types';
import { decimalsForStep, formatTime, formatValue } from '@/lib/format';
import { useThemeStore } from '@/store/theme';
import { useViewStore } from '@/store/view';
import { readPlotColors } from './colors';

const PLOT_HEIGHT = 340;
/** Empty space above and below the trace, as a fraction of its visible range. */
const Y_PADDING = 0.08;
const KEY_PAN_FRACTION = 0.1;
const KEY_ZOOM_FACTOR = 0.7;
/** Converts wheel delta (pixels) to a zoom factor; one mouse-wheel notch is roughly 20%. */
const WHEEL_ZOOM_RATE = 0.002;

interface Hover {
  time: number;
  value: number;
}

export interface PlotTrace {
  samples: Float64Array;
  /** Which palette entry to draw with. */
  color: 'signal' | 'raw';
}

interface SignalPlotProps {
  /** Traces drawn back to front; the hover readout follows the last one. All share `fs`. */
  traces: PlotTrace[];
  fs: number;
  units: SignalUnits;
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
export function SignalPlot({ traces, fs, units }: SignalPlotProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const theme = useThemeStore((state) => state.theme);
  const [hover, setHover] = useState<Hover | null>(null);

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
        height: PLOT_HEIGHT,
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
        },
      },
      [[], ...traces.map(() => [])],
      host,
    );

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
      plot.setSize({ width: host.clientWidth, height: PLOT_HEIGHT });
      scheduleDraw();
    });
    resizeObserver.observe(host);
    draw();

    const over = plot.over;
    let drag: { x: number; min: number; max: number } | null = null;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const { min, max } = useViewStore.getState();
      drag = { x: event.clientX, min, max };
      over.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!drag) return;
      const shift = ((event.clientX - drag.x) / over.clientWidth) * (drag.max - drag.min);
      useViewStore.getState().setView(drag.min - shift, drag.max - shift);
    };
    const endDrag = () => {
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
    over.addEventListener('pointerup', endDrag);
    over.addEventListener('pointercancel', endDrag);
    over.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
      resizeObserver.disconnect();
      plot.destroy(); // also removes the listeners attached to its elements
    };
    // The theme is a dependency because canvas colors are fixed when the plot is created.
  }, [traces, fs, units, theme]);

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
    if (!action) return;
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
        aria-label="Signal plot. Use the left and right arrow keys to pan, plus and minus to zoom, zero to reset."
        onKeyDown={onKeyDown}
        className="rounded-md"
        style={{ height: PLOT_HEIGHT }}
        data-testid="signal-plot"
      />
    </div>
  );
}
