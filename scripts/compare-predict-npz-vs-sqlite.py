"""Compare predict on npz row vs SQLite tensor for GAZP/BR."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
ALL = [
    "GAZP", "LKOH", "ROSN", "NVTK", "TATN", "SBER", "VTBR", "MOEX",
    "CHMF", "NLMK", "GMKN", "MGNT", "MTSS", "YDEX", "RUAL", "PLZL",
    "AFLT", "HYDR", "IRAO", "BR", "EU",
]


def stats(t: np.ndarray, sym: str, label: str) -> None:
    i = ALL.index(sym) * 5
    close = t[:, i + 3]
    vol = t[:, i + 4]
    print(
        f"{label} {sym}: CLOSE [{close.min():.2f}, {close.max():.2f}] "
        f"VOL [{vol.min():.4f}, {vol.max():.4f}]"
    )


def predict(worker: Path, tensor: np.ndarray) -> np.ndarray:
    req = json.dumps({"cmd": "predict", "id": "1", "prev_day": tensor.tolist()})
    proc = subprocess.run(
        [sys.executable, str(worker)],
        input=req + "\n",
        capture_output=True,
        text=True,
        cwd=str(ROOT),
        timeout=120,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr or proc.stdout)
    out = json.loads(proc.stdout.strip().splitlines()[-1])
    if not out.get("ok"):
        raise RuntimeError(out.get("error", "predict failed"))
    return np.array(out["next_day"], dtype=np.float32)


def per_ticker_max_diff(a: np.ndarray, b: np.ndarray) -> list[tuple[str, float]]:
    rows = []
    for sym in ALL:
        if sym in ("YDEX", "EU"):
            continue
        i = ALL.index(sym) * 5
        d = float(np.max(np.abs(a[:, i : i + 5] - b[:, i : i + 5])))
        rows.append((sym, d))
    return sorted(rows, key=lambda x: -x[1])


def main() -> None:
    dump = json.loads((ROOT / "tmp" / "analytics-tensor-dump.json").read_text())
    sqlite = np.array(dump["tensor"], dtype=np.float32)
    npz = np.load(ROOT / "timeVAE/data/mosbirzha_5min_v2_V10000_cond_v2.npz")["data"].astype(np.float32)

    gazp_ci = ALL.index("GAZP") * 5 + 3
    best_i, best_m = -1, 1e18
    for j in range(npz.shape[0]):
        d = float(np.max(np.abs(npz[j, :, gazp_ci] - sqlite[:, gazp_ci])))
        if d < best_m:
            best_m, best_i = d, j
    npz_row = npz[best_i]
    real_next = npz[best_i + 1] if best_i + 1 < npz.shape[0] else None

    print(f"NPZ input idx={best_i}, GAZP close diff vs SQLite={best_m:.4f}")
    print("\nInput diff by ticker (SQLite vs NPZ, skip YDEX/EU):")
    for sym, d in per_ticker_max_diff(sqlite, npz_row)[:8]:
        print(f"  {sym}: {d:.4f}")

    worker = ROOT / "resources/ml/python/predict_worker.py"
    print("\n--- predict(npz row) ---")
    pred_npz = predict(worker, npz_row)
    stats(npz_row, "GAZP", "IN")
    stats(pred_npz, "GAZP", "PRED")
    stats(npz_row, "BR", "IN")
    stats(pred_npz, "BR", "PRED")
    if real_next is not None:
        stats(real_next, "GAZP", "REAL(npz+1)")
        stats(real_next, "BR", "REAL(npz+1)")

    print("\n--- predict(SQLite tensor) ---")
    pred_sql = predict(worker, sqlite)
    stats(sqlite, "GAZP", "IN")
    stats(pred_sql, "GAZP", "PRED")
    stats(sqlite, "BR", "IN")
    stats(pred_sql, "BR", "PRED")


if __name__ == "__main__":
    main()
