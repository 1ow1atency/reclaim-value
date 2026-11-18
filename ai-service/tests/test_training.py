import os

import price
import train_price
from seed_synthetic_trades import main as seed


def test_train_price_pipeline(tmp_path, monkeypatch):
    csv_path = tmp_path / "trades.csv"
    out = tmp_path / "price_model.joblib"
    seed([str(csv_path), "--rows", "400"])
    code = train_price.main([str(csv_path), "--out", str(out)])
    assert code == 0 and out.exists()

    monkeypatch.setattr(price, "MODEL_PATH", str(out))
    est = price.estimate_price("steel", 85, 500, 10)
    assert est["model"] == "trained" and est["price"] > 0


def test_train_refuses_tiny_dataset(tmp_path):
    p = tmp_path / "t.csv"
    p.write_text("material,condition_score,quantity_kg,distance_km,price\nsteel,50,10,5,300\n")
    try:
        train_price.main([str(p), "--dry-run"])
    except SystemExit as e:
        assert "at least 30" in str(e)
    else:
        raise AssertionError("expected SystemExit")
