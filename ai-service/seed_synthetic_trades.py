"""Generate a SYNTHETIC trades CSV to test the training pipeline end to end.

The numbers come from the baseline formula plus noise, so a model trained on
them only proves the pipeline works - never present it as a real price model.

    python seed_synthetic_trades.py synthetic_trades.csv --rows 600
"""

from __future__ import annotations

import argparse
import csv
import random

from catalog import MATERIALS
from price import baseline_price


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--rows", type=int, default=600)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args(argv)
    rng = random.Random(args.seed)

    with open(args.out, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["material", "condition_score", "quantity_kg", "distance_km", "price", "synthetic"])
        for _ in range(args.rows):
            m = rng.choice(list(MATERIALS))
            cond = rng.uniform(15, 98)
            qty = round(rng.lognormvariate(5.5, 1.1), 1)
            dist = rng.uniform(1, 60)
            # a pretend market that deviates from the baseline formula in
            # learnable ways: some materials trade above/below the index and
            # excellent steel/wood earns a premium
            market = {"wood": 1.25, "glass": 0.8, "concrete": 0.7}.get(m, 1.0)
            premium = 1.2 if m in ("steel", "wood") and cond > 80 else 1.0
            price = baseline_price(m, cond, qty, dist) * market * premium * rng.uniform(0.92, 1.08)
            w.writerow([m, round(cond, 1), qty, round(dist, 1), round(price, 2), 1])
    print(f"wrote {args.rows} synthetic trades to {args.out}")


if __name__ == "__main__":
    main()
