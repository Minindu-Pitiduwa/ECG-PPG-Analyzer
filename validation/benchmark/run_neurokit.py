"""Run NeuroKit2's QRS detectors on the same MIT-BIH signals the TypeScript
benchmark uses, and save the detected peaks so both can be scored by the very
same scoring code (validation/benchmark/run_ts.ts --external ...).

Two NeuroKit2 methods are run, each with its matching cleaning step, as the
NeuroKit2 documentation recommends:
  - "neurokit":         NeuroKit2's own default detector
  - "pantompkins1985":  NeuroKit2's implementation of Pan & Tompkins

Prerequisite:  python validation/benchmark/export_mitdb.py
Usage:         python validation/benchmark/run_neurokit.py
"""

from __future__ import annotations

import json
import time
import warnings
from pathlib import Path

import neurokit2 as nk
import numpy as np

EXPORT_DIR = Path(__file__).resolve().parent.parent / "data" / "mitdb-export"
OUT = Path(__file__).resolve().parent / "results" / "neurokit_peaks.json"
METHODS = ["neurokit", "pantompkins1985"]


def main() -> None:
    records = json.loads((EXPORT_DIR / "records.json").read_text())
    peaks: dict[str, dict[str, list[int]]] = {method: {} for method in METHODS}
    for method in METHODS:
        started = time.time()
        for entry in records:
            adc = np.fromfile(EXPORT_DIR / f"{entry['record']}.i16", dtype="<i2")
            ecg = (adc - entry["baseline"]) / entry["gain"]
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                cleaned = nk.ecg_clean(ecg, sampling_rate=entry["fs"], method=method)
                _, info = nk.ecg_peaks(cleaned, sampling_rate=entry["fs"], method=method)
            peaks[method][entry["record"]] = [int(p) for p in info["ECG_R_Peaks"]]
        print(f"{method}: {len(records)} records in {time.time() - started:.0f} s", flush=True)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({"generator": f"neurokit2 {nk.__version__}", "methods": peaks}) + "\n"
    )
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
