# Data licenses and attribution

The app code is MIT-licensed (see `LICENSE`). The sample recordings in
`public/samples/` are short excerpts of third-party datasets and keep their own
licenses. They are regenerated from PhysioNet by `validation/make_samples.py`.

| Sample file       | Source record                   | Excerpt                | Dataset license                            |
| ----------------- | ------------------------------- | ---------------------- | ------------------------------------------ |
| `ecg-normal.i16`  | MIT-BIH Arrhythmia DB, rec. 100 | lead MLII, 0:00–5:00   | Open Data Commons Attribution License v1.0 |
| `ecg-ectopic.i16` | MIT-BIH Arrhythmia DB, rec. 119 | lead MLII, 0:00–5:00   | Open Data Commons Attribution License v1.0 |
| `ecg-noisy.i16`   | MIT-BIH Arrhythmia DB, rec. 105 | lead MLII, 15:00–20:00 | Open Data Commons Attribution License v1.0 |
| `ppg-finger.i16`  | BIDMC PPG and Respiration, 01   | PLETH, 0:00–5:00       | Open Data Commons Attribution License v1.0 |

Licenses were checked on the PhysioNet project pages on 2026-10-10. The samples
are unmodified ADC values, cut to length and stored as little-endian int16.

## MIT-BIH Arrhythmia Database (v1.0.0)

- Page: https://physionet.org/content/mitdb/1.0.0/ (DOI: 10.13026/C2F305)
- Moody GB, Mark RG. The impact of the MIT-BIH Arrhythmia Database. _IEEE Eng in
  Med and Biol_ 20(3):45–50 (May–June 2001).

## BIDMC PPG and Respiration Dataset (v1.0.0)

- Page: https://physionet.org/content/bidmc/1.0.0/ (DOI: 10.13026/C2208R)
- Pimentel MAF, Johnson AEW, Charlton PH, et al. Toward a robust estimation of
  respiratory rate from pulse oximeters. _IEEE Trans Biomed Eng_ 64(8):1914–1923
  (2017).

## PhysioNet

- Goldberger AL, Amaral LAN, Glass L, et al. PhysioBank, PhysioToolkit, and
  PhysioNet: components of a new research resource for complex physiologic
  signals. _Circulation_ 101(23):e215–e220 (2000).
