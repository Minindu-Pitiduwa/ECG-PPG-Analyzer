import { HRV_BANDS, type Psd } from '@/dsp/hrv/frequencyDomain';

const WIDTH = 420;
const HEIGHT = 190;
const MARGIN = { top: 18, right: 10, bottom: 30, left: 46 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;
const MAX_HZ = 0.5;
const X_TICKS = [0, 0.04, 0.15, 0.4, 0.5];

const xOf = (hz: number) => MARGIN.left + (hz / MAX_HZ) * PLOT_WIDTH;

interface PsdPlotProps {
  psd: Psd;
  /** Whether the VLF band is long enough to be shown as a result. */
  showVlf: boolean;
}

/** HRV power spectrum with the standard bands marked. */
export function PsdPlot({ psd, showVlf }: PsdPlotProps) {
  // Scale to the bands that are reported, so an unreliable VLF peak cannot flatten the rest.
  const from = showVlf ? HRV_BANDS.vlf[0] : HRV_BANDS.lf[0];
  let peak = 0;
  for (let i = 0; i < psd.freqHz.length; i++) {
    if (psd.freqHz[i] >= from && psd.freqHz[i] <= MAX_HZ) peak = Math.max(peak, psd.power[i]);
  }
  const top = peak > 0 ? peak * 1.1 : 1;
  const yOf = (power: number) => MARGIN.top + (1 - Math.min(power, top) / top) * PLOT_HEIGHT;

  let path = '';
  for (let i = 0; i < psd.freqHz.length; i++) {
    if (psd.freqHz[i] > MAX_HZ) break;
    // Below the reported bands the estimate is unreliable and would only dwarf the rest.
    if (psd.freqHz[i] < from) continue;
    path += `${path ? 'L' : 'M'}${xOf(psd.freqHz[i]).toFixed(1)},${yOf(psd.power[i]).toFixed(1)} `;
  }

  const bands = [
    { name: 'VLF', range: HRV_BANDS.vlf, shown: showVlf },
    { name: 'LF', range: HRV_BANDS.lf, shown: true },
    { name: 'HF', range: HRV_BANDS.hf, shown: true },
  ];

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="w-full"
      role="img"
      aria-label="Heart rate variability power spectrum"
    >
      {bands.map(({ name, range, shown }, index) => (
        <g key={name} opacity={shown ? 1 : 0.4}>
          <rect
            x={xOf(range[0])}
            y={MARGIN.top}
            width={xOf(range[1]) - xOf(range[0])}
            height={PLOT_HEIGHT}
            fill="var(--signal)"
            opacity={index % 2 === 0 ? 0.06 : 0.12}
          />
          <text
            x={(xOf(range[0]) + xOf(range[1])) / 2}
            y={MARGIN.top - 5}
            textAnchor="middle"
            fontSize="10"
            fill="var(--muted-foreground)"
          >
            {name}
          </text>
        </g>
      ))}
      <line
        x1={MARGIN.left}
        x2={WIDTH - MARGIN.right}
        y1={HEIGHT - MARGIN.bottom}
        y2={HEIGHT - MARGIN.bottom}
        stroke="var(--border)"
      />
      <line
        x1={MARGIN.left}
        x2={MARGIN.left}
        y1={MARGIN.top}
        y2={HEIGHT - MARGIN.bottom}
        stroke="var(--border)"
      />
      {X_TICKS.map((hz) => (
        <text
          key={hz}
          x={xOf(hz)}
          y={HEIGHT - MARGIN.bottom + 12}
          textAnchor="middle"
          fontSize="9"
          fill="var(--muted-foreground)"
        >
          {hz}
        </text>
      ))}
      <text
        x={MARGIN.left + PLOT_WIDTH / 2}
        y={HEIGHT - 3}
        textAnchor="middle"
        fontSize="9"
        fill="var(--muted-foreground)"
      >
        Frequency (Hz)
      </text>
      <text
        x={MARGIN.left - 5}
        y={MARGIN.top + 4}
        textAnchor="end"
        fontSize="9"
        fill="var(--muted-foreground)"
      >
        {Math.round(top).toLocaleString('en-US')}
      </text>
      <text
        x={MARGIN.left - 5}
        y={HEIGHT - MARGIN.bottom}
        textAnchor="end"
        fontSize="9"
        fill="var(--muted-foreground)"
      >
        0
      </text>
      <text
        x={11}
        y={MARGIN.top + PLOT_HEIGHT / 2}
        textAnchor="middle"
        fontSize="9"
        fill="var(--muted-foreground)"
        transform={`rotate(-90 11 ${MARGIN.top + PLOT_HEIGHT / 2})`}
      >
        Power (ms²/Hz)
      </text>
      <path d={path} fill="none" stroke="var(--signal)" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
