import { useMemo } from 'react';
import { logSpace, magnitudeResponse } from '@/dsp/filters/freqResponse';
import type { Sos } from '@/dsp/filters/types';

const WIDTH = 260;
const HEIGHT = 150;
const MARGIN = { top: 8, right: 8, bottom: 26, left: 34 };
const MIN_HZ = 0.1;
const MIN_DB = -60;
const MAX_DB = 5;
const DB_TICKS = [0, -20, -40, -60];
const POINTS = 240;

const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;

/** Horizontal position of a frequency on the logarithmic axis that ends at `maxHz`. */
function xOf(hz: number, maxHz: number): number {
  return MARGIN.left + (Math.log(hz / MIN_HZ) / Math.log(maxHz / MIN_HZ)) * PLOT_WIDTH;
}

function yOf(db: number): number {
  return MARGIN.top + ((MAX_DB - Math.max(db, MIN_DB)) / (MAX_DB - MIN_DB)) * PLOT_HEIGHT;
}

interface FrequencyResponsePlotProps {
  sos: Sos;
  fs: number;
  /** Frequency of a notch, if any. It is far narrower than the grid spacing and would be missed. */
  notchHz: number | null;
}

/**
 * Magnitude response of the active filter chain on a logarithmic frequency
 * axis. A small static SVG is enough here; no interaction is needed.
 */
export function FrequencyResponsePlot({ sos, fs, notchHz }: FrequencyResponsePlotProps) {
  const maxHz = fs / 2;

  const path = useMemo(() => {
    // Stop just short of Nyquist, where a low-pass response falls to minus infinity.
    const grid = logSpace(MIN_HZ, maxHz * 0.999, POINTS);
    const frequencies =
      notchHz !== null && notchHz < maxHz ? Float64Array.of(...grid, notchHz).sort() : grid;
    const { magnitudeDb } = magnitudeResponse(sos, fs, frequencies, 2);
    return Array.from(
      frequencies,
      (hz, i) =>
        `${i === 0 ? 'M' : 'L'}${xOf(hz, maxHz).toFixed(1)},${yOf(magnitudeDb[i]).toFixed(1)}`,
    ).join(' ');
  }, [sos, fs, maxHz, notchHz]);

  const decadeTicks = [0.1, 1, 10, 100, 1000].filter((hz) => hz <= maxHz);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="w-full"
      role="img"
      aria-label={`Filter frequency response from ${MIN_HZ} to ${maxHz} hertz`}
    >
      {DB_TICKS.map((db) => (
        <g key={db}>
          <line
            x1={MARGIN.left}
            x2={WIDTH - MARGIN.right}
            y1={yOf(db)}
            y2={yOf(db)}
            stroke="var(--grid)"
          />
          <text
            x={MARGIN.left - 5}
            y={yOf(db) + 3}
            textAnchor="end"
            fontSize="9"
            fill="var(--muted-foreground)"
          >
            {db}
          </text>
        </g>
      ))}
      {decadeTicks.map((hz) => (
        <g key={hz}>
          <line
            x1={xOf(hz, maxHz)}
            x2={xOf(hz, maxHz)}
            y1={MARGIN.top}
            y2={HEIGHT - MARGIN.bottom}
            stroke="var(--grid)"
          />
          <text
            x={xOf(hz, maxHz)}
            y={HEIGHT - MARGIN.bottom + 11}
            textAnchor="middle"
            fontSize="9"
            fill="var(--muted-foreground)"
          >
            {hz}
          </text>
        </g>
      ))}
      <text
        x={MARGIN.left + PLOT_WIDTH / 2}
        y={HEIGHT - 2}
        textAnchor="middle"
        fontSize="9"
        fill="var(--muted-foreground)"
      >
        Frequency (Hz)
      </text>
      <text
        x={9}
        y={MARGIN.top + PLOT_HEIGHT / 2}
        textAnchor="middle"
        fontSize="9"
        fill="var(--muted-foreground)"
        transform={`rotate(-90 9 ${MARGIN.top + PLOT_HEIGHT / 2})`}
      >
        Gain (dB)
      </text>
      <clipPath id="response-clip">
        <rect x={MARGIN.left} y={MARGIN.top} width={PLOT_WIDTH} height={PLOT_HEIGHT} />
      </clipPath>
      <path
        d={path}
        fill="none"
        stroke="var(--signal)"
        strokeWidth="1.5"
        clipPath="url(#response-clip)"
      />
    </svg>
  );
}
