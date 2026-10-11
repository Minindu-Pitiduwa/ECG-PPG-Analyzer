/**
 * Plain-language explanations shown in info tooltips. Kept in one place so
 * the wording stays consistent and can be reviewed without reading UI code.
 */
export const GLOSSARY = {
  meanHeartRate:
    'Average beats per minute, from the normal beat-to-beat intervals. A resting adult is typically between 60 and 100; athletes and sleeping people are often lower.',
  sdnn: 'Standard deviation of the normal beat-to-beat intervals: overall variability. Healthy adults at rest average about 50 ms over 5 minutes, with a wide spread. It grows with recording length, so only compare recordings of similar duration.',
  rmssd:
    'Root mean square of the differences between neighbouring intervals: fast, beat-to-beat variability driven mainly by the vagus nerve. Healthy adults at rest average about 40 ms. It is very sensitive to missed or extra beats.',
  pnn50:
    'Percentage of neighbouring intervals that differ by more than 50 ms. Like RMSSD it reflects fast, vagal variability. Unreliable with fewer than a few hundred beats.',
  meanNN: 'Average normal beat-to-beat interval. 1000 ms is 60 beats per minute; 600 ms is 100.',
  signalQuality:
    'Share of the recording, in 10-second segments, where the beats look alike and none are missing for several seconds. Low-quality segments are shaded grey on the plot and left out of the variability metrics.',
  excluded:
    'Intervals left out of the variability metrics: much shorter or longer than their neighbours (ectopic beats, missed or false detections), impossible for a heart, or in a low-quality segment. If many are excluded, treat the metrics with caution.',
  tachogram:
    'Each beat-to-beat interval over time. A healthy rhythm wanders gently. Flagged points are excluded from the variability metrics. Click to jump to that moment.',
  spectrum:
    'How the variability is spread over rhythm speeds. HF (0.15–0.4 Hz) is the breathing rhythm and reflects vagal activity. LF (0.04–0.15 Hz) mixes several influences. The LF/HF ratio is often called "sympathovagal balance", but that reading is disputed; do not over-interpret it.',
  spectralMethod:
    'Lomb–Scargle works directly on the unevenly spaced beats and copes with excluded intervals. Welch first resamples the intervals at 4 Hz, the classical approach, which slightly reduces fast (HF) power.',
  vlf: 'Very slow rhythms, below 0.04 Hz. Needs at least 5 minutes of data to estimate.',
  lf: 'Low-frequency power, 0.04–0.15 Hz: rhythms with a period of 7 to 25 seconds, influenced by both branches of the autonomic nervous system and by blood-pressure regulation.',
  hf: 'High-frequency power, 0.15–0.4 Hz: the breathing rhythm (respiratory sinus arrhythmia), driven by the vagus nerve. Breathing slower than 9 breaths per minute moves it into the LF band.',
  lfHf: 'LF power divided by HF power. Values depend strongly on breathing rate and posture. Its interpretation as a balance between stress and relaxation is not well supported.',
  poincare:
    'Each interval plotted against the next. A healthy rhythm forms a comet or ellipse along the diagonal. A tight ball means little variability; a wide, scattered cloud suggests an irregular rhythm or remaining artifacts.',
  sd1: 'Width of the Poincaré cloud across the diagonal: beat-to-beat variability. It equals RMSSD divided by about 1.41.',
  sd2: 'Length of the Poincaré cloud along the diagonal: slower, longer-term variability.',
  minHeartRate:
    'Slowest rate between two neighbouring normal beats. Intervals flagged as ectopic, implausible or noisy are left out.',
  maxHeartRate:
    'Fastest rate between two neighbouring normal beats. Intervals flagged as ectopic, implausible or noisy are left out.',
  beatCount:
    'Number of heartbeats found, after your manual corrections. Compare the markers with the signal to check that none are missing or extra.',
  heartRateTrend:
    'Heart rate from each beat-to-beat interval. Slow waves are normal (breathing, activity). Isolated spikes usually mean a missed, extra or early beat; those are flagged. Click the plot to jump to that moment.',
  editBeats:
    'Correct the automatic detection by hand. While this is on, click a marker to delete it, or click a peak to add a beat. All metrics update at once, and Undo reverts the last change.',
  viewMode:
    'Filtered is the cleaned signal used for analysis. Raw is the recording as loaded. Both overlays them so you can see what the filters removed.',
  mains:
    'Removes hum picked up from mains wiring with a very narrow notch filter. Use 50 Hz in Europe, Asia, Africa and Australia; 60 Hz in the Americas. Turn it off for battery-powered recordings with no hum.',
  baseline:
    'Removes slow drift caused by breathing and movement. The high-pass filter is the standard choice. The median filter copes better with sudden jumps but is slower and less exact.',
  highpass:
    'Frequencies below this are removed. 0.5 Hz suits most recordings; do not go above about 0.67 Hz (40 beats per minute) or slow heart rhythms get distorted.',
  lowpass:
    'Frequencies above this are removed. 40 Hz keeps the ECG beat shape and removes muscle noise; a PPG pulse needs only about 8 Hz. Leave empty to switch the low-pass off.',
  order:
    'How sharply the filters cut. Higher is steeper but rings more after sharp beats. The filter runs forwards and backwards, so the effective steepness is double this.',
  frequencyResponse:
    'How much each frequency is kept (0 dB) or reduced (-20 dB is one tenth of the amplitude). This is the effective response after filtering forwards and backwards.',
} as const;
