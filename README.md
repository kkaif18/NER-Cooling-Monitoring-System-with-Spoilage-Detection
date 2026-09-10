# North East Farmer Cooling Monitoring System

Active monitoring and AI inspection dashboard for a farmer cold storage / zero-energy evaporative cooling chamber in North East India. The backend tracks chamber microclimate (temperature and humidity), runs the trained MobileNetV2 produce spoilage model with spatial Grad-CAM detection overlays on camera stills, and streams real-time updates over WebSocket.

## 1. Install

From this folder:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

The trained weights are expected at:

`models/best_produce_spoilage_mobilenetv2.pth`

## 2. Start the backend

```powershell
.\.venv\Scripts\Activate.ps1
uvicorn app:app --host 127.0.0.1 --port 8000
```

Open the dashboard at [http://127.0.0.1:8000](http://127.0.0.1:8000). Leave this terminal running.

## 3. Start the sensor simulator (second terminal)

This stands in for the microcontroller temperature/humidity readings. It does **not** send fake camera pictures.

```powershell
.\.venv\Scripts\Activate.ps1
python simulator.py
```

## 4. Chamber Camera & AI Inspection Testing

There are multiple ways to inspect produce through the dashboard:

1. **Direct Browser Webcam**: Click **"Use Browser Webcam"** on the dashboard. Your browser will capture live frames every 2.5 seconds and display detected bounding boxes and produce condition overlays automatically.
2. **Phone IP Webcam**: Connect phone and PC on same Wi-Fi, open **IP Webcam**, tap **Start Server**, paste URL (e.g. `http://192.168.1.5:8080/video`) and click **Connect**.
3. **Local Webcam Index**: Enter `0`, `1`, or `2` for connected USB/virtual webcams.
4. **Upload Produce Photo**: Click **"Upload Produce Still"** to run instant MobileNetV2 + Grad-CAM inference on any produce photo.

## Device API (what the microcontroller will call later)

Sensor reading (JSON):

```http
POST /api/ingest
{"temperature": 4.2, "humidity": 88.1, "timestamp": "2026-09-04T18:00:00Z"}
```

Camera still (multipart). The backend classifies that **one image** with the same preprocessing used on webcam frames (BGR→RGB, resize 224, ImageNet normalize):

```http
POST /api/ingest/image
image: <jpeg or png file>
timestamp: optional
```

Live UI updates: `ws://127.0.0.1:8000/ws`

## Alerts

The banner turns on when:

- temperature is outside **2–8 °C**
- humidity is outside **70–95 %**
- the latest image is classified as **Spoiled**

Change those limits in `settings.py`.
