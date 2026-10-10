import { create } from 'zustand';
import { defaultPreprocessOptions, type PreprocessOptions } from '@/dsp/filters/preprocess';
import type { SignalKind } from '@/dsp/types';

interface SettingsState {
  preprocess: PreprocessOptions;
  setPreprocess: (patch: Partial<PreprocessOptions>) => void;
  /** Restore the defaults for the given signal type. */
  resetForKind: (kind: SignalKind) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  preprocess: defaultPreprocessOptions('ecg'),
  setPreprocess: (patch) => set((state) => ({ preprocess: { ...state.preprocess, ...patch } })),
  resetForKind: (kind) => set({ preprocess: defaultPreprocessOptions(kind) }),
}));
