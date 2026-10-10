/** Minimal complex arithmetic for filter design. Not exported from the DSP package. */
export interface Complex {
  re: number;
  im: number;
}

export const complex = (re: number, im = 0): Complex => ({ re, im });

export const add = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });

export const sub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im });

export const mul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});

export const scale = (a: Complex, k: number): Complex => ({ re: a.re * k, im: a.im * k });

export function div(a: Complex, b: Complex): Complex {
  const denominator = b.re * b.re + b.im * b.im;
  return {
    re: (a.re * b.re + a.im * b.im) / denominator,
    im: (a.im * b.re - a.re * b.im) / denominator,
  };
}

export const abs = (a: Complex): number => Math.hypot(a.re, a.im);

/** Principal square root (non-negative real part). */
export function sqrt(a: Complex): Complex {
  const magnitude = abs(a);
  const re = Math.sqrt((magnitude + a.re) / 2);
  const im = Math.sqrt((magnitude - a.re) / 2);
  return { re, im: a.im < 0 ? -im : im };
}

export function product(values: readonly Complex[]): Complex {
  return values.reduce(mul, complex(1));
}
