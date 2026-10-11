"""Download the MIT-BIH Arrhythmia Database and export it for the TypeScript benchmark.

For each of the 48 records this writes, into validation/data/mitdb-export/:
  <record>.i16   first channel as little-endian int16 ADC counts
and one records.json with the sampling rate, gain, baseline, lead name, the
sample indices of the reference beat annotations, and the annotated rhythm
changes (used to check the irregular-rhythm flag).

Only beat annotations are exported. Rhythm changes, noise marks and other
non-beat annotations are not heartbeats and must not be scored.

Usage:  python validation/benchmark/export_mitdb.py
"""

from __future__ import annotations

import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import wfdb

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
RAW_DIR = DATA_DIR / "mitdb"
OUT_DIR = DATA_DIR / "mitdb-export"
BASE_URL = "https://physionet.org/files/mitdb/1.0.0/"

# The WFDB beat annotation codes (https://archive.physionet.org/physiobank/annotations.shtml).
BEAT_SYMBOLS = set("NLRBAaJSVrFejnE/fQ?")

# Records with paced beats, conventionally reported separately (ANSI/AAMI EC57).
PACED_RECORDS = {"102", "104", "107", "217"}


def download(records: list[str]) -> None:
    """Fetch any record files that are not on disk yet, a few at a time."""
    wanted = [f"{name}.{ext}" for name in records for ext in ("hea", "dat", "atr")]
    missing = [file for file in wanted if not (RAW_DIR / file).exists()]
    if not missing:
        return
    print(f"downloading {len(missing)} files from PhysioNet ...")

    def fetch(file: str) -> None:
        partial = RAW_DIR / f"{file}.part"
        urllib.request.urlretrieve(BASE_URL + file, partial)
        partial.rename(RAW_DIR / file)  # only complete downloads get the final name

    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(fetch, missing))


def main() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    records = wfdb.get_record_list("mitdb")
    download(records)

    index = []
    for name in records:
        record = wfdb.rdrecord(str(RAW_DIR / name), channels=[0], physical=False)
        annotation = wfdb.rdann(str(RAW_DIR / name), "atr")
        adc = record.d_signal[:, 0]
        adc.astype("<i2").tofile(OUT_DIR / f"{name}.i16")
        beat_pairs = [(int(s), sym) for s, sym in zip(annotation.sample, annotation.symbol) if sym in BEAT_SYMBOLS]
        beats = [sample for sample, _ in beat_pairs]
        # Rhythm changes are '+' annotations whose note names the rhythm that starts there, e.g. "(AFIB".
        rhythms = [
            {"sample": int(s), "rhythm": note.strip("\x00 ").lstrip("(")}
            for s, sym, note in zip(annotation.sample, annotation.symbol, annotation.aux_note)
            if sym == "+"
        ]
        index.append(
            {
                "record": name,
                "fs": int(record.fs),
                "length": int(adc.size),
                "gain": float(record.adc_gain[0]),
                "baseline": int(record.baseline[0]),
                "lead": record.sig_name[0],
                "paced": name in PACED_RECORDS,
                "beats": beats,
                # One annotation code per beat, e.g. N normal, V premature ventricular, / paced.
                "symbols": "".join(symbol for _, symbol in beat_pairs),
                "rhythms": rhythms,
            }
        )
    (OUT_DIR / "records.json").write_text(json.dumps(index) + "\n")
    total = sum(len(entry["beats"]) for entry in index)
    print(f"exported {len(index)} records, {total} reference beats -> {OUT_DIR}")


if __name__ == "__main__":
    main()
