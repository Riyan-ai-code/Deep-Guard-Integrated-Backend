import os
import shutil


class ImageSaver:
    """Handles saving uploaded image files into uniquely named folders."""


    @staticmethod
    def save_file(file, temp_dir: str, image_id: str) -> str:
        # Create subfolder for this image ID
        image_folder = os.path.join(temp_dir, image_id)
        os.makedirs(image_folder, exist_ok=True)


        # Get original file extension
        original_filename = file.filename
        file_extension = os.path.splitext(original_filename)[1] or ".jpg"


        # Full path inside that subfolder
        image_path = os.path.join(image_folder, f"{image_id}{file_extension}")


        # Stream the upload to disk efficiently
        with open(image_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)


        return image_path, image_folder
