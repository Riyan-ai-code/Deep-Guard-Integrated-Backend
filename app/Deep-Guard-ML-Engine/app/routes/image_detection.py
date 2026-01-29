import os
import uuid
import shutil
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, BackgroundTasks
from app.services.model import detect_deepfake
from app.config.config import ExtractionConfig
from fastapi.responses import FileResponse
from app.services.image_saver import ImageSaver
from app.services.image_preprocessor import ImagePreprocessor
from fastapi import HTTPException
from app.utils.delayed_cleanup import delayed_cleanup
import json
from app.utils.annotate_images import annotate_confidences
from fastapi.responses import JSONResponse
from typing import List



router = APIRouter()





@router.post("/detect/deepfake/images", response_class=FileResponse)
async def predict_images(files: List[UploadFile] = File(...), background_tasks: BackgroundTasks = None):
    batch_id = str(uuid.uuid4())
    batch_folder = os.path.join(ExtractionConfig.TEMP_DIR, batch_id)
    os.makedirs(batch_folder, exist_ok=True)
    
    all_results = {}
    preprocessing_errors = []
    
    try:
        # Process each uploaded image
        for idx, file in enumerate(files):
            image_id = f"{batch_id}_img_{idx}"
            
            try:
                # Save uploaded image
                image_path, image_folder = ImageSaver.save_file(file, batch_folder, image_id)
            except Exception as e:
                preprocessing_errors.append(f"Image {idx}: Failed to save - {str(e)}")
                continue
            
            # Process image and crop face
            preprocessor = ImagePreprocessor(ExtractionConfig)
            stats = preprocessor.preprocess_image(
                image_path=image_path,
                output_dir=image_folder,
                image_id=os.path.basename(image_folder)
            )
            
            # If preprocessing errors, record and skip this image
            if stats.errors:
                preprocessing_errors.append(f"Image {idx}: {', '.join(stats.errors)}")
                continue
        
        # Check if any images were successfully preprocessed
        if not any(os.path.isdir(os.path.join(batch_folder, d)) for d in os.listdir(batch_folder)):
            background_tasks.add_task(delayed_cleanup, batch_folder, delay=60)
            return JSONResponse(
                status_code=400,
                content={
                    "detail": {
                        "batch_id": batch_id,
                        "message": "All images failed preprocessing",
                        "errors": preprocessing_errors
                    }
                }
            )
        
        # Detect fake for all processed images
        try:
            # Process each image folder
            for folder_name in os.listdir(batch_folder):
                folder_path = os.path.join(batch_folder, folder_name)
                if os.path.isdir(folder_path):
                    results = detect_deepfake(folder_path)
                    all_results.update(results)
        except Exception as e:
            background_tasks.add_task(delayed_cleanup, batch_folder, delay=60)
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
        
        scores = [extract_float(v) for v in all_results.values()]
        scores = [s for s in scores if s is not None]
        avg_score = float(sum(scores) / len(scores)) if scores else 0.0
        
        # Create image-wise confidence array in sorted order
        sorted_images = sorted(all_results.items(), key=lambda x: x[0])
        image_confidences = [
            round(extract_float(confidence), 4) if extract_float(confidence) is not None else None
            for image_name, confidence in sorted_images
        ]
        
        # Annotate images in each folder
        for folder_name in os.listdir(batch_folder):
            folder_path = os.path.join(batch_folder, folder_name)
            if os.path.isdir(folder_path):
                # Get results for this specific folder
                folder_results = {k: v for k, v in all_results.items() if folder_name in k}
                if folder_results:
                    annotate_confidences(folder_path, folder_results)
        
        # Collect all annotated images into one folder
        combined_annotated_folder = Path(batch_folder) / "all_annotated_results"
        combined_annotated_folder.mkdir(exist_ok=True)
        
        for folder_name in os.listdir(batch_folder):
            folder_path = os.path.join(batch_folder, folder_name)
            if os.path.isdir(folder_path):
                annotated_folder = Path(folder_path) / "annotated_results"
                if annotated_folder.exists():
                    for img_file in annotated_folder.iterdir():
                        if img_file.is_file():
                            # Copy with unique name
                            dest_name = f"{folder_name}_{img_file.name}"
                            shutil.copy2(img_file, combined_annotated_folder / dest_name)
        
        if not any(combined_annotated_folder.iterdir()):
            background_tasks.add_task(delayed_cleanup, batch_folder, delay=60)
            return JSONResponse(
                status_code=500,
                content={"detail": "No annotated results generated"}
            )
        
        # Save confidence report as JSON file inside all_annotated_results
        confidence_report = {
            "batch_id": batch_id,
            "total_images": len(all_results),
            "images_analyzed": len(all_results),
            "images_uploaded": len(files),
            "preprocessing_errors": len(preprocessing_errors),
            "average_confidence": round(avg_score, 4),
            "image_wise_confidences": image_confidences
        }
        
        confidence_json_path = combined_annotated_folder / "confidence_report.json"
        try:
            with open(confidence_json_path, 'w') as f:
                json.dump(confidence_report, f, indent=2)
        except Exception as e:
            background_tasks.add_task(delayed_cleanup, batch_folder, delay=60)
            return JSONResponse(
                status_code=500,
                content={"detail": f"Failed to create confidence report: {str(e)}"}
            )
        
        # Create zip file
        zip_filename = f"{batch_id}_annotated_images"
        zip_path = Path(batch_folder) / zip_filename
        
        try:
            zip_file_path = shutil.make_archive(
                base_name=str(zip_path),
                format='zip',
                root_dir=combined_annotated_folder
            )
        except Exception as e:
            background_tasks.add_task(delayed_cleanup, batch_folder, delay=60)
            return JSONResponse(
                status_code=500,
                content={"detail": f"Failed to create zip file: {str(e)}"}
            )
        
        # Schedule cleanup for success case
        background_tasks.add_task(delayed_cleanup, batch_folder, delay=60)
        
        # Return the zip file with confidence data in headers
        response = FileResponse(
            path=zip_file_path,
            media_type="application/zip",
            filename=f"{batch_id}_annotated_images.zip",
            background=background_tasks
        )
        
        response.headers["X-Batch-ID"] = batch_id
        response.headers["X-Images-Analyzed"] = str(len(all_results))
        response.headers["X-Average-Confidence"] = str(round(avg_score, 4))
        response.headers["X-Images-Uploaded"] = str(len(files))
        response.headers["X-Preprocessing-Errors"] = str(len(preprocessing_errors))
        
        return response
        
    except Exception as e:
        background_tasks.add_task(delayed_cleanup, batch_folder, delay=60)
        return JSONResponse(
            status_code=500,
            content={"detail": f"Batch processing failed: {str(e)}"}
        )
