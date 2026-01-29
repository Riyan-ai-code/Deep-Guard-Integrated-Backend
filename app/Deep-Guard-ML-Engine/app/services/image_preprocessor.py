from app.utils.image_processor import ImageProcessor
from app.config.config import ExtractionConfig
from fastapi import HTTPException


class ImagePreprocessor:
    def __init__(self, config: ExtractionConfig):
        self.config = config
    
    def preprocess_image(self, image_path: str, output_dir: str, image_id: str):
        processor = ImageProcessor(self.config)
        stats = processor.process_image_strict(
            image_path=image_path,
            output_dir=output_dir,
            image_id=image_id
        )

        return stats
