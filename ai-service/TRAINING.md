# Training the material recognition model

Out of the box the AI service runs in **demo mode**: it guesses the material from colours and textures. To make it actually predict steel, concrete, brick, wood, tiles and glass, train two models and drop them into `weights/`. Nothing else in the app changes.

| File | Model | Job |
|---|---|---|
| `weights/materials.pt` | YOLO detector | finds pieces of each material in the photo; pieces vote by area × confidence |
| `weights/materials_thresholds.json` | per-class cut-offs | written by training, tuned on the validation split |
| `weights/materials_cls.pt` | YOLO whole-photo classifier | second opinion for cluttered piles; its `other` class lets the app say "not a building material" |

When both models are unsure (below `ACCEPT_CONF`, default 0.35), the app does **not** guess. It asks the user to pick the material and shows the model's best guess.

## Step by step (Google Colab, free GPU)

All of this is in **`training/train_colab.ipynb`**. Open it in Colab and run the cells top to bottom.

1. **Open the notebook in Colab** and set *Runtime → Change runtime type → T4 GPU*.
2. **Upload `reclaim-value.zip`** in the Files panel. The notebook unzips it and installs `training/requirements.txt`.
3. **Download the public datasets:**
   - *Roboflow* (free API key, stored as a Colab secret named `ROBOFLOW_API_KEY`): IAAC construction materials, CD_OBB, Steel Construction Materials, Material_Database and construction-waste. Check each page's version number.
   - *CDW-Seg* (Figshare DOI 10.6084/m9.figshare.28573229): real skip-bin photos. Plastic and cardboard become negatives for the "other" class.
   - *CODD* (optional, manual download from Mendeley): 3,000+ C&D waste photos.
   - *Glass*: the public sets above have almost none. Add a glass set from Roboflow Universe, or your own photos.
4. **(Optional) Add your own photos.** Training works without them. The notebook already pulls an Indian classification set (`vinoth-pujdr/construction_materials`: TMT bars, construction glass, bricks, timber, plywood) and extra rebar and glass sets. Your own photos would still raise accuracy on Indian sites:
   - Take 100–200 phone photos per material and label boxes in Roboflow with exactly `steel, concrete, brick, wood, tiles, glass`.
   - Export them as YOLOv8 into `data/mine`.
   - Keep another ~30 per material **unlabelled and unused** in `real_test/<material>/`, plus `real_test/other/`.
5. **Merge and split.** `merge_yolo.py` maps every label onto the six classes and drops ambiguous ones. `resplit_by_source.py` keeps every augmented copy of a photo in one split. Random splits leak copies into the test set and inflate the score; that is why an earlier version scored mAP50 0.987 yet failed on real photos.
6. **Train the detector** (about 1–2 h): `train_yolo.py data/unified/data.yaml materials --model yolo11s.pt --strong-aug …`. It refuses to train when a class has no boxes. Add data, or pass `--allow-missing-classes`, in which case the app asks the user for that material.
7. **Train the classifier** (about 15–30 min): `make_cls_dataset.py`, then `train_cls.py … materials_cls`.
8. **Measure accuracy:** `eval_real_photos.py real_test` (or, without your own photos, `eval_real_photos.py data/cls/test`, the held-out public split; call that *accuracy on held-out public data* in the report). It runs your held-out photos through the exact code the app uses and prints accuracy, the share it answered, and a confusion matrix. **Quote this number in the report**, not the YOLO mAP.
9. **Download the three files** (the notebook also copies them to Google Drive).

## Using the trained model in the app

```bash
# copy materials.pt, materials_thresholds.json, materials_cls.pt into ai-service/weights/
cd ai-service
pip install ultralytics          # once
uvicorn main:app --port 8000
```

Open <http://localhost:8000/health>:

- `material_model.mode` should be `"trained"`.
- `detector.loaded` and `classifier.loaded` should be `true`, with `error: null`.

The Capture page then shows "Trained model: …% confident" instead of the demo-mode warning.

Files in `weights/` are picked up automatically. To use other paths, set `YOLO_WEIGHTS`, `CLS_WEIGHTS` or `YOLO_THRESHOLDS`. An empty value disables that model. Other settings:

- `ACCEPT_CONF` (default 0.35): below this, the user picks the material.
- `CLS_MIN_PROB` (default 0.6): how sure the classifier must be to answer "other".
- `ALLOW_HEURISTIC_FALLBACK=1`: use the colour guess when the models are unsure. For demos only.

## Running training on your own GPU instead of Colab

```bash
pip install -r training/requirements.txt
export ROBOFLOW_API_KEY=...                # PowerShell: $env:ROBOFLOW_API_KEY = "..."
cd training
python download_roboflow.py data/raw iaac/constrcution-materials:2 robocount/steel-construction-materials:1
python merge_yolo.py data/merged data/raw/*
python resplit_by_source.py data/merged data/unified
python train_yolo.py data/unified/data.yaml materials --model yolo11s.pt --epochs 60 --strong-aug
python make_cls_dataset.py data/unified data/cls --negatives data/negatives
python train_cls.py data/cls materials_cls
python eval_real_photos.py real_test
```

## Limits to state honestly in the report

- **Domain shift:** public data comes from Cyprus conveyor belts, Australian skip bins and US sites. Without your own photos, expect clearly lower accuracy on Indian sites than the test mAP suggests.
- **Glass and clean steel sections** are under-represented in public data, so check their recall in the confusion matrix.
- **Condition scoring** is still a rust/crack heuristic and is labelled advisory. A corrosion dataset (e.g. Roboflow *rust-detection*) could replace it for steel.
- **Quantity cannot be read from a photo:** the user enters kg.

## Price model

```bash
python training/export_trades.py "mongodb://localhost:27017/reclaim_value" trades.csv   # completed trades only
python train_price.py trades.csv        # saves weights/price_model.joblib only if it beats the baseline
```

`seed_synthetic_trades.py` makes **synthetic** trades to test the pipeline. Never present a model trained on them as real.
