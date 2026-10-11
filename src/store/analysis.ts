import { create } from 'zustand';
import { preprocessOptionsError } from '@/dsp/filters/preprocess';
import type { Sos } from '@/dsp/filters/types';
import { runInWorker } from '@/workers/client';
import { useRecordingStore } from './recording';
import { useSettingsStore } from './settings';

/** Wait this long after the last settings change, so typing a cutoff does not filter on every key. */
const SETTINGS_DEBOUNCE_MS = 200;

type Status = 'idle' | 'running' | 'ready' | 'error';

interface AnalysisState {
  status: Status;
  /** The cleaned signal for the current recording, or `null` before the first run finishes. */
  filtered: Float64Array | null;
  /** The filter cascade that produced `filtered`. */
  sos: Sos;
  /** Stages that could not be applied at this sampling rate. */
  skipped: string[];
  /** Times of the automatically detected beats, in seconds. */
  autoBeatTimesS: Float64Array;
  /** Whether beats are marked at maxima (1) or minima (-1) of the filtered signal. */
  polarity: 1 | -1;
  /** Why the current settings could not be applied, in plain language. */
  error: string | null;
}

const EMPTY: AnalysisState = {
  status: 'idle',
  filtered: null,
  sos: [],
  skipped: [],
  autoBeatTimesS: new Float64Array(0),
  polarity: 1,
  error: null,
};

export const useAnalysisStore = create<AnalysisState>(() => EMPTY);

/** Identifies the newest run, so a slow older run cannot overwrite a newer result. */
let latestRun = 0;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

async function analyze(): Promise<void> {
  const run = ++latestRun;
  const { recording } = useRecordingStore.getState();
  if (!recording) {
    useAnalysisStore.setState(EMPTY);
    return;
  }
  const options = useSettingsStore.getState().preprocess;
  const problem = preprocessOptionsError(recording.fs, options);
  if (problem) {
    // Keep showing the last good result while the user fixes the setting.
    useAnalysisStore.setState({ status: 'error', error: problem });
    return;
  }

  useAnalysisStore.setState({ status: 'running', error: null });
  try {
    const result = await runInWorker('analyze', {
      samples: recording.samples,
      fs: recording.fs,
      kind: recording.kind,
      options: { preprocess: options },
    });
    if (run !== latestRun) return;
    useAnalysisStore.setState({
      status: 'ready',
      filtered: result.filtered,
      sos: result.sos,
      skipped: result.skipped,
      autoBeatTimesS: result.beatTimesS,
      polarity: result.polarity,
      error: null,
    });
  } catch (cause) {
    if (run !== latestRun) return;
    console.error(cause);
    useAnalysisStore.setState({
      status: 'error',
      error: 'The signal could not be analyzed with these settings.',
    });
  }
}

// A new recording starts from the defaults for its type and is analyzed at once.
useRecordingStore.subscribe((state, previous) => {
  if (state.recording === previous.recording) return;
  useAnalysisStore.setState(EMPTY);
  if (state.recording) useSettingsStore.getState().resetForKind(state.recording.kind);
  // Resetting the settings schedules a debounced run; cancel it, because we run right now.
  clearTimeout(debounceTimer);
  void analyze();
});

useSettingsStore.subscribe((state, previous) => {
  if (state.preprocess === previous.preprocess) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void analyze(), SETTINGS_DEBOUNCE_MS);
});
