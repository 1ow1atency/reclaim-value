import pytest

from nlp import agent_intent, parse_query


def test_report_example_query():
    f = parse_query("find steel under 30,000 near me")
    assert f["material"] == "steel"
    assert f["max_price"] == 30000
    assert f["max_distance_km"] == 25


@pytest.mark.parametrize("q,expected", [
    ("timber planks below 15k", 15000),
    ("bricks under 2 lakh", 200000),
    ("glass under rs 5,000", 5000),
])
def test_price_suffixes(q, expected):
    assert parse_query(q)["max_price"] == expected


def test_between_and_distance_and_condition():
    f = parse_query("rebar between 10k and 20k within 40 km in good condition")
    assert f["material"] == "steel"
    assert (f["min_price"], f["max_price"]) == (10000, 20000)
    assert f["max_distance_km"] == 40
    assert f["min_condition"] == 60


def test_km_is_not_mistaken_for_price():
    f = parse_query("concrete within 30 km")
    assert "max_price" not in f and f["max_distance_km"] == 30


def test_quantity_in_tonnes():
    assert parse_query("need 2 tonnes of bricks")["min_quantity_kg"] == 2000


def test_cheapest_sort():
    assert parse_query("cheapest tiles")["sort"] == "price"


@pytest.mark.parametrize("msg,tool", [
    ("find steel under 30000 near me", "search_listings"),
    ("how much co2 have we saved", "impact_summary"),
    ("show my inventory", "list_inventory"),
    ("how much is 500 kg of steel worth", "estimate_price"),
    ("should i sell or recycle old glass", "recommend_action"),
    ("any pending requests?", "list_requests"),
])
def test_agent_routes_to_tools(msg, tool):
    assert agent_intent(msg)["tool"] == tool


def test_general_questions_have_no_tool():
    r = agent_intent("how does the escrow step work?")
    assert r["intent"] == "general" and r["tool"] is None


def test_condition_words_are_not_cities():
    assert "city" not in parse_query("steel near me in good condition")
    assert parse_query("bricks in Chandigarh under 20k")["city"] == "Chandigarh"
