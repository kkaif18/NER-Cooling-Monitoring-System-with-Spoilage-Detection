"""Active North East produce cold storage & AI vision inspection console."""
import asyncio
from datetime import datetime, timezone
from pathlib import Path
import time
import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from cv_inference import classify_image, detect_live_frame, load_model, render_frame_with_cam
from database import (
    get_frame,
    init_db,
    latest_frame,
    latest_reading,
    recent_frames,
    recent_readings,
    save_frame,
    save_reading,
    utcnow,
)
from settings import (
    CAMERA_POLL_SECONDS,
    HUMIDITY_MAX,
    HUMIDITY_MIN,
    MAX_STORED_FRAMES,
    TEMP_MAX_C,
    TEMP_MIN_C,
    UPLOADS_DIR,
)

app = FastAPI(title="North East Farmer Cold Storage & AI Inspection Console")
clients: list[WebSocket] = []


class SensorPayload(BaseModel):
    temperature: float
    humidity: float
    timestamp: str | None = None



def parse_timestamp(value: str | None) -> datetime:
    if not value:
        return utcnow()
    text = value.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is not None:
            return dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except Exception:
        return utcnow()


def reading_alerts(temperature: float, humidity: float) -> list[str]:
    alerts = []
    if temperature < TEMP_MIN_C:
        alerts.append(f"Temperature too low ({temperature:.1f} °C)")
    elif temperature > TEMP_MAX_C:
        alerts.append(f"Temperature too high ({temperature:.1f} °C)")
    if humidity < HUMIDITY_MIN:
        alerts.append(f"Humidity too low ({humidity:.1f} %)")
    elif humidity > HUMIDITY_MAX:
        alerts.append(f"Humidity too high ({humidity:.1f} %)")
    return alerts


def serialize_reading(row) -> dict:
    ts_str = row.timestamp.isoformat()
    if not ts_str.endswith("Z") and "+" not in ts_str:
        ts_str += "Z"
    return {
        "temperature": row.temperature,
        "humidity": row.humidity,
        "timestamp": ts_str,
    }


def serialize_frame(row) -> dict | None:
    if row is None:
        return None
    spoiled_prob = getattr(row, "spoiled_probability", 0.0) or 0.0
    severity = round(spoiled_prob * 100.0, 1)
    if severity < 20.0:
        tier = "Optimal Fresh"
    elif severity < 45.0:
        tier = "Early Risk"
    elif severity < 70.0:
        tier = "Moderate Decay"
    else:
        tier = "Severe Spoilage"
    ts_str = row.timestamp.isoformat()
    if not ts_str.endswith("Z") and "+" not in ts_str:
        ts_str += "Z"
    return {
        "id": row.id,
        "image_url": f"/api/image/{row.id}",
        "label": row.label,
        "confidence": row.confidence,
        "spoiled_probability": row.spoiled_probability,
        "severity": severity,
        "severity_tier": tier,
        "is_spoiled": row.is_spoiled,
        "timestamp": ts_str,
    }


def current_alerts() -> list[str]:
    alerts = []
    reading = latest_reading()
    if reading:
        alerts.extend(reading_alerts(reading.temperature, reading.humidity))
    frame = latest_frame()
    if frame and frame.is_spoiled:
        alerts.append("Spoilage detected in the camera feed")
    return alerts





def snapshot() -> dict:
    reading = latest_reading()
    frame = latest_frame()
    return {
        "type": "snapshot",
        "reading": serialize_reading(reading) if reading else None,
        "history": [serialize_reading(r) for r in recent_readings()],
        "camera": serialize_frame(frame),
        "camera_history": [serialize_frame(f) for f in recent_frames(20) if f is not None],
        "alerts": current_alerts(),
        "limits": {
            "temp_min": TEMP_MIN_C,
            "temp_max": TEMP_MAX_C,
            "humidity_min": HUMIDITY_MIN,
            "humidity_max": HUMIDITY_MAX,
        },
    }


async def broadcast(message: dict):
    stale = []
    for ws in clients:
        try:
            await ws.send_json(message)
        except Exception:
            stale.append(ws)
    for ws in stale:
        if ws in clients:
            clients.remove(ws)


def prune_old_frames(keep_count: int = MAX_STORED_FRAMES):
    """Keep only the most recent N frames on disk to prevent memory/disk bloat."""
    try:
        files = sorted(UPLOADS_DIR.glob("frame_*.jpg"), key=lambda p: p.stat().st_mtime)
        if len(files) > keep_count:
            for old_file in files[:-keep_count]:
                try:
                    old_file.unlink(missing_ok=True)
                except Exception:
                    pass
    except Exception:
        pass


