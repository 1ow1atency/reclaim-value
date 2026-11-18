"""Fine-tune YOLO and evaluate on the dataset test split."""
import argparse
import shutil
from pathlib import Path

from ultralytics import YOLO
import yaml


def validate_training_data(data_yaml, allow_missing=False):
    data_path = Path(data_yaml).expanduser().resolve()
    data = yaml.safe_load(data_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"Dataset config is not a YAML mapping: {data_path}")

    raw_names = data.get("names")
    if isinstance(raw_names, dict):
        try:
            names = [name for _, name in sorted(raw_names.items(), key=lambda item: int(item[0]))]
        except (TypeError, ValueError) as exc:
            raise ValueError("Dataset class names must use integer class IDs") from exc
    elif isinstance(raw_names, list):
        names = raw_names
    else:
        raise ValueError("Dataset config must define class names as a list or ID-to-name mapping")
    if not names or any(not isinstance(name, str) or not name.strip() for name in names):
        raise ValueError("Dataset config must define at least one non-empty class name")

    dataset_root = Path(data.get("path", data_path.parent)).expanduser()
    if not dataset_root.is_absolute():
        dataset_root = data_path.parent / dataset_root
    dataset_root = dataset_root.resolve()
    train_splits = data.get("train")
    if isinstance(train_splits, str):
        train_splits = [train_splits]
    if not isinstance(train_splits, list) or not train_splits:
        raise ValueError("Dataset config must define a non-empty train split")

    counts = [0] * len(names)
    for split in train_splits:
        image_dir = Path(split).expanduser()
        if not image_dir.is_absolute():
            image_dir = dataset_root / image_dir
        image_dir = image_dir.resolve()
        parts = list(image_dir.parts)
        if "images" not in parts:
            raise ValueError(f"Training image path must include an 'images' directory: {image_dir}")
        parts[len(parts) - 1 - parts[::-1].index("images")] = "labels"
        label_dir = Path(*parts)
        if not label_dir.is_dir():
            raise ValueError(f"Training labels directory does not exist: {label_dir}")
        label_files = list(label_dir.glob("*.txt"))
        if not label_files:
            raise ValueError(f"Training labels directory contains no .txt files: {label_dir}")

        for label_file in label_files:
            for line_number, line in enumerate(label_file.read_text(encoding="utf-8").splitlines(), 1):
                fields = line.split()
                if not fields:
                    continue
                try:
                    class_id = int(fields[0])
                except ValueError as exc:
                    raise ValueError(
                        f"Invalid class ID in {label_file}:{line_number}: {fields[0]!r}"
                    ) from exc
                if not 0 <= class_id < len(names):
                    raise ValueError(
                        f"Class ID {class_id} in {label_file}:{line_number} "
                        f"is outside the configured range 0-{len(names) - 1}"
                    )
                counts[class_id] += 1

    missing = [names[class_id] for class_id, count in enumerate(counts) if count == 0]
    if missing and allow_missing:
        print("WARNING: no training boxes for", missing, "- the model will NEVER predict these. "
              "The app will ask the user to pick them by hand. Add labelled photos and retrain.")
    elif missing:
        raise ValueError(
            "Training split has no labeled boxes for classes: "
            + ", ".join(missing)
            + ". Add correctly labeled training images for every class before training."
        )
    return dict(zip(names, counts))


def save_class_thresholds(model, data_yaml, out_file):
    """Pick, per class, the confidence that maximises F1 on the VAL split and save as JSON.

    vision.py loads this file so each class uses its own cut-off instead of one global 0.25.
    """
    import json
    m = model.val(data=data_yaml, split="val", verbose=False)
    f1, px = m.box.f1_curve, m.box.px
    names = m.names
    thresholds = {}
    for row, class_id in enumerate(m.box.ap_class_index):
        best = int(f1[row].argmax())
        thresholds[names[int(class_id)].lower()] = round(float(min(max(px[best], 0.05), 0.5)), 3)
    Path(out_file).write_text(json.dumps(thresholds, indent=2))
    print("per-class confidence thresholds:", thresholds)
    return thresholds


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data", help="Path to a YOLO data.yaml file")
    parser.add_argument("name", help="Name used for the run and output weights file")
    parser.add_argument("--model", default="yolo11s.pt", help="Pretrained model checkpoint (default: yolo11s.pt)")
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--patience", type=int, default=10)
    parser.add_argument("--allow-missing-classes", action="store_true",
                        help="Train even if some of the six classes have no boxes (e.g. no glass data yet)")
    parser.add_argument("--strong-aug", action="store_true",
                        help="Heavier colour/scale/perspective/mixup augmentation to cope with real-world domain shift")
    args = parser.parse_args()
    if min(args.epochs, args.imgsz, args.batch, args.patience) < 1:
        parser.error("--epochs, --imgsz, --batch, and --patience must be positive integers")

    try:
        class_counts = validate_training_data(args.data, args.allow_missing_classes)
    except ValueError as exc:
        parser.error(str(exc))
    print("training boxes per class:", class_counts)
    underrepresented = {name: count for name, count in class_counts.items() if count < 300}
    if underrepresented:
        print(
            "WARNING: fewer than 300 training boxes for these classes; "
            "collect and label more representative images:",
            underrepresented,
        )

    aug = dict(hsv_h=0.015, hsv_s=0.6, hsv_v=0.4, degrees=10, fliplr=0.5, mosaic=1.0)
    if args.strong_aug:
        aug.update(hsv_s=0.7, hsv_v=0.5, degrees=15, translate=0.15, scale=0.6, shear=2.0,
                   perspective=0.0005, flipud=0.1, mixup=0.15, close_mosaic=15, erasing=0.3)

    model = YOLO(args.model)
    model.train(data=args.data, epochs=args.epochs, imgsz=args.imgsz, batch=args.batch,
                patience=args.patience, project="runs", name=args.name, cos_lr=True, **aug)
    best = Path(model.trainer.save_dir) / "weights" / "best.pt"
    model = YOLO(str(best))
    metrics = model.val(data=args.data, split="test")
    print(f"mAP50={metrics.box.map50:.3f} mAP50-95={metrics.box.map:.3f}")
    print("per-class mAP50-95:", dict(zip(
        metrics.names.values(), [round(float(score), 3) for score in metrics.box.maps]
    )))
    output_dir = Path(__file__).resolve().parents[1] / "weights"
    output_dir.mkdir(exist_ok=True)
    destination = output_dir / f"{args.name}.pt"
    shutil.copy(best, destination)
    try:
        save_class_thresholds(model, args.data, output_dir / f"{args.name}_thresholds.json")
    except Exception as exc:  # thresholds are optional; never lose the trained weights over them
        print("could not compute per-class thresholds:", exc)
    print(f"Saved best weights to {destination.resolve()}")


if __name__ == "__main__":
    main()
