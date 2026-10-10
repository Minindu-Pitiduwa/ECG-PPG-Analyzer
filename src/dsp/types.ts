/** A uniformly sampled signal. Float64 keeps filter round-off far below ADC resolution. */
export type Signal = Float64Array;

export type SignalKind = 'ecg' | 'ppg';
