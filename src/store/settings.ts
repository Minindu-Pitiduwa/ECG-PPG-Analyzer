import { create } from 'zustand';
import { defaultPreprocessOptions, type PreprocessOptions } from '@/dsp/filters/preprocess';
import type { SpectralMethod } from '@/dsp/hrv/frequencyDomain';
import type { SignalKind } from '@/dsp/types';

interface SettingsState {
  preprocess: PreprocessOptions;
  /** How the HRV power spectrum is estimated. */
  spectralMethod: SpectralMethod;
  setSpectralMethod: (method: SpectralMethod) => void;
  setPreprocess: (patch: Partial<PreprocessOptions>) => void;
  /** Restore the defaults for the given signal type. */
  resetForKind: (kind: SignalKind) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  preprocess: defaultPreprocessOptions('ecg'),
  spectralMethod: 'lombScargle',
  setSpectralMethod: (spectralMethod) => set({ spectralMethod }),
  setPreprocess: (patch) => set((state) => ({ preprocess: { ...state.preprocess, ...patch } })),
  resetForKind: (kind) => set({ preprocess: defaultPreprocessOptions(kind) }),
}));
