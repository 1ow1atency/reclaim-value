"""Natural-language search parser and agent intent router.

Rule-based by default (no API key needed). ``parse_query`` turns text such as
"find steel under 30,000 near me in good condition" into structured filters.
``agent_intent`` picks which backend tool the assistant should call - this is
the "function calling" step; the backend executes the tool against MongoDB.
Either function can be swapped for an LLM chain with the same return shape.
"""

from __future__ import annotations

import re

from catalog import MATERIALS

SYNONYMS = {
    "steel": ["steel", "iron", "rebar", "tmt", "girder", "beam", "beams", "i-beam",
              "channel", "angle", "scrap metal", "metal", "rod", "rods", "sheet"],
    "concrete": ["concrete", "rubble", "aggregate", "debris", "cement", "slab", "rcc", "block"],
    "brick": ["brick", "bricks", "masonry", "fly ash", "flyash"],
    "wood": ["wood", "wooden", "timber", "plank", "planks", "lumber", "plywood", "ply",
             "door", "doors", "shuttering"],
    "tiles": ["tile", "tiles", "ceramic", "ceramics", "marble", "granite", "vitrified"],
    "glass": ["glass", "pane", "panes", "glazing", "window", "windows"],
}

CONDITION_WORDS = {
    "excellent": 80, "like new": 85, "mint": 85, "very good": 70,
    "good": 60, "decent": 50, "fair": 40, "usable": 40, "any condition": 0,
}

_NUM = r"(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakh|lakhs|lac|l|cr|crore)?"


def _to_number(num: str, suffix: str | None) -> float:
    value = float(num.replace(",", ""))
    mult = {"k": 1e3, "thousand": 1e3, "lakh": 1e5, "lakhs": 1e5, "lac": 1e5,
            "l": 1e5, "cr": 1e7, "crore": 1e7}
    return value * mult.get((suffix or "").lower(), 1)


def _find_material(text: str) -> str | None:
    best, best_pos = None, len(text) + 1
    for material, words in SYNONYMS.items():
        for w in words:
            m = re.search(rf"\b{re.escape(w)}\b", text)
            if m and m.start() < best_pos:
                best, best_pos = material, m.start()
    return best


def parse_query(query: str) -> dict:
    text = (query or "").lower().strip()
    filters: dict = {"material": _find_material(text)}

    price_ctx = r"(?:rs\.?|inr|₹|rupees?)?\s*"
    m = re.search(rf"between\s+{price_ctx}{_NUM}\s+(?:and|-|to)\s+{price_ctx}{_NUM}", text)
    if m:
        filters["min_price"] = _to_number(m.group(1), m.group(2))
        filters["max_price"] = _to_number(m.group(3), m.group(4))
    else:
        m = re.search(rf"(?:under|below|less than|max(?:imum)?|upto|up to|within budget of|<|cheaper than)\s*{price_ctx}{_NUM}(?!\s*(?:km|kms|kilomet|kg|kgs|tonnes?|tons?))", text)
        if m:
            filters["max_price"] = _to_number(m.group(1), m.group(2))
        m = re.search(rf"(?:over|above|more than|min(?:imum)?|>|at least)\s*{price_ctx}{_NUM}(?!\s*(?:km|kms|kilomet|kg|kgs|tonnes?|tons?))", text)
        if m:
            filters["min_price"] = _to_number(m.group(1), m.group(2))

    m = re.search(r"(?:within|in|under|less than|<)\s*(\d+(?:\.\d+)?)\s*(?:km|kms|kilomet)", text)
    if m:
        filters["max_distance_km"] = float(m.group(1))
    elif re.search(r"\b(near me|nearby|close by|around me|near by|local)\b", text):
        filters["max_distance_km"] = 25.0

    m = re.search(r"(?:at least|min(?:imum)?|over|above|more than)?\s*(\d[\d,]*(?:\.\d+)?)\s*(kg|kgs|tonnes?|tons?|t)\b", text)
    if m:
        qty = float(m.group(1).replace(",", ""))
        if m.group(2).startswith("t"):
            qty *= 1000
        filters["min_quantity_kg"] = qty

    for phrase, score in sorted(CONDITION_WORDS.items(), key=lambda x: -len(x[0])):
        if re.search(rf"\b{phrase}\b", text):
            filters["min_condition"] = score
            break

    m = re.search(r"\b(?:in|at|from)\s+([a-z][a-z ]{2,20}?)(?:\s+(?:under|below|with|for|near|within)|$|[,.])", text)
    not_city = {"good", "excellent", "fair", "poor", "condition", "stock", "budget", "bulk", "new",
                "mint", "usable", "decent", "very", "any", "total", "my", "the"}
    if m and not set(m.group(1).split()) & not_city:
        filters["city"] = m.group(1).strip().title()

    stop = set(sum(SYNONYMS.values(), [])) | {
        "find", "show", "me", "i", "need", "want", "looking", "for", "some", "any", "the", "a",
        "an", "under", "below", "near", "in", "good", "condition", "with", "and", "of", "to",
        "km", "kg", "within", "buy", "get", "search", "price", "cheap", "rs", "inr",
    }
    filters["keywords"] = [w for w in re.findall(r"[a-z]{3,}", text) if w not in stop][:6]
    filters["sort"] = "price" if re.search(r"\b(cheapest|lowest price|cheap)\b", text) else "match"
    return {k: v for k, v in filters.items() if v not in (None, [], "")}


INTENTS = [
    # (intent, tool, patterns) - first match wins, order matters.
    ("greeting", None, [r"^(hi|hello|hey|namaste|good (morning|evening))\b"]),
    ("impact", "impact_summary", [r"\bco2\b", r"carbon", r"impact", r"diver", r"landfill", r"esg",
                                  r"how much .* (saved|earned|sold)", r"stats|statistics|summary"]),
    ("requests", "list_requests", [r"\brequests?\b", r"\boffers?\b", r"\borders?\b", r"who wants"]),
    ("price", "estimate_price", [r"\bprice\b.*\bof\b", r"how much (is|are|for|would|can i get)",
                                 r"\bworth\b", r"\bvalue\b", r"estimate", r"\bquote\b"]),
    ("recommend", "recommend_action", [r"should i (sell|reuse|recycle|dispose|scrap)",
                                       r"what (should|to) do with", r"recommend"]),
    ("inventory", "list_inventory", [r"\b(my|our)\b.*\b(inventory|stock|materials|items)\b",
                                     r"\binventory\b", r"what do (i|we) have"]),
    ("listings", "list_my_listings", [r"\bmy listings\b", r"\bpublished\b", r"\blisted\b"]),
    ("search", "search_listings", [r"\b(find|search|show|looking for|need|want|buy|get|any)\b",
                                   r"\bunder\b|\bbelow\b|\bnear\b"]),
]


def agent_intent(message: str) -> dict:
    text = (message or "").lower().strip()
    filters = parse_query(text)
    for intent, tool, patterns in INTENTS:
        if any(re.search(p, text) for p in patterns):
            if intent == "search" and not filters.get("material") and not any(
                k in filters for k in ("max_price", "max_distance_km", "min_condition")
            ):
                continue  # vague "show me ..." without a target -> general question
            args = dict(filters)
            if tool in ("estimate_price", "recommend_action"):
                args.setdefault("min_condition", 60)
                args.setdefault("min_quantity_kg", 100)
            return {"intent": intent, "tool": tool, "args": args}
    return {"intent": "general", "tool": None, "args": {}}


SUPPORTED_MATERIALS = list(MATERIALS)
