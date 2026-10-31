"""Download the national law database (全國法規資料庫) Open API dumps and keep
the original JSON object of each target law under data/raw/moj/.

Usage: python scripts/fetch_moj.py [--force]

Notes
- The Open API (https://law.moj.gov.tw/api/) is the site's documented
  programmatic interface. The site's robots.txt governs HTML crawling and is
  not applied to the API; we only call the two documented dump endpoints.
- Each dump is downloaded at most once (cached in data/raw/_cache/, which is
  git-ignored). Use --force to re-download.
- The two ZIPs are large (6 MB and 26 MB); the per-law raw excerpts written
  here are what the build and the validator work from.
"""
from __future__ import annotations

import json
import sys
import zipfile

from common import CACHE, RAW, download, load_manifest, now_iso, rel, save_manifest, sha256_file

DUMPS = {
    "law": ("https://law.moj.gov.tw/api/ch/law/json", "ChLaw.json"),
    "order": ("https://law.moj.gov.tw/api/ch/order/json", "ChOrder.json"),
}

# pcode -> (dump, official name that MUST match)
TARGETS = {
    "J0170001": ("law", "消費者保護法"),
    "J0170002": ("order", "消費者保護法施行細則"),
    "J0170008": ("order", "消費爭議調解辦法"),
    "J0170012": ("order", "通訊交易解除權合理例外情事適用準則"),
}


def pcode_of(url: str) -> str:
    return url.split("pcode=")[-1]


def main(force: bool = False) -> None:
    manifest = load_manifest()
    loaded: dict[str, dict] = {}
    for kind, (url, member) in DUMPS.items():
        zpath = CACHE / f"Ch{kind.capitalize()}.zip"
        key = f"moj_dump_{kind}"
        if force or not zpath.exists() or key not in manifest:
            print(f"downloading {url}")
            download(url, zpath)
            manifest[key] = {
                "url": url,
                "cache_file": rel(zpath),
                "sha256": sha256_file(zpath),
                "bytes": zpath.stat().st_size,
                "fetched_at": now_iso(),
            }
        with zipfile.ZipFile(zpath) as z:
            data = json.loads(z.read(member).decode("utf-8-sig"))
        manifest[key]["update_date"] = data["UpdateDate"]
        loaded[kind] = data

    (RAW / "moj").mkdir(parents=True, exist_ok=True)
    for pcode, (kind, name) in TARGETS.items():
        hits = [x for x in loaded[kind]["Laws"] if pcode_of(x["LawURL"]) == pcode]
        if len(hits) != 1:
            sys.exit(f"{pcode}: expected exactly 1 match in {kind} dump, got {len(hits)}")
        law = hits[0]
        if law["LawName"] != name:
            sys.exit(f"{pcode}: official name is {law['LawName']!r}, expected {name!r}")
        if law["LawAbandonNote"].strip():
            sys.exit(f"{pcode}: law is marked abandoned: {law['LawAbandonNote']!r}")
        out = RAW / "moj" / f"{pcode}.json"
        out.write_text(json.dumps(law, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        manifest[f"moj_law_{pcode}"] = {
            "pcode": pcode,
            "law_name": name,
            "source_url": law["LawURL"],
            "dump": f"moj_dump_{kind}",
            "raw_file": rel(out),
            "sha256": sha256_file(out),
        }
        print(f"{pcode} {name}: {sum(a['ArticleType'] == 'A' for a in law['LawArticles'])} articles")
    # Names of all statutes (法律 level), used only to recognise cross-law citations
    # such as 民法第二百五十九條 in the reference parser.
    names = sorted({x["LawName"] for x in loaded["law"]["Laws"]})
    out = RAW / "moj" / "law_names.json"
    out.write_text(json.dumps({"source": DUMPS["law"][0], "update_date": loaded["law"]["UpdateDate"],
                               "names": names}, ensure_ascii=False, indent=0) + "\n", encoding="utf-8")
    manifest["moj_law_names"] = {"raw_file": rel(out), "sha256": sha256_file(out), "count": len(names)}
    save_manifest(manifest)


if __name__ == "__main__":
    main(force="--force" in sys.argv)
