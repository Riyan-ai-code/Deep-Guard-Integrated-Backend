from dataclasses import dataclass
from typing import Tuple

@dataclass
class ExtractionConfig:
    TEMP_DIR = "temp"
    MODEL_PATH = "app/models/deepfake_detector.tflite"
    FAKE_THRESHOLD = 0.5  # adjust based on validation metrics

    crop_enlargement_factor: float = 1.3
    target_size: Tuple[int, int] = (299, 299)
    jpeg_quality: int = 95

    