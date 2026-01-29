#!/bin/sh

# Make ML engine import paths point to the correct root
export PYTHONPATH="/usr/src/app/app/Deep-Guard-ML-Engine"

# Start ML engine
uvicorn app.main:app --host 0.0.0.0 --port 8000 &

# Start backend on public port
cd app/Deep-Guard-Backend
PORT=${PORT:-5000}
node server.js
