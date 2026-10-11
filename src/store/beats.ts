import { useMemo } from 'react';
import { create } from 'zustand';
import { applyBeatEdits, type Beat, type BeatEdit } from '@/dsp/detect/edits';
import { useAnalysisStore } from './analysis';
import { useRecordingStore } from './recording';

interface BeatEditState {
  /** Manual corrections, oldest first. Undo removes the last one. */
  edits: BeatEdit[];
  addBeat: (timeS: number) => void;
  removeBeat: (timeS: number) => void;
  undo: () => void;
}

export const useBeatEditStore = create<BeatEditState>((set) => ({
  edits: [],
  addBeat: (timeS) => set((state) => ({ edits: [...state.edits, { type: 'add', timeS }] })),
  removeBeat: (timeS) => set((state) => ({ edits: [...state.edits, { type: 'remove', timeS }] })),
  undo: () => set((state) => ({ edits: state.edits.slice(0, -1) })),
}));

// Corrections belong to one recording.
useRecordingStore.subscribe((state, previous) => {
  if (state.recording !== previous.recording) useBeatEditStore.setState({ edits: [] });
});

/** The beats used for all metrics: automatic detections with the manual corrections applied. */
export function useBeats(): Beat[] {
  const autoBeatTimesS = useAnalysisStore((state) => state.autoBeatTimesS);
  const edits = useBeatEditStore((state) => state.edits);
  return useMemo(() => applyBeatEdits(autoBeatTimesS, edits), [autoBeatTimesS, edits]);
}
