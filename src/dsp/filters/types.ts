/**
 * One second-order section (biquad) of an IIR filter, as
 * `[b0, b1, b2, a0, a1, a2]` with `a0 = 1`:
 *
 *     H(z) = (b0 + b1 z^-1 + b2 z^-2) / (1 + a1 z^-1 + a2 z^-2)
 *
 * This is the same layout SciPy uses for its `sos` arrays.
 */
export type SosSection = readonly [number, number, number, number, number, number];

/**
 * A filter as a cascade of second-order sections.
 *
 * High-order IIR filters are never run as one big polynomial: the coefficients
 * of, say, a 0.5 Hz high-pass at 500 Hz differ only in their last few digits,
 * and round-off makes the filter inaccurate or unstable. Splitting it into
 * biquads keeps every section well conditioned.
 */
export type Sos = readonly SosSection[];
