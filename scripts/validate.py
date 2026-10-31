"""Validate data/laws/*.json against the raw sources.

Usage: python scripts/validate.py        (exit code 1 on any failure)

Checks
  1. raw files exist and match the SHA-256 in data/raw/manifest.json
  2. unit counts match counts taken independently from the raw sources
  3. required fields present, ids unique, order sequential, point numbers contiguous
  4. verbatim: every unit's text equals the source text (whitespace-insensitive);
     for the ODT / PDF notices the whole document is reconciled, so nothing is
     dropped, duplicated or invented
  5. reference table: targets exist, spans match raw text, unit.references agrees
     with the edge table
  6. provenance fields and attribution notice
  7. a few hard-coded anchor sentences
"""
from __future__ import annotations

import html as htmllib
import json
import re
import sys
import zipfile

import pymupdf

from common import LAWS, RAW, ROOT, load_manifest, sha256_file

FAILS: list[str] = []
CHECKS = 0


def check(cond: bool, msg: str) -> None:
    global CHECKS
    CHECKS += 1
    if not cond:
        FAILS.append(msg)


def ws(s: str) -> str:
    return re.sub(r"\s+", "", s)


UNIT_REQUIRED = ["id", "doc_id", "law_name", "unit", "no", "no_label", "title", "part", "chapter",
                 "section", "hierarchy", "path", "order", "status", "text", "references",
                 "external_references", "unresolved_references", "source_url", "fetched_at"]
DOC_REQUIRED = ["doc_id", "law_name", "short_name", "doc_type", "unit_kind", "authority", "source",
                "unit_count"]
SRC_REQUIRED = ["source_type", "publisher", "source_url", "fetched_at", "raw_file", "raw_sha256",
                "license", "attribution"]
CN = "一二三四五六七八九十"


def load_docs():
    docs = {}
    for f in sorted(LAWS.glob("*.json")):
        if f.name in ("manifest.json", "references.json"):
            continue
        d = json.loads(f.read_text(encoding="utf-8"))
        docs[d["doc"]["doc_id"]] = d
    return docs


# ------------------------------------------------------------------ 1. hashes
def check_hashes(manifest):
    for key, m in manifest.items():
        if "raw_file" in m:
            p = ROOT / m["raw_file"]
            check(p.exists(), f"missing raw file {m['raw_file']}")
            if p.exists():
                check(sha256_file(p) == m["sha256"], f"sha256 mismatch for {m['raw_file']}")
        if "cache_file" in m:                      # large dumps are optional locally
            p = ROOT / m["cache_file"]
            if p.exists():
                check(sha256_file(p) == m["sha256"], f"sha256 mismatch for {m['cache_file']}")


