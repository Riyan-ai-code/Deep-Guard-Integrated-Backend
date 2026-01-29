import os
import uuid
import shutil
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, BackgroundTasks
from app.services.model import detect_deepfake
from app.config.config import ExtractionConfig
from fastapi.responses import FileResponse
from app.services.video_saver import VideoSaver
from app.services.video_preprocessor import VideoPreprocessor
from fastapi import HTTPException
from app.utils.delayed_cleanup import delayed_cleanup
import json
from app.utils.annotate_images import annotate_confidences
from fastapi.responses import JSONResponse


router = APIRouter()




@router.post("/detect/deepfake/video", response_class=FileResponse)
async def predict_video(file: UploadFile = File(...), frames: int = 50, background_tasks: BackgroundTasks = None):
    video_id = str(uuid.uuid4())
    video_folder = None
    
    try:
        # Save uploaded video
        video_path, video_folder = VideoSaver.save_file(file, ExtractionConfig.TEMP_DIR, video_id)
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"detail": f"Failed to save uploaded video: {str(e)}"}
        )


    # Extract frames and create necessary preprocessing
    preprocessor = VideoPreprocessor(ExtractionConfig)
    stats = preprocessor.preprocess_frame(
        video_path=video_path,
        output_dir=video_folder,
        video_id=os.path.basename(video_folder),
        frames=frames
    )


    # If preprocessing errors, schedule cleanup and return error
    if stats.errors:
        background_tasks.add_task(delayed_cleanup, video_folder, delay=60)
        return JSONResponse(
            status_code=400,
            content={
                "detail": {
                    "video_id": stats.video_id,
                    "message": "Video preprocessing failed",
                    "errors": stats.errors
                }
            }
        )


    # Detect fake
    try:
        results = detect_deepfake(video_folder)
    except Exception as e:
        background_tasks.add_task(delayed_cleanup, video_folder, delay=60)
        return JSONResponse(
            status_code=500,
            content={"detail": f"Deepfake detection failed: {str(e)}"}
        )


    # Process results
    def extract_float(value):
        if isinstance(value, (float, int)):
            return float(value)
        if isinstance(value, (list, tuple)) and len(value) > 0:
            return extract_float(value[0])
        return None


    scores = [extract_float(v) for v in results.values()]
    scores = [s for s in scores if s is not None]
    avg_score = float(sum(scores) / len(scores)) if scores else 0.0


    # Create frame-wise confidence array in sorted order
    sorted_frames = sorted(results.items(), key=lambda x: x[0])
    frame_confidences = [
        round(extract_float(confidence), 4) if extract_float(confidence) is not None else None
        for frame_name, confidence in sorted_frames
    ]


    # Annotate images
    annotate_confidences(video_folder, results)


    # Create zip file
    annotated_folder = Path(video_folder) / "annotated_results"
    
    if not annotated_folder.exists() or not any(annotated_folder.iterdir()):
        background_tasks.add_task(delayed_cleanup, video_folder, delay=60)
        return JSONResponse(
            status_code=500,
            content={"detail": "Annotated results folder is empty or does not exist"}
        )
    
    # Save confidence report as JSON file inside annotated_results
    confidence_report = {
        "video_id": video_id,
        "total_frames": len(results),
        "frames_analyzed": len(results),
        "average_confidence": round(avg_score, 4),
        "frame_wise_confidences": frame_confidences
    }
    
    confidence_json_path = annotated_folder / "confidence_report.json"
    try:
        with open(confidence_json_path, 'w') as f:
            json.dump(confidence_report, f, indent=2)
    except Exception as e:
        background_tasks.add_task(delayed_cleanup, video_folder, delay=60)
        return JSONResponse(
            status_code=500,
            content={"detail": f"Failed to create confidence report: {str(e)}"}
        )
    
    zip_filename = f"{video_id}_annotated_frames"
    zip_path = Path(video_folder) / zip_filename
    
    try:
        zip_file_path = shutil.make_archive(
            base_name=str(zip_path),
            format='zip',
            root_dir=annotated_folder
        )
    except Exception as e:
        background_tasks.add_task(delayed_cleanup, video_folder, delay=60)
        return JSONResponse(
            status_code=500,
            content={"detail": f"Failed to create zip file: {str(e)}"}
        )


    # Schedule cleanup for success case
    background_tasks.add_task(delayed_cleanup, video_folder, delay=60)


    # Return the zip file with confidence data in headers
    response = FileResponse(
        path=zip_file_path,
        media_type="application/zip",
        filename=f"{video_id}_annotated_frames.zip",
        background=background_tasks
    )


    response.headers["X-Video-ID"] = video_id
    response.headers["X-Frames-Analyzed"] = str(len(results))
    response.headers["X-Average-Confidence"] = str(round(avg_score, 4))


    return response
