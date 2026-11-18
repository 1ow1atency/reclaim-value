"""Export the trained models to ONNX (for hosting without PyTorch, e.g. on Vercel) and check they agree.

Run on the machine that has the .pt files and ultralytics (your Mac):

    cd ai-service && source .venv/bin/activate
    pip install onnx onnxruntime                       # once
    python training/export_onnx.py --check ~/Desktop/reclaim_web_test

Writes weights/materials.onnx and weights/materials_cls.onnx next to the .pt files.
With --check, every photo in the folder goes through the app's own code twice
(.pt and .onnx) and the answers are compared.
"""
import argparse
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".jfif"}


def export(pt: Path, dynamic: bool, default_imgsz: int) -> Path:
    from ultralytics import YOLO

    model = YOLO(str(pt))
    imgsz = (getattr(model, "ckpt", None) or {}).get("train_args", {}).get("imgsz") or default_imgsz
    print(f"exporting {pt.name} (imgsz {imgsz}, dynamic={dynamic}) ...")
    out = Path(model.export(format="onnx", imgsz=imgsz, dynamic=dynamic, simplify=True, verbose=False))
    target = pt.with_suffix(".onnx")
    if out.resolve() != target.resolve():
        shutil.move(str(out), target)
    print(f"  -> {target}  ({target.stat().st_size / 1e6:.1f} MB)")
    return target


def check(folder: Path, det_pt, cls_pt, det_onnx, cls_onnx) -> int:
    import vision

    photos = sorted(p for p in folder.rglob("*") if p.suffix.lower() in EXTS)
    if not photos:
        print("no photos found in", folder)
        return 1
    runs = {}
    for tag, det, cls in (("pt", det_pt, cls_pt), ("onnx", det_onnx, cls_onnx)):
        st = vision.load_detector(str(det) if det else "", str(cls) if cls else "")
        for name, slot in (("detector", st.detector), ("classifier", st.classifier)):
            if slot.path and not slot.loaded:
                print(f"{tag} {name} failed to load: {slot.error}")
                return 1
        runs[tag] = [vision.analyze_image(p.read_bytes()) for p in photos]
    same = 0
    worst = 0.0
    for p, a, b in zip(photos, runs["pt"], runs["onnx"]):
        diff = abs((a["confidence"] or 0) - (b["confidence"] or 0))
        worst = max(worst, diff)
        ok = a["material"] == b["material"] and a["needs_manual"] == b["needs_manual"]
        same += ok
        if not ok or diff > 0.05:
            print(f"  {'DIFF' if not ok else 'conf'}  {p.parent.name}/{p.name[:40]}: "
                  f".pt {a['material']} {a['confidence']:.2f}  |  .onnx {b['material']} {b['confidence']:.2f}")
    print(f"\nsame answer on {same}/{len(photos)} photos; largest confidence difference {worst * 100:.1f} points")
    print("OK - the ONNX models can replace the .pt ones." if same == len(photos) and worst < 0.05
          else "Small differences are normal (resizing maths); large ones mean something is wrong - send a screenshot.")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--detector", default=str(HERE / "weights" / "materials.pt"))
    ap.add_argument("--classifier", default=str(HERE / "weights" / "materials_cls.pt"))
    ap.add_argument("--check", help="folder of photos to compare .pt and .onnx answers on")
    ap.add_argument("--skip-export", action="store_true", help="only run --check on existing .onnx files")
    a = ap.parse_args(argv)

    det_pt = Path(a.detector).expanduser() if a.detector else None
    cls_pt = Path(a.classifier).expanduser() if a.classifier else None
    for p in (det_pt, cls_pt):
        if p and not p.is_file():
            print("not found:", p)
            return 1
    if a.skip_export:
        det_onnx, cls_onnx = det_pt.with_suffix(".onnx"), cls_pt.with_suffix(".onnx")
    else:
        det_onnx = export(det_pt, dynamic=True, default_imgsz=640)
        cls_onnx = export(cls_pt, dynamic=False, default_imgsz=320)
    thr = det_pt.with_name(det_pt.stem + "_thresholds.json")
    print("thresholds file:", thr if thr.is_file() else "missing (per-class cut-offs default to 0.25)")
    if a.check:
        return check(Path(a.check).expanduser(), det_pt, cls_pt, det_onnx, cls_onnx)
    return 0


if __name__ == "__main__":
    sys.exit(main())
