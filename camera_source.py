"""Grab a still from a phone IP webcam or local camera index.

Uses the same sources as live_spoilage_detector.py:
  --camera 0
  --camera http://192.168.x.x:8080/video
"""
from __future__ import annotations

import cv2
import requests


def parse_camera_source(val: str):
    text = (val or "").strip()
    try:
        return int(text)
    except ValueError:
        return text


def _still_candidates(url: str) -> list[str]:
    base = url.rstrip("/")
    if base.endswith("/video"):
        return [base[: -len("video")] + "shot.jpg", url]
    if "shot.jpg" in base or "photo.jpg" in base:
        return [url]
    if url.startswith("http"):
        return [base + "/shot.jpg", base + "/video", url]
    return [url]


def grab_jpeg(source: str) -> bytes:
    parsed = parse_camera_source(source)
    if isinstance(parsed, str) and parsed.startswith("http"):
        for url in _still_candidates(parsed):
            if "shot.jpg" in url or "photo.jpg" in url:
                response = requests.get(url, timeout=5)
                if response.ok and response.content[:2] == b"\xff\xd8":
                    return response.content

    cap = cv2.VideoCapture(parsed)
    if not cap.isOpened():
        raise RuntimeError(
            f"Could not open camera: {source}. "
            "For IP Webcam, Start Server and use http://PHONE_IP:8080/video"
        )
    ok, frame = cap.read()
    cap.release()
    if not ok or frame is None:
        raise RuntimeError(f"Opened camera but got no frame: {source}")
    ok, encoded = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    if not ok:
        raise RuntimeError("Failed to encode camera frame as JPEG")
    return encoded.tobytes()
