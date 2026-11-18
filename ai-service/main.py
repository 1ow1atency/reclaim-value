"""Reclaim Value AI microservice (FastAPI, port 8000)."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

import vision
from catalog import MATERIALS, normalise_material
from nlp import agent_intent, parse_query
from price import estimate_price, trained_model
from recommend import recommend

MAX_UPLOAD_BYTES = 8 * 1024 * 1024


@asynccontextmanager
async def lifespan(_: FastAPI):
    vision.load_detector()
    yield


app = FastAPI(title="Reclaim Value AI service", version="1.0.0", lifespan=lifespan)


class MaterialInput(BaseModel):
    material: str
    condition_score: float = Field(70, ge=0, le=100)
    quantity_kg: float = Field(100, gt=0)
    distance_km: float = Field(10, ge=0)
    demand: float | None = Field(None, ge=0, le=1)


class TextInput(BaseModel):
    text: str = Field(..., max_length=500)


def _material(name: str) -> str:
    m = normalise_material(name)
    if not m:
        raise HTTPException(422, f"unknown material '{name}'. Use one of: {', '.join(MATERIALS)}")
    return m


@app.get("/health")
def health():
    return {
        "status": "ok",
        "material_model": vision.detector_state().public(),
        "price_model": "trained" if trained_model() is not None else "baseline",
        "materials": list(MATERIALS),
    }


@app.get("/materials")
def materials():
    return MATERIALS


@app.post("/analyze")
async def analyze(
    file: UploadFile = File(...),
    quantity_kg: float = Form(100),
    distance_km: float = Form(10),
):
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "image larger than 8 MB")
    if quantity_kg <= 0:
        raise HTTPException(422, "quantity_kg must be positive")
    try:
        result = vision.analyze_image(data)
    except vision.InvalidImageError as exc:
        raise HTTPException(400, str(exc)) from exc
    m, cond = result["material"], result["condition_score"]
    result["quantity_kg"] = quantity_kg
    # When the trained model is unsure, material is None: the user picks it and
    # the backend asks /price and /recommend again.
    result["recommendation"] = recommend(m, cond, quantity_kg, distance_km) if m else None
    result["price"] = estimate_price(m, cond, quantity_kg, distance_km) if m else None
    return result


@app.post("/recommend")
def recommend_route(body: MaterialInput):
    return recommend(_material(body.material), body.condition_score, body.quantity_kg,
                     body.distance_km, body.demand)


@app.post("/price")
def price_route(body: MaterialInput):
    return estimate_price(_material(body.material), body.condition_score, body.quantity_kg,
                          body.distance_km)


@app.post("/nlp/parse")
def parse_route(body: TextInput):
    return {"query": body.text, "filters": parse_query(body.text)}


@app.post("/agent")
def agent_route(body: TextInput):
    return agent_intent(body.text)