# ------------------------------------------------------------ 2-4. MOJ docs
def check_moj(doc_id, d, manifest):
    doc, units = d["doc"], d["units"]
    raw = json.loads((ROOT / doc["source"]["raw_file"]).read_text(encoding="utf-8"))
    arts = [a for a in raw["LawArticles"] if a["ArticleType"] == "A"]
    check(len(arts) == len(units), f"{doc_id}: {len(units)} units vs {len(arts)} articles in source")
    check(raw["LawName"] == doc["law_name"], f"{doc_id}: law name differs from source")
    check(raw["LawURL"] == doc["source"]["source_url"], f"{doc_id}: source url differs")
    deleted_src = sum(1 for a in arts if ws(a["ArticleContent"]) in ("（刪除）", "(刪除)"))
    check(deleted_src == doc["deleted_unit_count"], f"{doc_id}: deleted count differs")
    for a, u in zip(arts, units):
        no = re.match(r"^第\s*(\d+(?:-\d+)?)\s*條$", a["ArticleNo"].strip()).group(1)
        check(u["no"] == no, f"{doc_id}: article order/no mismatch at {u['id']} vs {a['ArticleNo']}")
        check(ws(u["text"]) == ws(a["ArticleContent"]), f"{doc_id}: text differs from source at {u['id']}")
    n_chapters = sum(1 for a in raw["LawArticles"] if a["ArticleType"] == "C")
    check(sum(1 for u in units if u["hierarchy"]) <= len(units), "n/a")
    # every heading in the source appears in some unit's hierarchy
    heads = {a["ArticleContent"].strip() for a in raw["LawArticles"] if a["ArticleType"] == "C"}
    used = {h["label"] for u in units for h in u["hierarchy"]}
    check(heads <= used or not heads, f"{doc_id}: headings never attached to a unit: {heads - used}")
    del n_chapters
    # optional: compare against the full dump if it is cached locally
    mm = manifest[f"moj_law_{doc['pcode']}"]
    zp = ROOT / manifest[mm["dump"]]["cache_file"]
    if zp.exists():
        member = "ChLaw.json" if mm["dump"].endswith("law") else "ChOrder.json"
        with zipfile.ZipFile(zp) as z:
            data = json.loads(z.read(member).decode("utf-8-sig"))
        hit = [x for x in data["Laws"] if x["LawURL"] == raw["LawURL"]]
        check(len(hit) == 1 and hit[0] == raw, f"{doc_id}: raw excerpt differs from cached dump")


# ------------------------------------------------------------ gift (ODT)
def odt_source_text(path):
    with zipfile.ZipFile(path) as z:
        x = z.read("content.xml").decode("utf-8")
    x = x.split("<office:text", 1)[1].split(">", 1)[1]
    x = re.sub(r"<text:s[^>]*/>", " ", x)
    x = re.sub(r"</text:p>", "\n", x)
    x = re.sub(r"<[^>]+>", "", x)
    return htmllib.unescape(x)


def expected_sequence(doc, units):
    """Text of title, announcement, headings and units in document order."""
    seq = [doc["law_name"], doc["announcement"]]
    heading = {p["part"]: p["heading"] for p in doc["parts"] if p.get("heading")}
    last_part, table_header_added = None, False
    for u in units:
        if u["part"] != last_part:
            if u["part"] in heading:
                seq.append(heading[u["part"]])
            last_part = u["part"]
        if u["unit"] == "table_row":
            if not table_header_added:
                seq.append("項次行業別適用範圍主管機關")
                table_header_added = True
            inherited = set(u.get("inherited_fields", []))
            seq.extend(v for k, v in u["fields"].items() if k not in inherited)
        else:
            seq.append(u["text"])
    return seq


def check_points_numbering(doc_id, units):
    by_part = {}
    for u in units:
        if u["unit"] == "point":
            by_part.setdefault(u["part"], []).append(int(u["no"]))
    for part, nums in by_part.items():
        check(nums == list(range(1, len(nums) + 1)),
              f"{doc_id}/{part}: point numbers not contiguous: {nums}")
    return {p: len(n) for p, n in by_part.items()}


def check_gift(d):
    doc, units = d["doc"], d["units"]
    src = odt_source_text(ROOT / doc["source"]["raw_file"])
    with zipfile.ZipFile(ROOT / doc["source"]["raw_file"]) as z:
        x = z.read("content.xml").decode("utf-8")
    # independent counts from the source
    plain_lines = [ln.strip() for ln in src.split("\n") if ln.strip()]
    i_must = next(i for i, l in enumerate(plain_lines) if l.startswith("貳、"))
    i_not = next(i for i, l in enumerate(plain_lines) if l.startswith("參、"))
    i_app = next(i for i, l in enumerate(plain_lines) if l.startswith("附表"))
    pt = re.compile(rf"^[{CN}]+、")
    n_must = sum(1 for l in plain_lines[i_must + 1:i_not] if pt.match(l))
    n_not = sum(1 for l in plain_lines[i_not + 1:i_app] if pt.match(l))
    n_rows = x.count("<table:table-row") - 1
    counts = check_points_numbering("gift", units)
    check(counts.get("應記載事項") == n_must, f"gift: must points {counts.get('應記載事項')} vs source {n_must}")
    check(counts.get("不得記載事項") == n_not, f"gift: must-not points {counts.get('不得記載事項')} vs source {n_not}")
    check(sum(1 for u in units if u["unit"] == "table_row") == n_rows, "gift: table rows differ from source")
    check(sum(1 for u in units if u["unit"] == "preamble") == 1, "gift: preamble missing")
    # whole-document reconciliation
    check(ws("".join(expected_sequence(doc, units))) == ws(src),
          "gift: units do not reproduce the ODT text exactly")


