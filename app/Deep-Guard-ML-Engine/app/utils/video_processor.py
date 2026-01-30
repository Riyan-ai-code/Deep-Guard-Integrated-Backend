from dataclasses import dataclass, field
from typing import List
import cv2
import numpy as np
from app.config.config import ExtractionConfig
from app.utils.face_tracker import FaceTracker3D
from app.utils.face_extractor import FaceExtractor

@dataclass
class VideoProcessingStats:
    video_id: str
    total_frames: int = 0
    frames_extracted: int = 0
    duration_seconds: float = 0.0
    average_confidence: float = 0.0
    errors: List[str] = field(default_factory=list)

class VideoProcessor:
    """
    PERSISTENT: Sequential reading with 'Nudge' logic.
    If a target frame fails, it scans forward until a face is found.
    """
    
    def __init__(self, config: ExtractionConfig):
        self.config = config
        self.tracker = FaceTracker3D(config)
        self.extractor = FaceExtractor(config)
    
    def process_video_persistent(self, video_path: str, output_dir: str, video_id: str, target_count: int = 50) -> VideoProcessingStats:
        stats = VideoProcessingStats(video_id=video_id)
        
        try:
            cap = cv2.VideoCapture(video_path)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1) # Optimization: Small buffer
            
            if not cap.isOpened():
                stats.errors.append("Failed to open video")
                return stats
            
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            fps = cap.get(cv2.CAP_PROP_FPS)
            stats.total_frames = total_frames
            stats.duration_seconds = total_frames / fps if fps > 0 else 0
            
            if total_frames < target_count:
                stats.errors.append(f"Video too short: {total_frames} frames")
                cap.release()
                return stats

            # Calculate ideal spacing
            interval = total_frames // target_count
            target_indices = [i * interval for i in range(target_count)]
            
            successful_crops = []
            confidence_sum = 0.0
            current_f_num = 0
            
            

            # Loop through the video once (Sequential Optimization)
            while cap.isOpened() and len(successful_crops) < target_count:
                ret, frame = cap.read()
                if not ret:
                    break
                
                # Logic: Is this a frame we want OR are we in 'Nudge Mode' looking for a replacement?
                # We only check frames if we haven't reached our quota for the current interval
                expected_next_target = target_indices[len(successful_crops)]
                
                if current_f_num >= expected_next_target:
                    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    tracking_info = self.tracker.track_face_in_frame(frame_rgb)
                    
                    # If face found and quality is decent
                    if tracking_info and tracking_info['confidence'] > 0.5:
                        face_crop = self.extractor.extract_conservative_crop(frame_rgb, tracking_info)
                        
                        if face_crop is not None:
                            face_resized = self.extractor.resize_for_classification(face_crop)
                            successful_crops.append(face_resized)
                            confidence_sum += tracking_info['confidence']
                            # After success, current_f_num will continue until it hits the NEXT target_index
                    else:
                        # FAIL: We don't 'return'. We just let the loop continue to current_f_num + 1
                        # This is the 'Nudge' - it will check the very next frame in the next loop iteration
                        pass
                
                current_f_num += 1
            
            cap.release()
            
            # FINAL VALIDATION
            if len(successful_crops) < target_count:
                stats.errors.append(f"Failed to find {target_count} valid faces. Only found {len(successful_crops)}.")
                return stats
            
            # Save the gathered faces
            for i, face_img in enumerate(successful_crops):
                success = self.extractor.save_frame(face_img, output_dir, i, video_id)
                if success:
                    stats.frames_extracted += 1
            
            stats.average_confidence = confidence_sum / target_count
            
        except Exception as e:
            stats.errors.append(f"System Error: {str(e)}")
            
        return stats