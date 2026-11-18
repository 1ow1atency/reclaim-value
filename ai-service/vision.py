"""AI material recognition and condition scoring.

Trained mode (the real one)
    * Detector - a YOLO detection model (``YOLO_WEIGHTS``, default ``weights/materials.pt``).
      Runs at a low floor confidence; each class then uses its own cut-off from
      ``<weights>_thresholds.json`` (written by training/train_yolo.py). Boxes vote by
      area x confidence, so a pile with many small pieces still gives one answer.
    * Classifier - a whole-image YOLO-cls model (``CLS_WEIGHTS``, default
      ``weights/materials_cls.pt``). Second opinion that copes with cluttered piles,
      and its optional ``other`` class lets the app say "not one of the six materials".
    * If the combined confidence is below ``ACCEPT_CONF`` the service does NOT guess:
      ``material`` is null, ``needs_manual`` is true and the user picks the material.

Demo mode
    When no trained model is available, a colour/texture heuristic is used so the
    workflow can be demonstrated. Every response says ``demo_mode: true``.

Condition scoring is heuristic (rust on steel, dark patches, crack-like edges) and
always advisory.
"""

from __future__ import annotations

import io
import json
import os
from dataclasses import dataclass, field

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

from catalog import MATERIALS, MATERIAL_NAMES, condition_label, normalise_material

HERE = os.path.dirname(os.path.abspath(__file__))
MAX_SIDE = 160
DEMO_CONFIDENCE_CAP = 0.65


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except ValueError:
        return default


DET_FLOOR = _env_float("YOLO_CONF", 0.10)        # detector floor; per-class thresholds apply on top
DEFAULT_CLASS_THRESHOLD = 0.25
CLS_MIN_PROB = _env_float("CLS_MIN_PROB", 0.60)  # how sure the classifier must be to call "other"
ACCEPT_CONF = _env_float("ACCEPT_CONF", 0.35)    # below this the user picks the material
# Out-of-domain guards (found in testing: with no detector boxes the whole-photo
# classifier tends to fall back to its biggest class, wood, with high confidence).
CLS_ONLY_FACTOR = _env_float("CLS_ONLY_FACTOR", 0.6)   # detector found nothing -> trust classifier less
DISAGREE_FACTOR = _env_float("DISAGREE_FACTOR", 0.7)   # detector and classifier disagree
CONFIRM_BELOW = _env_float("CONFIRM_BELOW", 0.6)       # below this the UI asks the user to confirm


class InvalidImageError(ValueError):
    pass


@dataclass
class ModelSlot:
    path: str | None = None
    loaded: bool = False
    error: str | None = None
    model: object | None = field(default=None, repr=False)

    def public(self) -> dict:
        return {"weights": self.path, "loaded": self.loaded, "error": self.error}


@dataclass
class DetectorState:
    detector: ModelSlot = field(default_factory=ModelSlot)
    classifier: ModelSlot = field(default_factory=ModelSlot)
    thresholds: dict = field(default_factory=dict)
    allow_heuristic: bool = False

    @property
    def loaded(self) -> bool:
        return self.detector.loaded or self.classifier.loaded

    def public(self) -> dict:
        return {
            "mode": "trained" if self.loaded else "demo-heuristic",
            "loaded": self.loaded,
            "detector": self.detector.public(),
            "classifier": self.classifier.public(),
            "class_thresholds": self.thresholds,
            "accept_confidence": ACCEPT_CONF,
        }


_state = DetectorState()


def _resolve(env_name: str, default_file: str, explicit: str | None) -> str | None:
    """Explicit arg > env var > default file in weights/. An empty string disables the model."""
    value = explicit if explicit is not None else os.getenv(env_name)
    if value is None:
        candidate = os.path.join(HERE, "weights", default_file)
        return candidate if os.path.isfile(candidate) else None
    return value or None


def _load_slot(path: str | None) -> ModelSlot:
    slot = ModelSlot(path=path)
    if not path:
        return slot
    if not os.path.isfile(path):
        slot.error = f"weights file not found: {path}"
        return slot
    try:
        from ultralytics import YOLO  # type: ignore

        slot.model = YOLO(path)
        slot.loaded = True
    except ImportError:
        slot.error = "ultralytics is not installed (pip install ultralytics)"
    except Exception as exc:  # pragma: no cover - depends on the weights file
        slot.error = f"could not load weights: {exc}"
    return slot


