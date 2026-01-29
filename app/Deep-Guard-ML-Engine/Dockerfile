# Use a lightweight Python image
FROM python:3.10-slim

# Set environment variables for non-interactive installs
ENV PYTHONUNBUFFERED=1

# Install necessary system dependencies (like ffmpeg for video processing)
# The need for ffmpeg is likely contributing to your memory issues.
RUN apt-get update && \
    apt-get install -y ffmpeg libsm6 libxext6 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Copy the requirements file and install Python dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code (e.g., the 'app' directory)
COPY . .

# Expose the application port
EXPOSE 8000

# Simple command to run the application (assuming app/main.py and an app object)
# If your ML service uses Gunicorn, change this back to the Gunicorn command.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]