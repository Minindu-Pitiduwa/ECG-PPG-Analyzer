/** Format a time position as m:ss, with the given number of decimals on the seconds. */
export function formatTime(seconds: number, decimals = 0): string {
  const sign = seconds < 0 ? '-' : '';
  // Round first so 59.999 becomes 1:00, not 0:60.
  const scale = 10 ** decimals;
  const total = Math.round(Math.abs(seconds) * scale) / scale;
  const minutes = Math.floor(total / 60);
  const rest = (total - minutes * 60).toFixed(decimals).padStart(decimals ? decimals + 3 : 2, '0');
  return `${sign}${minutes}:${rest}`;
}

/** Fewest decimals (at most 3) that write an axis tick step exactly, e.g. 0.25 s needs two. */
export function decimalsForStep(step: number): number {
  if (!(step > 0)) return 0;
  for (let decimals = 0; decimals < 3; decimals++) {
    const scaled = step * 10 ** decimals;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6) return decimals;
  }
  return 3;
}

/** Format a length of time in words, e.g. "5 min", "1 min 30 s", "42.5 s". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Number(seconds.toFixed(1))} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/** Format a signal value with a sensible number of digits for its magnitude. */
export function formatValue(value: number): string {
  if (!Number.isFinite(value)) return '–';
  const magnitude = Math.abs(value);
  if (magnitude >= 1000) return value.toFixed(0);
  if (magnitude >= 10) return value.toFixed(1);
  return value.toFixed(3);
}
