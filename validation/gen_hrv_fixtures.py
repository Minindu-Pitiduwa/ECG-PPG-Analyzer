"""Generate NeuroKit2 and SciPy reference values for the TypeScript HRV tests.

Writes tests/fixtures/hrv.json. For several interval series it stores:
  - time-domain measures and Poincaré SD1/SD2 from NeuroKit2;
  - the Lomb-Scargle periodogram from scipy.signal.lombscargle;
  - the 4 Hz linear resampling (numpy.interp) and its Welch spectrum from
    scipy.signal.welch.

Usage:  python validation/gen_hrv_fixtures.py   (after gen_sample_refs.py)
"""

from __future__ import annotations

import json
from pathlib import Path

import neurokit2 as nk
import numpy as np
import scipy
from scipy import signal

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "fixtures" / "hrv.json"
RESAMPLE_HZ = 4.0


def synthetic(n: int, seed: int) -> np.ndarray:
    """Intervals with a slow (LF) and a breathing-rate (HF) rhythm plus noise."""
    rng = np.random.default_rng(seed)
    rr = np.full(n, 850.0)
    for _ in range(3):  # the modulation depends on time, which depends on the intervals
        t = np.cumsum(rr) / 1000.0
        rr = 850 + 40 * np.sin(2 * np.pi * 0.1 * t) + 25 * np.sin(2 * np.pi * 0.25 * t)
    return rr + rng.normal(0, 8, n)


def real_record_100() -> np.ndarray:
    refs = json.loads((ROOT / "tests" / "fixtures" / "sample_refs.json").read_text())
    return np.diff(np.asarray(refs["ecg-normal"]["beatTimesS"])) * 1000.0


def case(name: str, rr: np.ndarray) -> dict:
    t = np.cumsum(rr) / 1000.0
    intervals = {"RRI": rr, "RRI_Time": t}
    time = nk.hrv_time(intervals)
    nonlinear = nk.hrv_nonlinear(intervals)

    freqs = np.linspace(0.01, 0.5, 50)
    periodogram = signal.lombscargle(t, rr - rr.mean(), 2 * np.pi * freqs)

    grid = t[0] + np.arange(int(np.floor((t[-1] - t[0]) * RESAMPLE_HZ)) + 1) / RESAMPLE_HZ
    resampled = np.interp(grid, t, rr)
    segment = min(1024, 2 ** int(np.floor(np.log2(resampled.size))))
    welch_f, welch_p = signal.welch(
        resampled, fs=RESAMPLE_HZ, window="hann", nperseg=segment, noverlap=segment // 2,
        detrend="constant", scaling="density",
    )
    return {
        "name": name,
        "rrMs": rr.tolist(),
        "timeS": t.tolist(),
        "meanNN": float(time["HRV_MeanNN"].iloc[0]),
        "sdnn": float(time["HRV_SDNN"].iloc[0]),
        "rmssd": float(time["HRV_RMSSD"].iloc[0]),
        "pnn50": float(time["HRV_pNN50"].iloc[0]),
        "sd1": float(nonlinear["HRV_SD1"].iloc[0]),
        "sd2": float(nonlinear["HRV_SD2"].iloc[0]),
        "lombFreqHz": freqs.tolist(),
        "lombPower": periodogram.tolist(),
        "resampled": resampled.tolist(),
        "welchSegment": segment,
        "welchFreqHz": welch_f.tolist(),
        "welchPower": welch_p.tolist(),
    }


def main() -> None:
    cases = [
        case("MIT-BIH record 100, first 5 minutes (annotated beats)", real_record_100()),
        case("synthetic, 350 intervals with LF and HF rhythms", synthetic(350, 1)),
        case("synthetic, 2100 intervals (about 30 minutes)", synthetic(2100, 2)),
        case("short, 12 intervals", synthetic(12, 3)),
    ]
    fixture = {
        "generator": (
            f"validation/gen_hrv_fixtures.py (neurokit2 {nk.__version__}, "
            f"scipy {scipy.__version__}, numpy {np.__version__})"
        ),
        "cases": cases,
    }
    OUT.write_text(json.dumps(fixture) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} kB)")
    for entry in cases:
        print(f"  {entry['name']}: SDNN {entry['sdnn']:.2f}  RMSSD {entry['rmssd']:.2f}  pNN50 {entry['pnn50']:.2f}  SD1 {entry['sd1']:.2f}  SD2 {entry['sd2']:.2f}")


if __name__ == "__main__":
    main()
