from dataclasses import dataclass, field
from typing import List
import cv2
import os
from app.config.config import ExtractionConfig
from app.utils.face_tracker import FaceTracker3D
from app.utils.face_extractor import FaceExtractor



@dataclass
class ImageProcessingStats:
    image_id: str
    total_images: int = 0
    images_extracted: int = 0
    average_confidence: float = 0.0
    errors: List[str] = field(default_factory=list)



class ImageProcessor:
    """Processes single images with face detection and cropping."""
    
    def __init__(self, config: ExtractionConfig):
        self.config = config
        self.tracker = FaceTracker3D(config)
        self.extractor = FaceExtractor(config)
    
    def process_image_strict(self, image_path: str, output_dir: str, image_id: str) -> ImageProcessingStats:
        """
        Process single image with face detection, tracking, and cropping.
        STRICT: Rejects if any step fails.
        """
        stats = ImageProcessingStats(image_id=image_id)
        stats.total_images = 1
        
        try:
            # Read image
            frame = cv2.imread(image_path)
            
            if frame is None:
                stats.errors.append("Failed to open image")
                return stats
            
            # Convert to RGB
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            
            # Track face
            tracking_info = self.tracker.track_face_in_frame(frame_rgb)
            if not tracking_info:
                stats.errors.append("No face detected in image")
                return stats  # STRICT: Reject image
            
            stats.average_confidence = tracking_info['confidence']
            
            # Extract crop
            face_crop = self.extractor.extract_conservative_crop(frame_rgb, tracking_info)
            if face_crop is None:
                stats.errors.append("Failed to crop face from image")
                return stats  # STRICT: Reject image
            
            # Resize
            face_resized = self.extractor.resize_for_classification(face_crop)
            
            # Save processed image
            success = self.extractor.save_frame(face_resized, output_dir, 0, image_id)
            if success:
                stats.images_extracted = 1
                
                # Delete original uploaded image after successful processing
                try:
                    if os.path.exists(image_path):
                        os.remove(image_path)
                except Exception as delete_error:
                    # Don't fail the entire process if deletion fails
                    pass
            else:
                stats.errors.append("Failed to save processed image")
                return stats
            
        except Exception as e:
            stats.errors.append(f"Processing error: {str(e)}")
        
        return stats
