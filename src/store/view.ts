import { create } from 'zustand';

/** Opening view: long enough to show a rhythm, short enough to see each beat's shape. */
const DEFAULT_SPAN_S = 10;
/** Zooming in further than this shows only a handful of samples. */
const MIN_SPAN_S = 0.05;

interface ViewState {
  /** Total length of the loaded recording, in seconds. */
  duration: number;
  /** Visible time window of the main plot, in seconds. */
  min: number;
  max: number;
  /** Start viewing a recording of the given length at the default zoom. */
  init: (duration: number) => void;
  /** Set the window, keeping its width while clamping it inside the recording. */
  setView: (min: number, max: number) => void;
  /** Move the window by `deltaS` seconds. */
  pan: (deltaS: number) => void;
  /** Scale the window by `factor` (<1 zooms in) around the time `anchor`. */
  zoom: (factor: number, anchor?: number) => void;
  reset: () => void;
  showAll: () => void;
}

function clampWindow(min: number, max: number, duration: number): { min: number; max: number } {
  const span = Math.min(Math.max(max - min, Math.min(MIN_SPAN_S, duration)), duration);
  const start = Math.min(Math.max(min, 0), duration - span);
  return { min: start, max: start + span };
}

export const useViewStore = create<ViewState>((set, get) => ({
  duration: 0,
  min: 0,
  max: 0,
  init: (duration) => set({ duration, min: 0, max: Math.min(DEFAULT_SPAN_S, duration) }),
  setView: (min, max) => set(clampWindow(min, max, get().duration)),
  pan: (deltaS) => {
    const { min, max, setView } = get();
    setView(min + deltaS, max + deltaS);
  },
  zoom: (factor, anchor) => {
    const { min, max, setView } = get();
    const pivot = anchor ?? (min + max) / 2;
    setView(pivot - (pivot - min) * factor, pivot + (max - pivot) * factor);
  },
  reset: () => get().init(get().duration),
  showAll: () => set({ min: 0, max: get().duration }),
}));
