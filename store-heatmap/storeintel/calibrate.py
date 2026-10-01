"""Calibration check: draws the floor plan's aisles onto a camera frame.

If the projected outlines sit on the real aisles in the image, the homography is right.
"""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from .config import StoreConfig


def grab_frame(source: str, skip: int = 30) -> np.ndarray:
    cap = cv2.VideoCapture(source)
    frame = None
    for _ in range(skip):  # skip the first frames; IP cameras often start on a grey keyframe
        ok, f = cap.read()
        if not ok:
            break
        frame = f
    cap.release()
    if frame is None:
        raise SystemExit(f"could not read a frame from {source}")
    return frame


def draw_overlay(cfg: StoreConfig, camera_id: str, frame: np.ndarray) -> np.ndarray:
    h = cfg.cameras[camera_id].homography
    out = frame.copy()
    for aisle in cfg.aisles:
        if aisle.cameras and camera_id not in aisle.cameras:
            continue
        # Densify edges so the projected outline follows perspective correctly.
        pts = []
        poly = np.vstack([aisle.polygon, aisle.polygon[:1]])
        for a, b in zip(poly, poly[1:]):
            pts.extend(a + (b - a) * t for t in np.linspace(0, 1, 20, endpoint=False))
        img = h.to_image(np.asarray(pts))
        # Keep only points in front of the camera / near the frame.
        H, W = out.shape[:2]
        ok = (img[:, 0] > -W) & (img[:, 0] < 2 * W) & (img[:, 1] > -H) & (img[:, 1] < 2 * H)
        if ok.sum() < 3:
            continue
        cv2.polylines(out, [img[ok].astype(np.int32)], True, (0, 200, 255), 2)
        cx, cy = h.to_image(aisle.polygon.mean(axis=0, keepdims=True))[0]
        cv2.putText(out, aisle.id, (int(cx), int(cy)), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 200, 255), 2)
    return out


def calibrate(cfg: StoreConfig, camera_id: str, out_dir: Path) -> tuple[Path, Path]:
    camera = cfg.cameras[camera_id]
    frame = grab_frame(camera.source)
    out_dir.mkdir(parents=True, exist_ok=True)
    raw = out_dir / f"{camera_id}-frame.png"
    overlay = out_dir / f"{camera_id}-overlay.png"
    cv2.imwrite(str(raw), frame)
    cv2.imwrite(str(overlay), draw_overlay(cfg, camera_id, frame))
    return raw, overlay
