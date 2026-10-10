export interface PlotColors {
  signal: string;
  raw: string;
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
    grid: read('--grid'),
    text: read('--muted-foreground'),
  };
}
