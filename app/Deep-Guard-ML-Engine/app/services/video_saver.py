import os
import shutil

class VideoSaver:
    """Handles saving uploaded video files into uniquely named folders."""

    @staticmethod
    def save_file(file, temp_dir: str, video_id: str) -> str:
        # Create subfolder for this video ID
        video_folder = os.path.join(temp_dir, video_id)
        os.makedirs(video_folder, exist_ok=True)

        # Full path inside that subfolder
        video_path = os.path.join(video_folder, f"{video_id}.mp4")

        # Stream the upload to disk efficiently
        with open(video_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        return video_path, video_folder
