"""Generate SciPy reference outputs for the TypeScript filter tests.

Writes tests/fixtures/filters.json. The Vitest suite designs the same filters
in TypeScript, runs them on the same input, and requires agreement with these
numbers to a stated tolerance. Re-run after changing the cases below:

    python validation/gen_fixtures.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import scipy
from scipy import ndimage, signal

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "fixtures" / "filters.json"

# (name, order, band, cutoff Hz, fs)
BUTTER_CASES = [
    ("lowpass order 2, 40 Hz @ 360 Hz", 2, "low", 40.0, 360.0),
    ("lowpass order 3 (odd), 8 Hz @ 125 Hz", 3, "low", 8.0, 125.0),
    ("lowpass order 5, 100 Hz @ 500 Hz", 5, "low", 100.0, 500.0),
    ("highpass order 2, 0.5 Hz @ 360 Hz", 2, "high", 0.5, 360.0),
    ("highpass order 4, 0.5 Hz @ 1000 Hz (narrow)", 4, "high", 0.5, 1000.0),
    ("highpass order 1, 1 Hz @ 250 Hz", 1, "high", 1.0, 250.0),
    ("bandpass order 2, 5-15 Hz @ 360 Hz", 2, "band", [5.0, 15.0], 360.0),
    ("bandpass order 3 (odd), 0.5-8 Hz @ 125 Hz", 3, "band", [0.5, 8.0], 125.0),
    ("bandpass order 1, 1-100 Hz @ 250 Hz (wide, real poles)", 1, "band", [1.0, 100.0], 250.0),
]

# (name, f0 Hz, Q, fs)
NOTCH_CASES = [
    ("notch 50 Hz Q30 @ 360 Hz", 50.0, 30.0, 360.0),
    ("notch 60 Hz Q30 @ 500 Hz", 60.0, 30.0, 500.0),
    ("notch 50 Hz Q5 @ 125 Hz", 50.0, 5.0, 125.0),
]

MEDIAN_SIZES = [1, 5, 73, 217]
N_SAMPLES = 1200
N_FREQS = 64


def test_signal() -> np.ndarray:
    """Slow drift, a few tones, sharp spikes and noise: something for every filter to act on."""
    rng = np.random.default_rng(20261010)
    t = np.arange(N_SAMPLES) / 360.0
    x = (
        0.8 * np.sin(2 * np.pi * 0.3 * t)
        + 0.5 * np.sin(2 * np.pi * 7.0 * t + 0.4)
        + 0.3 * np.sin(2 * np.pi * 50.0 * t)
        + 0.1 * rng.standard_normal(N_SAMPLES)
        + 1.5  # DC offset, so the edge handling is exercised
    )
    x[::173] += 2.0
    return x


def response(sos: np.ndarray, fs: float) -> tuple[list[float], list[float]]:
    freqs = np.geomspace(0.05, 0.49 * fs, N_FREQS)
    _, h = signal.sosfreqz(sos, worN=freqs, fs=fs)
    return freqs.tolist(), np.abs(h).tolist()


def filter_case(name: str, params: dict, sos: np.ndarray, fs: float, x: np.ndarray) -> dict:
    freqs, magnitude = response(sos, fs)
    return {
        "name": name,
        **params,
        "fs": fs,
        "freqHz": freqs,
        "magnitude": magnitude,
        "filtfilt": signal.sosfiltfilt(sos, x).tolist(),
        "causal": signal.sosfilt(sos, x).tolist(),
    }


def ecg_case() -> dict:
    """The app's default ECG chain on real data: 10 s of the bundled MIT-BIH record 100."""
    index = json.loads((ROOT / "public" / "samples" / "index.json").read_text())
    info = next(entry for entry in index if entry["id"] == "ecg-normal")
    fs = float(info["fs"])
    n = int(10 * fs)
    adc = np.fromfile(ROOT / "public" / "samples" / info["file"], dtype="<i2", count=n)
    x = (adc - info["baseline"]) / info["gain"]
    sos = np.vstack(
        [
            signal.butter(2, 0.5, "highpass", fs=fs, output="sos"),
            signal.tf2sos(*signal.iirnotch(50.0, 30.0, fs=fs)),
            signal.butter(2, 40.0, "lowpass", fs=fs, output="sos"),
        ]
    )
    return {"sample": "ecg-normal", "length": n, "filtfilt": signal.sosfiltfilt(sos, x).tolist()}


def main() -> None:
    x = test_signal()
    butter = [
        filter_case(
            name,
            {"order": order, "band": band, "cutoffHz": cutoff},
            signal.butter(order, cutoff, {"low": "lowpass", "high": "highpass", "band": "bandpass"}[band], fs=fs, output="sos"),
            fs,
            x,
        )
        for name, order, band, cutoff, fs in BUTTER_CASES
    ]
    notch = [
        filter_case(name, {"f0Hz": f0, "q": q}, signal.tf2sos(*signal.iirnotch(f0, q, fs=fs)), fs, x)
        for name, f0, q, fs in NOTCH_CASES
    ]
    median = [
        {"size": size, "output": ndimage.median_filter(x, size=size, mode="nearest").tolist()}
        for size in MEDIAN_SIZES
    ]
    fixture = {
        "generator": f"validation/gen_fixtures.py (scipy {scipy.__version__}, numpy {np.__version__})",
        "input": x.tolist(),
        "butter": butter,
        "notch": notch,
        "median": median,
        "ecgDefaultChain": ecg_case(),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fixture) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} kB)")


if __name__ == "__main__":
    main()
