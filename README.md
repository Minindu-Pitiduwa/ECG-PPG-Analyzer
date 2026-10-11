# PulseScope

A browser-based ECG and PPG signal analyzer. Load a recording, and PulseScope
cleans the signal, finds each heartbeat and measures heart rate and its
variability. Everything runs locally in the browser; no data is uploaded.

> **For education and research only. Not a medical device. Do not use for diagnosis.**

**Status: in development.** This README is a working stub and will be replaced by
the full version (demo, algorithm notes, validation results) when the project is
complete.

| Phase | Scope                                                         | State |
| ----- | ------------------------------------------------------------- | ----- |
| 1     | Project setup, CI, sample and CSV loading, zoomable plot      | Done  |
| 2     | Filters, verified against SciPy                               | Done  |
| 3     | Pan–Tompkins and PPG beat detection, beat editing, heart rate | Done  |
| 4     | Heart rate variability, ectopic handling, signal quality      | Done  |
| 5     | Rhythm flags, noise lab                                       |       |
| 6     | WFDB import, PDF/CSV/JSON export                              |       |
| 7     | MIT-BIH benchmark, full README, deployment                    |       |

## Run locally

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

## Checks

```bash
npm run lint         # ESLint
npm run typecheck    # TypeScript, strict mode
npm test             # unit tests (Vitest)
npm run build        # production build
npx playwright install chromium   # once
npx playwright test  # end-to-end tests, run against the production build
```

## Project layout

```
src/dsp/         signal processing: pure TypeScript, no browser or React imports
src/io/          file parsers and the sample loader
src/workers/     Web Worker that keeps heavy work off the UI thread
src/store/       Zustand stores
src/components/  shared UI and plot components
src/features/    the Load, Analyze and Report screens
tests/           unit tests
e2e/             Playwright tests
validation/      Python scripts that build samples and reference data (not needed to run the app)
public/samples/  bundled sample recordings
```

## Reference data for the filter tests

The filter tests compare the TypeScript output with SciPy's, stored in
`tests/fixtures/filters.json`. The detector tests use the MIT-BIH beat
annotations and the BIDMC monitor's pulse rate for the bundled samples, stored
in `tests/fixtures/sample_refs.json`. To regenerate them (after the Python
setup below):

```bash
validation/.venv/bin/python validation/gen_fixtures.py
validation/.venv/bin/python validation/gen_sample_refs.py
validation/.venv/bin/python validation/gen_hrv_fixtures.py
```

The HRV tests compare against NeuroKit2 (time domain, Poincaré) and SciPy
(Lomb–Scargle, Welch), stored in `tests/fixtures/hrv.json`.

## Detector benchmark (preview)

The Pan–Tompkins detector can already be scored on all 48 MIT-BIH Arrhythmia
records. The full write-up comes in phase 7.

```bash
validation/.venv/bin/python validation/benchmark/export_mitdb.py   # downloads ~100 MB once
npx tsx validation/benchmark/run_ts.ts
```

## Sample data

The bundled recordings are excerpts from the MIT-BIH Arrhythmia Database and the
BIDMC PPG and Respiration Dataset (PhysioNet). See
[DATA_LICENSES.md](DATA_LICENSES.md). To regenerate them:

```bash
python -m venv validation/.venv
validation/.venv/bin/pip install -r validation/requirements.txt
validation/.venv/bin/python validation/make_samples.py
```

## License

MIT. See [LICENSE](LICENSE). Sample data keeps its own license.
