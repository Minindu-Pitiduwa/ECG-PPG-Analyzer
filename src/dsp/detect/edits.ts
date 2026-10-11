import type { Signal } from '../types';
import { extremumIndex, parabolicOffset } from './refine';

/** A manual correction to the detected beats, identified by time so it survives re-detection. */
export type BeatEdit = { type: 'add'; timeS: number } | { type: 'remove'; timeS: number };

export interface Beat {
  timeS: number;
  /** `'manual'` for beats the user added by hand. */
  source: 'auto' | 'manual';
}

/** Two beat times closer than this refer to the same beat. */
const SAME_BEAT_S = 0.05;

function nearestIndex(beats: Beat[], timeS: number): number {
  let best = -1;
  for (let i = 0; i < beats.length; i++) {
    if (best === -1 || Math.abs(beats[i].timeS - timeS) < Math.abs(beats[best].timeS - timeS))
      best = i;
  }
  return best;
}

/**
 * Combine the automatically detected beats with the user's corrections.
 *
 * Edits are replayed in order on top of the current detections instead of
 * being baked into a list. When a filter setting changes and detection runs
 * again, the corrections still apply to the new result. An edit that no
 * longer matches anything (removing a beat that is not there, adding one that
 * now exists) is simply a no-op.
 *
 * @returns all beats in time order
 */
export function applyBeatEdits(autoTimesS: ArrayLike<number>, edits: readonly BeatEdit[]): Beat[] {
  const beats = Array.from(autoTimesS, (timeS): Beat => ({ timeS, source: 'auto' }));
  for (const edit of edits) {
    const nearest = nearestIndex(beats, edit.timeS);
    const exists = nearest !== -1 && Math.abs(beats[nearest].timeS - edit.timeS) <= SAME_BEAT_S;
    if (edit.type === 'remove' && exists) beats.splice(nearest, 1);
    if (edit.type === 'add' && !exists) beats.push({ timeS: edit.timeS, source: 'manual' });
  }
  return beats.sort((a, b) => a.timeS - b.timeS);
}

/**
 * Whether beats are marked at maxima (1) or minima (-1) of the signal, judged
 * by comparing each peak with the average of its surroundings. Used so that a
 * manually added beat snaps to the same kind of point the detector marks.
 */
export function dominantPolarity(x: Signal, peaks: ArrayLike<number>, fs: number): 1 | -1 {
  const radius = Math.max(1, Math.round(0.1 * fs));
  let upward = 0;
  for (let p = 0; p < peaks.length; p++) {
    const from = Math.max(0, peaks[p] - radius);
    const to = Math.min(x.length, peaks[p] + radius + 1);
    let sum = 0;
    for (let i = from; i < to; i++) sum += x[i];
    upward += x[peaks[p]] >= sum / (to - from) ? 1 : -1;
  }
  return upward >= 0 ? 1 : -1;
}

/**
 * Time of the nearest peak to where the user clicked, so a manual beat lands
 * on the actual peak and not merely near it.
 *
 * @param radiusS how far from the click to look
 */
export function snapToPeak(
  x: Signal,
  fs: number,
  timeS: number,
  polarity: 1 | -1,
  radiusS = 0.08,
): number {
  const center = Math.round(timeS * fs);
  const radius = Math.round(radiusS * fs);
  const index = extremumIndex(x, center - radius, center + radius, polarity);
  return (index + parabolicOffset(x, index)) / fs;
}
