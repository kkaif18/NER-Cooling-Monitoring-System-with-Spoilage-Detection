#!/bin/sh
# Start the FastAPI server in the background
uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000} &

# Give the server a moment to boot before the simulator starts sending data
sleep 3

# Start the sensor simulator pointed at the server running in this same container
python simulator.py --url http://127.0.0.1:${PORT:-8000} &

# Wait for both background processes; if either exits, the container stops
wait -n
