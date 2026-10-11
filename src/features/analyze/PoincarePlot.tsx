import { extent } from '@/dsp/util/decimate';
import type { Poincare } from '@/dsp/hrv/poincare';

const SIZE = 260;
const MARGIN = { top: 8, right: 8, bottom: 30, left: 42 };
const PLOT = SIZE - MARGIN.left - MARGIN.right;
/** Beyond this many points the cloud's shape is already clear and more dots only slow the page. */
const MAX_POINTS = 3000;

interface PoincarePlotProps {
  data: Poincare;
}

/** Scatter of each NN interval against the next, with the SD1/SD2 ellipse. */
export function PoincarePlot({ data }: PoincarePlotProps) {
  const { x, y, sd1, sd2, center } = data;
  const [loX, hiX] = extent(x);
  const [loY, hiY] = extent(y);
  const lo = Math.min(loX, loY);
  const hi = Math.max(hiX, hiY);
  const padding = (hi - lo) * 0.08 || 10;
  const min = lo - padding;
  const max = hi + padding;
  const scale = PLOT / (max - min);
  // Both axes share one scale so the diagonal really is at 45 degrees.
  const px = (value: number) => MARGIN.left + (value - min) * scale;
  const py = (value: number) => MARGIN.top + PLOT - (value - min) * scale;

  const stride = Math.ceil(x.length / MAX_POINTS);
  const points: [number, number][] = [];
  for (let i = 0; i < x.length; i += stride) points.push([x[i], y[i]]);

  const ticks = [min + padding, (min + max) / 2, max - padding].map(
    (value) => Math.round(value / 10) * 10,
  );

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="w-full max-w-72"
      role="img"
      aria-label="Poincaré plot of each interval against the next"
    >
      <rect
        x={MARGIN.left}
        y={MARGIN.top}
        width={PLOT}
        height={PLOT}
        fill="none"
        stroke="var(--border)"
      />
      <line
        x1={px(min)}
        y1={py(min)}
        x2={px(max)}
        y2={py(max)}
        stroke="var(--grid)"
        strokeDasharray="4 3"
      />
      {points.map(([a, b], i) => (
        <circle key={i} cx={px(a)} cy={py(b)} r="1.6" fill="var(--signal)" opacity="0.55" />
      ))}
      {Number.isFinite(sd1) && Number.isFinite(sd2) && (
        // Screen y points down, so the data diagonal is a rotation of -45 degrees on screen.
        <ellipse
          cx={px(center)}
          cy={py(center)}
          rx={sd2 * scale}
          ry={sd1 * scale}
          transform={`rotate(-45 ${px(center)} ${py(center)})`}
          fill="none"
          stroke="var(--beat)"
          strokeWidth="1.5"
        />
      )}
      {ticks.map((tick) => (
        <g key={tick} fontSize="9" fill="var(--muted-foreground)">
          <text x={px(tick)} y={SIZE - MARGIN.bottom + 12} textAnchor="middle">
            {tick}
          </text>
          <text x={MARGIN.left - 5} y={py(tick) + 3} textAnchor="end">
            {tick}
          </text>
        </g>
      ))}
      <text
        x={MARGIN.left + PLOT / 2}
        y={SIZE - 3}
        textAnchor="middle"
        fontSize="9"
        fill="var(--muted-foreground)"
      >
        Interval n (ms)
      </text>
      <text
        x={9}
        y={MARGIN.top + PLOT / 2}
        textAnchor="middle"
        fontSize="9"
        fill="var(--muted-foreground)"
        transform={`rotate(-90 9 ${MARGIN.top + PLOT / 2})`}
      >
        Interval n + 1 (ms)
      </text>
    </svg>
  );
}
