"""Merge several YOLO-format datasets (each with data.yaml) into one unified 6-class DETECTION dataset.

python merge_yolo.py data/merged data/codd_yolo data/raw/*

* Unmapped / ambiguous labels are dropped; images left with no labels are skipped.
* Polygon / oriented-box rows are converted to plain boxes (fixes the 'Box and segment counts' warning).
* The output keeps ONE pool (data/merged/all). Run resplit_by_source.py next to create train/val/test
  without near-duplicate leakage.
"""
import sys, shutil, collections
from pathlib import Path
import yaml
from common import UNIFIED, IMAGE_EXTS, map_name, to_yolo_box


def main(out, sources):
    out = Path(out)
    (out / "all" / "images").mkdir(parents=True, exist_ok=True)
    (out / "all" / "labels").mkdir(parents=True, exist_ok=True)
    counts, imgs, dropped = collections.Counter(), collections.Counter(), collections.Counter()
    for srcdir in map(Path, sources):
        if not (srcdir / "data.yaml").exists():
            print("skip (no data.yaml):", srcdir); continue
        names = yaml.safe_load((srcdir / "data.yaml").read_text())["names"]
        names = list(names.values()) if isinstance(names, dict) else names
        remap = {i: UNIFIED.index(u) for i, n in enumerate(names) if (u := map_name(n)) is not None}
        print(f"{srcdir.name}: {len(remap)}/{len(names)} source classes mapped ->",
              {n: map_name(n) for n in names})
        tag = srcdir.name[:24]
        for sp_src in ("train", "valid", "val", "test"):
            lab_dir, img_dir = srcdir / sp_src / "labels", srcdir / sp_src / "images"
            if not lab_dir.exists():
                continue
            for lab in lab_dir.glob("*.txt"):
                rows = []
                for line in lab.read_text().splitlines():
                    p = line.split()
                    if not p:
                        continue
                    box = to_yolo_box(p)
                    if box is None:
                        dropped["malformed/tiny box"] += 1; continue
                    cls, xc, yc, w, h = box
                    if cls not in remap:
                        dropped["unmapped class"] += 1; continue
                    rows.append(f"{remap[cls]} {xc:.6f} {yc:.6f} {w:.6f} {h:.6f}")
                    counts[UNIFIED[remap[cls]]] += 1
                img = next((x for e in IMAGE_EXTS if (x := img_dir / (lab.stem + e)).exists()), None)
                if not rows or img is None:
                    continue
                shutil.copy(img, out / "all" / "images" / f"{tag}__{img.name}")
                (out / "all" / "labels" / f"{tag}__{lab.name}").write_text("\n".join(rows))
                imgs[tag] += 1
    print("images per source:", dict(imgs))
    print("boxes per class:", {u: counts[u] for u in UNIFIED})
    print("dropped rows:", dict(dropped))
    missing = [u for u in UNIFIED if counts[u] < 500]
    if missing:
        print("WARNING: fewer than 500 boxes for:", missing, "- add more data for these classes before training.")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
