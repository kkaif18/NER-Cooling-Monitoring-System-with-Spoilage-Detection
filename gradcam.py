"""Grad-CAM heatmap for produce inspection stills.

Provides targeted localization of produce decay cues with smooth, non-poppy
thermal visualization (using TURBO colormap rather than loud JET), bounding
box extraction, and severity scoring.
"""
from typing import Optional, Tuple

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from settings import HEATMAP_ALPHA, HEATMAP_THRESHOLD


class GradCAM:
    def __init__(self, model: nn.Module, target_layer: nn.Module):
        self.model = model
        self.target_layer = target_layer
        self.activations: Optional[torch.Tensor] = None
        self.gradients: Optional[torch.Tensor] = None
        self.fwd_handle = self.target_layer.register_forward_hook(self._forward_hook)
        self.bwd_handle = self.target_layer.register_full_backward_hook(self._backward_hook)

    def _forward_hook(self, module, input, output):
        self.activations = output.detach()

    def _backward_hook(self, module, grad_input, grad_output):
        self.gradients = grad_output[0].detach()

    def generate_cam(self, input_tensor: torch.Tensor, target_class: Optional[int] = None):
        self.model.eval()
        self.model.zero_grad()
        logits = self.model(input_tensor)
        probs = F.softmax(logits, dim=1)
        pred_class = torch.argmax(probs, dim=1).item()
        pred_conf = probs[0, pred_class].item()
        if target_class is None:
            target_class = pred_class
        score = logits[0, target_class]
        score.backward(retain_graph=False)
        weights = torch.mean(self.gradients, dim=(2, 3), keepdim=True)
        cam = torch.sum(weights * self.activations, dim=1, keepdim=True)
        cam = F.relu(cam)
        h, w = input_tensor.shape[2], input_tensor.shape[3]
        cam = F.interpolate(cam, size=(h, w), mode="bilinear", align_corners=False)
        cam_np = cam.squeeze().cpu().numpy()
        cam_min, cam_max = cam_np.min(), cam_np.max()
        if cam_max - cam_min > 1e-8:
            cam_np = (cam_np - cam_min) / (cam_max - cam_min)
        else:
            cam_np = np.zeros_like(cam_np)
        return cam_np, pred_class, pred_conf, probs.squeeze(0).detach().cpu()

    @torch.no_grad()
    def generate_cam_fast(self, input_tensor: torch.Tensor, target_class: Optional[int] = None):
        """Memory-efficient CAM for live inference. Uses classifier weights instead of backward()."""
        self.model.eval()
        logits = self.model(input_tensor)
        probs = F.softmax(logits, dim=1)
        pred_class = torch.argmax(probs, dim=1).item()
        pred_conf = probs[0, pred_class].item()
        if target_class is None:
            target_class = pred_class
            
        # Standard CAM: weight * activation
        weights = self.model.classifier[1].weight[target_class]
        cam = torch.sum(weights.view(1, -1, 1, 1) * self.activations, dim=1, keepdim=True)
        cam = F.relu(cam)
        
        h, w = input_tensor.shape[2], input_tensor.shape[3]
        cam = F.interpolate(cam, size=(h, w), mode="bilinear", align_corners=False)
        cam_np = cam.squeeze().cpu().numpy()
        cam_min, cam_max = cam_np.min(), cam_np.max()
        if cam_max - cam_min > 1e-8:
            cam_np = (cam_np - cam_min) / (cam_max - cam_min)
        else:
            cam_np = np.zeros_like(cam_np)
        return cam_np, pred_class, pred_conf, probs.squeeze(0).detach().cpu()


def extract_bbox_from_cam(
    heatmap: np.ndarray,
    frame_size: Tuple[int, int],
    threshold: float = 0.35,
    min_area_fraction: float = 0.005,
) -> Optional[Tuple[int, int, int, int]]:
    """Find the primary bounding box of high-activation region in CAM."""
    frame_h, frame_w = frame_size
    heatmap_resized = cv2.resize(heatmap, (frame_w, frame_h))
    binary_mask = (heatmap_resized >= threshold).astype(np.uint8) * 255
    contours, _ = cv2.findContours(binary_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    largest = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(largest)
    if area >= (frame_h * frame_w * min_area_fraction):
        return cv2.boundingRect(largest)
    return None


def calculate_spoilage_severity(
    spoiled_prob: float,
    heatmap: np.ndarray,
    threshold: float = HEATMAP_THRESHOLD,
) -> Tuple[float, str]:
    """Calculate continuous spoilage severity percentage (0-100%) and tier."""
    if spoiled_prob < 0.05:
        return 0.0, "Optimal Fresh"
    spatial_coverage = float(np.mean(heatmap >= threshold))
    severity = (0.70 * spoiled_prob + 0.30 * min(1.0, spatial_coverage * 3.5)) * 100.0
    severity = min(100.0, max(0.0, severity))
    if severity < 20.0:
        tier = "Safe / Fresh"
    elif severity < 45.0:
        tier = "Early Rot Alert"
    elif severity < 70.0:
        tier = "Moderate Decay"
    else:
        tier = "Severe Spoilage"
    return round(severity, 1), tier


def overlay_cam_on_frame(
    frame_bgr: np.ndarray,
    heatmap: np.ndarray,
    alpha: float = 0.38,
    threshold: float = 0.30,
    colormap: int = cv2.COLORMAP_TURBO,
) -> Tuple[np.ndarray, Optional[Tuple[int, int, int, int]]]:
    """Overlay a smooth, refined thermal heatmap on decay spots without neon noise."""
    frame_h, frame_w = frame_bgr.shape[:2]
    heatmap_resized = cv2.resize(heatmap, (frame_w, frame_h))
    heatmap_masked = np.copy(heatmap_resized)
    heatmap_masked[heatmap_masked < threshold] = 0.0
    heatmap_uint8 = np.uint8(255 * heatmap_masked)
    heatmap_color = cv2.applyColorMap(heatmap_uint8, colormap)
    mask_3ch = (heatmap_masked >= threshold)[:, :, np.newaxis]
    heatmap_color = np.where(mask_3ch, heatmap_color, 0)
    blended = frame_bgr.copy()
    active = heatmap_masked >= threshold
    if np.any(active):
        blended[active] = cv2.addWeighted(
            frame_bgr[active], 1.0 - alpha, heatmap_color[active], alpha, 0
        )
    bbox = extract_bbox_from_cam(heatmap, (frame_h, frame_w), threshold=threshold)
    return blended, bbox
