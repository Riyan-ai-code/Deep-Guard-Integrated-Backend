import os
import cv2
import numpy as np

# OPTIMIZATION 1: Try importing lightweight runtime first, fall back to heavy TF only if needed
try:
    import tflite_runtime.interpreter as tflite
    print("✅ Using lightweight tflite-runtime")
except ImportError:
    print("⚠️ tflite-runtime not found, falling back to full tensorflow (Heavy RAM usage)")
    import tensorflow.lite as tflite

def preprocess_inference_xception(image_path, input_shape):
    """Preprocess image for Xception model (inference) using Pure NumPy."""
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"Failed to load image: {image_path}")
    
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    img = cv2.resize(img, (input_shape[2], input_shape[1]))
    img = img.astype(np.float32)
    
    # OPTIMIZATION 2: Replaced 'tf.keras.applications.xception.preprocess_input(img)'
    # Xception preprocessing is simply: (x / 127.5) - 1.0
    img = (img / 127.5) - 1.0
    
    return np.expand_dims(img, axis=0)

def detect_deepfake(images_folder, tflite_model_path="./app/model/deepfake_detector.tflite"):
    """Run deepfake detection on all images in a folder using TFLite."""

    # Load model using the imported interpreter (tflite-runtime or tf.lite)
    interpreter = tflite.Interpreter(model_path=tflite_model_path)
    interpreter.allocate_tensors()
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()
    input_shape = input_details[0]['shape']

    # Collect images
    valid_exts = ('.jpg', '.jpeg', '.png', '.bmp')
    if not os.path.exists(images_folder):
         raise ValueError(f"Folder not found: {images_folder}")

    image_paths = [
        os.path.join(images_folder, f)
        for f in os.listdir(images_folder)
        if f.lower().endswith(valid_exts)
    ]

    if not image_paths:
        return {} # Return empty dict instead of crashing if folder is empty but exists

    results = {}

    # Inference loop
    for img_path in sorted(image_paths):
        try:
            img = preprocess_inference_xception(img_path, input_shape)
            interpreter.set_tensor(input_details[0]['index'], img)
            interpreter.invoke()
            output = interpreter.get_tensor(output_details[0]['index'])
            results[os.path.basename(img_path)] = output.tolist()
        except Exception as e:
            results[os.path.basename(img_path)] = {"error": str(e)}

    return results

if __name__ == "__main__": 
    folder = "./app/model/test_images"
    try:
        predictions = detect_deepfake(folder)
        for name, pred in predictions.items():
            print(f"{name}: {pred}")
    except Exception as e:
        print(f"Error: {e}")