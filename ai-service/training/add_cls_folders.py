"""Add Roboflow CLASSIFICATION exports (class folders) to the classifier dataset.

python add_cls_folders.py data/cls data/raw_cls/vinoth-pujdr__construction_materials ...

Each source has <split>/<class name>/*.jpg (Roboflow 'folder' export). Class names are
mapped with common.map_name (e.g. 'TMT Bars' -> steel, 'Construction Glass' -> glass,
'Plywood' -> wood); unmapped classes (sand, cement, MDF, aluminium...) are skipped.
Splits are re-assigned BY SOURCE PHOTO (all augmented copies stay together) so the
classifier's test score is not inflated: ~80% train / 10% val / 10% test.
"""
import argparse, collections, hashlib, shutil
from pathlib import Path
from common import IMAGE_EXTS, map_name, source_group


def split_of(group: str) -> str:
    h = int(hashlib.md5(group.encode()).hexdigest(), 16) % 10
    return "test" if h == 0 else "val" if h == 1 else "train"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("cls_out"); ap.add_argument("sources", nargs="+")
    a = ap.parse_args(argv)
    out = Path(a.cls_out)
    added, skipped = collections.Counter(), collections.Counter()
    for src in map(Path, a.sources):
        if not src.is_dir():
            print("missing, skipped:", src); continue
        for img in src.rglob("*"):
            if img.suffix not in IMAGE_EXTS:
                continue
            cls_name = img.parent.name
            m = map_name(cls_name)
            if m is None:
                skipped[cls_name] += 1; continue
            sp = split_of(f"{src.name}/{source_group(img.name)}")
            d = out / sp / m; d.mkdir(parents=True, exist_ok=True)
            shutil.copy(img, d / f"{src.name}__{img.name}")
            added[(sp, m)] += 1
    for sp in ("train", "val", "test"):
        print(sp, {m: n for (s, m), n in sorted(added.items()) if s == sp})
    if skipped:
        print("classes not used (not one of the six materials):", dict(skipped))


if __name__ == "__main__":
    main()
