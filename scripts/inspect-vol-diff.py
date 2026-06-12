"""Inspect VOL diff SQLite tensor vs npz vs txt for critical tickers."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
ALL = [
    "GAZP", "LKOH", "ROSN", "NVTK", "TATN", "SBER", "VTBR", "MOEX",
    "CHMF", "NLMK", "GMKN", "MGNT", "MTSS", "YDEX", "RUAL", "PLZL",
    "AFLT", "HYDR", "IRAO", "BR", "EU",
]
NPZ_IDX = 2759
MSK = "20191230"


def vol_series(t: np.ndarray, sym: str) -> np.ndarray:
    i = ALL.index(sym) * 5 + 4
    return t[:, i]


def txt_day_agg(sym: str, msk: str) -> pd.DataFrame:
    if sym == "BR":
        path = ROOT / "indexes" / "BR.txt"
    elif sym == "EU":
        path = ROOT / "indexes" / "Eu.txt"
    else:
        path = ROOT / "tickers" / f"{sym}.txt"
    df = pd.read_csv(path, sep=",", dtype=str, skipinitialspace=True)
    df.columns = [c.strip().replace("<", "").replace(">", "").upper() for c in df.columns]
    ds = df["DATE"].str.strip()
    ts = df["TIME"].str.strip().str.zfill(6)
    df.index = pd.to_datetime(ds + ts, format="%Y%m%d%H%M%S")
    df = df.sort_index()
    for col in ["OPEN", "HIGH", "LOW", "CLOSE", "VOL"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    day = df[df.index.normalize() == pd.Timestamp(msk)]
    start = day.index.min().floor("D") + pd.Timedelta(hours=10)
    end = day.index.min().floor("D") + pd.Timedelta(hours=18, minutes=50)
    grid = pd.date_range(start, end, freq="5min")
    agg = (
        day.resample("5min", label="right", closed="right")
        .agg({"OPEN": "first", "HIGH": "max", "LOW": "min", "CLOSE": "last", "VOL": "sum"})
        .reindex(grid)
        .ffill()
        .bfill()
    )
    return agg


def main() -> None:
    sqlite = np.array(
        json.loads((ROOT / "tmp/analytics-tensor-dump.json").read_text())["tensor"],
        dtype=np.float32,
    )
    npz = np.load(ROOT / "timeVAE/data/mosbirzha_5min_v2_V10000_cond_v2.npz")["data"][NPZ_IDX]

    print(f"=== VOL diff vs npz[{NPZ_IDX}] ===")
    for sym in ["VTBR", "GMKN", "HYDR", "PLZL", "GAZP", "BR", "YDEX"]:
        s = vol_series(sqlite, sym)
        n = vol_series(npz, sym)
        d = np.abs(s - n)
        j = int(d.argmax())
        ratio = s[j] / n[j] if n[j] != 0 else float("inf")
        print(
            f"{sym:5} max_diff={d.max():.4f} slot={j} "
            f"sqlite={s[j]:.4f} npz={n[j]:.4f} ratio={ratio:.2f}"
        )

    print(f"\n=== VTBR txt vs sqlite vs npz (slots 0-3, 105) ===")
    agg = txt_day_agg("VTBR", MSK)
    i = ALL.index("VTBR") * 5 + 4
    for slot in [0, 1, 2, 3, 105]:
        raw = float(agg.iloc[slot]["VOL"])
        txt_scaled = raw / 10_000.0
        print(
            f"slot {slot:3d}: txt_raw={raw:.0f} txt_scaled={txt_scaled:.4f} "
            f"sqlite={sqlite[slot, i]:.4f} npz={npz[slot, i]:.4f}"
        )

    print(f"\n=== GMKN slot 105 ===")
    i = ALL.index("GMKN") * 5 + 4
    agg = txt_day_agg("GMKN", MSK)
    raw = float(agg.iloc[105]["VOL"])
    print(
        f"txt_raw={raw:.0f} txt_scaled={raw/10000:.4f} "
        f"sqlite={sqlite[105, i]:.4f} npz={npz[105, i]:.4f}"
    )


if __name__ == "__main__":
    main()