def save_and_classify_jpeg(contents: bytes, timestamp: datetime | None = None) -> dict:
    ts = timestamp or utcnow()
    path = UPLOADS_DIR / f"frame_{ts.strftime('%Y%m%d_%H%M%S_%f')}.jpg"
    path.write_bytes(contents)
    result = classify_image(path)
    row = save_frame(
        image_path=str(path),
        label=result["label"],
        confidence=result["confidence"],
        spoiled_probability=result["spoiled_probability"],
        timestamp=ts,
    )
    prune_old_frames()
    return serialize_frame(row)





@app.on_event("startup")
def startup():
    init_db()
    load_model()


@app.post("/api/ingest")
async def ingest_json(payload: SensorPayload):
    """Ingest a temperature/humidity reading (JSON). Same shape the MCU will send."""
    ts = parse_timestamp(payload.timestamp)
    row = save_reading(payload.temperature, payload.humidity, ts)
    data = serialize_reading(row)
    await broadcast(
        {
            "type": "reading",
            "reading": data,
            "alerts": current_alerts(),
        }
    )
    return {"ok": True, "reading": data, "alerts": current_alerts()}


@app.post("/api/ingest/image")
async def ingest_image(
    image: UploadFile = File(...),
    timestamp: str | None = Form(None),
):
    """Ingest an archival camera still. Runs MobileNetV2 + Grad-CAM and saves snapshot."""
    ts = parse_timestamp(timestamp)
    contents = await image.read()
    camera = save_and_classify_jpeg(contents, ts)
    await broadcast(
        {
            "type": "camera",
            "camera": camera,
            "alerts": current_alerts(),
        }
    )
    return {"ok": True, "camera": camera, "alerts": current_alerts()}


@app.post("/api/ingest/live-detect")
async def ingest_live_detect(image: UploadFile = File(...)):
    """Fast in-memory live detection for video stream without writing files to disk."""
    contents = await image.read()
    nparr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if frame is None:
        return {"ok": False, "error": "Could not decode frame"}
    detection = detect_live_frame(frame)
    return {"ok": True, "detection": detection}



@app.get("/api/status")
def status():
    return snapshot()

@app.get("/api/image/{frame_id:int}")
def get_image_by_id(
    frame_id: int,
    view: str = "annotated",
    colormap: str = "turbo",
    heatmap: bool = True,
):
    """Retrieve a specific scanned image by its audit frame ID."""
    frame = get_frame(frame_id)
    if frame is None or not Path(frame.image_path).exists():
        raise HTTPException(status_code=404, detail="Scanned image not found")

    base_path = Path(frame.image_path)
    raw_path = base_path.with_name(base_path.stem.replace("_raw", "").replace("_annotated", "") + "_raw.jpg")

    if (view == "raw" or not heatmap) and raw_path.exists():
        return FileResponse(str(raw_path))

    cmap_map = {"turbo": cv2.COLORMAP_TURBO, "hot": cv2.COLORMAP_HOT, "jet": cv2.COLORMAP_JET}
    if colormap in cmap_map and colormap != "turbo" and raw_path.exists():
        try:
            rendered = render_frame_with_cam(raw_path, colormap=cmap_map[colormap])
            ok, buf = cv2.imencode(".jpg", rendered, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
            if ok:
                return Response(content=buf.tobytes(), media_type="image/jpeg")
        except Exception:
            pass

    return FileResponse(frame.image_path)


@app.get("/api/image/latest")
def latest_image(
    view: str = "annotated",
    colormap: str = "turbo",
    heatmap: bool = True,
):
    """Retrieve the latest scanned image with optional raw view or dynamic colormap."""
    frame = latest_frame()
    if frame is None or not Path(frame.image_path).exists():
        raise HTTPException(status_code=404, detail="No image yet")

    base_path = Path(frame.image_path)
    raw_path = base_path.with_name(base_path.stem.replace("_raw", "").replace("_annotated", "") + "_raw.jpg")

    # If raw requested or heatmap turned off
    if (view == "raw" or not heatmap) and raw_path.exists():
        return FileResponse(str(raw_path))

    # If dynamic colormap requested
    cmap_map = {"turbo": cv2.COLORMAP_TURBO, "hot": cv2.COLORMAP_HOT, "jet": cv2.COLORMAP_JET}
    if colormap in cmap_map and colormap != "turbo" and raw_path.exists():
        try:
            rendered = render_frame_with_cam(raw_path, colormap=cmap_map[colormap])
            ok, buf = cv2.imencode(".jpg", rendered, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
            if ok:
                return Response(content=buf.tobytes(), media_type="image/jpeg")
        except Exception:
            pass

    return FileResponse(frame.image_path)


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    clients.append(ws)
    await ws.send_json(snapshot())
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        if ws in clients:
            clients.remove(ws)


@app.get("/")
def index():
    return FileResponse("static/index.html")


app.mount("/static", StaticFiles(directory="static"), name="static")
