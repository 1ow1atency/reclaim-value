"""Run the trained YOLO models from ONNX files with onnxruntime (no PyTorch).

Used when the service is hosted somewhere small (e.g. Vercel), where PyTorch
and ultralytics do not fit. The pre- and post-processing below reproduce what
ultralytics does at prediction time, so answers match the .pt models:

* detector: letterbox (bilinear resize, grey 114 padding, minimal padding when
  the model was exported with dynamic shapes), best-class-per-box, class-aware
  NMS, boxes scaled back to the original photo;
* classifier: resize the short side, centre-crop, softmax output from the model.

Export the .onnx files on a machine with ultralytics:
    python training/export_onnx.py
"""
from __future__ import annotations

import ast
import os

import numpy as np
from PIL import Image

NMS_IOU = float(os.getenv("NMS_IOU", "0.5"))   # ultralytics predict default
MAX_NMS = 30000
MAX_DET = 300
MAX_WH = 7680                                   # class offset for class-aware NMS


def _resize_bilinear(a: np.ndarray, new_w: int, new_h: int) -> np.ndarray:
    """cv2.resize(..., INTER_LINEAR) equivalent (half-pixel centres, no antialiasing)."""
    h, w = a.shape[:2]
    if (w, h) == (new_w, new_h):
        return a

    def axis(n_out: int, n_in: int):
        f = (np.arange(n_out, dtype=np.float64) + 0.5) * (n_in / n_out) - 0.5
        i0 = np.floor(f).astype(np.int64)
        frac = f - i0
        low = i0 < 0
        i0[low], frac[low] = 0, 0.0
        high = i0 >= n_in - 1
        i0[high], frac[high] = n_in - 1, 0.0
        return i0, np.minimum(i0 + 1, n_in - 1), frac.astype(np.float32)

    x0, x1, fx = axis(new_w, w)
    y0, y1, fy = axis(new_h, h)
    a = a.astype(np.float32)
    top = a[y0][:, x0] * (1 - fx)[None, :, None] + a[y0][:, x1] * fx[None, :, None]
    bot = a[y1][:, x0] * (1 - fx)[None, :, None] + a[y1][:, x1] * fx[None, :, None]
    out = top * (1 - fy)[:, None, None] + bot * fy[:, None, None]
    return np.clip(np.rint(out), 0, 255).astype(np.uint8)


def _nms(boxes: np.ndarray, scores: np.ndarray, iou_thres: float) -> np.ndarray:
    order = scores.argsort()[::-1]
    areas = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    keep = []
    while order.size:
        i = order[0]
        keep.append(i)
        if len(keep) >= MAX_DET:
            break
        rest = order[1:]
        xx1 = np.maximum(boxes[i, 0], boxes[rest, 0])
        yy1 = np.maximum(boxes[i, 1], boxes[rest, 1])
        xx2 = np.minimum(boxes[i, 2], boxes[rest, 2])
        yy2 = np.minimum(boxes[i, 3], boxes[rest, 3])
        inter = np.clip(xx2 - xx1, 0, None) * np.clip(yy2 - yy1, 0, None)
        iou = inter / (areas[i] + areas[rest] - inter + 1e-9)
        order = rest[iou <= iou_thres]
    return np.array(keep, dtype=np.int64)


