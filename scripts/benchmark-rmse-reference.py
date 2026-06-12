#!/usr/bin/env python3
"""
Reproduce cond_vae_test.py PER-TICKER RMSE (CLOSE) on Validation Set.
Same formulas as timeVAE/cond_vae_test.py compute_metrics().

Run from repo root:
  python scripts/benchmark-rmse-reference.py
"""
from __future__ import annotations

import pickle
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import tensorflow as tf

REPO = Path(__file__).resolve().parents[1]
TIMEVAE = REPO / "timeVAE"
ML_SRC = REPO / "resources" / "ml" / "src"
DATA_PATH = TIMEVAE / "data" / "mosbirzha_5min_v2_V10000_cond_v2.npz"
MODEL_DIR = REPO / "resources" / "ml" / "model" / "mosbirzha_5min_v2_V10000_cond_v2"

STOCK_TICKERS = [
    "GAZP", "LKOH", "ROSN", "NVTK", "TATN", "SBER", "VTBR", "MOEX",
    "CHMF", "NLMK", "GMKN", "MGNT", "MTSS", "YDEX", "RUAL", "PLZL",
    "AFLT", "HYDR", "IRAO",
]
OTHER_TICKERS = ["BR", "Eu"]
ALL_TICKERS = STOCK_TICKERS + OTHER_TICKERS
N_TICKERS = len(ALL_TICKERS)
FEATS_PER_TICKER = 5
FEATURE_NAMES = ["OPEN", "HIGH", "LOW", "CLOSE", "VOL"]


def get_feature_idx(ticker_idx: int, feat: str) -> int:
    return ticker_idx * FEATS_PER_TICKER + FEATURE_NAMES.index(feat)


def compute_metrics(true, pred, mask=None):
    if mask is not None:
        true = true[:, :, mask]
        pred = pred[:, :, mask]
    mae = np.mean(np.abs(true - pred))
    rmse = np.sqrt(np.mean((true - pred) ** 2))
    std_loss = np.mean((np.std(true, axis=1) - np.std(pred, axis=1)) ** 2)
    return mae, rmse, std_loss


def inverse_3d(data_norm, scaler):
    s, t, f = data_norm.shape
    result = np.zeros_like(data_norm)
    for i in range(s):
        result[i] = scaler.inverse_transform(data_norm[i])
    return result


def main() -> None:
    sys.path.insert(0, str(TIMEVAE / "src"))
    sys.path.insert(0, str(ML_SRC))

    from vae.conditional_timevae import ConditionalTimeVAE
    from data_utils import split_data, scale_data

    print("Loading ConditionalTimeVAE...")
    vae = ConditionalTimeVAE.load(str(MODEL_DIR))
    with open(MODEL_DIR / "scaler.pkl", "rb") as f:
        scaler = pickle.load(f)

    with np.load(DATA_PATH) as npz_file:
        data = npz_file["data"].astype(np.float32)

    train_data, valid_data = split_data(data, valid_perc=0.1, shuffle=False)
    _, scaled_valid_data, _ = scale_data(train_data, valid_data)

    valid_prev = scaled_valid_data[:-1]
    valid_next = scaled_valid_data[1:]
    print(f"Valid pairs: {valid_prev.shape[0]}")

    valid_prev_tf = tf.convert_to_tensor(valid_prev, dtype=tf.float32)
    z_mean, _, _ = vae.encoder(valid_prev_tf)
    model_pred_norm = vae.decoder([z_mean, valid_prev_tf]).numpy()

    model_pred = inverse_3d(model_pred_norm, scaler)
    real_next = inverse_3d(valid_next, scaler)

    vol_idxs = np.array([get_feature_idx(i, "VOL") for i in range(N_TICKERS)])
    model_pred[:, :, vol_idxs] = np.maximum(model_pred[:, :, vol_idxs], 0)
    real_next[:, :, vol_idxs] = np.maximum(real_next[:, :, vol_idxs], 0)

    print("\n" + "=" * 120)
    print("PER-TICKER RMSE (CLOSE ONLY) — Validation Set (cond_vae_test parity)")
    print("=" * 120)

    per_ticker_rmse = {}
    for ticker_idx, ticker_name in enumerate(ALL_TICKERS):
        ticker_mask = np.array([get_feature_idx(ticker_idx, "CLOSE")])
        _, rmse_close, _ = compute_metrics(real_next, model_pred, mask=ticker_mask)
        per_ticker_rmse[ticker_name] = round(float(rmse_close), 6)

    df = pd.DataFrame({"ConditionalTimeVAE (Model)": per_ticker_rmse})
    print(df.to_string())


if __name__ == "__main__":
    main()
