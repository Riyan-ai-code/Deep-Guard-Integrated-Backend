from typing import Dict, Optional
import os
import cv2
import numpy as np
from app.config.config import ExtractionConfig

class FaceExtractor:
    """Extract face with 1.3x conservative crop."""
    
    def __init__(self, config: ExtractionConfig):
        self.config = config
        assert self.config.crop_enlargement_factor == 1.3
    
    def extract_conservative_crop(self, frame: np.ndarray, tracking_info: Dict) -> Optional[np.ndarray]:
        if not tracking_info:
            return None
        
        x, y, width, height = tracking_info['bounding_box']
        center_x, center_y = x + width // 2, y + height // 2
        
        enlarged_w = int(width * 1.3)
        enlarged_h = int(height * 1.3)
        
        x1 = max(0, center_x - enlarged_w // 2)
        y1 = max(0, center_y - enlarged_h // 2)
        x2 = min(frame.shape[1], center_x + enlarged_w // 2)
        y2 = min(frame.shape[0], center_y + enlarged_h // 2)
        
        crop = frame[y1:y2, x1:x2]
        return crop if crop.size > 0 else None
    
    def resize_for_classification(self, crop: np.ndarray) -> np.ndarray:
        return cv2.resize(crop, self.config.target_size, interpolation=cv2.INTER_CUBIC)
    
    def save_frame(self, crop: np.ndarray, output_path: str, frame_id: int, video_id: str) -> bool:
        try:
            os.makedirs(output_path, exist_ok=True)
            filename = f"{video_id}_frame_{frame_id:05d}.jpg"
            filepath = os.path.join(output_path, filename)
            face_bgr = cv2.cvtColor(crop, cv2.COLOR_RGB2BGR)
            return cv2.imwrite(filepath, face_bgr, [cv2.IMWRITE_JPEG_QUALITY, self.config.jpeg_quality])
        except:
            return False