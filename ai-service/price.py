"""Price estimation.

Baseline (default): a transparent formula built on the scrap-index reference
prices in ``catalog.py``. If ``weights/price_model.joblib`` exists (created by
``train_price.py``) the trained regression is used instead, and the baseline
is still returned alongside it for comparison.
"""

from __future__ import annotations

import os
from functools import lru_cache

from catalog import MATERIALS

MODEL_PATH = os.getenv(
    "PRICE_MODEL", os.path.join(os.path.dirname(__file__), "weights", "price_model.joblib")
)
FEATURES = ["material", "condition_score", "quantity_kg", "distance_km"]


def condition_multiplier(condition_score: float) -> float:
    """Poor material sells near scrap value, excellent near reuse value."""
    c = max(0.0, min(float(condition_score), 100.0)) / 100.0
    return 0.3 + 0.7 * c


def baseline_price(material: str, condition_score: float, quantity_kg: float,
                   distance_km: float = 10.0) -> float:
    info = MATERIALS[material]
    per_kg = max(info["price_per_kg"] * condition_multiplier(condition_score),
                 info["scrap_price_per_kg"])
    # Bulk discount: large lots trade a little cheaper per kg.
    bulk = 1.0 if quantity_kg < 1000 else 0.93 if quantity_kg < 10000 else 0.86
    # Freight: buyers pay less for far-away lots (report: 25-50 km radius).
    freight = 1.0 - min(max(distance_km, 0.0), 50.0) / 50.0 * 0.08
    return per_kg * quantity_kg * bulk * freight


@lru_cache(maxsize=1)
def _load_model(path: str, mtime: float):  # mtime busts the cache on retrain
    import joblib  # imported lazily so the baseline works without it

    return joblib.load(path)


def trained_model():
    if not os.path.isfile(MODEL_PATH):
        return None
    try:
        return _load_model(MODEL_PATH, os.path.getmtime(MODEL_PATH))
    except Exception:
        return None


def estimate_price(material: str, condition_score: float, quantity_kg: float,
                   distance_km: float = 10.0) -> dict:
    if material not in MATERIALS:
        raise ValueError(f"unknown material '{material}'")
    if quantity_kg <= 0:
        raise ValueError("quantity_kg must be positive")

    base = baseline_price(material, condition_score, quantity_kg, distance_km)
    value, source = base, "baseline"
    model = trained_model()
    if model is not None:
        import pandas as pd

        row = pd.DataFrame([{
            "material": material, "condition_score": condition_score,
            "quantity_kg": quantity_kg, "distance_km": distance_km,
        }])[FEATURES]
        predicted_per_kg = float(model.predict(row)[0])
        if predicted_per_kg > 0:
            value, source = predicted_per_kg * quantity_kg, "trained"

    value = round(value, -1) if value >= 100 else round(value, 2)
    return {
        "price": value,
        "low": round(value * 0.85, -1) if value >= 100 else round(value * 0.85, 2),
        "high": round(value * 1.15, -1) if value >= 100 else round(value * 1.15, 2),
        "per_kg": round(value / quantity_kg, 2),
        "baseline_price": round(base, 2),
        "scrap_value": round(MATERIALS[material]["scrap_price_per_kg"] * quantity_kg, 2),
        "currency": "INR",
        "model": source,
    }
