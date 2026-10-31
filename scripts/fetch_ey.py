"""Fetch the two industry-specific 'must / must-not include' notices from the
Executive Yuan website (行政院全球資訊網, www.ey.gov.tw).

Usage: python scripts/fetch_ey.py [--force]

Terms check (done 2026-10-31, re-check before large changes):
- 政府網站資料開放宣告 (https://www.ey.gov.tw/Page/2EADDBFEDDB6357E) licenses all
  content under the Government Open Data License v1.0: free reuse, adaptation
  and redistribution, attribution required, no malicious alteration.
- robots.txt only disallows /Upload and one .ascx path; this script verifies
  at run time that every URL it requests is allowed.
- Requests are spaced >= 3 s apart and only ~6 requests are made in total.
"""
from __future__ import annotations

import sys
import urllib.request
import urllib.robotparser

from common import RAW, USER_AGENT, download, load_manifest, now_iso, rel, save_manifest, sha256_file

BASE = "https://www.ey.gov.tw"
SOURCES = {
    # key: (url, local file)
    "ey_gift_page": (f"{BASE}/Page/DFB720D019CCCB0A/5486b053-67e1-47e8-90e4-a9a59529dc87", "ey/gift.html"),
    "ey_gift_odt": (f"{BASE}/File/D9A65CE181F97ACB?A=C", "ey/gift.odt"),
    "ey_gym_page": (f"{BASE}/Page/DFB720D019CCCB0A/a8a9e88e-6f7a-49bc-a4d7-d990a1d9840d", "ey/gym.html"),
    "ey_gym_pdf": (f"{BASE}/File/11A27ED8536A6030?A=C", "ey/gym.pdf"),
}


def robots_allows(urls: list[str]) -> None:
    req = urllib.request.Request(f"{BASE}/robots.txt", headers={"User-Agent": USER_AGENT})
    text = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
    rp = urllib.robotparser.RobotFileParser()
    rp.parse(text.splitlines())
    for u in urls:
        if not rp.can_fetch(USER_AGENT, u):
            sys.exit(f"robots.txt disallows {u}; stopping")


def main(force: bool = False) -> None:
    robots_allows([u for u, _ in SOURCES.values()])
    manifest = load_manifest()
    for key, (url, local) in SOURCES.items():
        dest = RAW / local
        if dest.exists() and key in manifest and not force:
            print(f"cached: {local}")
            continue
        print(f"downloading {url}")
        download(url, dest)
        manifest[key] = {
            "source_url": url,
            "raw_file": rel(dest),
            "sha256": sha256_file(dest),
            "bytes": dest.stat().st_size,
            "fetched_at": now_iso(),
        }
    save_manifest(manifest)


if __name__ == "__main__":
    main(force="--force" in sys.argv)
