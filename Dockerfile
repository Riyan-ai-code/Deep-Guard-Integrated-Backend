FROM python:3.10-slim

ENV PYTHONUNBUFFERED=1 \
    NODE_ENV=production

# 1️⃣ UPDATE: Added 'wget' to the list of installed packages
RUN apt-get update && \
    apt-get install -y ffmpeg libsm6 libxext6 curl wget && \
    rm -rf /var/lib/apt/lists/* && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get update && apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Install ML dependencies
COPY app/Deep-Guard-ML-Engine/requirements.txt ./ml-requirements.txt
RUN pip install --no-cache-dir -r ml-requirements.txt

# 2️⃣ NEW: Download the lightweight YuNet Model
# We do this here so it stays cached even if you change your app code later.
RUN wget -q https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx -O /usr/src/app/face_detection_yunet_2023mar.onnx

# Copy full app (backend + ML)
COPY app ./app

# 🔥 FIX: Copy ML model to the path expected by the ML code
COPY app/Deep-Guard-ML-Engine/app/model ./app/model

# Install backend dependencies
RUN cd app/Deep-Guard-Backend && npm install --omit=dev --no-audit --no-fund

# Copy startup script
COPY start.sh .

EXPOSE 5000

RUN chmod +x start.sh

CMD ["./start.sh"]