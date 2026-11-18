"""Download Roboflow Universe datasets.
export ROBOFLOW_API_KEY=...   (free account at roboflow.com)
python download_roboflow.py data/raw  iaac/constrcution-materials:2  bricks10/timber_brick_log_rebar ...

Each arg is workspace/project[:VERSION]. Without a version the newest one is used.
Detection/segmentation projects are saved in YOLOv8 format under <dest>/<ws>__<proj>.
CLASSIFICATION projects (one label per photo) are saved as class folders under
<dest>_cls/<ws>__<proj> - feed those to add_cls_folders.py, not merge_yolo.py.
A dataset that fails (removed, private, no versions) is skipped; the others still download."""
import os, sys
from roboflow import Roboflow


def latest_version(project):
    nums = []
    for v in project.versions() or []:
        raw = str(getattr(v, "version", "") or getattr(v, "id", ""))
        tail = raw.replace("-", "/").split("/")[-1]
        if tail.isdigit():
            nums.append(int(tail))
    if not nums:
        raise RuntimeError("no downloadable versions")
    return max(nums)


def main():
    rf = Roboflow(api_key=os.environ["ROBOFLOW_API_KEY"]); dest = sys.argv[1]
    ok, failed = [], []
    for spec in sys.argv[2:]:
        try:
            path, _, ver = spec.partition(":"); ws, proj = path.split("/")
            project = rf.workspace(ws).project(proj)
            ver = int(ver) if ver else latest_version(project)
            kind = str(getattr(project, "type", "")).lower()
            if "classification" in kind:
                project.version(ver).download("folder", location=f"{dest}_cls/{ws}__{proj}")
            else:
                project.version(ver).download("yolov8", location=f"{dest}/{ws}__{proj}")
            ok.append(f"{ws}/{proj}:{ver} ({kind or 'detection'})")
        except Exception as exc:  # keep going - one bad dataset must not stop the rest
            print(f"SKIPPED {spec}: {exc}")
            failed.append(spec)
    print("downloaded:", ok)
    if failed:
        print("failed (open each page on universe.roboflow.com and check it is public and has a version):", failed)


if __name__ == "__main__":
    main()
