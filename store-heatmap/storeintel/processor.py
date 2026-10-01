"""Turns a recorded video segment into floor-plan observations.

Per sampled frame: detect + track people (YOLO + ByteTrack), take each person's foot point
(bottom-centre of the box), project it onto the floor plan with the camera's homography and
look up which aisle it falls in.
"""
from __future__ import annotations

import logging
import re
import time
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

from . import db
from .config import StoreConfig
from .geometry import find_aisle

log = logging.getLogger(__name__)

# Segment files are named <camera>_<YYYYmmddTHHMMSS>.mp4 by the recorder.
SEGMENT_TS = re.compile(r"_(\d{8}T\d{6})\.\w+$")
FLOOR_MARGIN_M = 0.5


def segment_start_time(path: Path) -> float | None:
    m = SEGMENT_TS.search(path.name)
    if not m:
        return None
    return datetime.strptime(m.group(1), "%Y%m%dT%H%M%S").timestamp()


class Detector:
    """Wraps a YOLO model; the tracker state is reset for every segment."""

    def __init__(self, model_name: str, confidence: float):
        from ultralytics import YOLO  # imported lazily so the dashboard runs without torch

        self.model = YOLO(model_name)
        self.confidence = confidence

    def reset(self) -> None:
        predictor = getattr(self.model, "predictor", None)
        for tracker in getattr(predictor, "trackers", None) or []:
            tracker.reset()

    def track(self, frame: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Returns (track_ids, foot_points_px) for people in the frame."""
        result = self.model.track(
            frame,
            persist=True,
            classes=[0],  # COCO "person"
            conf=self.confidence,
            tracker="bytetrack.yaml",
            verbose=False,
        )[0]
        boxes = result.boxes
        if boxes is None or boxes.id is None:
            return np.empty(0, dtype=int), np.empty((0, 2))
        xyxy = boxes.xyxy.cpu().numpy()
        ids = boxes.id.cpu().numpy().astype(int)
        feet = np.stack([(xyxy[:, 0] + xyxy[:, 2]) / 2, xyxy[:, 3]], axis=1)
        return ids, feet


def process_segment(
    cfg: StoreConfig,
    conn,
    detector: Detector,
    camera_id: str,
    video_path: Path,
    started_at: float,
) -> int:
    """Processes one video file; returns the number of observations stored."""
    camera = cfg.cameras[camera_id]
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"cannot open {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    step = max(1, round(fps / cfg.processing.sample_fps))
    weight = step / fps
    segment = video_path.name
    detector.reset()

    rows: list[tuple] = []
    frame_idx = 0
    t0 = time.time()
    while True:
        if frame_idx % step:
            if not cap.grab():
                break
            frame_idx += 1
            continue
        ok, frame = cap.read()
        if not ok:
            break
        ts = started_at + frame_idx / fps
        frame_idx += 1

        ids, feet = detector.track(frame)
        if len(ids) == 0:
            continue
        floor = camera.homography.to_floor(feet)
        for track_id, (x, y) in zip(ids, floor):
            if not (-FLOOR_MARGIN_M <= x <= cfg.width_m + FLOOR_MARGIN_M
                    and -FLOOR_MARGIN_M <= y <= cfg.depth_m + FLOOR_MARGIN_M):
                continue  # outside the mapped floor (e.g. someone standing at the door)
            aisle = find_aisle(x, y, cfg.aisles, camera_id)
            rows.append((camera_id, segment, int(track_id), ts, float(x), float(y), aisle, weight))
    cap.release()

    with conn:
        conn.execute("DELETE FROM observations WHERE camera = ? AND segment = ?", (camera_id, segment))
        db.insert_observations(conn, rows)
        db.mark_segment(conn, str(video_path), camera_id, started_at, "done", f"{len(rows)} observations")
    log.info(
        "%s: %d frames sampled, %d observations in %.1fs",
        segment, frame_idx // step, len(rows), time.time() - t0,
    )
    return len(rows)
