export interface DetectionScore {
  /** Reference beats that were found. */
  truePositives: number;
  /** Detections with no reference beat nearby. */
  falsePositives: number;
  /** Reference beats that were missed. */
  falseNegatives: number;
  /** Share of real beats that were found: TP / (TP + FN). NaN without reference beats. */
  sensitivity: number;
  /** Share of detections that were real: TP / (TP + FP). NaN without detections. */
  positivePredictivity: number;
  /** Harmonic mean of the two. NaN when either is undefined. */
  f1: number;
}

/**
 * Score detected beat times against reference beat times.
 *
 * Both lists are walked in time order. A detection within `toleranceS` of the
 * next unmatched reference beat is a true positive, and each beat can be
 * matched only once, so two detections on one real beat count as one hit and
 * one false positive. 150 ms is the tolerance of ANSI/AAMI EC57, the standard
 * for testing arrhythmia detectors.
 *
 * @param referenceS reference beat times in seconds, increasing
 * @param detectedS detected beat times in seconds, increasing
 */
export function matchBeats(
  referenceS: ArrayLike<number>,
  detectedS: ArrayLike<number>,
  toleranceS = 0.15,
): DetectionScore {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let r = 0;
  let d = 0;
  while (r < referenceS.length && d < detectedS.length) {
    const difference = detectedS[d] - referenceS[r];
    if (Math.abs(difference) <= toleranceS) {
      truePositives++;
      r++;
      d++;
    } else if (difference < 0) {
      falsePositives++;
      d++;
    } else {
      falseNegatives++;
      r++;
    }
  }
  falseNegatives += referenceS.length - r;
  falsePositives += detectedS.length - d;
  return summarize(truePositives, falsePositives, falseNegatives);
}

/** Derive sensitivity, positive predictivity and F1 from the three counts. */
export function summarize(
  truePositives: number,
  falsePositives: number,
  falseNegatives: number,
): DetectionScore {
  const sensitivity = truePositives / (truePositives + falseNegatives);
  const positivePredictivity = truePositives / (truePositives + falsePositives);
  const f1 = (2 * sensitivity * positivePredictivity) / (sensitivity + positivePredictivity);
  return { truePositives, falsePositives, falseNegatives, sensitivity, positivePredictivity, f1 };
}
