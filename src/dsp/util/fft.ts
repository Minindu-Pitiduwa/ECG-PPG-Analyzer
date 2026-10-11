/**
 * In-place radix-2 fast Fourier transform (iterative Cooley–Tukey).
 * `re` and `im` hold the real and imaginary parts and are overwritten.
 *
 * @throws RangeError when the length is not a power of two
 */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n !== im.length || n === 0 || (n & (n - 1)) !== 0) {
    throw new RangeError(`FFT length must be a power of two, got ${n}.`);
  }
  // Reorder into bit-reversed positions so the butterflies can run in place.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const angle = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const cos = Math.cos(angle * k);
        const sin = Math.sin(angle * k);
        const a = start + k;
        const b = a + half;
        const tre = re[b] * cos - im[b] * sin;
        const tim = re[b] * sin + im[b] * cos;
        re[b] = re[a] - tre;
        im[b] = im[a] - tim;
        re[a] += tre;
        im[a] += tim;
      }
    }
  }
}

/** Largest power of two that is not greater than `n` (0 for `n < 1`). */
export function floorPowerOfTwo(n: number): number {
  if (n < 1) return 0;
  return 2 ** Math.floor(Math.log2(n));
}
