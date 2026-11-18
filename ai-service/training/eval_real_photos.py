"""Measure the REAL accuracy of the material recognition on your own photos.

Folder layout - the folder name is the true class ('other' = none of the six materials):
    real_test/steel/*.jpg  real_test/wood/*.jpg  real_test/concrete/*.jpg ... real_test/other/*.jpg

    python training/eval_real_photos.py real_test [--csv errors.csv]

It uses exactly the same code path as the app (vision.analyze_image), with the weights in
ai-service/weights/ (or YOLO_WEIGHTS / CLS_WEIGHTS). These photos must NEVER be used for
training. This - not the YOLO validation mAP - is the number to quote in the report.
"""
import argparse
import collections
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import vision  # noqa: E402

EXTS = (".jpg", ".jpeg", ".png", ".webp", ".jfif", ".bmp")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("folder")
    ap.add_argument("--csv")
    a = ap.parse_args(argv)

    state = vision.load_detector()
    if not state.loaded:
        print("WARNING: no trained model found - this measures the DEMO heuristic, not a model.")
    conf = collections.defaultdict(collections.Counter)
    rows = []
    for cls_dir in sorted(p for p in Path(a.folder).iterdir() if p.is_dir()):
        truth = cls_dir.name.lower()
        for f in sorted(x for x in cls_dir.rglob("*") if x.suffix.lower() in EXTS):
            r = vision.analyze_image(f.read_bytes())
            if r["material"]:
                pred = r["material"]
            else:
                pred = "other" if "not recognised" in (r["reason"] or "") else "unsure"
            conf[truth][pred] += 1
            rows.append((str(f), truth, pred, r["confidence"], r["model"]))

    total = sum(sum(c.values()) for c in conf.values())
    if not total:
        print("no images found")
        return 1
    correct = sum(c[t] for t, c in conf.items())
    answered = sum(n for c in conf.values() for p, n in c.items() if p != "unsure")
    print(f"images: {total} | answered: {answered / total:.0%} | accuracy (unsure counts as wrong): {correct / total:.1%}")
    if answered:
        print(f"accuracy when it answers: {correct / answered:.1%}")
    preds = sorted({p for c in conf.values() for p in c} | set(conf))
    print("\nconfusion matrix (rows = truth, columns = prediction)")
    print(f"{'':10s}" + "".join(f"{p:>10s}" for p in preds))
    for t in sorted(conf):
        n = sum(conf[t].values())
        print(f"{t:10s}" + "".join(f"{conf[t][p]:>10d}" for p in preds) + f"   recall {conf[t][t] / n:.0%} (n={n})")
    if a.csv:
        with open(a.csv, "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["file", "truth", "pred", "confidence", "model"])
            w.writerows(r for r in rows if r[1] != r[2])
        print("misclassified photos saved to", a.csv)
    return 0


if __name__ == "__main__":
    sys.exit(main())
