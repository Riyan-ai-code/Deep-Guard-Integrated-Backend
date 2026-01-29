from app.utils.video_processor import VideoProcessor
from app.config.config import ExtractionConfig
from fastapi import HTTPException

class VideoPreprocessor:
    def __init__(self, config: ExtractionConfig):
        self.config = config
    
    def preprocess_frame(self,video_path:str,output_dir: str, video_id: str, frames: int = 50):
        processor = VideoProcessor(self.config)
        stats = processor.process_video_strict(
            video_path=video_path,
            output_dir=output_dir,
            video_id=video_id,
            frames=frames
        )

        return stats