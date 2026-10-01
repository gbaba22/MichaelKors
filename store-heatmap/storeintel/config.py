"""Loads and validates the store layout + camera configuration."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .geometry import Homography


@dataclass
class Aisle:
    id: str
    name: str
    polygon: np.ndarray  # floor coordinates, metres
    cameras: list[str] = field(default_factory=list)  # empty = any camera may count it


@dataclass
class Camera:
    id: str
    source: str
    homography: Homography


@dataclass
class Processing:
    sample_fps: float = 5.0
    segment_minutes: int = 5
    model: str = "yolo11n.pt"
    confidence: float = 0.35
    grid_cell_m: float = 0.5


@dataclass
class StoreConfig:
    name: str
    width_m: float
    depth_m: float
    aisles: list[Aisle]
    cameras: dict[str, Camera]
    processing: Processing
    path: Path
    fixtures: list[list[list[float]]] = field(default_factory=list)  # shelves, drawn on the plan
    entrance: list[float] | None = None

    def public_layout(self) -> dict:
        """The parts of the config the dashboard needs (no camera URLs/credentials)."""
        return {
            "name": self.name,
            "width_m": self.width_m,
            "depth_m": self.depth_m,
            "grid_cell_m": self.processing.grid_cell_m,
            "fixtures": self.fixtures,
            "entrance": self.entrance,
            "aisles": [
                {"id": a.id, "name": a.name, "polygon": a.polygon.tolist()} for a in self.aisles
            ],
            "cameras": list(self.cameras),
        }


def load_config(path: str | Path) -> StoreConfig:
    path = Path(path)
    raw = json.loads(path.read_text())
    store = raw["store"]

    aisles = [
        Aisle(
            id=a["id"],
            name=a.get("name", a["id"]),
            polygon=np.asarray(a["polygon"], dtype=float),
            cameras=a.get("cameras", []),
        )
        for a in raw["aisles"]
    ]
    ids = [a.id for a in aisles]
    if len(ids) != len(set(ids)):
        raise ValueError(f"{path}: aisle ids must be unique")

    cameras = {}
    for c in raw.get("cameras", []):
        cal = c["calibration"]
        cameras[c["id"]] = Camera(
            id=c["id"],
            source=c.get("source", ""),
            homography=Homography.from_points(cal["image"], cal["floor"]),
        )

    return StoreConfig(
        name=store.get("name", "Store"),
        width_m=float(store["width_m"]),
        depth_m=float(store["depth_m"]),
        aisles=aisles,
        cameras=cameras,
        processing=Processing(**raw.get("processing", {})),
        path=path,
        fixtures=store.get("fixtures", []),
        entrance=store.get("entrance"),
    )