def load_detector(weights: str | None = None, cls_weights: str | None = None) -> DetectorState:
    """Load the trained models once at start-up. Failures are recorded, never raised."""
    global _state
    det_path = _resolve("YOLO_WEIGHTS", "materials.pt", weights)
    cls_path = _resolve("CLS_WEIGHTS", "materials_cls.pt", cls_weights)
    state = DetectorState(
        detector=_load_slot(det_path),
        classifier=_load_slot(cls_path),
        allow_heuristic=os.getenv("ALLOW_HEURISTIC_FALLBACK", "0") == "1",
    )
    thr_file = os.getenv("YOLO_THRESHOLDS") or (os.path.splitext(det_path)[0] + "_thresholds.json" if det_path else None)
    if thr_file and os.path.isfile(thr_file):
        try:
            with open(thr_file) as fh:
                state.thresholds = {str(k).lower(): float(v) for k, v in json.load(fh).items()}
        except Exception as exc:  # pragma: no cover
            state.detector.error = f"bad thresholds file: {exc}"
    _state = state
    return state


def detector_state() -> DetectorState:
    return _state


# --------------------------------------------------------------------------
# Image features (used by demo mode and by condition scoring)
# --------------------------------------------------------------------------

def open_image(data: bytes) -> Image.Image:
    if not data:
        raise InvalidImageError("empty file")
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise InvalidImageError("file is not a readable image") from exc
    img = ImageOps.exif_transpose(img)
    return img.convert("RGB")


def _features(img: Image.Image) -> dict:
    small = img.copy()
    small.thumbnail((MAX_SIDE, MAX_SIDE))
    hsv = np.asarray(small.convert("HSV"), dtype=np.float32)
    h = hsv[..., 0] * (360.0 / 255.0)
    s = hsv[..., 1] / 255.0
    v = hsv[..., 2] / 255.0
    grey = np.asarray(small.convert("L"), dtype=np.float32) / 255.0

    gx = np.zeros_like(grey)
    gy = np.zeros_like(grey)
    gx[:, 1:-1] = grey[:, 2:] - grey[:, :-2]
    gy[1:-1, :] = grey[2:, :] - grey[:-2, :]
    mag = np.hypot(gx, gy)
    edges = mag > 0.18
    edge_density = float(edges.mean())
    axis = float((np.abs(gx[edges]) > 3 * np.abs(gy[edges])).mean() +
                 (np.abs(gy[edges]) > 3 * np.abs(gx[edges])).mean()) if edges.any() else 0.0

    sat = s > 0.32
    warm = (h < 28) | (h > 345)
    return {
        "mean_s": float(s.mean()),
        "mean_v": float(v.mean()),
        "std_v": float(v.std()),
        "grey": float((s < 0.16).mean()),
        "brick_red": float((sat & warm & (v > 0.25) & (v < 0.9)).mean()),
        "rust": float((sat & (h >= 12) & (h <= 35) & (v > 0.15) & (v < 0.7) & (s > 0.45)).mean()),
        "brown": float(((h >= 22) & (h <= 50) & (s > 0.25) & (s < 0.85) & (v > 0.2) & (v < 0.92)).mean()),
        "blue": float(((h >= 170) & (h <= 235) & (s > 0.08)).mean()),
        "bright": float((v > 0.8).mean()),
        "dark": float((v < 0.16).mean()),
        "edge_density": edge_density,
        "axis_aligned": axis,
        "texture": float(mag.std()),
    }


def _heuristic_scores(f: dict) -> dict[str, float]:
    mid_grey = 1.0 - min(abs(f["mean_v"] - 0.55) / 0.45, 1.0)
    scores = {
        "brick": 2.2 * f["brick_red"] + 0.15 * f["axis_aligned"],
        "wood": 1.8 * f["brown"] * (1 - f["brick_red"]) + 0.1 * f["axis_aligned"],
        "steel": 0.55 * f["grey"] + 1.4 * f["rust"] * f["grey"] * 2 + 0.9 * f["edge_density"]
                 + 0.6 * f["std_v"] + 0.25 * f["dark"],
        "concrete": 0.85 * f["grey"] * mid_grey + 0.6 * min(f["texture"] * 8, 1) * f["grey"]
                    - 0.3 * f["edge_density"],
        "tiles": 0.7 * f["bright"] + 0.6 * f["axis_aligned"] * (1 - f["texture"] * 4)
                 - 0.4 * f["brick_red"],
        "glass": 1.4 * f["blue"] * (1 - f["texture"] * 3) + 0.35 * f["bright"] * (1 - f["mean_s"]),
    }
    return {k: max(v, 0.0) for k, v in scores.items()}


