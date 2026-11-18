import pytest

import vision
from synthetic import SAMPLES


@pytest.mark.parametrize("material", sorted(SAMPLES))
def test_heuristic_recognises_synthetic_textures(material):
    r = vision.analyze_image(SAMPLES[material])
    assert r["material"] == material
    assert r["demo_mode"] is True
    assert r["model"] == "demo-heuristic"
    assert 0 < r["confidence"] <= vision.DEMO_CONFIDENCE_CAP


def test_rust_lowers_steel_condition():
    clean = vision.analyze_image(SAMPLES["concrete"])  # no rust
    rusty = vision.analyze_image(SAMPLES["steel"])
    assert rusty["condition_score"] < clean["condition_score"]
    assert any("rust" in n for n in rusty["condition_notes"])


def test_condition_always_advisory():
    r = vision.analyze_image(SAMPLES["brick"])
    assert any("advisory" in n for n in r["condition_notes"])
    assert r["condition_label"] in {"Excellent", "Good", "Fair", "Poor"}


@pytest.mark.parametrize("data", [b"", b"not an image at all"])
def test_invalid_images_rejected(data):
    with pytest.raises(vision.InvalidImageError):
        vision.analyze_image(data)


def test_missing_weights_file_is_reported_not_raised(tmp_path):
    state = vision.load_detector(str(tmp_path / "nope.pt"), str(tmp_path / "nope_cls.pt"))
    assert state.loaded is False
    assert "not found" in state.detector.error and "not found" in state.classifier.error
    assert state.public()["mode"] == "demo-heuristic"
    vision.load_detector("", "")  # reset


NAMES = {0: "steel", 1: "concrete", 2: "brick", 3: "wood", 4: "tiles", 5: "glass"}


def test_detections_vote_by_area_and_respect_class_thresholds():
    boxes = [
        (2, 0.9, 0, 0, 50, 50),     # big brick
        (1, 0.6, 50, 50, 60, 60),   # small concrete
        (1, 0.6, 60, 60, 70, 70),
        (5, 0.3, 0, 0, 100, 100),   # glass below its 0.5 threshold -> ignored
        (2, 0.05, 0, 0, 10, 10),    # below the floor -> ignored
    ]
    d = vision.aggregate_detections(boxes, NAMES, 100, 100, thresholds={"glass": 0.5})
    assert d["count"] == 3
    assert max(d["share"], key=d["share"].get) == "brick"
    assert "glass" not in d["share"]
    assert abs(sum(d["share"].values()) - 1) < 1e-9


def test_classifier_other_class_rejects_non_materials():
    cls = vision.classifier_probs([0.1, 0.05, 0.05, 0.05, 0.05, 0.0, 0.7], {**NAMES, 6: "other"})
    scores, reason = vision.combine(None, cls)
    assert scores == {} and "not recognised" in reason


def test_detector_and_classifier_are_averaged():
    det = {"share": {"wood": 1.0}, "confidence": {"wood": 0.8}, "count": 2}
    scores, _ = vision.combine(det, {"wood": 0.6, "brick": 0.4})
    assert scores["wood"] == pytest.approx(0.5 * 0.8 + 0.5 * 0.6)
    assert scores["brick"] == pytest.approx(0.2)


class _FakeResult:
    def __init__(self, boxes=None, probs=None, names=NAMES):
        self.names = names
        self.probs = probs
        self.boxes = boxes


class _Tensor(list):
    def tolist(self):
        return list(self)


class _Boxes:
    def __init__(self, rows):
        self.cls = _Tensor(r[0] for r in rows)
        self.conf = _Tensor(r[1] for r in rows)
        self.xyxy = _Tensor(list(r[2:]) for r in rows)

    def __len__(self):
        return len(self.cls)


def _install_fake_detector(rows):
    st = vision.DetectorState()
    st.detector = vision.ModelSlot(path="fake.pt", loaded=True,
                                   model=lambda img, **kw: [_FakeResult(boxes=_Boxes(rows))])
    vision._state = st


def test_trained_model_answer_is_used_and_not_demo():
    _install_fake_detector([(3, 0.9, 0, 0, 200, 200)])
    try:
        r = vision.analyze_image(SAMPLES["brick"])  # photo colour says brick, model says wood
        assert r["material"] == "wood" and r["model"] == "trained" and r["demo_mode"] is False
        assert r["needs_manual"] is False and r["detections"] == 1
    finally:
        vision.load_detector("", "")


def test_unsure_trained_model_asks_the_user_instead_of_guessing():
    _install_fake_detector([(3, 0.3, 0, 0, 20, 20)])  # weak, tiny box
    try:
        r = vision.analyze_image(SAMPLES["wood"])
        assert r["material"] is None and r["needs_manual"] is True
        assert r["demo_mode"] is False and "sure" in r["reason"]
        assert r["alternatives"][0]["material"] == "wood"
    finally:
        vision.load_detector("", "")
