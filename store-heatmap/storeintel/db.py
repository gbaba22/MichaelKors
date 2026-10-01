"""SQLite storage. Only floor positions are stored — never images or faces."""
from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS observations (
    id        INTEGER PRIMARY KEY,
    camera    TEXT NOT NULL,
    segment   TEXT NOT NULL,      -- track ids are only unique within a segment
    track_id  INTEGER NOT NULL,
    ts        REAL NOT NULL,      -- unix seconds
    x         REAL NOT NULL,      -- floor metres
    y         REAL NOT NULL,
    aisle     TEXT,               -- NULL = walkway / outside any aisle
    weight    REAL NOT NULL       -- seconds this observation represents (1 / sample_fps)
);
CREATE INDEX IF NOT EXISTS idx_obs_ts ON observations(ts);

CREATE TABLE IF NOT EXISTS segments (
    path         TEXT PRIMARY KEY,
    camera       TEXT NOT NULL,
    started_at   REAL NOT NULL,
    processed_at REAL,
    status       TEXT NOT NULL,   -- done | failed
    detail       TEXT
);
"""


def connect(path: str | Path) -> sqlite3.Connection:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA)
    return conn


def insert_observations(conn: sqlite3.Connection, rows: list[tuple]) -> None:
    conn.executemany(
        "INSERT INTO observations (camera, segment, track_id, ts, x, y, aisle, weight) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        rows,
    )


def mark_segment(conn, path: str, camera: str, started_at: float, status: str, detail: str = "") -> None:
    conn.execute(
        "INSERT OR REPLACE INTO segments (path, camera, started_at, processed_at, status, detail) "
        "VALUES (?, ?, ?, strftime('%s','now'), ?, ?)",
        (path, camera, started_at, status, detail),
    )


def segment_seen(conn, path: str) -> bool:
    """True once a segment has been processed or has failed (failures are not retried)."""
    return conn.execute("SELECT 1 FROM segments WHERE path = ?", (path,)).fetchone() is not None