def _condition(material: str | None, f: dict) -> tuple[float, list[str]]:
    score = 92.0
    notes: list[str] = []
    if material == "steel" and f["rust"] > 0.03:
        score -= min(f["rust"] * 140, 45)
        notes.append(f"visible rust/corrosion on ~{f['rust'] * 100:.0f}% of the image")
    if f["dark"] > 0.12:
        score -= min((f["dark"] - 0.12) * 60, 15)
        notes.append("dark patches (possible damage, staining or deep shadow)")
    crack_proxy = f["edge_density"] - (0.22 if material in ("brick", "tiles") else 0.14)
    if crack_proxy > 0:
        score -= min(crack_proxy * 120, 25)
        notes.append("many irregular edges (possible cracks, breakage or mixed debris)")
    if f["std_v"] < 0.03:
        notes.append("very low contrast photo - condition estimate is unreliable")
    if len(notes) == 0:
        notes.append("no obvious surface damage detected")
    notes.append("advisory only: inspect physically before high-value trades")
    return float(np.clip(score, 5, 98)), notes


# --------------------------------------------------------------------------
# Trained-model inference
# --------------------------------------------------------------------------

def aggregate_detections(boxes, names, img_w: int, img_h: int, thresholds: dict | None = None,
                         floor: float = DET_FLOOR) -> dict:
    """Area x confidence vote over all boxes that pass their class threshold.

    ``boxes`` is an iterable of (class_id, confidence, x1, y1, x2, y2).
    Returns {"share": {material: 0..1}, "confidence": {material: mean conf}, "count": n}.
    """
    thresholds = thresholds or {}
    weight: dict[str, float] = {}
    confs: dict[str, list[float]] = {}
    count = 0
    area_total = float(max(img_w * img_h, 1))
    for cls_id, conf, x1, y1, x2, y2 in boxes:
        m = normalise_material(str(names[int(cls_id)]))
        if m is None:
            continue
        if conf < max(floor, thresholds.get(m, DEFAULT_CLASS_THRESHOLD)):
            continue
        area = max(0.0, x2 - x1) * max(0.0, y2 - y1) / area_total
        if area <= 0:
            continue
        weight[m] = weight.get(m, 0.0) + area * conf
        confs.setdefault(m, []).append(conf)
        count += 1
    total = sum(weight.values())
    return {
        "share": {m: w / total for m, w in weight.items()} if total else {},
        "confidence": {m: sum(c) / len(c) for m, c in confs.items()},
        "count": count,
    }


def classifier_probs(probs, names) -> dict:
    """Map classifier class probabilities to platform materials (+ 'other')."""
    out: dict[str, float] = {}
    for idx, p in enumerate(probs):
        name = str(names[idx]).lower()
        key = "other" if name == "other" else normalise_material(name)
        if key:
            out[key] = out.get(key, 0.0) + float(p)
    return out


def combine(det: dict | None, cls: dict | None) -> tuple[dict[str, float], str | None]:
    """Merge detector and classifier into one score per material (0..1).

    Returns (scores, reason_if_rejected).
    """
    det_score = {}
    if det and det["share"]:
        # share of the photo's material x how confident the boxes were
        det_score = {m: s * det["confidence"][m] for m, s in det["share"].items()}
    cls_score = {m: p for m, p in (cls or {}).items() if m != "other"}

    if cls and cls.get("other", 0) >= CLS_MIN_PROB and (not det_score or max(det_score.values()) < 0.5):
        return {}, "not recognised as one of the six materials"
    if det_score and cls_score:
        keys = set(det_score) | set(cls_score)
        scores = {m: 0.5 * det_score.get(m, 0) + 0.5 * cls_score.get(m, 0) for m in keys}
    else:
        scores = det_score or cls_score
    return scores, None if scores else "no material detected"


