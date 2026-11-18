from fastapi.testclient import TestClient

from main import app
from synthetic import SAMPLES

client = TestClient(app)


def test_health():
    with TestClient(app) as c:
        r = c.get("/health").json()
    assert r["status"] == "ok"
    assert r["material_model"]["mode"] == "demo-heuristic"
    assert r["material_model"]["detector"]["loaded"] is False
    assert "steel" in r["materials"]


def test_analyze_full_pipeline():
    r = client.post("/analyze", files={"file": ("b.png", SAMPLES["brick"], "image/png")},
                    data={"quantity_kg": "800", "distance_km": "12"})
    assert r.status_code == 200
    body = r.json()
    assert body["material"] == "brick" and body["demo_mode"] is True
    assert body["recommendation"]["action"] in ("Reuse", "Sell", "Recycle", "Dispose")
    assert body["price"]["price"] > 0 and body["quantity_kg"] == 800


def test_analyze_rejects_non_image():
    r = client.post("/analyze", files={"file": ("x.txt", b"hello", "text/plain")})
    assert r.status_code == 400


def test_price_and_recommend_endpoints():
    body = {"material": "timber", "condition_score": 75, "quantity_kg": 200}
    assert client.post("/price", json=body).json()["price"] > 0
    assert client.post("/recommend", json=body).json()["action"]
    assert client.post("/price", json={**body, "material": "unobtainium"}).status_code == 422


def test_nlp_and_agent():
    assert client.post("/nlp/parse", json={"text": "steel under 30k"}).json()["filters"]["max_price"] == 30000
    assert client.post("/agent", json={"text": "show my inventory"}).json()["tool"] == "list_inventory"
