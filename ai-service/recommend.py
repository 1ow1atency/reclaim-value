"""Smart salvage engine: Reuse / Sell / Recycle / Dispose.

A weighted heuristic that trades off condition, market demand, material
value, haul distance and recyclability. Every score is returned so the user
can see *why* an action was chosen - the decision is advisory and must be
confirmed by a person.
"""

from __future__ import annotations

from catalog import ACTION_CO2_SHARE, MATERIALS

MAX_PRICE_PER_KG = max(m["price_per_kg"] for m in MATERIALS.values())


def _clip(x: float) -> float:
    return max(0.0, min(1.0, x))


def recommend(material: str, condition_score: float, quantity_kg: float = 100.0,
              distance_km: float = 10.0, demand: float | None = None) -> dict:
    if material not in MATERIALS:
        raise ValueError(f"unknown material '{material}'")
    info = MATERIALS[material]
    cond = _clip(condition_score / 100.0)
    demand = _clip(info["demand"] if demand is None else demand)
    value = _clip(info["price_per_kg"] / MAX_PRICE_PER_KG) ** 0.5
    near = 1.0 - _clip(distance_km / 50.0)  # 50 km = practical haul limit
    lot = _clip(quantity_kg / 2000.0)        # bigger lots are easier to sell

    scores = {
        # Re-use on another of the company's own sites: needs good condition.
        "Reuse": 0.55 * cond + 0.30 * info["reusability"] + 0.15 * demand - 0.25 * (cond < 0.5),
        # Sell on the marketplace: condition, demand, value and logistics.
        "Sell": 0.30 * cond + 0.25 * demand + 0.20 * value + 0.15 * near + 0.10 * lot,
        # Recycle: best when condition is poor but the material is recyclable.
        "Recycle": 0.65 * info["recyclability"] * (1.1 - cond) + 0.15,
        # Dispose: only wins for badly damaged, non-recyclable material.
        "Dispose": 0.75 * (1 - info["recyclability"]) * (1 - cond) ** 2,
    }
    scores = {k: round(_clip(v), 3) for k, v in scores.items()}
    action = max(scores, key=scores.get)

    reasons = []
    if action in ("Reuse", "Sell"):
        if condition_score >= 50:
            reasons.append(f"condition {condition_score:.0f}/100 is good enough for another use")
        else:
            reasons.append(f"condition {condition_score:.0f}/100 is low, but it can still sell as a discounted lot")
    if action == "Sell":
        reasons.append(f"market demand for {info['label'].lower()} is "
                       f"{'high' if demand > 0.65 else 'moderate'}")
        if distance_km > 35:
            reasons.append("buyers are far away - freight cost reduces value")
    if action == "Recycle":
        reasons.append(f"{info['label']} is {info['recyclability'] * 100:.0f}% recyclable")
        reasons.append("condition is too low for structural reuse")
    if action == "Dispose":
        reasons.append("low condition and low recyclability - no recovery route is viable")

    co2_full = info["co2_per_kg"] * quantity_kg
    return {
        "action": action,
        "scores": scores,
        "reasons": reasons,
        "co2_saved_kg": round(co2_full * ACTION_CO2_SHARE[action], 1),
        "co2_by_action": {a: round(co2_full * s, 1) for a, s in ACTION_CO2_SHARE.items()},
        "landfill_diverted_kg": 0.0 if action == "Dispose" else round(quantity_kg, 1),
    }
