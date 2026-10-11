/**
 * Plain-language explanations shown in info tooltips. Kept in one place so
 * the wording stays consistent and can be reviewed without reading UI code.
 */
export const GLOSSARY = {
  meanHeartRate:
    'Average beats per minute over the whole recording. A resting adult is typically between 60 and 100; athletes and sleeping people are often lower.',
  minHeartRate:
    'Slowest rate between two neighbouring beats. A single missed beat halves this value, so check the plot before trusting an unusually low number.',
  maxHeartRate:
    'Fastest rate between two neighbouring beats. A single false detection or an early (ectopic) beat can push it far up.',
  beatCount:
    'Number of heartbeats found, after your manual corrections. Compare the markers with the signal to check that none are missing or extra.',
  heartRateTrend:
    'Heart rate from each beat-to-beat interval. Slow waves are normal (breathing, activity). Isolated spikes usually mean a missed, extra or early beat. Click the plot to jump to that moment.',
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
