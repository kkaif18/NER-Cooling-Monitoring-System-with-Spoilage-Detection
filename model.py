"""MobileNetV2 classifier copied from the existing spoilage detector."""
from typing import Any, Dict

import torch
import torch.nn as nn
import torchvision.models as models

from settings import DEVICE, NUM_CLASSES


class ProduceSpoilageClassifier(nn.Module):
    """MobileNetV2-based binary classifier for Fresh vs. Spoiled produce."""

    def __init__(self, num_classes: int = NUM_CLASSES, dropout_rate: float = 0.25):
        super().__init__()
        self.num_classes = num_classes
        base_model = models.mobilenet_v2(weights=None)
        self.features = base_model.features
        self.pool = nn.AdaptiveAvgPool2d((1, 1))
        in_features = base_model.last_channel
        self.classifier = nn.Sequential(
            nn.Dropout(p=dropout_rate),
            nn.Linear(in_features, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.features(x)
        x = self.pool(x)
        x = torch.flatten(x, 1)
        return self.classifier(x)


def build_model(device: torch.device = DEVICE) -> ProduceSpoilageClassifier:
    model = ProduceSpoilageClassifier()
    return model.to(device)


def load_checkpoint(
    model: nn.Module,
    load_path,
    device: torch.device = DEVICE,
) -> Dict[str, Any]:
    checkpoint = torch.load(load_path, map_location=device, weights_only=False)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.to(device)
    return checkpoint
