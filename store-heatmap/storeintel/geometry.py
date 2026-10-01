"""Camera-pixel to floor-plan mapping and aisle lookup."""
from __future__ import annotations

import cv2
import numpy as np


class Homography:
    """Maps image pixels to floor-plan metres using 4+ reference points on the floor.

    Pick points that lie on the floor (aisle corners, floor tiles, shelf bases) — a homography
    is only valid for the ground plane, which is why we project a person's feet, not their box.
    """

    def __init__(self, matrix: np.ndarray):
        self.matrix = matrix
        self.inverse = np.linalg.inv(matrix)

    @classmethod
    def from_points(cls, image_pts, floor_pts) -> "Homography":
        src = np.asarray(image_pts, dtype=np.float32)
        dst = np.asarray(floor_pts, dtype=np.float32)
        if len(src) < 4 or len(src) != len(dst):
            raise ValueError("calibration needs >= 4 matching image/floor points")
        matrix, _ = cv2.findHomography(src, dst)
        if matrix is None:
            raise ValueError("calibration points are degenerate (collinear?)")
        return cls(matrix)

    def to_floor(self, pts: np.ndarray) -> np.ndarray:
        if len(pts) == 0:
            return np.empty((0, 2))
        return cv2.perspectiveTransform(pts.reshape(-1, 1, 2).astype(np.float32), self.matrix).reshape(-1, 2)

    def to_image(self, pts: np.ndarray) -> np.ndarray:
        if len(pts) == 0:
            return np.empty((0, 2))
        return cv2.perspectiveTransform(pts.reshape(-1, 1, 2).astype(np.float32), self.inverse).reshape(-1, 2)


def point_in_polygon(x: float, y: float, polygon: np.ndarray) -> bool:
    return cv2.pointPolygonTest(polygon.astype(np.float32), (float(x), float(y)), False) >= 0


def find_aisle(x: float, y: float, aisles, camera_id: str | None = None) -> str | None:
    for aisle in aisles:
        if aisle.cameras and camera_id not in aisle.cameras:
            continue
        if point_in_polygon(x, y, aisle.polygon):
            return aisle.id
    return None