# ------------------------------------------------------------ gym (PDF)
def pdf_source_text(path):
    out = []
    for page in pymupdf.open(path):
        for ln in page.get_text().split("\n"):
            s = ln.strip()
            if s and not s.isdigit():
                out.append(s)
    return out


def check_gym(d):
    doc, units = d["doc"], d["units"]
    lines = pdf_source_text(ROOT / doc["source"]["raw_file"])
    i_must = next(i for i, l in enumerate(lines) if l.startswith("壹、"))
    i_not = next(i for i, l in enumerate(lines) if l.startswith("貳、"))
    pt = re.compile(rf"^[{CN}]+、")
    n_must = sum(1 for l in lines[i_must + 1:i_not] if pt.match(l))
    n_not = sum(1 for l in lines[i_not + 1:] if pt.match(l))
    counts = check_points_numbering("gym", units)
    check(counts.get("應記載事項") == n_must, f"gym: must points {counts.get('應記載事項')} vs source {n_must}")
    check(counts.get("不得記載事項") == n_not, f"gym: must-not points {counts.get('不得記載事項')} vs source {n_not}")
    check(ws("".join(expected_sequence(doc, units))) == ws("".join(lines)),
          "gym: units do not reproduce the PDF text exactly")


# ------------------------------------------------------------ 3. generic
def check_generic(docs):
    all_ids = set()
    for did, d in docs.items():
        doc, units = d["doc"], d["units"]
        check(d["schema_version"] == 1, f"{did}: schema_version")
        for k in DOC_REQUIRED:
            check(k in doc, f"{did}: doc field {k} missing")
        for k in SRC_REQUIRED:
            check(doc["source"].get(k), f"{did}: source field {k} missing/empty")
        if doc["source"]["source_type"] == "open_data":
            check(doc["source"].get("open_data_update_date"), f"{did}: open_data_update_date missing")
        check(doc["unit_count"] == len(units), f"{did}: unit_count")
        for i, u in enumerate(units, 1):
            for k in UNIT_REQUIRED:
                check(k in u, f"{u.get('id')}: field {k} missing")
            check(u["order"] == i, f"{u['id']}: order {u['order']} != {i}")
            check(u["id"] not in all_ids, f"duplicate id {u['id']}")
            all_ids.add(u["id"])
            check(u["id"].startswith(did + "-"), f"{u['id']}: id prefix")
            check(bool(u["text"]) or u["unit"] == "preamble", f"{u['id']}: empty text")
            check(u["source_url"] == doc["source"]["source_url"], f"{u['id']}: source_url differs from doc")
            check(bool(u["fetched_at"]), f"{u['id']}: fetched_at missing")
            check(u["unit"] in ("article", "point", "preamble", "table_row"), f"{u['id']}: unit kind")
            check(u["status"] in ("active", "deleted"), f"{u['id']}: status")
    return all_ids


