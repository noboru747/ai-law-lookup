"""Shared helpers for the Phase 1 data pipeline."""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

if hasattr(sys.stdout, "reconfigure"):      # Windows consoles default to a legacy code page
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
CACHE = RAW / "_cache"          # large re-downloadable files, git-ignored
LAWS = ROOT / "data" / "laws"
MANIFEST = RAW / "manifest.json"

# Identify ourselves honestly to the servers we contact.
USER_AGENT = "ai-law-lookup/0.1 (portfolio project; https://github.com/noboru747/ai-law-lookup)"
MIN_INTERVAL_SECONDS = 3.0      # minimum gap between two requests to the same host

_last_request: dict[str, float] = {}


def now_iso() -> str:
    """Local time with offset, e.g. 2026-10-31T21:05:00+08:00."""
    return _dt.datetime.now().astimezone().replace(microsecond=0).isoformat()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def polite_wait(url: str) -> None:
    host = urlparse(url).netloc
    last = _last_request.get(host)
    if last is not None:
        wait = MIN_INTERVAL_SECONDS - (time.monotonic() - last)
        if wait > 0:
            time.sleep(wait)
    _last_request[host] = time.monotonic()


def download(url: str, dest: Path) -> None:
    """Download with curl, TLS verification ON.

    Python 3.13+ rejects the MOJ certificate chain ("Missing Subject Key
    Identifier") under its strict default verification, so we shell out to
    curl, which validates the chain with the OS trust store. We never
    disable verification.
    """
    polite_wait(url)
    dest.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["curl", "--fail", "--silent", "--show-error", "--location",
         "--retry", "2", "--max-time", "300", "-A", USER_AGENT,
         "-o", str(dest), url],
        check=True,
    )


def load_manifest() -> dict:
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text(encoding="utf-8"))
    return {}


def save_manifest(m: dict) -> None:
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(m, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()
