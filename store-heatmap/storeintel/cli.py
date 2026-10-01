"""Command line: python -m storeintel <command> --help"""
from __future__ import annotations

import argparse
import logging
from datetime import datetime
from pathlib import Path

from . import db
from .config import load_config


def main() -> None:
    p = argparse.ArgumentParser(prog="storeintel", description=__doc__)
    p.add_argument("--config", default="config/store.example.json")
    p.add_argument("--db", default="data/store.db")
    sub = p.add_subparsers(dest="command", required=True)

    s = sub.add_parser("simulate", help="fill the database with synthetic shoppers")
    s.add_argument("--hours", type=float, help="simulate the last N hours (default: today's trading day so far)")
    s.add_argument("--peak-per-hour", type=float, default=90, help="shoppers arriving per hour at peak")
    s.add_argument("--seed", type=int, default=7)
    s.add_argument("--keep", action="store_true", help="keep earlier simulated data")

    s = sub.add_parser("process", help="process one video file now")
    s.add_argument("--camera", required=True)
    s.add_argument("--video", required=True, type=Path)
    s.add_argument("--start", help="wall-clock time of the first frame, e.g. 2026-10-01T09:00:00 "
                                   "(default: from the file name, else the file's mtime)")

    s = sub.add_parser("record", help="record every camera into fixed-length segment files")
    s.add_argument("--segments", default="data/segments", type=Path)

    s = sub.add_parser("worker", help="process segment files as they complete")
    s.add_argument("--segments", default="data/segments", type=Path)
    s.add_argument("--once", action="store_true", help="process what is ready, then exit")

    s = sub.add_parser("calibrate", help="save a camera frame with the aisles drawn on it")
    s.add_argument("--camera", required=True)
    s.add_argument("--out", default="data/calibration", type=Path)

    s = sub.add_parser("serve", help="run the dashboard")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8000)

    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    cfg = load_config(args.config)

    if args.command == "simulate":
        from .simulate import simulate

        with db.connect(args.db) as conn:
            simulate(cfg, conn, args.hours, args.peak_per_hour, args.seed, reset=not args.keep)

    elif args.command == "process":
        from .processor import Detector, process_segment, segment_start_time

        if args.camera not in cfg.cameras:
            raise SystemExit(f"unknown camera {args.camera!r}; config has {list(cfg.cameras)}")
        if args.start:
            started_at = datetime.fromisoformat(args.start).timestamp()
        else:
            started_at = segment_start_time(args.video) or args.video.stat().st_mtime
        detector = Detector(cfg.processing.model, cfg.processing.confidence)
        with db.connect(args.db) as conn:
            process_segment(cfg, conn, detector, args.camera, args.video, started_at)

    elif args.command == "record":
        from .pipeline import record

        record(cfg, args.segments)

    elif args.command == "worker":
        from .pipeline import work

        work(cfg, db.connect(args.db), args.segments, once=args.once)

    elif args.command == "calibrate":
        from .calibrate import calibrate

        raw, overlay = calibrate(cfg, args.camera, args.out)
        print(f"frame:   {raw}\noverlay: {overlay}")

    elif args.command == "serve":
        import uvicorn

        from .server import create_app

        uvicorn.run(create_app(cfg, args.db), host=args.host, port=args.port)
