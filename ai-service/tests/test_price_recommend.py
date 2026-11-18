import pytest

from catalog import MATERIALS
from price import baseline_price, estimate_price
from recommend import recommend


def test_price_rises_with_condition():
    assert estimate_price("steel", 90, 500)["price"] > estimate_price("steel", 30, 500)["price"]


def test_price_never_below_scrap_value():
    for m, info in MATERIALS.items():
        p = baseline_price(m, 0, 100, 0)
        assert p >= info["scrap_price_per_kg"] * 100 - 1e-6


def test_price_range_and_currency():
    p = estimate_price("wood", 70, 250, 5)
    assert p["low"] < p["price"] < p["high"]
    assert p["currency"] == "INR" and p["model"] in ("baseline", "trained")


def test_distance_reduces_price():
    assert baseline_price("brick", 70, 1000, 45) < baseline_price("brick", 70, 1000, 2)


@pytest.mark.parametrize("bad", [dict(material="gold", condition_score=50, quantity_kg=1),
                                 dict(material="steel", condition_score=50, quantity_kg=0)])
def test_price_validation(bad):
    with pytest.raises(ValueError):
        estimate_price(**bad)


def test_good_steel_is_sold_or_reused():
    r = recommend("steel", 88, 1500, 8)
    assert r["action"] in ("Sell", "Reuse")
    assert r["co2_saved_kg"] > 0 and r["landfill_diverted_kg"] == 1500


def test_poor_recyclable_material_is_recycled():
    assert recommend("glass", 10, 300, 10)["action"] == "Recycle"


def test_wrecked_tiles_are_disposed():
    r = recommend("tiles", 2, 300, 40)
    assert r["action"] == "Dispose"
    assert r["landfill_diverted_kg"] == 0 and r["co2_saved_kg"] == 0


def test_all_scores_present_and_bounded():
    r = recommend("concrete", 60)
    assert set(r["scores"]) == {"Reuse", "Sell", "Recycle", "Dispose"}
    assert all(0 <= s <= 1 for s in r["scores"].values())
