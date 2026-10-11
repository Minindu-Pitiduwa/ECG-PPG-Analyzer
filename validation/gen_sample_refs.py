"""Reference values for the bundled sample recordings, used by the detector tests.

Writes tests/fixtures/sample_refs.json with:
  - for each ECG sample, the times of the cardiologist-reviewed beat annotations
    of the MIT-BIH Arrhythmia Database that fall inside the excerpt;
  - for the PPG sample, the mean pulse rate reported by the bedside monitor
    over the same five minutes (BIDMC "numerics" record, PULSE channel).

Neither comes from this project's own algorithms, so they are independent
checks on the detectors.

Usage:  python validation/gen_sample_refs.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import wfdb

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "fixtures" / "sample_refs.json"
BEAT_SYMBOLS = set("NLRBAaJSVrFejnE/fQ?")


def main() -> None:
    index = json.loads((ROOT / "public" / "samples" / "index.json").read_text())
    refs: dict[str, dict] = {}
    for info in index:
        fs = info["fs"]
        start = info["startS"] * fs
        stop = start + info["length"]
        if info["kind"] == "ecg":
            annotation = wfdb.rdann(info["record"], "atr", pn_dir="mitdb", sampfrom=start, sampto=stop)
            beats = [
                (int(sample) - start) / fs
                for sample, symbol in zip(annotation.sample, annotation.symbol)
                if symbol in BEAT_SYMBOLS
            ]
            refs[info["id"]] = {"beatTimesS": beats}
        else:
            numerics = wfdb.rdrecord(info["record"] + "n", pn_dir="bidmc")
            channel = [name.strip(", ") for name in numerics.sig_name].index("PULSE")
            seconds = info["length"] // fs
            first = int(info["startS"] * numerics.fs)
            pulse = numerics.p_signal[first : first + int(seconds * numerics.fs), channel]
            refs[info["id"]] = {"monitorMeanPulseBpm": float(np.nanmean(pulse))}
    OUT.write_text(json.dumps(refs) + "\n")
    for sample_id, ref in refs.items():
        summary = f"{len(ref['beatTimesS'])} beats" if "beatTimesS" in ref else f"{ref['monitorMeanPulseBpm']:.2f} bpm"
        print(f"{sample_id}: {summary}")


if __name__ == "__main__":
    main()