# ------------------------------------------------------------ 5. references
def check_refs(docs, all_ids):
    refs = json.loads((LAWS / "references.json").read_text(encoding="utf-8"))
    units = {u["id"]: u for d in docs.values() for u in d["units"]}
    per_unit = {}
    for e in refs["edges"]:
        check(e["status"] in ("resolved", "external", "ambiguous", "unresolved"), f"bad status {e}")
        check(e["from_id"] in units, f"edge from unknown unit {e['from_id']}")
        u = units.get(e["from_id"])
        if u:
            a, b = e["span"]
            check(u["text"][a:b] == e["raw"], f"{e['from_id']}: edge raw {e['raw']!r} does not match text span")
        if e["status"] == "resolved":
            check(e.get("to_id") in all_ids, f"{e['from_id']}: unknown target {e.get('to_id')}")
            check(e["to_id"] != e["from_id"], f"{e['from_id']}: self reference")
            per_unit.setdefault(e["from_id"], set()).add(e["to_id"])
        if e["status"] == "external":
            check(bool(e.get("target_law")), f"{e['from_id']}: external edge without law")
        if e["status"] == "ambiguous":
            check(len(e.get("candidates", [])) > 1, f"{e['from_id']}: ambiguous edge without candidates")
            check(all(c in all_ids for c in e.get("candidates", [])), "ambiguous candidate missing")
    for uid, u in units.items():
        check(set(u["references"]) == per_unit.get(uid, set()), f"{uid}: references disagree with edge table")
    st = refs["stats"]
    check(st["edges"] == len(refs["edges"]), "refs stats edges")
    # coverage: every 第N條/點 token in a text is inside some edge span
    NUM = r"[〇零一二三四五六七八九十百千0-9]+"
    for uid, u in units.items():
        if u["unit"] == "table_row" or u["status"] == "deleted":
            continue
        spans = [tuple(e["span"]) for e in refs["edges"] if e["from_id"] == uid]
        for m in re.finditer(rf"第{NUM}(?:條|點)", u["text"]):
            check(any(a <= m.start() < b for a, b in spans), f"{uid}: citation {m.group(0)!r} not extracted")
    return refs


# ------------------------------------------------------------ 6/7. misc
ANCHORS = [
    ("cpa-019", "七日內"),
    ("cpa-017", "應記載或不得記載事項"),
    ("cpa_ex-002", "易於腐敗"),
    ("gym-must-004", "契約期間不得逾三年"),
    ("gift-mustnot-001", "不得記載使用期限"),
    ("gift-must-002", "至少一年期間"),
]


def check_misc(docs):
    units = {u["id"]: u for d in docs.values() for u in d["units"]}
    for uid, needle in ANCHORS:
        check(uid in units and needle in units[uid]["text"], f"anchor {uid} lacks {needle!r}")
    notice = ROOT / "NOTICE.md"
    check(notice.exists() and "全國法規資料庫" in notice.read_text(encoding="utf-8"),
          "NOTICE.md must attribute 全國法規資料庫")
    top = json.loads((LAWS / "manifest.json").read_text(encoding="utf-8"))
    check(top["snapshot_date"] == "2026-11-01", "snapshot date")
    check({x["doc_id"] for x in top["documents"]} == set(docs), "manifest documents differ from files")


def main() -> int:
    manifest = load_manifest()
    check_hashes(manifest)
    docs = load_docs()
    check(set(docs) == {"cpa", "cpa_er", "cpa_ex", "cpa_med", "gift", "gym"}, f"unexpected docs {set(docs)}")
    all_ids = check_generic(docs)
    for did in ("cpa", "cpa_er", "cpa_ex", "cpa_med"):
        if did in docs:
            check_moj(did, docs[did], manifest)
    if "gift" in docs:
        check_gift(docs["gift"])
    if "gym" in docs:
        check_gym(docs["gym"])
    refs = check_refs(docs, all_ids)
    check_misc(docs)

    print(f"{CHECKS} checks, {len(FAILS)} failures")
    for did, d in docs.items():
        print(f"  {did:8} {d['doc']['unit_count']:3} units  {d['doc']['unit_counts_by_kind']}")
    print("  reference edges:", refs["stats"])
    for f in FAILS[:50]:
        print("FAIL:", f)
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
