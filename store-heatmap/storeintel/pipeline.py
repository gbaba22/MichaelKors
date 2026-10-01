"""Recorder (camera -> 5-minute segment files) and worker (segment files -> observations).

The two run independently, which is what gives the 10-15 minute lag budget its slack: the
recorder never blocks on inference, and the worker can fall behind at peak and catch up later.
"""
from __future__ import annotations

import logging
import subprocess
import threading
import time
from pathlib import Path

from . import db
from .config import StoreConfig
from .processor import Detector, process_segment, segment_start_time

log = logging.getLogger(__name__)


def ffmpeg_command(source: str, out_dir: Path, camera_id: str, segment_seconds: int) -> list[str]:
    pattern = str(out_dir / f"{camera_id}_%Y%m%dT%H%M%S.mp4")
    if source.startswith(("rtsp://", "rtsps://")):
        # Most IP cameras already send H.264, so segments are a stream copy (near-zero CPU).
        input_args = ["-rtsp_transport", "tcp", "-i", source]
        codec_args = ["-c:v", "copy"]
    else:
        # A local file or webcam: replay in real time on a loop so it behaves like a camera.
        input_args = ["-re", "-stream_loop", "-1", "-i", source]
        codec_args = ["-c:v", "libx264", "-preset", "veryfast", "-g", "50"]
    return [
        "ffmpeg", "-hide_banner", "-loglevel", "warning", *input_args, "-an", *codec_args,
        "-f", "segment", "-segment_time", str(segment_seconds), "-reset_timestamps", "1",
        "-strftime", "1", pattern,
    ]


def record(cfg: StoreConfig, segments_dir: Path) -> None:
    """Runs one ffmpeg segmenter per camera, restarting any that exit."""
    seconds = cfg.processing.segment_minutes * 60

    def run(camera_id: str, source: str) -> None:
        out_dir = segments_dir / camera_id
        out_dir.mkdir(parents=True, exist_ok=True)
        while True:
            cmd = ffmpeg_command(source, out_dir, camera_id, seconds)
            log.info("recording %s -> %s", camera_id, out_dir)
            code = subprocess.call(cmd)
            log.warning("ffmpeg for %s exited (%s); restarting in 10s", camera_id, code)
            time.sleep(10)

    threads = [
        threading.Thread(target=run, args=(c.id, c.source), daemon=True)
        for c in cfg.cameras.values()
        if c.source
    ]
    if not threads:
        raise SystemExit("no cameras with a 'source' in the config")
    for t in threads:
        t.start()
    for t in threads:
        t.join()


def completed_segments(cfg: StoreConfig, segments_dir: Path, camera_id: str) -> list[Path]:
    """Segments ffmpeg has finished writing: every file except the newest, unless that one has
    gone quiet for longer than a segment (camera dropped)."""
    files = sorted((segments_dir / camera_id).glob(f"{camera_id}_*.mp4"))
    if not files:
        return []
    stale_after = cfg.processing.segment_minutes * 60 + 60
    newest = files[-1]
    if time.time() - newest.stat().st_mtime < stale_after:
        files = files[:-1]
    return files


def work(cfg: StoreConfig, conn, segments_dir: Path, once: bool = False, poll_seconds: int = 30) -> None:
    detector = Detector(cfg.processing.model, cfg.processing.confidence)
    while True:
        did_work = False
        for camera_id in cfg.cameras:
            for path in completed_segments(cfg, segments_dir, camera_id):
                if db.segment_seen(conn, str(path)):
                    continue
                started_at = segment_start_time(path) or path.stat().st_mtime
                try:
                    process_segment(cfg, conn, detector, camera_id, path, started_at)
                except Exception as exc:  # keep going; one corrupt file must not stall the store
                    log.exception("failed on %s", path)
                    with conn:
                        db.mark_segment(conn, str(path), camera_id, started_at, "failed", str(exc))
                did_work = True
        if once:
            return
        if not did_work:
            time.sleep(poll_seconds)
