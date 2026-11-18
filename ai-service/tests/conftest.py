import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# empty string = "no model", so tests never pick up weights/ files a developer has trained
os.environ["YOLO_WEIGHTS"] = ""
os.environ["CLS_WEIGHTS"] = ""
