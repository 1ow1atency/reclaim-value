"""Train the whole-image material classifier (YOLOv8-cls) and save it for vision.py.

python train_cls.py data/cls materials_cls [--model yolov8s-cls.pt --imgsz 320 --epochs 40]
"""
import argparse, shutil
from pathlib import Path
from ultralytics import YOLO

ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument("data"); ap.add_argument("name")
ap.add_argument("--model", default="yolo11s-cls.pt"); ap.add_argument("--imgsz", type=int, default=320)
ap.add_argument("--epochs", type=int, default=40); ap.add_argument("--batch", type=int, default=32)
ap.add_argument("--patience", type=int, default=10)
a = ap.parse_args()

model = YOLO(a.model)
model.train(data=a.data, epochs=a.epochs, imgsz=a.imgsz, batch=a.batch, patience=a.patience, project="runs", name=a.name,
            hsv_h=0.02, hsv_s=0.7, hsv_v=0.5, degrees=15, translate=0.1, scale=0.5, fliplr=0.5, erasing=0.3,
            auto_augment="randaugment", cos_lr=True)
best = Path(model.trainer.save_dir) / "weights" / "best.pt"
m = YOLO(str(best)).val(data=a.data, split="test")
print(f"test top1={m.top1:.3f} top5={m.top5:.3f}")
dest = Path(__file__).resolve().parents[1] / "weights" / f"{a.name}.pt"
dest.parent.mkdir(exist_ok=True); shutil.copy(best, dest); print("Saved", dest)
