import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import { extent } from '@/dsp/util/decimate';
import { formatTime } from '@/lib/format';
import { useThemeStore } from '@/store/theme';
import { readPlotColors } from './colors';

const HEIGHT = 170;
const Y_PADDING = 0.1;
/** Above this many points the dots would touch, so only the line is drawn. */
const MAX_POINTS_WITH_DOTS = 150;

interface TrendPlotProps {
  timeS: Float64Array;
  values: Float64Array;
  /** Total length of the recording, so the time axis matches the mini-map. */
  durationS: number;
  yLabel: string;
  ariaLabel: string;
  /** Called with the time under the pointer when the plot is clicked. */
  onSelectTime?: (timeS: number) => void;
}

/**
 * A small plot of one value per beat over the whole recording (heart rate,
 * later also RR intervals). Clicking it moves the main plot to that time.
 */
export function TrendPlot({
  timeS,
  values,
  durationS,
  yLabel,
  ariaLabel,
  onSelectTime,
}: TrendPlotProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const theme = useThemeStore((state) => state.theme);
  const onSelectRef = useRef(onSelectTime);
  useEffect(() => {
    onSelectRef.current = onSelectTime;
  }, [onSelectTime]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const colors = readPlotColors();
    const axis: uPlot.Axis = {
      stroke: colors.text,
      grid: { stroke: colors.grid, width: 1 },
      ticks: { stroke: colors.grid, width: 1 },
    };
    const [lo, hi] = extent(values);
    const padding = (hi - lo) * Y_PADDING || 1;

    const plot = new uPlot(
      {
        width: host.clientWidth,
        height: HEIGHT,
        legend: { show: false },
        cursor: { drag: { x: false, y: false }, y: false },
        scales: {
          x: { time: false, range: [0, durationS] },
          y: { range: [lo - padding, hi + padding] },
        },
        axes: [
          { ...axis, values: (_u, ticks) => ticks.map((tick) => formatTime(tick)) },
          { ...axis, label: yLabel, labelSize: 18, size: 60 },
        ],
        series: [
          {},
          {
            stroke: colors.signal,
            width: 1.25,
            points: { show: values.length <= MAX_POINTS_WITH_DOTS, size: 4, fill: colors.signal },
          },
        ],
      },
      [timeS, values],
      host,
    );

    const onClick = (event: MouseEvent) => {
      const rect = plot.over.getBoundingClientRect();
      onSelectRef.current?.(plot.posToVal(event.clientX - rect.left, 'x'));
    };
    plot.over.addEventListener('click', onClick);

    const resizeObserver = new ResizeObserver(() => {
      plot.setSize({ width: host.clientWidth, height: HEIGHT });
    });
    resizeObserver.observe(host);

    return () => {
      resizeObserver.disconnect();
      plot.destroy();
    };
  }, [timeS, values, durationS, yLabel, theme]);

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label={ariaLabel}
      className="cursor-pointer"
      style={{ height: HEIGHT }}
      data-testid="trend-plot"
    />
  );
}
