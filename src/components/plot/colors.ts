export interface PlotColors {
  signal: string;
  raw: string;
  beat: string;
  flagged: string;
  lowQuality: string;
  card: string;
  grid: string;
  text: string;
}

/** Canvas drawing cannot use CSS variables directly, so resolve them for the current theme. */
export function readPlotColors(): PlotColors {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    signal: read('--signal'),
    raw: read('--raw'),
    beat: read('--beat'),
    flagged: read('--flagged'),
    lowQuality: read('--low-quality'),
    card: read('--card'),
    grid: read('--grid'),
    text: read('--muted-foreground'),
  };
}
