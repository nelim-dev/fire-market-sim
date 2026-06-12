"""
Build one (107, 105) day tensor from repo txt files — exact prepare_raw_for_official_timevae_v2 logic.
Usage: python build_reference_day_tensor.py --msk 20191230
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
TICKERS_DIR = ROOT / "tickers"
INDEXES_DIR = ROOT / "indexes"

STOCK_TICKERS = [
    "GAZP", "LKOH", "ROSN", "NVTK", "TATN", "SBER", "VTBR", "MOEX",
    "CHMF", "NLMK", "GMKN", "MGNT", "MTSS", "YDEX", "RUAL", "PLZL",
    "AFLT", "HYDR", "IRAO",
]
OTHER_TICKERS = ["BR", "EU"]
ALL_TICKERS = STOCK_TICKERS + OTHER_TICKERS
TICKER_PATH = {t: (TICKERS_DIR / f"{t}.txt") for t in STOCK_TICKERS}
TICKER_PATH["BR"] = INDEXES_DIR / "BR.txt"
TICKER_PATH["EU"] = INDEXES_DIR / "Eu.txt"

BARS = 107
VOL_SCALE = 10_000.0


def load_txt(path: Path) -> pd.DataFrame | None:
    if not path.exists():
        return None
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


def build_all_days() -> tuple[list[pd.Timestamp], dict[str, pd.DataFrame | None]]:
    all_data: dict[str, pd.DataFrame | None] = {}
    for t in ALL_TICKERS:
        all_data[t] = load_txt(TICKER_PATH[t])

    day_counts: dict[pd.Timestamp, int] = {}
    for df in all_data.values():
        if df is not None and not df.empty:
            for day in df.index.normalize().unique():
                day_counts[day] = day_counts.get(day, 0) + 1
    threshold = len(ALL_TICKERS) * 0.75
    trading_days = sorted(d for d, cnt in day_counts.items() if cnt >= threshold)
    return trading_days, all_data


def tensor_for_msk(msk: str) -> np.ndarray | None:
    target = pd.Timestamp(msk)
    trading_days, all_data = build_all_days()
    if target not in trading_days:
        # find by string match on normalize
        matches = [d for d in trading_days if d.strftime("%Y%m%d") == msk]
        if not matches:
            return None
        target = matches[0]

    first_listing = {}
    for t, df in all_data.items():
        if df is not None and not df.empty:
            first_listing[t] = df.index.normalize().min()
        else:
            first_listing[t] = pd.Timestamp.max

    last_known: dict[str, np.ndarray | None] = {t: None for t in ALL_TICKERS}

    for day in trading_days:
        if day > target:
            break
        day_rows = []
        for t in ALL_TICKERS:
            df = all_data.get(t)
            if df is None:
                arr = np.zeros((BARS, 5), dtype=np.float32)
            else:
                if day < first_listing[t]:
                    arr = np.zeros((BARS, 5), dtype=np.float32)
                else:
                    df_day = df[df.index.normalize() == day]
                    if not df_day.empty:
                        df_agg = aggregate_5min(df_day)
                        arr = df_agg[["OPEN", "HIGH", "LOW", "CLOSE", "VOL"]].values.astype(np.float32)[:BARS]
                        last_known[t] = arr.copy()
                    elif last_known[t] is not None:
                        prev_close = last_known[t][-1, 3]
                        arr = np.full((BARS, 5), [prev_close, prev_close, prev_close, prev_close, 0.0], dtype=np.float32)
                    else:
                        arr = np.zeros((BARS, 5), dtype=np.float32)
            arr = np.nan_to_num(arr, nan=0.0)
            arr[:, 4] /= VOL_SCALE
            day_rows.append(arr)
        session = np.hstack(day_rows)
        if day == target:
            return session
    return None


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--msk", required=True)
    p.add_argument("--compare", help="json tensor dump from TS")
    args = p.parse_args()
    t = tensor_for_msk(args.msk)
    if t is None:
        print(f"no trading day for {args.msk}", file=sys.stderr)
        sys.exit(1)
    print(f"built tensor shape {t.shape} for {args.msk}")
    if args.compare:
        dump = json.loads(Path(args.compare).read_text())
        other = np.array(dump["tensor"], dtype=np.float32)
        diff = np.abs(t - other)
        print(f"max_abs_diff vs TS: {diff.max():.6f} mean: {diff.mean():.6f}")
        for ti, sym in enumerate(ALL_TICKERS):
            sl = slice(ti * 5, ti * 5 + 5)
            d = diff[:, sl].max()
            if d > 0.01:
                print(f"  {sym}: max_diff={d:.4f}")
    else:
        out = ROOT / "tmp" / f"reference-tensor-{args.msk}.json"
        out.parent.mkdir(exist_ok=True)
        out.write_text(json.dumps({"msk": args.msk, "tensor": t.tolist()}), encoding="utf-8")
        print(f"wrote {out}")


if __name__ == "__main__":
    main()
