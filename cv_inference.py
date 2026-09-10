"""Run the trained produce spoilage model with live visual detection overlays.

Performs forward inference with MobileNetV2 with aspect-preserving center crop
preprocessing, generates spatial Grad-CAM heatmaps, and renders high-clarity
inspection bounding boxes and HUD telemetry.
"""
from pathlib import Path
from threading import Lock
from typing import Optional, Tuple

import cv2
import numpy as np
import torch

from gradcam import (
    GradCAM,
    calculate_spoilage_severity,
    extract_bbox_from_cam,
    overlay_cam_on_frame,
)
from model import build_model, load_checkpoint
from settings import (
    CHECKPOINT_PATH,
    CLASS_NAMES,
    DEVICE,
    IMAGE_SIZE,
    IMAGENET_MEAN,
    IMAGENET_STD,
)

# Limit PyTorch threads to prevent CPU memory spikes on 512MB free tiers
torch.set_num_threads(1)

_model = None
_gradcam = None
_infer_lock = Lock()


def preprocess_frame(frame_bgr: np.ndarray, device: torch.device = DEVICE) -> Tuple[torch.Tensor, Tuple[int, int, int, int]]:
    """Aspect-preserving square crop to prevent produce distortion and improve accuracy."""
    frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    h, w = frame_rgb.shape[:2]
    min_dim = min(h, w)
    start_x = (w - min_dim) // 2
    start_y = (h - min_dim) // 2
    crop = frame_rgb[start_y : start_y + min_dim, start_x : start_x + min_dim]
    resized = cv2.resize(crop, (IMAGE_SIZE, IMAGE_SIZE), interpolation=cv2.INTER_LINEAR)
    normalized = resized.astype(np.float32) / 255.0
    mean = np.array(IMAGENET_MEAN, dtype=np.float32)
    std = np.array(IMAGENET_STD, dtype=np.float32)
    standardized = (normalized - mean) / std
    tensor = torch.from_numpy(standardized).permute(2, 0, 1).unsqueeze(0)
    return tensor.to(device), (start_x, start_y, min_dim, min_dim)


def load_model():
    global _model, _gradcam
    if _model is not None:
        return _model
    if not CHECKPOINT_PATH.exists():
        raise FileNotFoundError(
            f"Model checkpoint not found at {CHECKPOINT_PATH}. "
            "Copy best_produce_spoilage_mobilenetv2.pth into the models/ folder."
        )
    model = build_model(device=DEVICE)
    load_checkpoint(model, CHECKPOINT_PATH, device=DEVICE)
    model.eval()
    _model = model
    _gradcam = GradCAM(model, model.features[18])
    return _model


