"""Full per-ticker diff: SQLite tensor dump vs npz row for one day."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
ALL = [
    "GAZP", "LKOH", "ROSN", "NVTK", "TATN", "SBER", "VTBR", "MOEX",
    "CHMF", "NLMK", "GMKN", "MGNT", "MTSS", "YDEX", "RUAL", "PLZL",
    "AFLT", "HYDR", "IRAO", "BR", "EU",
]
FEATS = ["OPEN", "HIGH", "LOW", "CLOSE", "VOL"]
NPZ_PATH = ROOT / "timeVAE/data/mosbirzha_5min_v2_V10000_cond_v2.npz"
DUMP_PATH = ROOT / "tmp/analytics-tensor-dump.json"


def ticker_slice(sym: str) -> slice:
    i = ALL.index(sym) * 5
    return slice(i, i + 5)


def report_block(a: np.ndarray, b: np.ndarray, sym: str) -> dict:
    sl = ticker_slice(sym)
    diff = np.abs(a[:, sl] - b[:, sl])
    max_d = float(diff.max())
    slot, feat_i = np.unravel_index(int(diff.argmax()), diff.shape)
    feat = FEATS[feat_i]
    return {
        "sym": sym,
        "max": max_d,
        "slot": int(slot),
        "feat": feat,
        "sqlite": float(a[slot, sl.start + feat_i]),
        "npz": float(b[slot, sl.start + feat_i]),
        "sqlite_close_rng": (float(a[:, sl.start + 3].min()), float(a[:, sl.start + 3].max())),
        "npz_close_rng": (float(b[:, sl.start + 3].min()), float(b[:, sl.start + 3].max())),
    }


def main() -> None:
    msk = sys.argv[1] if len(sys.argv) > 1 else "20191230"
    npz_idx = int(sys.argv[2]) if len(sys.argv) > 2 else None

    sqlite = np.array(json.loads(DUMP_PATH.read_text())["tensor"], dtype=np.float32)
    npz = np.load(NPZ_PATH)["data"].astype(np.float32)

    if npz_idx is None:
        gazp_ci = ALL.index("GAZP") * 5 + 3
        best_i, best_m = -1, 1e18
        for j in range(npz.shape[0]):
            d = float(np.max(np.abs(npz[j, :, gazp_ci] - sqlite[:, gazp_ci])))
            if d < best_m:
                best_m, best_i = d, j
        npz_idx = best_i
        print(f"Auto npz idx={npz_idx} (min GAZP close diff={best_m:.4f})")
    else:
        print(f"Using npz idx={npz_idx}")

    ref = npz[npz_idx]
    full_max = float(np.max(np.abs(sqlite - ref)))
    nan_sql = int(np.sum(~np.isfinite(sqlite)))
    nan_npz = int(np.sum(~np.isfinite(ref)))
    print(f"Full tensor max_abs_diff={full_max:.4f}  non-finite sqlite={nan_sql} npz={nan_npz}")
    print()

    rows = [report_block(sqlite, ref, sym) for sym in ALL]
    rows.sort(key=lambda r: -r["max"])

    print("Per-ticker max abs diff (all 21 tickers, all OHLCV):")
    print(f"{'sym':6} {'max':>12} {'slot':>5} {'feat':>5}  sqlite vs npz @ peak")
    for r in rows:
        flag = " ***" if r["max"] > 1.0 else ""
        print(
            f"{r['sym']:6} {r['max']:12.4f} {r['slot']:5d} {r['feat']:>5}  "
            f"{r['sqlite']:.4f} vs {r['npz']:.4f}{flag}"
        )

    print("\nClose range comparison:")
    for r in sorted(rows, key=lambda x: -abs(x["sqlite_close_rng"][1] - x["npz_close_rng"][1])):
        sc, nc = r["sqlite_close_rng"], r["npz_close_rng"]
        print(f"  {r['sym']:6} SQLite {sc[0]:.2f}-{sc[1]:.2f}  npz {nc[0]:.2f}-{nc[1]:.2f}  max_diff={r['max']:.4f}")

    # Slots where entire ticker block is zero in one but not other
    print("\nAll-zero ticker blocks (max abs < 1e-9):")
    for sym in ALL:
        sl = ticker_slice(sym)
        zs = float(np.max(np.abs(sqlite[:, sl]))) < 1e-9
        zn = float(np.max(np.abs(ref[:, sl]))) < 1e-9
        if zs != zn:
            print(f"  {sym}: sqlite_zero={zs} npz_zero={zn}")


if __name__ == "__main__":
    main()
