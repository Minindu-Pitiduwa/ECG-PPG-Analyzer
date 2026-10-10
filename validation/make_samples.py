"""Build the sample recordings bundled with the app.

Each sample is a short slice of a PhysioNet record, stored as raw little-endian
int16 ADC counts (<id>.i16) plus an entry in index.json carrying the gain and
baseline needed to convert back to physical units:

    physical = (adc - baseline) / gain

Storing ADC counts keeps the files small and bit-exact with the source.

Usage:  python validation/make_samples.py
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import wfdb

OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "samples"
LICENSE = "Open Data Commons Attribution License v1.0"


@dataclass(frozen=True)
class SampleSpec:
    id: str
    title: str
    description: str
    kind: str  # "ecg" | "ppg"
    database: str  # PhysioNet directory name
    record: str
    channel: int
    start_s: int
    duration_s: int
    source: str


MITDB = "MIT-BIH Arrhythmia Database v1.0.0 (Moody & Mark, 2001), https://doi.org/10.13026/C2F305"
BIDMC = (
    "BIDMC PPG and Respiration Dataset v1.0.0 (Pimentel et al., 2017), "
    "https://doi.org/10.13026/C2208R"
)

SPECS = [
    SampleSpec(
        "ecg-normal",
        "ECG: normal sinus rhythm",
        "MIT-BIH record 100, lead MLII. Clean signal with a steady rhythm.",
        "ecg", "mitdb", "100", 0, 0, 300, MITDB,
    ),
    SampleSpec(
        "ecg-ectopic",
        "ECG: frequent ectopic beats",
        "MIT-BIH record 119, lead MLII. Many premature ventricular beats.",
        "ecg", "mitdb", "119", 0, 0, 300, MITDB,
    ),
    SampleSpec(
        "ecg-noisy",
        "ECG: noisy recording",
        "MIT-BIH record 105, lead MLII. Baseline wander and muscle noise.",
        "ecg", "mitdb", "105", 0, 900, 300, MITDB,
    ),
    SampleSpec(
        "ppg-finger",
        "PPG: fingertip pulse oximeter",
        "BIDMC record 01, PLETH channel. Bedside monitor photoplethysmogram.",
        "ppg", "bidmc", "bidmc01", 1, 0, 300, BIDMC,
    ),
]


def build(spec: SampleSpec) -> dict:
    header = wfdb.rdheader(spec.record, pn_dir=spec.database)
    fs = int(header.fs)
    start = spec.start_s * fs
    stop = start + spec.duration_s * fs
    record = wfdb.rdrecord(
        spec.record,
        pn_dir=spec.database,
        sampfrom=start,
        sampto=stop,
        channels=[spec.channel],
        physical=False,
    )
    adc = record.d_signal[:, 0]
    if adc.min() < -32768 or adc.max() > 32767:
        raise ValueError(f"{spec.id}: samples do not fit in int16")

    file_name = f"{spec.id}.i16"
    adc.astype("<i2").tofile(OUT_DIR / file_name)

    units = record.units[0]
    return {
        "id": spec.id,
        "title": spec.title,
        "description": spec.description,
        "kind": spec.kind,
        "file": file_name,
        "fs": fs,
        "length": int(adc.size),
        "gain": float(record.adc_gain[0]),
        "baseline": int(record.baseline[0]),
        # BIDMC labels the pleth channel "NU" (normalised units); treat as arbitrary.
        "units": "mV" if units == "mV" else "a.u.",
        "channel": record.sig_name[0].strip(", "),
        "record": spec.record,
        "startS": spec.start_s,
        "source": spec.source,
        "license": LICENSE,
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    index = [build(spec) for spec in SPECS]
    (OUT_DIR / "index.json").write_text(json.dumps(index, indent=2) + "\n")
    for entry in index:
        print(f"{entry['id']}: {entry['length']} samples @ {entry['fs']} Hz")


if __name__ == "__main__":
    main()
