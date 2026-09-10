FROM python:3.11-slim

# System libraries OpenCV needs even in headless mode
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Render sets $PORT at runtime; default to 8000 for local testing
ENV PORT=8000
EXPOSE 8000

RUN chmod +x start.sh
CMD ["./start.sh"]
