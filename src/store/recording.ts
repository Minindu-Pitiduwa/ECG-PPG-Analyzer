import { create } from 'zustand';
import type { Recording } from '@/io/types';
import { useViewStore } from './view';

export type Step = 'load' | 'analyze' | 'report';

interface RecordingState {
  recording: Recording | null;
  step: Step;
  setRecording: (recording: Recording) => void;
  setStep: (step: Step) => void;
}

export const useRecordingStore = create<RecordingState>((set) => ({
  recording: null,
  step: 'load',
  // A freshly loaded recording is what the user wants to look at next.
  setRecording: (recording) => {
    useViewStore.getState().init(recording.samples.length / recording.fs);
    set({ recording, step: 'analyze' });
  },
  setStep: (step) => set({ step }),
}));
