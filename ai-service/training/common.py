"""Shared class mapping: any dataset label -> the 6 unified Reclaim Value classes."""
UNIFIED = ["steel", "concrete", "brick", "wood", "tiles", "glass"]
KEYWORDS = {
    "steel": ["steel", "rebar", "beam", "metal", "iron", "girder", "tmt"],
    "concrete": ["concrete", "cement"],
    "brick": ["brick"],
    "wood": ["wood", "timber", "lumber", "plank", "pallet"],
    "tiles": ["tile", "ceramic"],
    "glass": ["glass"],
}
IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".JPG", ".JPEG", ".PNG", ".webp", ".bmp")


def map_name(name: str):
    """Return unified class if EXACTLY one matches, else None (drops ambiguous labels like 'brickconcrete')."""
    n = name.lower().replace("_", " ").replace("-", " ")
    hits = {u for u, ks in KEYWORDS.items() if any(k in n for k in ks)}
    return next(iter(hits)) if len(hits) == 1 else None


def to_yolo_box(parts):
    """Normalise one YOLO label row to 'cls xc yc w h'.

    Roboflow exports of oriented-box (OBB) or segmentation datasets have 8+ coordinates
    (polygons). Mixing those with 4-number boxes is what triggers Ultralytics'
    'Box and segment counts should be equal' warning. We convert every polygon to its
    axis-aligned bounding box so the merged dataset is pure detection format.
    Returns None for malformed rows.
    """
    try:
        cls = int(float(parts[0]))
        nums = [float(x) for x in parts[1:]]
    except (ValueError, IndexError):
        return None
    if len(nums) == 4:
        xc, yc, w, h = nums
    elif len(nums) >= 6 and len(nums) % 2 == 0:
        xs, ys = nums[0::2], nums[1::2]
        x1, x2, y1, y2 = min(xs), max(xs), min(ys), max(ys)
        xc, yc, w, h = (x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1
    else:
        return None
    if w <= 0.005 or h <= 0.005 or not (0 <= xc <= 1 and 0 <= yc <= 1):
        return None
    return cls, xc, yc, min(w, 1.0), min(h, 1.0)


def source_group(filename: str) -> str:
    """Key shared by every augmented copy of one original photo.

    Roboflow names files '<original>_jpg.rf.<hash>.jpg' (one per augmentation). Everything
    before '.rf.' identifies the original photo, so copies must never straddle train/val/test.
    """
    stem = filename
    if ".rf." in stem:
        stem = stem.split(".rf.")[0]
    else:
        stem = stem.rsplit(".", 1)[0]
    for suffix in ("_jpg", "_jpeg", "_png", "_JPG", "_PNG"):
        if stem.endswith(suffix):
            stem = stem[: -len(suffix)]
    return stem
