/**
 * Plain-language explanations shown in info tooltips. Kept in one place so
 * the wording stays consistent and can be reviewed without reading UI code.
 */
export const GLOSSARY = {
  duration:
    'Length of the recording. Heart rate variability needs at least 2 minutes; 5 minutes is the standard for short-term analysis.',
  samplingRate:
    'Samples per second. Beat timing can be no more precise than one sample, so 250 Hz or more is preferred for variability analysis.',
  sampleCount:
    'Total number of data points. Analysis always uses all of them; only the plot is thinned for drawing.',
  amplitudeRange:
    'Smallest and largest value in the raw recording. A range stuck at a limit of your ADC suggests clipping.',
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
