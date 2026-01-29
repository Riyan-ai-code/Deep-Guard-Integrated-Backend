import cv2
import numpy as np
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


def annotate_confidences(folder_path, results):
    """
    Annotates each image in sorted order with a compact header showing:
        Sample #N
        Pred: Fake
        Conf: 0.989
    
    Color coding based on confidence percentage (applied to ALL text):
      <30%   → Green   (Low confidence)
      30-50% → Yellow  (Medium-low confidence)
      50-70% → Orange  (Medium-high confidence)
      >70%   → Red     (High confidence)
    
    Uses DejaVu Sans font with uniform sizing for all text.
    """
    folder_path = Path(folder_path)
    output_folder = folder_path / "annotated_results"
    output_folder.mkdir(exist_ok=True)

    valid_exts = (".jpg", ".jpeg", ".png", ".bmp", ".tiff")
    image_files = sorted([f for f in folder_path.iterdir() if f.suffix.lower() in valid_exts])

    if not image_files:
        print(f"⚠️ No valid image files found in: {folder_path}")
        return

    # Load DejaVu Sans font - uniform size for all text
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 18)
    except:
        # Fallback for Windows/Mac
        try:
            font = ImageFont.truetype("DejaVuSans-Bold.ttf", 18)
        except:
            print("⚠️ DejaVu Sans not found, using default font")
            font = ImageFont.load_default()

    for idx, image_file in enumerate(image_files, start=1):
        img = cv2.imread(str(image_file))
        if img is None:
            print(f"⚠️ Could not read {image_file}")
            continue

        file_name = image_file.name
        if file_name not in results:
            print(f"⚠️ No prediction for {file_name}, skipping...")
            continue

        # Extract confidence safely
        raw_conf = results[file_name]
        if isinstance(raw_conf, dict):
            conf = float(raw_conf.get("conf", 0))
        elif isinstance(raw_conf, (list, tuple)):
            try:
                conf = float(raw_conf[0][0]) if isinstance(raw_conf[0], (list, tuple)) else float(raw_conf[0])
            except Exception:
                conf = float(raw_conf[0]) if raw_conf else 0.0
        else:
            conf = float(raw_conf)

        conf_percent = conf * 100

        # Determine prediction label and color based on confidence
        label = "Fake" if conf >= 0.5 else "Real"
        
        if conf_percent < 30:
            color = (0, 180, 0)      # Green
        elif conf_percent < 50:
            color = (255, 200, 0)    # Yellow
        elif conf_percent < 70:
            color = (255, 140, 0)    # Orange
        else:
            color = (255, 0, 0)      # Red

        # Convert OpenCV image to PIL
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(img_rgb)

        # Create header
        header_height = 85
        header = Image.new('RGB', (pil_img.width, header_height), color=(255, 255, 255))
        draw = ImageDraw.Draw(header)

        # Text lines
        line1 = f"Sample #{idx}"
        line2 = f"Pred: {label}"
        line3 = f"Conf: {conf:.3f}"

        # Get text dimensions (all using same font)
        bbox1 = draw.textbbox((0, 0), line1, font=font)
        bbox2 = draw.textbbox((0, 0), line2, font=font)
        bbox3 = draw.textbbox((0, 0), line3, font=font)

        w1, h1 = bbox1[2] - bbox1[0], bbox1[3] - bbox1[1]
        w2, h2 = bbox2[2] - bbox2[0], bbox2[3] - bbox2[1]
        w3, h3 = bbox3[2] - bbox3[0], bbox3[3] - bbox3[1]

        center_x = header.width // 2

        # Vertical positions
        y1 = 10
        y2 = y1 + 26
        y3 = y2 + 26

        # Draw centered text - ALL lines use same font and color
        draw.text((center_x - w1 // 2, y1), line1, font=font, fill=color)
        draw.text((center_x - w2 // 2, y2), line2, font=font, fill=color)
        draw.text((center_x - w3 // 2, y3), line3, font=font, fill=color)

        # Combine header + image
        combined = Image.new('RGB', (pil_img.width, header_height + pil_img.height))
        combined.paste(header, (0, 0))
        combined.paste(pil_img, (0, header_height))

        # Convert back to OpenCV format and save
        annotated = cv2.cvtColor(np.array(combined), cv2.COLOR_RGB2BGR)
        save_path = output_folder / file_name
        cv2.imwrite(str(save_path), annotated)

    print(f"✅ Annotated {len(image_files)} images with uniform text size saved to: {output_folder}")
