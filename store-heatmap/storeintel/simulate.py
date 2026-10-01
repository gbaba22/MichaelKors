"""Synthetic shoppers, so the dashboard can be demoed before any camera is connected.

Writes the same observation rows the video pipeline produces. Shoppers walk the store's
corridors (front cross-aisle, back cross-aisle and the vertical aisles between them), stop in
the zones on their "list", and leave through checkout. Zone popularity shifts through the day
(breakfast in the morning, beverages and frozen in the evening) so the timeline has something
to show.
"""
from __future__ import annotations

import heapq
import logging
import math
import random
import time
from datetime import datetime

import numpy as np

from . import db
from .config import StoreConfig
from .geometry import find_aisle

log = logging.getLogger(__name__)

CAMERA = "sim"
SAMPLE_S = 1.0
WALK_SPEED = 1.1      # m/s
BROWSE_SPEED = 0.35   # m/s while browsing inside a zone
POSITION_NOISE = 0.15  # metres, roughly what foot-point projection jitter looks like

# Relative arrivals per hour of day (store open 08:00-22:00).
HOURLY_TRAFFIC = {8: .35, 9: .55, 10: .7, 11: .85, 12: 1.0, 13: .9, 14: .65, 15: .6,
                  16: .75, 17: 1.0, 18: 1.1, 19: .85, 20: .55, 21: .3}

# Keyword -> (base popularity, {hour range: multiplier}); matched against zone names.
POPULARITY = [
    ("produce", 1.6, {}),
    ("bakery", 1.1, {(8, 11): 2.2}),
    ("snack", 0.9, {(15, 22): 1.6}),
    ("beverage", 1.0, {(16, 22): 1.9}),
    ("household", 0.45, {}),
    ("personal", 0.4, {}),
    ("frozen", 0.7, {(17, 22): 1.7}),
    ("dairy", 1.4, {(8, 11): 1.4}),
    ("meat", 0.9, {(16, 20): 1.6}),
    ("promo", 0.8, {}),
]


def _popularity(name: str, hour: int) -> float:
    name = name.lower()
    for key, base, boosts in POPULARITY:
        if key in name:
            mult = next((m for (h0, h1), m in boosts.items() if h0 <= hour < h1), 1.0)
            return base * mult
    return 0.6


class Walkways:
    """Corridor graph: front and back cross-aisles joined by every tall, narrow zone."""

    def __init__(self, cfg: StoreConfig):
        verticals = []
        for a in cfg.aisles:
            (x0, y0), (x1, y1) = a.polygon.min(axis=0), a.polygon.max(axis=0)
            if (y1 - y0) > 2 * (x1 - x0):
                verticals.append(((x0 + x1) / 2, y0, y1))
        self.nodes: list[tuple[float, float]] = []
        self.edges: dict[int, list[int]] = {}
        if not verticals:
            return
        verticals.sort()
        y_front = min(v[1] for v in verticals) - 0.5
        y_back = max(v[2] for v in verticals) + 0.4
        front, back = [], []
        for cx, _, _ in verticals:
            front.append(self._add((cx, y_front)))
            back.append(self._add((cx, y_back)))
            self._link(front[-1], back[-1])
        for row in (front, back):
            for a, b in zip(row, row[1:]):
                self._link(a, b)

    def _add(self, p) -> int:
        self.nodes.append(p)
        self.edges[len(self.nodes) - 1] = []
        return len(self.nodes) - 1

    def _link(self, a: int, b: int) -> None:
        self.edges[a].append(b)
        self.edges[b].append(a)

    def _nearest(self, p) -> int:
        return min(range(len(self.nodes)), key=lambda i: math.dist(self.nodes[i], p))

    def route(self, start, end) -> list[tuple[float, float]]:
        if not self.nodes:
            return [end]
        s, e = self._nearest(start), self._nearest(end)
        dist, prev, heap = {s: 0.0}, {}, [(0.0, s)]
        while heap:
            d, n = heapq.heappop(heap)
            if n == e:
                break
            for m in self.edges[n]:
                nd = d + math.dist(self.nodes[n], self.nodes[m])
                if nd < dist.get(m, math.inf):
                    dist[m], prev[m] = nd, n
                    heapq.heappush(heap, (nd, m))
        path, n = [e], e
        while n != s:
            n = prev[n]
            path.append(n)
        return [self.nodes[i] for i in reversed(path)] + [end]


def _point_in(polygon: np.ndarray, rng: random.Random, inset: float = 0.3):
    (x0, y0), (x1, y1) = polygon.min(axis=0), polygon.max(axis=0)
    return (rng.uniform(x0 + inset, x1 - inset), rng.uniform(y0 + inset, y1 - inset))


