"""
Long-lived JSON-lines worker for ConditionalTimeVAE inference.

Protocol (one JSON object per line on stdin/stdout):
  {"cmd":"ping","id":"1"}
  {"cmd":"ping","id":"1","ok":true}

  {"cmd":"predict","id":"2","prev_day":[[...107 rows x 105 cols...]]}
  {"cmd":"predict","id":"2","ok":true,"next_day":[[...]]}
"""

from __future__ import annotations

import json
import os
import pickle
import sys
from pathlib import Path

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"

import numpy as np
import tensorflow as tf

ML_ROOT = Path(__file__).resolve().parent.parent
SRC_ROOT = ML_ROOT / "src"
MODEL_DIR = ML_ROOT / "model" / "mosbirzha_5min_v2_V10000_cond_v2"

sys.path.insert(0, str(SRC_ROOT))

from vae.conditional_timevae import ConditionalTimeVAE  # noqa: E402

FEATS_PER_TICKER = 5
N_TICKERS = 21
FEATURE_NAMES = ["OPEN", "HIGH", "LOW", "CLOSE", "VOL"]
VOL_IDXS = np.array(
    [i * FEATS_PER_TICKER + FEATURE_NAMES.index("VOL") for i in range(N_TICKERS)],
    dtype=np.int32,
)

_vae: ConditionalTimeVAE | None = None
_scaler = None


def _load_model() -> None:
    global _vae, _scaler
    if _vae is not None:
        return
    _vae = ConditionalTimeVAE.load(str(MODEL_DIR))
    with open(MODEL_DIR / "scaler.pkl", "rb") as f:
        _scaler = pickle.load(f)


def _inverse_transform_day(data_norm: np.ndarray) -> np.ndarray:
    return _scaler.inverse_transform(data_norm.copy())


def _predict(prev_day_raw: np.ndarray) -> np.ndarray:
    _load_model()
    if prev_day_raw.shape != (107, 105):
        raise ValueError(f"expected shape (107, 105), got {prev_day_raw.shape}")

    prev_scaled = _scaler.transform(prev_day_raw.astype(np.float32))
    prev_tf = tf.convert_to_tensor(prev_scaled[np.newaxis, ...], dtype=tf.float32)

    z_mean, _, _ = _vae.encoder(prev_tf)
    pred_norm = _vae.decoder([z_mean, prev_tf]).numpy()[0]
    pred = _inverse_transform_day(pred_norm)
    pred[:, VOL_IDXS] = np.maximum(pred[:, VOL_IDXS], 0.0)
    return pred.astype(np.float32)


def _handle_line(line: str) -> dict:
    msg = json.loads(line)
    cmd = msg.get("cmd")
    req_id = msg.get("id")

    if cmd == "ping":
        return {"cmd": "ping", "id": req_id, "ok": True}

    if cmd == "predict":
        prev = np.array(msg["prev_day"], dtype=np.float32)
        next_day = _predict(prev)
        return {
            "cmd": "predict",
            "id": req_id,
            "ok": True,
            "next_day": next_day.tolist(),
        }

    raise ValueError(f"unknown cmd: {cmd}")


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            out = _handle_line(line)
        except Exception as e:  # noqa: BLE001
            try:
                req = json.loads(line)
                req_id = req.get("id")
            except Exception:  # noqa: BLE001
                req_id = None
            out = {"id": req_id, "ok": False, "error": str(e)}
        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
