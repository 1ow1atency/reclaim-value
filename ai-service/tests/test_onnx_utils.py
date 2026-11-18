"""Pre/post-processing used by the ONNX models must match what ultralytics does."""
import numpy as np
import pytest

from onnx_models import _nms, _resize_bilinear


@pytest.mark.parametrize("src,dst", [((480, 640), (240, 320)), ((300, 200), (640, 427)), ((97, 131), (97, 131))])
def test_resize_matches_cv2(src, dst):
    cv2 = pytest.importorskip("cv2")
    rng = np.random.default_rng(0)
    a = rng.integers(0, 256, size=(*src, 3), dtype=np.uint8)
    ours = _resize_bilinear(a, dst[1], dst[0]).astype(int)
    ref = cv2.resize(a, (dst[1], dst[0]), interpolation=cv2.INTER_LINEAR).astype(int)
    assert np.abs(ours - ref).max() <= 1  # cv2 uses fixed-point maths


def test_nms_keeps_best_and_separate_boxes():
    boxes = np.array([[0, 0, 10, 10], [1, 1, 10, 10], [20, 20, 30, 30]], dtype=np.float32)
    scores = np.array([0.9, 0.8, 0.7], dtype=np.float32)
    assert _nms(boxes, scores, 0.5).tolist() == [0, 2]
