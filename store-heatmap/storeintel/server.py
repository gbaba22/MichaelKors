"""Dashboard API + static page."""
from __future__ import annotations

import time
from pathlib import Path

from fastapi import FastAPI, Query
from fastapi.responses import FileResponse

from . import db, metrics
from .config import StoreConfig

STATIC = Path(__file__).resolve().parent.parent / "static"


def create_app(cfg: StoreConfig, db_path: str) -> FastAPI:
    app = FastAPI(title="Store heatmap")
    conn = db.connect(db_path)
    conn.close()  # schema created; each request opens its own connection (thread safety)

    def window(start: float | None, end: float | None):
        with db.connect(db_path) as c:
            rng = metrics.data_range(c)
        end = end if end is not None else (rng["end"] or time.time()) + 1
        start = start if start is not None else (rng["start"] or end - 3600)
        return start, end

    @app.get("/")
    def index():
        return FileResponse(STATIC / "index.html")

    @app.get("/api/layout")
    def layout():
        return cfg.public_layout()

    @app.get("/api/range")
    def data_range():
        with db.connect(db_path) as c:
            rng = metrics.data_range(c)
            last = c.execute("SELECT MAX(processed_at) FROM segments WHERE status = 'done'").fetchone()[0]
        return {**rng, "now": time.time(), "last_processed": last}

    @app.get("/api/aisles")
    def aisles(start: float | None = None, end: float | None = None):
        start, end = window(start, end)
        with db.connect(db_path) as c:
            return metrics.aisle_metrics(c, start, end)

    @app.get("/api/grid")
    def grid(start: float | None = None, end: float | None = None):
        start, end = window(start, end)
        with db.connect(db_path) as c:
            return metrics.grid(c, start, end, cfg.processing.grid_cell_m)

    @app.get("/api/timeseries")
    def timeseries(start: float | None = None, end: float | None = None,
                   bucket: int = Query(900, ge=60)):
        start, end = window(start, end)
        with db.connect(db_path) as c:
            return metrics.timeseries(c, start, end, bucket)

    return app
