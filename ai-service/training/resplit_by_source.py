"""Create leakage-free train/val/test from the pooled dataset made by merge_yolo.py.

python resplit_by_source.py data/merged data/unified [--val 0.1 --test 0.1 --seed 0]

Why: Roboflow exports contain several augmented copies of every photo. A random split puts
copies of the same photo in train AND test, which is why the earlier run scored mAP50 = 0.987
yet failed on real photos. Here every original photo (group) lives in exactly one split, and
val/test keep only ONE image per group (the un-augmented-looking first copy) so the scores are honest.
Groups are assigned greedily so every class gets its share of boxes in each split.
"""
import argparse, random, shutil, collections
from pathlib import Path
import yaml
from common import UNIFIED, IMAGE_EXTS, source_group


def read_classes(label_file):
    c = collections.Counter()
    for line in label_file.read_text().splitlines():
        if line.split():
            c[int(line.split()[0])] += 1
    return c


def plan_split(groups, fractions, seed):
    """groups: {key: Counter(class_id -> boxes)}. Returns {key: split}."""
    rng = random.Random(seed)
    total = collections.Counter()
    for c in groups.values():
        total.update(c)
    target = {sp: {k: v * f for k, v in total.items()} for sp, f in fractions.items()}
    have = {sp: collections.Counter() for sp in fractions}
    keys = sorted(groups, key=lambda k: (sum(total[c] for c in groups[k]) / max(1, sum(groups[k].values())), rng.random()))
    assign = {}
    for k in keys:  # rarest-class groups first
        best, best_gain = None, None
        for sp in fractions:
            deficit = sum(max(0.0, target[sp][c] - have[sp][c]) * n / max(1, target[sp][c]) for c, n in groups[k].items())
            deficit *= 1.0 + rng.random() * 0.05
            if best_gain is None or deficit > best_gain:
                best, best_gain = sp, deficit
        assign[k] = best
        have[best].update(groups[k])
    return assign


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pool"); ap.add_argument("out")
    ap.add_argument("--val", type=float, default=0.1); ap.add_argument("--test", type=float, default=0.1)
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    pool, out = Path(a.pool) / "all", Path(a.out)
    members = collections.defaultdict(list)
    for lab in sorted((pool / "labels").glob("*.txt")):
        members[source_group(lab.name)].append(lab)
    groups = {k: sum((read_classes(l) for l in labs), collections.Counter()) for k, labs in members.items()}
    # use the first copy's classes for val/test balancing (copies share the same boxes)
    groups = {k: read_classes(members[k][0]) for k in members}
    assign = plan_split(groups, {"train": 1 - a.val - a.test, "val": a.val, "test": a.test}, a.seed)
    for sp in ("train", "val", "test"):
        for kind in ("images", "labels"):
            (out / sp / kind).mkdir(parents=True, exist_ok=True)
    n = collections.Counter(); boxes = {sp: collections.Counter() for sp in ("train", "val", "test")}
    for k, labs in members.items():
        sp = assign[k]
        chosen = labs if sp == "train" else labs[:1]
        for lab in chosen:
            img = next((x for e in IMAGE_EXTS if (x := pool / "images" / (lab.stem + e)).exists()), None)
            if img is None:
                continue
            shutil.copy(img, out / sp / "images" / img.name); shutil.copy(lab, out / sp / "labels" / lab.name)
            n[sp] += 1; boxes[sp].update(read_classes(lab))
    (out / "data.yaml").write_text(yaml.safe_dump({
        "path": str(out.resolve()), "train": "train/images", "val": "val/images", "test": "test/images",
        "names": dict(enumerate(UNIFIED))}))
    print("original photos (groups):", len(members), "| images per split:", dict(n))
    for sp in ("train", "val", "test"):
        print(f"{sp:5s} boxes:", {UNIFIED[c]: boxes[sp][c] for c in range(len(UNIFIED))})
    thin = [(sp, UNIFIED[c]) for sp in ("val", "test") for c in range(len(UNIFIED)) if boxes[sp][c] < 30]
    if thin:
        print("WARNING: <30 boxes in these (split, class) pairs, metrics for them are unreliable:", thin)


if __name__ == "__main__":
    main()
