"""Shared reference data for construction & demolition (C&D) materials.

All prices are indicative Indian-market reference values in INR per kg for
*reusable* material in excellent condition. They act as the cold-start
"scrap-index" baseline described in the project report (Risk #2) and are
meant to be replaced by a trained model once real trade data exists.

CO2 factors are kg CO2e avoided per kg of material that is reused instead of
being newly manufactured. They are rounded, order-of-magnitude values drawn
from common embodied-carbon tables (e.g. ICE database) and are labelled as
estimates everywhere they are shown.
"""

MATERIALS = {
    "steel": {
        "label": "Structural steel",
        "price_per_kg": 52.0,       # reusable sections / rebar
        "scrap_price_per_kg": 34.0, # what a recycler would pay
        "co2_per_kg": 1.85,
        "recyclability": 0.95,
        "reusability": 0.85,
        "demand": 0.85,
        "density_hint": "beams, rebar, channels, plates",
    },
    "concrete": {
        "label": "Concrete / rubble",
        "price_per_kg": 0.9,
        "scrap_price_per_kg": 0.4,
        "co2_per_kg": 0.12,
        "recyclability": 0.75,
        "reusability": 0.35,
        "demand": 0.45,
        "density_hint": "blocks, slabs, crushed aggregate",
    },
    "brick": {
        "label": "Bricks",
        "price_per_kg": 3.2,
        "scrap_price_per_kg": 0.6,
        "co2_per_kg": 0.24,
        "recyclability": 0.6,
        "reusability": 0.8,
        "demand": 0.7,
        "density_hint": "clay bricks, fly-ash bricks",
    },
    "wood": {
        "label": "Timber / wood",
        "price_per_kg": 24.0,
        "scrap_price_per_kg": 4.0,
        "co2_per_kg": 0.45,
        "recyclability": 0.55,
        "reusability": 0.75,
        "demand": 0.65,
        "density_hint": "beams, planks, doors, shuttering ply",
    },
    "tiles": {
        "label": "Tiles / ceramics",
        "price_per_kg": 14.0,
        "scrap_price_per_kg": 0.5,
        "co2_per_kg": 0.6,
        "recyclability": 0.35,
        "reusability": 0.55,
        "demand": 0.5,
        "density_hint": "floor tiles, wall tiles, sanitary ware",
    },
    "glass": {
        "label": "Glass",
        "price_per_kg": 9.0,
        "scrap_price_per_kg": 2.0,
        "co2_per_kg": 0.85,
        "recyclability": 0.9,
        "reusability": 0.45,
        "demand": 0.4,
        "density_hint": "window panes, glazing units",
    },
}

MATERIAL_NAMES = list(MATERIALS.keys())

ACTIONS = ["Reuse", "Sell", "Recycle", "Dispose"]

# Share of the full reuse CO2 saving achieved by each end-of-life action.
ACTION_CO2_SHARE = {"Reuse": 1.0, "Sell": 1.0, "Recycle": 0.45, "Dispose": 0.0}


def condition_label(score: float) -> str:
    if score >= 80:
        return "Excellent"
    if score >= 60:
        return "Good"
    if score >= 40:
        return "Fair"
    return "Poor"


def normalise_material(name: str | None) -> str | None:
    if not name:
        return None
    name = name.strip().lower()
    aliases = {
        "metal": "steel", "iron": "steel", "rebar": "steel", "beam": "steel",
        "rubble": "concrete", "cement": "concrete", "aggregate": "concrete",
        "bricks": "brick", "timber": "wood", "lumber": "wood", "plywood": "wood",
        "tile": "tiles", "ceramic": "tiles", "ceramics": "tiles",
    }
    name = aliases.get(name, name)
    return name if name in MATERIALS else None
