/** A repeatable source of random numbers, so noise experiments give the same result every run. */
export interface Random {
  /** Uniform in [0, 1). */
  uniform: () => number;
  /** Standard normal (mean 0, variance 1). */
  gaussian: () => number;
}

/**
 * Seeded generator (Mulberry32 for uniform numbers, Box–Muller for normal
 * ones). Not cryptographic; chosen because it is tiny, fast and identical on
 * every platform.
 */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  const uniform = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
  const gaussian = () => {
    // 1 - uniform() is in (0, 1], which keeps the logarithm finite.
    const radius = Math.sqrt(-2 * Math.log(1 - uniform()));
    return radius * Math.cos(2 * Math.PI * uniform());
  };
  return { uniform, gaussian };
}
