"""Build an image-CLASSIFICATION dataset from the detection dataset (+ optional negatives).

python make_cls_dataset.py data/unified data/cls [--negatives data/negatives]

Why a second model: a detector needs boxes and fails silently ("no detection") on cluttered
piles. A whole-image classifier answers "what is the dominant material in this photo?" which
is exactly what the app needs, and it is far more robust on messy photos.

* train: whole-image samples (dominant class by box area) + crops of the biggest boxes
* val/test: whole-image samples only (that is how the app is used)
* --negatives: folder of photos that are NOT one of the 6 materials (plastic, cardboard, soil,
  people, interiors, mixed rubble, ...). They become class "other" so the app can say
  "not recognised" instead of guessing concrete.
"""
import argparse, collections, hashlib, shutil
from pathlib import Path
from PIL import Image
from common import UNIFIED, IMAGE_EXTS

CLASSES = UNIFIED + ["other"]


def dominant(label_file, min_share=0.5):
    area = collections.Counter(); rows = []
    for line in label_file.read_text().splitlines():
        p = line.split()
        if len(p) == 5:
            c, w, h = int(p[0]), float(p[3]), float(p[4]); area[c] += w * h; rows.append((c, *map(float, p[1:])))
    if not area:
        return None, rows
    c, a = area.most_common(1)[0]
    return (c if a / sum(area.values()) >= min_share else None), rows


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("unified"); ap.add_argument("out"); ap.add_argument("--negatives")
    ap.add_argument("--crops-per-image", type=int, default=3); ap.add_argument("--min-box", type=float, default=0.04)
    a = ap.parse_args()
    src, out = Path(a.unified), Path(a.out)
    n = collections.Counter()
    for sp in ("train", "val", "test"):
        for lab in (src / sp / "labels").glob("*.txt"):
            img = next((x for e in IMAGE_EXTS if (x := src / sp / "images" / (lab.stem + e)).exists()), None)
            if img is None:
                continue
            dom, rows = dominant(lab)
            im = None
            if dom is not None:
                d = out / sp / UNIFIED[dom]; d.mkdir(parents=True, exist_ok=True)
                shutil.copy(img, d / img.name); n[(sp, UNIFIED[dom])] += 1
            if sp == "train":
                big = sorted((r for r in rows if r[3] * r[4] >= a.min_box), key=lambda r: -r[3] * r[4])[: a.crops_per_image]
                if big:
                    im = Image.open(img).convert("RGB"); W, H = im.size
                for i, (c, xc, yc, w, h) in enumerate(big):
                    pad = 0.1
                    box = (max(0, (xc - w / 2 * (1 + pad)) * W), max(0, (yc - h / 2 * (1 + pad)) * H),
                           min(W, (xc + w / 2 * (1 + pad)) * W), min(H, (yc + h / 2 * (1 + pad)) * H))
                    if box[2] - box[0] < 32 or box[3] - box[1] < 32:
                        continue
                    d = out / sp / UNIFIED[c]; d.mkdir(parents=True, exist_ok=True)
                    im.crop(tuple(int(v) for v in box)).save(d / f"{img.stem}_crop{i}.jpg", quality=92); n[(sp, UNIFIED[c])] += 1
    if a.negatives:
        for f in sorted(p for p in Path(a.negatives).rglob("*") if p.suffix in IMAGE_EXTS):
            bucket = int(hashlib.md5(f.name.split("__crop")[0].encode()).hexdigest(), 16) % 10   # stable 80/10/10 split by filename
            sp = "train" if bucket < 8 else "val" if bucket == 8 else "test"
            d = out / sp / "other"; d.mkdir(parents=True, exist_ok=True); shutil.copy(f, d / f.name); n[(sp, "other")] += 1
    for sp in ("train", "val", "test"):
        print(sp, {c: n[(sp, c)] for c in CLASSES})
    low = [c for c in CLASSES if n[("val", c)] < 20 or n[("test", c)] < 20]
    if low:
        print("WARNING: <20 val or test images for:", low, "- accuracy for these classes will be noisy.")


if __name__ == "__main__":
    main()
