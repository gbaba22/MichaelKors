import numpy as np

from storeintel import db, metrics
from storeintel.config import load_config
from storeintel.geometry import Homography, find_aisle
from storeintel.processor import segment_start_time
from storeintel.simulate import simulate


def test_homography_round_trip():
    h = Homography.from_points([[0, 0], [100, 0], [100, 50], [0, 50]], [[0, 0], [10, 0], [10, 5], [0, 5]])
    pts = np.array([[50.0, 25.0], [10.0, 40.0]])
    assert np.allclose(h.to_floor(pts), [[5, 2.5], [1, 4]], atol=1e-4)
    assert np.allclose(h.to_image(h.to_floor(pts)), pts, atol=1e-3)


def test_aisle_lookup_and_camera_ownership():
    cfg = load_config("config/store.example.json")
    assert find_aisle(3, 10, cfg.aisles) == "A01"
    assert find_aisle(6, 10, cfg.aisles) is None  # inside a shelf
    cfg.aisles[0].cameras = ["cam-back"]
    assert find_aisle(3, 10, cfg.aisles, "cam-front") is None


def test_segment_name_timestamp():
    from pathlib import Path
    assert segment_start_time(Path("cam1_20261001T090000.mp4")) is not None
    assert segment_start_time(Path("export.mp4")) is None


def test_metrics_from_known_observations(tmp_path):
    conn = db.connect(tmp_path / "t.db")
    # Track 1: 12 s in A01 (a stop). Track 2: 3 s in A01 (a pass). Track 3: 1 s blip (not a visit).
    rows = [("c", "s", 1, 100 + i, 3, 10, "A01", 1.0) for i in range(12)]
    rows += [("c", "s", 2, 100 + i, 3, 10, "A01", 1.0) for i in range(3)]
    rows += [("c", "s", 3, 100, 3, 10, "A01", 1.0)]
    db.insert_observations(conn, rows)
    a = metrics.aisle_metrics(conn, 0, 1000)["aisles"]["A01"]
    assert a["visits"] == 2 and a["stops"] == 1 and a["dwell_s"] == 15


def test_simulator_fills_every_aisle(tmp_path):
    cfg = load_config("config/store.example.json")
    conn = db.connect(tmp_path / "t.db")
    simulate(cfg, conn, hours=None, peak_per_hour=120, seed=1, reset=True)  # a full trading day
    r = metrics.data_range(conn)
    got = metrics.aisle_metrics(conn, r["start"], r["end"] + 1)["aisles"]
    assert set(got) == {a.id for a in cfg.aisles}