class Shopper:
    def __init__(self, track_id: int, t: float, pos, rng: random.Random):
        self.track_id, self.t, self.pos, self.rng = track_id, t, pos, rng
        self.samples: list[tuple[float, float, float]] = []

    def _emit(self, x, y):
        self.samples.append((self.t, x + self.rng.gauss(0, POSITION_NOISE), y + self.rng.gauss(0, POSITION_NOISE)))

    def walk_to(self, target, speed: float):
        x0, y0 = self.pos
        x1, y1 = target
        steps = max(1, int(math.dist(self.pos, target) / (speed * SAMPLE_S)))
        for i in range(1, steps + 1):
            self.t += SAMPLE_S
            self._emit(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps)
        self.pos = target

    def pause(self, seconds: float):
        for _ in range(int(seconds / SAMPLE_S)):
            self.t += SAMPLE_S
            self._emit(*self.pos)


def trading_window(now: float, hours: float | None) -> tuple[float, float]:
    """Today's trading day up to now; before opening, yesterday's full day."""
    if hours:
        return now - hours * 3600, now
    day = datetime.fromtimestamp(now).replace(minute=0, second=0, microsecond=0)
    open_h, close_h = min(HOURLY_TRAFFIC), max(HOURLY_TRAFFIC) + 1
    opening = day.replace(hour=open_h).timestamp()
    if now < opening + 3600:
        opening -= 86400
        return opening, opening + (close_h - open_h) * 3600
    return opening, min(now, opening + (close_h - open_h) * 3600)


def simulate(cfg: StoreConfig, conn, hours: float | None, peak_per_hour: float, seed: int, reset: bool) -> int:
    rng = random.Random(seed)
    walk = Walkways(cfg)
    start, end = trading_window(time.time(), hours)
    entrance = tuple(cfg.entrance or (cfg.width_m / 2, 0.3))
    checkout = next((a for a in cfg.aisles if "checkout" in a.name.lower()), None)
    shoppable = [a for a in cfg.aisles if a is not checkout]
    segment = f"sim-{int(end)}"

    if reset:
        with conn:
            conn.execute("DELETE FROM observations WHERE camera = ?", (CAMERA,))

    # Arrivals: a Poisson process whose rate follows HOURLY_TRAFFIC.
    t, track_id, total = start, 0, 0
    batch: list[tuple] = []
    while t < end:
        hour = datetime.fromtimestamp(t).hour
        rate = peak_per_hour * HOURLY_TRAFFIC.get(hour, 0.05) / 3600
        t += rng.expovariate(rate)
        if t >= end:
            break
        track_id += 1
        s = Shopper(track_id, t, entrance, rng)

        weights = [_popularity(a.name, hour) for a in shoppable]
        n_zones = min(len(shoppable), max(1, int(rng.gauss(3.5, 1.5))))
        picks = []
        pool = list(zip(shoppable, weights))
        for _ in range(n_zones):
            a = rng.choices([p[0] for p in pool], [p[1] for p in pool])[0]
            picks.append(a)
            pool = [p for p in pool if p[0] is not a]
        # Visit in walking order (front-to-back, left-to-right), like a real loop round the store.
        picks.sort(key=lambda a: (a.polygon[:, 0].mean() // 6, a.polygon[:, 1].mean()))
        if checkout is not None and rng.random() < 0.85:
            picks.append(checkout)

        for a in picks:
            target = _point_in(a.polygon, rng)
            for waypoint in walk.route(s.pos, target):
                s.walk_to(waypoint, WALK_SPEED)
            # Browse: a few slow moves with pauses; longer for popular zones.
            for _ in range(rng.randint(1, 3)):
                s.pause(rng.expovariate(1 / (6 + 8 * _popularity(a.name, hour))))
                s.walk_to(_point_in(a.polygon, rng), BROWSE_SPEED)
        for waypoint in walk.route(s.pos, entrance):
            s.walk_to(waypoint, WALK_SPEED)

        for ts, x, y in s.samples:
            if ts > end:
                break
            batch.append((CAMERA, segment, track_id, ts, x, y, find_aisle(x, y, cfg.aisles, CAMERA), SAMPLE_S))
        if len(batch) > 50_000:
            with conn:
                db.insert_observations(conn, batch)
            total += len(batch)
            batch = []
    with conn:
        db.insert_observations(conn, batch)
    total += len(batch)
    log.info("simulated %d shoppers, %d observations, %s -> %s", track_id, total,
             datetime.fromtimestamp(start), datetime.fromtimestamp(end))
    return total
