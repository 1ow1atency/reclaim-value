"""Export completed marketplace trades from MongoDB to a CSV for train_price.py.

    pip install pymongo
    python training/export_trades.py "mongodb://localhost:27017/reclaim_value" trades.csv

Only *completed* requests are exported, and demo listings are skipped.
"""

from __future__ import annotations

import csv
import sys


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 1
    uri, out = sys.argv[1:]
    from pymongo import MongoClient

    db = MongoClient(uri).get_default_database()
    rows = 0
    with open(out, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["material", "condition_score", "quantity_kg", "distance_km", "price"])
        for req in db.requests.find({"status": "completed"}):
            listing = db.listings.find_one({"_id": req["listing"]})
            if not listing or listing.get("isDemo"):
                continue
            w.writerow([listing["materialType"], listing.get("conditionScore", 60),
                        req.get("quantityKg") or listing["quantityKg"],
                        req.get("distanceKm", 10), req.get("offerPrice") or listing["price"]])
            rows += 1
    print(f"exported {rows} trades to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
