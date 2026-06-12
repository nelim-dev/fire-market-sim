"""Compare OHLC scale: sqlite tensor vs npz; test /100 heuristic."""
from __future__ import annotations

import json
import re
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


def ticker_path(sym: str) -> Path:
    if sym == "BR":
        return ROOT / "indexes" / "BR.txt"
    if sym == "EU":
        return ROOT / "indexes" / "Eu.txt"
    return ROOT / "tickers" / f"{sym}.txt"


def sample_txt_format(sym: str, msk: str, n: int = 5) -> None:
    path = ticker_path(sym)
    if not path.exists():
        print(f"{sym}: no file")
        return
    has_dot = 0
    no_dot = 0
    samples = []
    with path.open(encoding="utf-8", errors="replace") as f:
        for line in f:
            if msk not in line:
                continue
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 9:
                continue
            o, h, l, c = parts[5:9]
            for v in (o, h, l, c):
                if "." in v:
                    has_dot += 1
                else:
                    no_dot += 1
            if len(samples) < n:
                samples.append((parts[3], o, h, l, c, parts[8]))
    print(f"\n{sym} txt {msk}: dot_fields={has_dot} int_fields={no_dot}")
    for row in samples:
        t, o, h, l, c, v = row
        fo, fh, fl, fc = float(o), float(h), float(l), float(c)
        print(f"  {t} O={o} C={c}  /100 → C={fc/100:.4f}")


def close_stats(t: np.ndarray, sym: str) -> tuple[float, float]:
    i = ALL.index(sym) * 5 + 3
    return float(t[:, i].min()), float(t[:, i].max())


def main() -> None:
    sqlite = np.array(
        json.loads((ROOT / "tmp/analytics-tensor-dump.json").read_text())["tensor"],
        dtype=np.float32,
    )
    npz = np.load(ROOT / "timeVAE/data/mosbirzha_5min_v2_V10000_cond_v2.npz")["data"][NPZ_IDX]

    print(f"=== CLOSE sqlite vs npz[{NPZ_IDX}] ({MSK}) ===")
    for sym in ["VTBR", "YDEX", "EU", "GAZP", "BR", "SBER"]:
        s = close_stats(sqlite, sym)
        n = close_stats(npz, sym)
        ratio = s[1] / n[1] if n[1] > 0 else 0
        s100 = (s[0] / 100, s[1] / 100)
        print(
            f"{sym:5} sqlite {s[0]:.2f}-{s[1]:.2f}  npz {n[0]:.2f}-{n[1]:.2f}  "
            f"ratio={ratio:.2f}  sqlite/100 {s100[0]:.2f}-{s100[1]:.2f}"
        )

    for sym in ["VTBR", "YDEX", "EU"]:
        sample_txt_format(sym, MSK)

    # VTBR early vs late format in new file
    print("\n=== VTBR format by year (first line per year) ===")
    path = ROOT / "tickers" / "VTBR.txt"
    seen = set()
    with path.open(encoding="utf-8", errors="replace") as f:
        for line in f:
            m = re.search(r",(\d{8}),", line)
            if not m:
                continue
            y = m.group(1)[:4]
            if y in seen:
                continue
            seen.add(y)
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 9:
                continue
            c = parts[8]
            print(f"  {y} CLOSE={c} has_dot={'.' in c}")


if __name__ == "__main__":
    main()
