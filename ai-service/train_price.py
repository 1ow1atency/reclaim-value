"""Train the price-regression model from a CSV of completed trades.

CSV columns: material, condition_score, quantity_kg, distance_km, price
(price = total agreed INR). Get one from real data with
``training/export_trades.py`` or, for a dry run only, generate a synthetic file
with ``seed_synthetic_trades.py``.

    python train_price.py trades.csv            # trains + saves weights/price_model.joblib
    python train_price.py trades.csv --dry-run  # report metrics only

The model predicts price *per kg*; it is only saved if it beats the baseline
formula on the held-out split.
"""

from __future__ import annotations

import argparse
import os
import sys

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from catalog import MATERIALS
from price import FEATURES, MODEL_PATH, baseline_price

REQUIRED = FEATURES + ["price"]


def load(path: str) -> pd.DataFrame:
    df = pd.read_csv(path)
    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        raise SystemExit(f"CSV is missing columns: {missing}")
    df = df[REQUIRED].dropna()
    df["material"] = df["material"].str.lower().str.strip()
    df = df[df["material"].isin(MATERIALS.keys())]
    df = df[(df["quantity_kg"] > 0) & (df["price"] > 0)]
    if len(df) < 30:
        raise SystemExit(f"need at least 30 valid trades, found {len(df)}")
    return df


def build() -> Pipeline:
    pre = ColumnTransformer(
        [("material", OneHotEncoder(handle_unknown="ignore"), ["material"])],
        remainder="passthrough",
    )
    return Pipeline([("pre", pre), ("gbr", GradientBoostingRegressor(random_state=42))])


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("csv")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--out", default=MODEL_PATH)
    ap.add_argument("--force", action="store_true", help="save even if it loses to the baseline")
    args = ap.parse_args(argv)

    df = load(args.csv)
    y = df["price"] / df["quantity_kg"]
    X = df[FEATURES]
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, random_state=42)

    model = build().fit(X_tr, y_tr)
    pred_total = model.predict(X_te) * X_te["quantity_kg"].to_numpy()
    true_total = y_te.to_numpy() * X_te["quantity_kg"].to_numpy()
    base_total = np.array([baseline_price(r.material, r.condition_score, r.quantity_kg, r.distance_km)
                           for r in X_te.itertuples()])

    mae_model = mean_absolute_error(true_total, pred_total)
    mae_base = mean_absolute_error(true_total, base_total)
    print(f"trades: {len(df)}  (train {len(X_tr)}, test {len(X_te)})")
    print(f"MAE baseline formula : Rs {mae_base:,.0f}")
    print(f"MAE trained model    : Rs {mae_model:,.0f}")

    if args.dry_run:
        return 0
    if mae_model >= mae_base and not args.force:
        print("trained model does not beat the baseline - not saved")
        return 1
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    joblib.dump(model.fit(X, y), args.out)  # refit on all data before saving
    print(f"saved {args.out} - restart the AI service to use it")
    return 0


if __name__ == "__main__":
    sys.exit(main())
