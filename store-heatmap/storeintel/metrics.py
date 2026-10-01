"""Aisle-level metrics computed from observations over a time window."""
from __future__ import annotations

# A visit needs at least this much time in the aisle; filters out tracker blips and ID switches.
MIN_VISIT_SECONDS = 2.0
# A visit this long counts as a "stop" (shopper engaged with the shelf, not just walking through).
STOP_SECONDS = 10.0

VISITS_SQL = """
WITH visits AS (
    SELECT aisle, camera, segment, track_id, SUM(weight) AS dwell
    FROM observations
    WHERE ts >= :start AND ts < :end AND aisle IS NOT NULL
    GROUP BY aisle, camera, segment, track_id
    HAVING dwell >= :min_visit
)
SELECT aisle,
       COUNT(*)                                 AS visits,
       SUM(dwell)                               AS dwell_s,
       SUM(CASE WHEN dwell >= :stop THEN 1 END) AS stops
FROM visits
GROUP BY aisle
"""


def data_range(conn) -> dict:
    row = conn.execute("SELECT MIN(ts) AS start, MAX(ts) AS end FROM observations").fetchone()
    return {"start": row["start"], "end": row["end"]}


def aisle_metrics(conn, start: float, end: float) -> dict:
    params = {"start": start, "end": end, "min_visit": MIN_VISIT_SECONDS, "stop": STOP_SECONDS}
    aisles = {}
    for r in conn.execute(VISITS_SQL, params):
        visits = r["visits"]
        stops = r["stops"] or 0
        aisles[r["aisle"]] = {
            "visits": visits,
            "dwell_s": round(r["dwell_s"], 1),
            "avg_dwell_s": round(r["dwell_s"] / visits, 1),
            "stops": stops,
            "stop_rate": round(stops / visits, 3),
        }
    shoppers = conn.execute(
        "SELECT COUNT(*) FROM (SELECT DISTINCT camera, segment, track_id FROM observations "
        "WHERE ts >= ? AND ts < ?)",
        (start, end),
    ).fetchone()[0]
    return {"start": start, "end": end, "shoppers": shoppers, "aisles": aisles}


def grid(conn, start: float, end: float, cell_m: float) -> dict:
    """Seconds of presence per floor cell — the continuous heatmap."""
    rows = conn.execute(
        "SELECT CAST(x / :c AS INTEGER) AS gx, CAST(y / :c AS INTEGER) AS gy, SUM(weight) AS s "
        "FROM observations WHERE ts >= :start AND ts < :end GROUP BY gx, gy",
        {"c": cell_m, "start": start, "end": end},
    ).fetchall()
    return {"cell_m": cell_m, "cells": [[r["gx"], r["gy"], round(r["s"], 1)] for r in rows]}


def timeseries(conn, start: float, end: float, bucket_s: int) -> dict:
    """Dwell seconds per aisle per time bucket, for the sparklines and the timeline."""
    rows = conn.execute(
        "SELECT aisle, CAST((ts - :start) / :b AS INTEGER) AS i, SUM(weight) AS s "
        "FROM observations WHERE ts >= :start AND ts < :end AND aisle IS NOT NULL "
        "GROUP BY aisle, i",
        {"start": start, "end": end, "b": bucket_s},
    ).fetchall()
    n = max(1, int((end - start + bucket_s - 1) // bucket_s))
    series: dict[str, list[float]] = {}
    for r in rows:
        if 0 <= r["i"] < n:
            series.setdefault(r["aisle"], [0.0] * n)[r["i"]] = round(r["s"], 1)
    return {"start": start, "bucket_s": bucket_s, "buckets": n, "series": series}
