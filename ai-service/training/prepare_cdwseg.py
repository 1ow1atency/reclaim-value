"""Convert the CDW-Seg dataset (Labelme JSON polygons) to YOLO detection format + 'other' negatives.

python prepare_cdwseg.py <folder with Original_Images_and_Annotation_Files> data/cdwseg_yolo data/negatives/cdwseg

* concrete / timber(->wood) / steel polygons  -> YOLO boxes (class names kept as in the dataset; merge_yolo.py maps timber->wood)
* plastic / fabric / cardboard / plasterboard polygons -> cropped photos saved as NEGATIVES ("other" class for the classifier)
* fill dirt and bin are ignored on purpose (fill dirt looks like concrete rubble; the paper reports 12% confusion).
* Images are shrunk to 1280 px on the long side (originals are 3000x4000) to save disk and training time.
"""
import argparse, collections, json
from pathlib import Path
from PIL import Image

MATERIALS = {"concrete": ["concrete"], "timber": ["timber", "wood"], "steel": ["steel"], "glass": ["glass"]}
NEGATIVES = ["plastic", "fabric", "cardboard", "plasterboard", "plaster board", "drywall"]
# The published Labelme files use short codes. Deduced from the paper's class list
# (bin, concrete, fill dirt, timber, hard/soft plastic, steel, fabric, cardboard, plaster board).
# 'gl' is not one of the paper's 10 classes - assumed glass; check data/check_codes/gl/ before trusting it.
CODE_MATERIAL = {"cp": "concrete", "wt": "timber", "st": "steel", "gl": "glass"}
CODE_NEGATIVE = {"hp", "sp", "cb", "fb", "pb"}   # hard/soft plastic, cardboard, fabric, plaster board
# ignored on purpose: "bin" (the skip itself), "fd" (fill dirt - looks like concrete rubble)
EXTS = (".jpg", ".jpeg", ".png", ".JPG", ".JPEG", ".PNG")


def norm(label):
    return label.lower().replace("_", " ").replace("-", " ").strip()


def material_of(label):
    n = norm(label)
    if n in CODE_MATERIAL:
        return CODE_MATERIAL[n]
    return next((m for m, ks in MATERIALS.items() if any(k in n for k in ks)), None)


def is_negative(label):
    n = norm(label)
    return n in CODE_NEGATIVE or any(k in n for k in NEGATIVES)


def find_image(js_path, data):
    cand = [js_path.with_name(Path(data.get("imagePath") or "").name)] + [js_path.with_suffix(e) for e in EXTS]
    return next((c for c in cand if c.is_file() and c.suffix in EXTS), None)


def bbox(points):
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("src"); ap.add_argument("out"); ap.add_argument("neg_out")
    ap.add_argument("--max-side", type=int, default=1280); ap.add_argument("--crops-per-image", type=int, default=4)
    ap.add_argument("--check-dir", default="data/check_codes", help="a few example crops per label, to eyeball the mapping")
    a = ap.parse_args()
    out, neg = Path(a.out), Path(a.neg_out)
    (out / "train" / "images").mkdir(parents=True, exist_ok=True); (out / "train" / "labels").mkdir(parents=True, exist_ok=True)
    neg.mkdir(parents=True, exist_ok=True)
    names = list(MATERIALS)
    seen, boxes, crops, skipped = collections.Counter(), collections.Counter(), 0, 0
    checked = collections.Counter()
    for js in sorted(Path(a.src).rglob("*.json")):
        try:
            data = json.loads(js.read_text())
            shapes = data["shapes"]
        except (ValueError, KeyError):
            continue  # not a Labelme file (e.g. COCO annotations.json)
        img_path = find_image(js, data)
        if img_path is None:
            skipped += 1; continue
        im = Image.open(img_path).convert("RGB")
        W0, H0 = im.size
        scale = min(1.0, a.max_side / max(W0, H0))
        im = im.resize((round(W0 * scale), round(H0 * scale))) if scale < 1 else im
        W, H = im.size
        rows, negs = [], []
        for sh in shapes:
            lab, pts = sh.get("label", ""), sh.get("points", [])
            seen[norm(lab)] += 1
            if len(pts) < 3:
                continue
            x1, y1, x2, y2 = (v * scale for v in bbox(pts))
            x1, y1, x2, y2 = max(0, x1), max(0, y1), min(W, x2), min(H, y2)
            m = material_of(lab)
            if m is not None and checked[norm(lab)] < 6 and x2 - x1 >= 64 and y2 - y1 >= 64:
                d = Path(a.check_dir) / norm(lab).replace(" ", "_"); d.mkdir(parents=True, exist_ok=True)
                im.crop(tuple(int(v) for v in (x1, y1, x2, y2))).save(d / f"{img_path.stem}_{checked[norm(lab)]}.jpg", quality=85)
                checked[norm(lab)] += 1
            if m is not None:
                w, h = (x2 - x1) / W, (y2 - y1) / H
                if w > 0.01 and h > 0.01:
                    rows.append(f"{names.index(m)} {(x1 + x2) / 2 / W:.6f} {(y1 + y2) / 2 / H:.6f} {w:.6f} {h:.6f}"); boxes[m] += 1
            elif is_negative(lab) and x2 - x1 >= 96 and y2 - y1 >= 96:
                negs.append((x1, y1, x2, y2))
        stem = img_path.stem
        if rows:
            im.save(out / "train" / "images" / f"{stem}.jpg", quality=92)
            (out / "train" / "labels" / f"{stem}.txt").write_text("\n".join(rows))
        for i, b in enumerate(sorted(negs, key=lambda b: -(b[2] - b[0]) * (b[3] - b[1]))[: a.crops_per_image]):
            im.crop(tuple(int(v) for v in b)).save(neg / f"{stem}__crop{i}.jpg", quality=92); crops += 1
    (out / "data.yaml").write_text("path: .\ntrain: train/images\nval: train/images\nnames:\n" + "".join(f"  {i}: {n}\n" for i, n in enumerate(names)))
    print("labels found in the JSON files:", dict(seen))
    print("boxes written:", dict(boxes), "| negative crops:", crops, "| JSON without image:", skipped)
    print("example crops to check the label mapping:", a.check_dir, dict(checked))
    if not boxes:
        print("WARNING: no boxes written. Check the label names printed above and edit MATERIALS/NEGATIVES at the top of this file.")


if __name__ == "__main__":
    main()