def _run_models(img: Image.Image) -> tuple[dict | None, dict | None]:
    st = _state
    det = cls = None
    if st.detector.loaded:
        r = st.detector.model(img, conf=DET_FLOOR, verbose=False)[0]  # type: ignore[operator]
        boxes = []
        if r.boxes is not None and len(r.boxes):
            for c, conf, xyxy in zip(r.boxes.cls.tolist(), r.boxes.conf.tolist(), r.boxes.xyxy.tolist()):
                boxes.append((c, conf, *xyxy))
        det = aggregate_detections(boxes, r.names, img.width, img.height, st.thresholds)
    if st.classifier.loaded:
        r = st.classifier.model(img, verbose=False)[0]  # type: ignore[operator]
        if getattr(r, "probs", None) is not None:
            cls = classifier_probs(r.probs.data.tolist(), r.names)
    return det, cls


def analyze_image(data: bytes) -> dict:
    img = open_image(data)
    f = _features(img)
    st = _state

    material: str | None = None
    conf = 0.0
    ranked: list[tuple[str, float]] = []
    reason = None
    basis = None
    needs_confirmation = False
    detections = 0
    sources: dict = {}
    model = "demo-heuristic"

    if st.loaded:
        model = "trained"
        try:
            det, cls = _run_models(img)
        except Exception as exc:  # pragma: no cover - model specific
            det, cls, reason = None, None, f"inference failed: {exc}"
        if det is not None:
            detections = det["count"]
            sources["detector"] = {"share": {m: round(s, 3) for m, s in det["share"].items()}, "boxes": det["count"]}
        if cls is not None:
            sources["classifier"] = {m: round(p, 3) for m, p in sorted(cls.items(), key=lambda x: -x[1])[:4]}
        scores, why = combine(det, cls) if reason is None else ({}, reason)
        det_found = bool(det and det["count"])
        cls_top = max(((m, p) for m, p in (cls or {}).items() if m != "other"), key=lambda x: x[1], default=(None, 0))[0]
        det_top = max(det["share"], key=det["share"].get) if det_found else None
        factor = 1.0
        if st.detector.loaded and not det_found and cls:
            basis, factor, needs_confirmation = "classifier-only", CLS_ONLY_FACTOR, True
        elif det_found and cls_top and det_top != cls_top:
            basis, factor, needs_confirmation = "models-disagree", DISAGREE_FACTOR, True
        elif det_found and cls:
            basis = "detector+classifier"
        else:
            basis = "detector-only" if det_found else "classifier-only"
        scores = {m: s * factor for m, s in scores.items()}
        ranked = sorted(scores.items(), key=lambda x: -x[1])
        if ranked and ranked[0][1] >= ACCEPT_CONF:
            material, conf = ranked[0]
        else:
            if why:
                reason = why
            elif ranked:
                reason = f"model was only {ranked[0][1] * 100:.0f}% sure"
            else:
                reason = "no material detected"

    if material is None and (not st.loaded or st.allow_heuristic):
        hs = _heuristic_scores(f)
        total = sum(hs.values()) or 1.0
        hranked = sorted(((m, s / total) for m, s in hs.items()), key=lambda x: -x[1])
        material, conf = hranked[0][0], min(hranked[0][1], DEMO_CONFIDENCE_CAP)
        if not ranked:
            ranked = hranked
        model = "demo-heuristic"

    cond, notes = _condition(material, f)
    return {
        "material": material,
        "material_label": MATERIALS[material]["label"] if material else None,
        "confidence": round(conf, 3),
        "alternatives": [{"material": m, "score": round(s, 3)} for m, s in ranked if m != material][:3],
        "needs_manual": material is None,
        "needs_confirmation": bool(material) and model == "trained" and (needs_confirmation or conf < CONFIRM_BELOW),
        "basis": basis,
        "reason": reason if material is None else None,
        "condition_score": round(cond, 1),
        "condition_label": condition_label(cond),
        "condition_notes": notes,
        "detections": detections,
        "sources": sources,
        "model": model,
        "demo_mode": model == "demo-heuristic",
        "image": {"width": img.width, "height": img.height},
    }


__all__ = ["analyze_image", "load_detector", "detector_state", "aggregate_detections",
           "classifier_probs", "combine", "InvalidImageError", "MATERIAL_NAMES"]
