"""Per-photo diagnosis: what the detector saw and the classifier's top-3, v1 vs v2.

Folder layout: <folder>/<true class>/*.jpg  (brick, concrete, glass, other, steel, tiles, wood)

    python training/diagnose_photos.py ~/Desktop/reclaim_web_test \
        --v1 weights/materials_cls.pt --v2 weights/materials_cls_v2.pt --csv ~/Desktop/diagnose.csv

Runs on CPU (no GPU needed). Uses the same code path as the app (vision.analyze_image).
"""
import argparse
import collections
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import vision  # noqa: E402

EXTS = (".jpg", ".jpeg", ".png", ".webp", ".jfif", ".bmp")
SHORT = {"brick": "brick", "concrete": "concr", "glass": "glass", "other": "other",
         "steel": "steel", "tiles": "tiles", "wood": "wood"}


def top3(probs):
    ranked = sorted(probs.items(), key=lambda x: -x[1])[:3]
    return ", ".join(f"{SHORT.get(m, m)} {p * 100:.0f}" for m, p in ranked) or "-"


def run(photo: bytes):
    """Final app answer + full classifier probabilities + detector shares."""
    r = vision.analyze_image(photo)
    det, cls = vision._run_models(vision.open_image(photo))
    pred = r["material"] or ("other" if "not recognised" in (r["reason"] or "") else "unsure")
    det_txt = ", ".join(f"{SHORT.get(m, m)} {s * 100:.0f}%" for m, s in
                        sorted((det or {}).get("share", {}).items(), key=lambda x: -x[1])) or "no pieces"
    return pred, r["confidence"], r.get("basis") or "-", cls or {}, det_txt


def rank_of(truth, probs):
    order = [m for m, _ in sorted(probs.items(), key=lambda x: -x[1])]
    return order.index(truth) + 1 if truth in order else None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("folder")
    ap.add_argument("--v1", default="weights/materials_cls.pt")
    ap.add_argument("--v2", default="weights/materials_cls_v2.pt")
    ap.add_argument("--detector", default="weights/materials.pt")
    ap.add_argument("--csv")
    a = ap.parse_args(argv)

    photos = []
    skipped = []
    for cdir in sorted(p for p in Path(a.folder).expanduser().iterdir() if p.is_dir()):
        for f in sorted(cdir.iterdir()):
            if f.suffix.lower() in EXTS:
                photos.append((cdir.name.lower(), f))
            elif f.is_file() and not f.name.startswith("."):
                skipped.append(f.name)
    if not photos:
        print("no photos found - check the folder path")
        return 1

    results = {}
    for tag, cls_path in (("v1", a.v1), ("v2", a.v2)):
        state = vision.load_detector(a.detector, cls_path)
        if not state.classifier.loaded:
            print(f"{tag}: could not load {cls_path}: {state.classifier.error}")
            return 1
        print(f"running {tag} ({cls_path}) on {len(photos)} photos...")
        results[tag] = [run(f.read_bytes()) for _, f in photos]

    rows = []
    print()
    for i, (truth, f) in enumerate(photos):
        p1, c1, b1, cls1, det = results["v1"][i]
        p2, c2, b2, cls2, _ = results["v2"][i]
        mark = lambda p: "OK " if p == truth else "-- "
        print(f"[{truth}] {f.name[:45]}")
        print(f"   detector : {det}")
        print(f"   v1 {mark(p1)}{p1:8s} {c1 * 100:3.0f}%  ({b1})   classifier top3: {top3(cls1)}")
        print(f"   v2 {mark(p2)}{p2:8s} {c2 * 100:3.0f}%  ({b2})   classifier top3: {top3(cls2)}")
        rows.append([truth, f.name, det, p1, round(c1, 3), b1, top3(cls1), rank_of(truth, cls1),
                     p2, round(c2, 3), b2, top3(cls2), rank_of(truth, cls2)])

    print("\nSUMMARY - where the TRUE class sits in the classifier's ranking")
    print(f"{'class':10s}{'n':>4s}{'v1 right':>10s}{'v1 top1':>9s}{'v1 top3':>9s}{'v2 right':>10s}{'v2 top1':>9s}{'v2 top3':>9s}")
    by = collections.defaultdict(list)
    for r in rows:
        by[r[0]].append(r)
    for truth in sorted(by):
        rs = by[truth]
        n = len(rs)
        def count(pred_i, rank_i, k=None):
            if k is None:
                return sum(r[pred_i] == truth for r in rs)
            return sum(r[rank_i] is not None and r[rank_i] <= k for r in rs)
        print(f"{truth:10s}{n:4d}{count(3, 7):>10d}{count(3, 7, 1):>9d}{count(3, 7, 3):>9d}"
              f"{count(8, 12):>10d}{count(8, 12, 1):>9d}{count(8, 12, 3):>9d}")
    print("\n'right' = final app answer correct; 'top1/top3' = true class is the classifier's 1st / in its top 3.")
    print("If top3 is much higher than 'right', tuning the app's cut-offs can help.")
    print("If even top3 is low, the model needs real training photos of that material.")
    if skipped:
        print(f"\nskipped {len(skipped)} file(s) with unsupported formats (convert to JPG):", ", ".join(skipped[:10]))

    if a.csv:
        with open(Path(a.csv).expanduser(), "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["truth", "file", "detector", "v1_pred", "v1_conf", "v1_basis", "v1_cls_top3", "v1_true_rank",
                        "v2_pred", "v2_conf", "v2_basis", "v2_cls_top3", "v2_true_rank"])
            w.writerows(rows)
        print("details saved to", a.csv)
    return 0


if __name__ == "__main__":
    sys.exit(main())