def _draw_corner_brackets(img, x, y, w, h, color, thickness, bracket_len):
    """Draw stylish corner brackets around a detected object."""
    bl = min(bracket_len, w // 3, h // 3)
    # Top-left
    cv2.line(img, (x, y), (x + bl, y), color, thickness, cv2.LINE_AA)
    cv2.line(img, (x, y), (x, y + bl), color, thickness, cv2.LINE_AA)
    # Top-right
    cv2.line(img, (x + w, y), (x + w - bl, y), color, thickness, cv2.LINE_AA)
    cv2.line(img, (x + w, y), (x + w, y + bl), color, thickness, cv2.LINE_AA)
    # Bottom-left
    cv2.line(img, (x, y + h), (x + bl, y + h), color, thickness, cv2.LINE_AA)
    cv2.line(img, (x, y + h), (x, y + h - bl), color, thickness, cv2.LINE_AA)
    # Bottom-right
    cv2.line(img, (x + w, y + h), (x + w - bl, y + h), color, thickness, cv2.LINE_AA)
    cv2.line(img, (x + w, y + h), (x + w, y + h - bl), color, thickness, cv2.LINE_AA)


def _draw_detection(
    frame_bgr: np.ndarray,
    heatmap: np.ndarray,
    label: str,
    confidence: float,
    spoiled_prob: float,
    severity: float,
    tier: str,
    bbox: Optional[Tuple[int, int, int, int]] = None,
    colormap: int = cv2.COLORMAP_TURBO,
) -> np.ndarray:
    """Render the Grad-CAM thermal heatmap and clear bounding boxes on the frame."""
    h, w = frame_bgr.shape[:2]
    scale = max(0.65, min(w, h) / 640.0)

    is_spoiled = label == "Spoiled" or spoiled_prob >= 0.48

    # Blend the model's Grad-CAM heatmap onto the frame
    display, cam_bbox = overlay_cam_on_frame(
        frame_bgr, heatmap, alpha=0.38, threshold=0.18, colormap=colormap
    )
    if bbox is None:
        bbox = cam_bbox

    # 1. Top HUD Banner
    bar_h = int(60 * scale)
    overlay = display.copy()
    cv2.rectangle(overlay, (0, 0), (w, bar_h), (16, 28, 20), -1)
    display = cv2.addWeighted(overlay, 0.84, display, 0.16, 0)
    cv2.line(display, (0, bar_h), (w, bar_h), (40, 72, 50), max(1, int(2 * scale)))

    status_color = (48, 65, 225) if is_spoiled else (68, 198, 92)

    # Status Dot
    dot_radius = max(4, int(5 * scale))
    dot_x = int(22 * scale)
    dot_y = int(22 * scale)
    cv2.circle(display, (dot_x, dot_y), dot_radius, status_color, -1, cv2.LINE_AA)

    # Primary detection label
    font_main = cv2.FONT_HERSHEY_DUPLEX
    main_text = f"AI DETECTION: {label.upper()}"
    cv2.putText(
        display,
        main_text,
        (dot_x + int(14 * scale), dot_y + int(5 * scale)),
        font_main,
        0.58 * scale,
        status_color,
        max(1, int(1.8 * scale)),
        cv2.LINE_AA,
    )

    # Sub-telemetry text
    font_sub = cv2.FONT_HERSHEY_SIMPLEX
    if is_spoiled:
        sub_text = f"Decay Alert | Conf: {confidence * 100:.1f}% | Severity: {severity:.1f}% ({tier}) | Grad-CAM Active"
    else:
        sub_text = f"Produce Safe & Fresh | Conf: {confidence * 100:.1f}% | Decay Risk: {spoiled_prob * 100:.1f}% | Grad-CAM Active"

    cv2.putText(
        display,
        sub_text,
        (dot_x, dot_y + int(24 * scale)),
        font_sub,
        0.42 * scale,
        (205, 220, 210),
        max(1, int(1.2 * scale)),
        cv2.LINE_AA,
    )

    # Right side branding watermark
    right_text = "NE FARMER COOLING MONITOR"
    (rw, _), _ = cv2.getTextSize(right_text, font_sub, 0.40 * scale, 1)
    rx = w - rw - int(20 * scale)
    if rx > dot_x + 280 * scale:
        cv2.putText(
            display,
            right_text,
            (rx, dot_y + int(5 * scale)),
            font_sub,
            0.40 * scale,
            (145, 175, 155),
            1,
            cv2.LINE_AA,
        )
        tech_text = "MobileNetV2 Vision Station"
        (tw, _), _ = cv2.getTextSize(tech_text, font_sub, 0.36 * scale, 1)
        cv2.putText(
            display,
            tech_text,
            (w - tw - int(20 * scale), dot_y + int(22 * scale)),
            font_sub,
            0.36 * scale,
            (115, 145, 125),
            1,
            cv2.LINE_AA,
        )

    # 2. Draw Detection Bounding Box & Target Callout
    line_th = max(2, int(2.2 * scale))
    corner_th = max(3, int(4 * scale))
    bracket_len = int(24 * scale)

    if bbox is not None:
        bx, by, bw, bh = bbox
        cv2.rectangle(display, (bx, by), (bx + bw, by + bh), status_color, 1, cv2.LINE_AA)
        _draw_corner_brackets(display, bx, by, bw, bh, status_color, corner_th, bracket_len)

        tag_text = (
            f"SPOILAGE HOTSPOT ({confidence * 100:.0f}%)"
            if is_spoiled
            else f"PRODUCE DETECTED: FRESH ({confidence * 100:.0f}%)"
        )
        (tw, th_box), _ = cv2.getTextSize(tag_text, font_sub, 0.44 * scale, max(1, int(1.4 * scale)))
        tag_y = max(bar_h + th_box + 12, by - 8)
        tag_bg_tl = (bx, tag_y - th_box - 6)
        tag_bg_br = (bx + tw + 14, tag_y + 4)

        cv2.rectangle(display, tag_bg_tl, tag_bg_br, (16, 28, 20), -1)
        cv2.rectangle(display, tag_bg_tl, tag_bg_br, status_color, 1)
        cv2.putText(
            display,
            tag_text,
            (bx + 7, tag_y - 2),
            font_sub,
            0.44 * scale,
            status_color,
            max(1, int(1.4 * scale)),
            cv2.LINE_AA,
        )
    else:
        margin_x = int(w * 0.15)
        margin_y = int(bar_h + (h - bar_h) * 0.12)
        rw = w - 2 * margin_x
        rh = h - margin_y - int((h - bar_h) * 0.12)
        _draw_corner_brackets(display, margin_x, margin_y, rw, rh, status_color, corner_th, bracket_len)
        zone_text = f"INSPECTION FIELD · {label.upper()}"
        cv2.putText(
            display,
            zone_text,
            (margin_x + 10, margin_y + 22),
            font_sub,
            0.45 * scale,
            status_color,
            max(1, int(1.4 * scale)),
            cv2.LINE_AA,
        )

    return display


def detect_live_frame(frame_bgr: np.ndarray) -> dict:
    """Fast in-memory live detection without disk writes."""
    h, w = frame_bgr.shape[:2]
    with _infer_lock:
        load_model()
        tensor, (sx, sy, cw, ch) = preprocess_frame(frame_bgr, device=DEVICE)
        cam_crop, pred_idx, confidence, probs = _gradcam.generate_cam_fast(tensor, target_class=None)
        label = CLASS_NAMES[pred_idx]
        spoiled_prob = float(probs[1].item())

        # Map CAM back to full frame
        heatmap_full = np.zeros((h, w), dtype=np.float32)
        cam_resized = cv2.resize(cam_crop, (cw, ch))
        heatmap_full[sy : sy + ch, sx : sx + cw] = cam_resized

        severity, tier = calculate_spoilage_severity(spoiled_prob, heatmap_full)
        bbox = extract_bbox_from_cam(heatmap_full, (h, w), threshold=0.18)

    return {
        "label": label,
        "confidence": round(float(confidence), 4),
        "spoiled_probability": round(spoiled_prob, 4),
        "severity": severity,
        "severity_tier": tier,
        "is_spoiled": label == "Spoiled" or spoiled_prob >= 0.48,
        "bbox": list(bbox) if bbox else None,
    }


def render_frame_with_cam(raw_image_path: Path, colormap: int = cv2.COLORMAP_TURBO) -> np.ndarray:
    """Render Grad-CAM and HUD on a raw image with the specified colormap."""
    frame = cv2.imread(str(raw_image_path))
    if frame is None:
        raise ValueError(f"Could not read image: {raw_image_path}")

    h, w = frame.shape[:2]
    with _infer_lock:
        load_model()
        tensor, (sx, sy, cw, ch) = preprocess_frame(frame, device=DEVICE)
        heatmap_crop, pred_idx, confidence, probs = _gradcam.generate_cam_fast(tensor, target_class=None)
        label = CLASS_NAMES[pred_idx]
        spoiled_prob = float(probs[1].item())

        heatmap_full = np.zeros((h, w), dtype=np.float32)
        cam_resized = cv2.resize(heatmap_crop, (cw, ch))
        heatmap_full[sy : sy + ch, sx : sx + cw] = cam_resized

        if label == "Fresh" and spoiled_prob >= 0.20:
            spoil_crop, _, _, _ = _gradcam.generate_cam_fast(tensor, target_class=1)
            spoil_full = np.zeros((h, w), dtype=np.float32)
            spoil_full[sy : sy + ch, sx : sx + cw] = cv2.resize(spoil_crop, (cw, ch))
            severity, tier = calculate_spoilage_severity(spoiled_prob, spoil_full)
            target_map = spoil_full
        else:
            severity, tier = calculate_spoilage_severity(spoiled_prob, heatmap_full)
            target_map = heatmap_full

        bbox = extract_bbox_from_cam(target_map, (h, w), threshold=0.18)

        annotated = _draw_detection(
            frame_bgr=frame,
            heatmap=target_map,
            label=label,
            confidence=float(confidence),
            spoiled_prob=spoiled_prob,
            severity=severity,
            tier=tier,
            bbox=bbox,
            colormap=colormap,
        )
    return annotated


def classify_image(image_path: Path, colormap: int = cv2.COLORMAP_TURBO) -> dict:
    """Classify one archival image, save both raw and annotated versions."""
    frame = cv2.imread(str(image_path))
    if frame is None:
        raise ValueError(f"Could not read image: {image_path}")

    # Ensure a raw backup is saved alongside
    raw_path = image_path.with_name(image_path.stem.replace("_raw", "").replace("_annotated", "") + "_raw.jpg")
    if not raw_path.exists() or raw_path.resolve() != image_path.resolve():
        cv2.imwrite(str(raw_path), frame)

    h, w = frame.shape[:2]
    with _infer_lock:
        load_model()
        tensor, (sx, sy, cw, ch) = preprocess_frame(frame, device=DEVICE)

        heatmap_crop, pred_idx, confidence, probs = _gradcam.generate_cam_fast(tensor, target_class=None)
        label = CLASS_NAMES[pred_idx]
        spoiled_prob = float(probs[1].item())

        heatmap_full = np.zeros((h, w), dtype=np.float32)
        cam_resized = cv2.resize(heatmap_crop, (cw, ch))
        heatmap_full[sy : sy + ch, sx : sx + cw] = cam_resized

        if label == "Fresh" and spoiled_prob >= 0.20:
            spoil_crop, _, _, _ = _gradcam.generate_cam_fast(tensor, target_class=1)
            spoil_full = np.zeros((h, w), dtype=np.float32)
            spoil_full[sy : sy + ch, sx : sx + cw] = cv2.resize(spoil_crop, (cw, ch))
            severity, tier = calculate_spoilage_severity(spoiled_prob, spoil_full)
            target_map = spoil_full
        else:
            severity, tier = calculate_spoilage_severity(spoiled_prob, heatmap_full)
            target_map = heatmap_full

        bbox = extract_bbox_from_cam(target_map, (h, w), threshold=0.18)

        annotated = _draw_detection(
            frame_bgr=frame,
            heatmap=target_map,
            label=label,
            confidence=float(confidence),
            spoiled_prob=spoiled_prob,
            severity=severity,
            tier=tier,
            bbox=bbox,
            colormap=colormap,
        )
        cv2.imwrite(str(image_path), annotated)

    return {
        "label": label,
        "confidence": round(float(confidence), 4),
        "spoiled_probability": round(spoiled_prob, 4),
        "severity": severity,
        "severity_tier": tier,
        "has_detection_box": bbox is not None,
        "bbox": list(bbox) if bbox else None,
        "raw_path": str(raw_path),
        "overlay": True,
    }

