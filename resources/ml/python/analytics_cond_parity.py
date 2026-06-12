"""
Parity plots for integrated analytics pipeline (same as cond_vae_test price trajectory).

Usage:
  python analytics_cond_parity.py --input tmp/analytics-parity/parity-payload.json --out-dir tmp/analytics-parity
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

BARS = 107


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--out-dir", required=True)
    args = parser.parse_args()

    payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    source = payload["sourceDayMsk"]
    target = payload["targetDayMsk"]
    tickers = payload["tickers"]
    time_axis = np.arange(BARS) * 5 / 60.0

    plt.style.use("dark_background")

    for ticker in tickers:
        prev = np.array(payload["prevCloseByTicker"][ticker], dtype=np.float32)
        pred = np.array(payload["predCloseByTicker"][ticker], dtype=np.float32)
        real = np.array(payload["realCloseByTicker"][ticker], dtype=np.float32)
        vol = np.array(payload["predVolByTicker"][ticker], dtype=np.float32)

        fig, axes = plt.subplots(2, 1, figsize=(12, 8))

        axes[0].plot(time_axis, prev, label="Prev day (app input)", linewidth=2, color="#00b0ff")
        axes[0].plot(time_axis, real, label="Real next day (SQLite)", linewidth=2, color="#ff4444")
        axes[0].plot(
            time_axis,
            pred,
            label="Model pred (app worker)",
            linestyle="--",
            linewidth=2,
            color="#00ffaa",
        )
        axes[0].set_title(f"{ticker} CLOSE — {source} → {target}")
        axes[0].set_xlabel("Hours from session start")
        axes[0].legend()
        axes[0].grid(True, alpha=0.3)

        axes[1].plot(time_axis, vol * 10000, label="Pred VOL (×10000)", color="#ffaa00")
        axes[1].set_title(f"{ticker} predicted VOL (scaled channel ×10000)")
        axes[1].legend()
        axes[1].grid(True, alpha=0.3)

        fig.tight_layout()
        out_path = out_dir / f"parity_{ticker}_{source}_{target}.png"
        fig.savefig(out_path, dpi=120)
        plt.close(fig)
        print(f"Saved {out_path}")

    summary_path = out_dir / "parity_summary.txt"
    summary_path.write_text(
        f"Integrated parity plots\nsource={source}\ntarget={target}\ntickers={','.join(tickers)}\n",
        encoding="utf-8",
    )
    print(f"Saved {summary_path}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
