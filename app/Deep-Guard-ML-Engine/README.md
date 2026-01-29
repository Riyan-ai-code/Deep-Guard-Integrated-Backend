# Deep-Guard-ML-Engine

A compact, student-friendly write-up of the Deep-Guard-ML-Engine: a research-style project that detects deepfakes using a trained Keras model and a TensorFlow Lite runtime for lightweight inference.

I built this project while learning practical ML deployment: the repo packages the training artifacts, a lightweight inference engine, and utilities for extracting and annotating faces from videos. The tone here is professional, but I'm writing as a student who wants other learners to get started quickly.

## What this project does

- Loads a trained model (`models/best_model.keras`) and a TFLite runtime model (`app/model/deepfake_detector.tflite`) to detect face-level deepfakes.
- Provides scripts and services to preprocess videos, extract faces, run inference, and save annotated outputs.
- Ships a minimal API and CLI-style scripts to try the model on images and videos.

## Quick contract (what to expect)

- Inputs: images or videos with faces (single or multiple faces per frame).
- Outputs: per-face deepfake probability, annotated images/videos, and CSV/prediction logs in `test_results/`.
- Errors: missing model files or unsupported video codecs will raise exceptions. The README shows how to avoid them.

## Repo layout (important files)

- `requirements.txt` — Python dependencies to install.
- `app/` — Application entry points and API layers.
  - `app/main.py` — main runner for the app (entrypoint for the API/service).
  - `app/api.py` — HTTP endpoints (if used) for inference.
  - `app/services/` — service wrappers around model inference and preprocessing.
- `models/` — training artifacts and helper scripts (`best_model.keras`, `lite_model.py`).
- `app/model/deepfake_detector.tflite` — TFLite model used for fast inference on CPU.
- `utils/` — helper scripts: face extraction, tracking, annotating, video processing.
- `test_results/` — output logs from running inference (metrics, misclassified files, etc.).

(If you want a deeper map of folders, open the `app/`, `utils/`, and `services/` directories.)

## Prerequisites

- Linux or macOS (Linux recommended for video codecs).
- Python 3.8+ (the code was developed and tested with Python 3.8–3.11).
- FFmpeg installed system-wide for video processing (used by `utils/video_processor.py`).

## Install (quick)

1. Create and activate a virtual environment (recommended):

```bash
python3 -m venv .venv
source .venv/bin/activate
```

2. Install Python dependencies:

```bash
pip install -r requirements.txt
```

Note: If you hit installation issues with `tensorflow` or `tensorflow-lite`, try installing the platform-specific wheel first or use a lightweight CPU-only wheel if GPU isn't needed.

## Try the model (basic)

These are copy-paste commands that should work from the project root.

Run the main app (if `app/main.py` contains a runner):

```bash
python3 app/main.py
```

If the project exposes an HTTP API in `app/api.py`, after starting the app you can call the inference endpoint (example):

```bash
curl -X POST http://localhost:8000/predict -F "file=@tests/sample_face.jpg"
```

(Replace the URL and endpoint name with the actual endpoint if different. Check `app/api.py` to confirm routes.)

Run a utility script to annotate a sample video/image (example):

```bash
python3 app/services/save_video.py --input path/to/video.mp4 --output test_results/annotated.mp4
```

## How to use the models

- `models/best_model.keras` — Keras model checkpoint used during training and evaluation.
- `app/model/deepfake_detector.tflite` — Optimized TFLite model; used for fast inference in `app/services/model.py`.

To swap in a new TFLite model, replace `app/model/deepfake_detector.tflite` and restart the service.

## Development notes (student perspective)

I wrote this while learning about model deployment. A few notes from my experiments:

- Face detection and cropping are sensitive: ensure faces are well-cropped and normalized like the training data.
- For video inputs, extracting face tracks and deduplicating frames speeds up inference.
- TFLite yields faster CPU inference but may slightly differ numerically from full Keras outputs.

## Tests & validation

There are no automated unit tests committed yet (this was a research repo). To validate manually:

- Put a few sample images in `app/model/test_images/` and run the inference script.
- Inspect `test_results/metrics.json` and `test_results/predictions.csv` for outputs.

## Edge cases to watch for

- Input files with no detectable faces: scripts will often raise `ValueError` or return an empty set of predictions — handle this in callers.
- Large videos: consider sampling frames to reduce inference time and memory usage.
- Mismatched image sizes: ensure preprocessing matches training transforms (resize, normalize).

## Contributing

I welcome feedback and small PRs. If you contribute:

1. Open an issue to discuss larger changes.
2. Keep changes focused (feature, bugfix, docs).
3. Add small tests or example scripts when possible.

## Next steps (ideas I might work on)

- Add unit tests and a CI pipeline.
- Add a Dockerfile for consistent runtime (especially for FFmpeg and TF deps).
- Provide a small web UI for uploading videos/images.

## Acknowledgements & references

- My thanks to the tutorials and reference implementations that helped me learn TFLite deployment and face processing.