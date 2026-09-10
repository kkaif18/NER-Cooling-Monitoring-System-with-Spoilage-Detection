"""Paths and alert thresholds for the cooling monitor."""
from pathlib import Path

import torch

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
MODELS_DIR = BASE_DIR / "models"
UPLOADS_DIR = DATA_DIR / "uploads"
DB_PATH = DATA_DIR / "cooling.db"
CHECKPOINT_PATH = MODELS_DIR / "best_produce_spoilage_mobilenetv2.pth"

# Same preprocessing as the webcam detector
IMAGE_SIZE = 224
IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]
CLASS_NAMES = ["Fresh", "Spoiled"]
NUM_CLASSES = 2

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# Safe storage range for a mini produce cooler (alert if outside)
TEMP_MIN_C = 2.0
TEMP_MAX_C = 8.0
HUMIDITY_MIN = 70.0
HUMIDITY_MAX = 95.0

HISTORY_LIMIT = 120
CAMERA_POLL_SECONDS = 60.0  # Capture still every 1 minute
MAX_STORED_FRAMES = 20     # Prune older stills to conserve disk/memory
HEATMAP_ALPHA = 0.40
HEATMAP_THRESHOLD = 0.25

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
MODELS_DIR.mkdir(parents=True, exist_ok=True)
