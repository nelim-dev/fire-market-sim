"""Fast GAZP/BR column diff: SQLite dump vs npz vs txt prepare_raw (2 tickers only)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
COMPARE = ["GAZP", "BR"]
ALL_TICKERS = [
    "GAZP", "LKOH", "ROSN", "NVTK", "TATN", "SBER", "VTBR", "MOEX",
    "CHMF", "NLMK", "GMKN", "MGNT", "MTSS", "YDEX", "RUAL", "PLZL",
    "AFLT", "HYDR", "IRAO", "BR", "EU",
]
BARS = 107
VOL_SCALE = 10_000.0


def ticker_path(t: str) -> Path:
    if t == "BR":
        return ROOT / "indexes" / "BR.txt"
    return ROOT / "tickers" / f"{t}.txt"


def load_txt(path: Path) -> pd.DataFrame | None:
    df = pd.read_csv(path, sep=",", dtype=str, skipinitialspace=True)
    df.columns = [c.strip().replace("<", "").replace(">", "").upper() for c in df.columns]
    date_str = df["DATE"].str.strip()
    time_str = df["TIME"].str.strip().str.zfill(6)
    df.index = pd.to_datetime(date_str + time_str, format="%Y%m%d%H%M%S")
    df = df.sort_index()
    for col in ["OPEN", "HIGH", "LOW", "CLOSE", "VOL"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    return df[["OPEN", "HIGH", "LOW", "CLOSE", "VOL"]].dropna()


def aggregate_5min(df_day: pd.DataFrame) -> pd.DataFrame:
    start = df_day.index.min().floor("D") + pd.Timedelta(hours=10)
    end = df_day.index.min().floor("D") + pd.Timedelta(hours=18, minutes=50)
    grid = pd.date_range(start, end, freq="5min")
    df_agg = df_day.resample("5min", label="right", closed="right").agg(
        {"OPEN": "first", "HIGH": "max", "LOW": "min", "CLOSE": "last", "VOL": "sum"}
    ).reindex(grid)
    return df_agg.ffill().bfill()


def build_ticker_day_series(ticker: str, target: pd.Timestamp) -> np.ndarray | None:
    df = load_txt(ticker_path(ticker))
    if df is None or df.empty:
        return None
    first = df.index.normalize().min()
    trading_days = sorted(df.index.normalize().unique())
    if target not in trading_days:
        return None
    last_known: np.ndarray | None = None
    out: np.ndarray | None = None
    for day in trading_days:
        if day > target:
            break
        if day < first:
            arr = np.zeros((BARS, 5), dtype=np.float32)
        else:
            df_day = df[df.index.normalize() == day]
            if not df_day.empty:
                arr = aggregate_5min(df_day)[["OPEN", "HIGH", "LOW", "CLOSE", "VOL"]].values.astype(np.float32)[:BARS]
                last_known = arr.copy()
            elif last_known is not None:
                pc = last_known[-1, 3]
                arr = np.full((BARS, 5), [pc, pc, pc, pc, 0.0], dtype=np.float32)
            else:
                arr = np.zeros((BARS, 5), dtype=np.float32)
        arr = np.nan_to_num(arr, nan=0.0)
        arr[:, 4] /= VOL_SCALE
        if day == target:
            out = arr
    return out


def sym_stats_block(block: np.ndarray, sym: str) -> str:
    close = block[:, 3]
    vol = block[:, 4]
    return f"{sym} CLOSE {close.min():.4f}-{close.max():.4f} VOL {vol.min():.4f}-{vol.max():.4f}"


def main() -> None:
    msk = sys.argv[1] if len(sys.argv) > 1 else "20191230"
    target = pd.Timestamp(msk)
    dump_path = ROOT / "tmp" / "analytics-tensor-dump.json"
    sqlite = np.array(json.loads(dump_path.read_text())["tensor"], dtype=np.float32)

    print(f"=== {msk} GAZP/BR focus ===")
    for sym in COMPARE:
        idx = ALL_TICKERS.index(sym)
        sl = slice(idx * 5, idx * 5 + 5)
        txt = build_ticker_day_series(sym, target)
        sq = sqlite[:, sl]
        print(f"\n{sym}:")
        print("  SQLite:", sym_stats_block(sq, sym))
        if txt is not None:
            print("  TXT ref:", sym_stats_block(txt, sym))
            print("  max_abs_diff SQLite vs TXT:", float(np.max(np.abs(sq - txt))))
        else:
            print("  TXT ref: unavailable")

    npz = np.load(ROOT / "timeVAE/data/mosbirzha_5min_v2_V10000_cond_v2.npz")["data"].astype(np.float32)
    gazp_ci = ALL_TICKERS.index("GAZP") * 5 + 3
    best_i, best_m = -1, 1e18
    for j in range(npz.shape[0]):
        d = np.max(np.abs(npz[j, :, gazp_ci] - sqlite[:, gazp_ci]))
        if d < best_m:
            best_m, best_i = d, j
    row = npz[best_i]
    print(f"\nNPZ closest by GAZP close idx={best_i}:")
    for sym in COMPARE:
        idx = ALL_TICKERS.index(sym)
        sl = slice(idx * 5, idx * 5 + 5)
        print(f"  {sym_stats_block(row[:, sl], sym)}")
        print(f"  max_abs_diff SQLite vs NPZ: {float(np.max(np.abs(sqlite[:, sl] - row[:, sl]))):.6f}")


if __name__ == "__main__":
    main()
