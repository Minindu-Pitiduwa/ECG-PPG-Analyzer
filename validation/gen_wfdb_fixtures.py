"""Small WFDB records for testing the TypeScript reader, with the values the
reference `wfdb` Python package reads back from them.

Writes into tests/fixtures/wfdb/:
  ecg212.hea/.dat   two ECG leads from MIT-BIH record 100, format 212, odd length
  one212.hea/.dat   a single lead in format 212, odd length (the awkward packing case)
  ppg16.hea/.dat    five channels from BIDMC record 01, format 16
  expected.json     for each record, the header fields and every sample as wfdb reads them

Usage:  python validation/gen_wfdb_fixtures.py
"""

from __future__ import annotations

import json
from pathlib import Path

import wfdb

OUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "wfdb"


def write(name: str, source: wfdb.Record, fmt: str, channels: list[int]) -> dict:
    wfdb.wrsamp(
        name,
        fs=source.fs,
        units=[source.units[c] for c in channels],
        sig_name=[source.sig_name[c].strip(", ") for c in channels],
        d_signal=source.d_signal[:, channels],
        fmt=[fmt] * len(channels),
        adc_gain=[source.adc_gain[c] for c in channels],
        baseline=[source.baseline[c] for c in channels],
        write_dir=str(OUT),
    )
    # Read it back the way any WFDB user would: this is the reference the TypeScript reader must match.
    digital = wfdb.rdrecord(str(OUT / name), physical=False)
    physical = wfdb.rdrecord(str(OUT / name))
    return {
        "fs": float(digital.fs),
        "sampleCount": int(digital.sig_len),
        "signals": [
            {
                "description": digital.sig_name[i],
                "units": digital.units[i],
                "gain": float(digital.adc_gain[i]),
                "baseline": int(digital.baseline[i]),
                "format": int(digital.fmt[i]),
                "adc": digital.d_signal[:, i].tolist(),
                "physical": physical.p_signal[:, i].tolist(),
            }
            for i in range(digital.n_sig)
        ],
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    ecg = wfdb.rdrecord("100", pn_dir="mitdb", sampfrom=1000, sampto=1501, physical=False)
    ppg = wfdb.rdrecord("bidmc01", pn_dir="bidmc", sampfrom=0, sampto=400, physical=False)
    expected = {
        "ecg212": write("ecg212", ecg, "212", [0, 1]),
        "one212": write("one212", ecg, "212", [0]),
        "ppg16": write("ppg16", ppg, "16", [0, 1, 2, 3, 4]),
    }
    (OUT / "expected.json").write_text(json.dumps(expected) + "\n")
    for name, record in expected.items():
        print(f"{name}: {len(record['signals'])} signals x {record['sampleCount']} samples")


if __name__ == "__main__":
    main()