class OnnxYolo:
    """A YOLO detect or classify model exported to ONNX by ultralytics."""

    def __init__(self, path: str):
        import onnxruntime as ort  # imported lazily: only needed for .onnx weights

        opts = ort.SessionOptions()
        threads = int(os.getenv("ORT_THREADS", "0") or 0)
        if threads:
            opts.intra_op_num_threads = threads
        self.session = ort.InferenceSession(path, sess_options=opts, providers=["CPUExecutionProvider"])
        meta = self.session.get_modelmeta().custom_metadata_map
        self.names = {int(k): str(v) for k, v in ast.literal_eval(meta.get("names", "{}")).items()}
        self.task = meta.get("task", "detect")
        imgsz = ast.literal_eval(meta.get("imgsz", "[640, 640]"))
        self.imgsz = (imgsz, imgsz) if isinstance(imgsz, int) else (int(imgsz[0]), int(imgsz[1]))
        self.stride = int(ast.literal_eval(meta.get("stride", "32")))
        inp = self.session.get_inputs()[0]
        self.input_name = inp.name
        self.dynamic = any(not isinstance(d, int) for d in inp.shape[2:])
        if not self.names:
            raise ValueError("ONNX file has no class names (export it with ultralytics)")

    # ---------------------------------------------------------------- detect
    def _letterbox(self, rgb: np.ndarray):
        h, w = rgb.shape[:2]
        nh, nw = self.imgsz
        r = min(nh / h, nw / w)
        new_unpad = (max(round(w * r), 1), max(round(h * r), 1))
        dw, dh = nw - new_unpad[0], nh - new_unpad[1]
        if self.dynamic:  # ultralytics uses the minimum rectangle for dynamic-shape models
            dw, dh = dw % self.stride, dh % self.stride
        dw, dh = dw / 2, dh / 2
        img = _resize_bilinear(rgb, *new_unpad)
        top, bottom = round(dh - 0.1), round(dh + 0.1)
        left, right = round(dw - 0.1), round(dw + 0.1)
        img = np.pad(img, ((top, bottom), (left, right), (0, 0)), constant_values=114)
        return img

    def detect(self, img: Image.Image, conf: float) -> list[tuple]:
        """Returns [(class_id, confidence, x1, y1, x2, y2), ...] in original-photo pixels."""
        rgb = np.asarray(img.convert("RGB"))
        h0, w0 = rgb.shape[:2]
        lb = self._letterbox(rgb)
        x = (lb.transpose(2, 0, 1)[None].astype(np.float32)) / 255.0
        pred = self.session.run(None, {self.input_name: x})[0][0].T  # (anchors, 4 + nc)
        scores = pred[:, 4:]
        cls = scores.argmax(1)
        confs = scores[np.arange(len(cls)), cls]
        keep = confs > conf
        if not keep.any():
            return []
        xywh, cls, confs = pred[keep, :4], cls[keep], confs[keep]
        if len(confs) > MAX_NMS:
            top = confs.argsort()[::-1][:MAX_NMS]
            xywh, cls, confs = xywh[top], cls[top], confs[top]
        boxes = np.empty_like(xywh)
        boxes[:, 0] = xywh[:, 0] - xywh[:, 2] / 2
        boxes[:, 1] = xywh[:, 1] - xywh[:, 3] / 2
        boxes[:, 2] = xywh[:, 0] + xywh[:, 2] / 2
        boxes[:, 3] = xywh[:, 1] + xywh[:, 3] / 2
        idx = _nms(boxes + (cls * MAX_WH)[:, None], confs, NMS_IOU)
        boxes, cls, confs = boxes[idx], cls[idx], confs[idx]
        # scale back to the original photo (ultralytics scale_boxes)
        h1, w1 = lb.shape[:2]
        gain = min(h1 / h0, w1 / w0)
        pad_x = round((w1 - w0 * gain) / 2 - 0.1)
        pad_y = round((h1 - h0 * gain) / 2 - 0.1)
        boxes[:, [0, 2]] = (boxes[:, [0, 2]] - pad_x) / gain
        boxes[:, [1, 3]] = (boxes[:, [1, 3]] - pad_y) / gain
        boxes[:, [0, 2]] = boxes[:, [0, 2]].clip(0, w0)
        boxes[:, [1, 3]] = boxes[:, [1, 3]].clip(0, h0)
        return [(int(c), float(p), *map(float, b)) for c, p, b in zip(cls, confs, boxes)]

    # -------------------------------------------------------------- classify
    def classify(self, img: Image.Image) -> list[float]:
        """Class probabilities (softmax is part of the exported model)."""
        size = self.imgsz[0]
        im = img.convert("RGB")
        w, h = im.size
        if w <= h:
            ow, oh = size, int(size * h / w)
        else:
            ow, oh = int(size * w / h), size
        if (ow, oh) != (w, h):
            im = im.resize((ow, oh), Image.BILINEAR)
        left = int(round((ow - size) / 2.0))
        top = int(round((oh - size) / 2.0))
        im = im.crop((left, top, left + size, top + size))
        x = (np.asarray(im, dtype=np.float32).transpose(2, 0, 1)[None]) / 255.0
        return self.session.run(None, {self.input_name: x})[0][0].tolist()
