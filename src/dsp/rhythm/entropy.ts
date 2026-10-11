/**
 * Sample entropy of a short series.
 *
 * Counts how often two stretches of the series that are alike for `m` points
 * (every point within `r`) are still alike at the next point. If the series is
 * predictable, similar pasts lead to similar futures and the entropy is low;
 * if it is erratic, they do not and the entropy is high.
 *
 *   SampEn = -ln(A / B)
 *
 * with B the number of pairs of templates of length `m` that match and A the
 * number of those pairs that still match at length `m + 1`. A template is
 * never compared with itself.
 *
 * Returns `Infinity` when some templates match at length `m` but none at
 * `m + 1` (as unpredictable as this series can show), and `NaN` when there are
 * no matches at all, so nothing can be said.
 *
 * Reference: Richman & Moorman, "Physiological time-series analysis using
 * approximate entropy and sample entropy", Am. J. Physiol. Heart Circ.
 * Physiol. 278(6):H2039–H2049, 2000.
 *
 * @param m template length
 * @param r tolerance, in the units of `x`
 */
export function sampleEntropy(x: ArrayLike<number>, m: number, r: number): number {
  const templates = x.length - m;
  let matchesM = 0;
  let matchesM1 = 0;
  for (let i = 0; i < templates; i++) {
    for (let j = i + 1; j < templates; j++) {
      let k = 0;
      while (k < m && Math.abs(x[i + k] - x[j + k]) <= r) k++;
      if (k < m) continue;
      matchesM++;
      if (Math.abs(x[i + m] - x[j + m]) <= r) matchesM1++;
    }
  }
  if (matchesM === 0) return NaN;
  if (matchesM1 === 0) return Infinity;
  // Written as ln(B / A), which is the same number but gives +0, not -0, for a perfectly regular series.
  return Math.log(matchesM / matchesM1);
}

/**
 * Coefficient of sample entropy (COSEn), a variant designed for telling atrial
 * fibrillation from other rhythms in windows as short as 12 beats.
 *
 *   COSEn = SampEn + ln(2r) - ln(mean interval)
 *
 * Adding ln(2r) turns the match probability into a density, which removes most
 * of the dependence on the tolerance chosen. Subtracting the log of the mean
 * interval corrects for heart rate: a fast rhythm has smaller intervals and so
 * smaller absolute differences, which would otherwise look more regular.
 *
 * Reference: Lake & Moorman, "Accurate estimation of entropy in very short
 * physiological time series: the problem of atrial fibrillation detection in
 * implanted ventricular devices", Am. J. Physiol. Heart Circ. Physiol.
 * 300(1):H319–H325, 2011. The paper recommends `m = 1` and `r = 30 ms`.
 *
 * @param intervalsMs beat-to-beat intervals in milliseconds
 */
export function coefficientOfSampleEntropy(
  intervalsMs: ArrayLike<number>,
  m = 1,
  rMs = 30,
): number {
  let sum = 0;
  for (let i = 0; i < intervalsMs.length; i++) sum += intervalsMs[i];
  const mean = sum / intervalsMs.length;
  return sampleEntropy(intervalsMs, m, rMs) + Math.log(2 * rMs) - Math.log(mean);
}
