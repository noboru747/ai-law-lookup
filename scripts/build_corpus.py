"""Build data/laws/*.json from the raw source files.

Usage: python scripts/build_corpus.py

Inputs  (fetched by fetch_moj.py / fetch_ey.py)
  data/raw/moj/<pcode>.json   original law objects from the MOJ Open API
  data/raw/ey/gift.odt|html   商品(服務)禮券 notice (Executive Yuan site)
  data/raw/ey/gym.pdf|html    健身中心 notice (Executive Yuan site)
  data/raw/manifest.json      URLs, hashes and fetch timestamps

Outputs (see data/README.md for the schema)
  data/laws/<doc_id>.json     one file per document
  data/laws/references.json   cross-reference edge table
  data/laws/manifest.json     index of documents + provenance summary

Statute text is stored verbatim: only line endings are normalised and
line-wrap / page-number artifacts of the PDF are removed. Nothing is
summarised or rewritten. The output is deterministic (no build timestamps);
timestamps come from the fetch manifest.
"""
from __future__ import annotations

import html as htmllib
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

import pymupdf

from common import LAWS, RAW, load_manifest, write_text
from refs import Corpus, cn2int, find_mentions, resolve, set_known_names

SCHEMA_VERSION = 1
SNAPSHOT_DATE = "2026-11-01"
LICENSE = "政府資料開放授權條款-第1版"
LICENSE_URL = "https://data.gov.tw/license"

MOJ_DOCS = [
    # doc_id, pcode, aliases, short name
    ("cpa", "J0170001", ["消保法"], "消保法"),
    ("cpa_er", "J0170002", [], "消保法施行細則"),
    ("cpa_ex", "J0170012", [], "通訊交易解除權例外準則"),
    ("cpa_med", "J0170008", [], "消費爭議調解辦法"),
]
HIER_RANK = {"編": 1, "章": 2, "節": 3, "款": 4, "目": 5}
CN_NUM = "一二三四五六七八九十"


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def norm_text(s: str) -> str:
    """Normalise line endings and trailing blanks; keep the words as they are."""
    lines = [ln.rstrip() for ln in s.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    return "\n".join(lines).strip()


def html_text(raw_html: str) -> str:
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", raw_html, flags=re.S)
    s = htmllib.unescape(re.sub(r"<[^>]+>", "\n", t))
    return re.sub(r"\n\s*\n+", "\n", s)


def ey_announcement(html_path) -> list[str]:
    """Announcement lines shown on the detail page (between 日期 and 相關檔案)."""
    s = html_text(html_path.read_text(encoding="utf-8"))
    body = s.split("日期：", 1)[1].split("\n", 1)[1]
    body = body.split("相關檔案", 1)[0]
    return [ln.strip() for ln in body.split("\n") if ln.strip()]


def make_unit(doc_id, law_name, unit, no, no_label, text, order, part="", title="",
              hierarchy=None, status="active", source_url="", fetched_at="", fields=None):
    hierarchy = hierarchy or []
    chapter = next((h["label"] for h in hierarchy if h["level"] in ("編", "章")), "")
    section = next((h["label"] for h in hierarchy if h["level"] == "節"), "")
    path = [law_name] + [h["label"] for h in hierarchy]
    if part:
        path.append(part)
    u = {
        "id": None,            # filled by caller
        "doc_id": doc_id,
        "law_name": law_name,
        "unit": unit,
        "no": no,
        "no_label": no_label,
        "title": title,
        "part": part,
        "chapter": chapter,
        "section": section,
        "hierarchy": hierarchy,
        "path": path,
        "order": order,
        "status": status,
        "text": text,
        "references": [],
        "external_references": [],
        "unresolved_references": [],
        "source_url": source_url,
        "fetched_at": fetched_at,
    }
    if fields:
        u["fields"] = fields
    return u


# --------------------------------------------------------------------------
# MOJ (open data) documents
# --------------------------------------------------------------------------
def build_moj(doc_id, pcode, aliases, short, manifest):
    raw_path = RAW / "moj" / f"{pcode}.json"
    raw = json.loads(raw_path.read_text(encoding="utf-8"))
    mm = manifest[f"moj_law_{pcode}"]
    dump = manifest[mm["dump"]]
    law_name = raw["LawName"]
    units, stack = [], []
    order = 0
    for a in raw["LawArticles"]:
        if a["ArticleType"] == "C":
            label = a["ArticleContent"].strip()
            m = re.match(r"^第\s*\S+?\s*(編|章|節|款|目)\b", label) or re.match(r"^第\s*\S+\s*(編|章|節|款|目)", label)
            if not m:
                sys.exit(f"{doc_id}: cannot parse heading {label!r}")
            level = m.group(1)
            while stack and HIER_RANK[stack[-1]["level"]] >= HIER_RANK[level]:
                stack.pop()
            stack.append({"level": level, "label": label})
            continue
        m = re.match(r"^第\s*(\d+)(?:-(\d+))?\s*條$", a["ArticleNo"].strip())
        if not m:
            sys.exit(f"{doc_id}: cannot parse article no {a['ArticleNo']!r}")
        base, sub = int(m.group(1)), m.group(2)
        no = f"{base}-{int(sub)}" if sub else str(base)
        uid = f"{doc_id}-{base:03d}" + (f"-{int(sub)}" if sub else "")
        text = norm_text(a["ArticleContent"])
        order += 1
        u = make_unit(doc_id, law_name, "article", no, f"第 {no} 條", text, order,
                      hierarchy=[dict(h) for h in stack],
                      status="deleted" if text in ("（刪除）", "(刪除)") else "active",
                      source_url=raw["LawURL"], fetched_at=dump["fetched_at"])
        u["id"] = uid
        units.append(u)

    def d(s):  # 20150617 -> 2015-06-17
        return f"{s[:4]}-{s[4:6]}-{s[6:]}" if s else ""

    doc = {
        "doc_id": doc_id,
        "law_name": law_name,
        "short_name": short,
        "aliases": aliases,
        "doc_type": raw["LawLevel"],                  # 法律 | 命令
        "unit_kind": "article",
        "authority": "行政院",
        "authority_basis": f"全國法規資料庫法規類別：{raw['LawCategory']}",
        "pcode": pcode,
        "law_modified_date": d(raw["LawModifiedDate"]),    # kept as provided by the source
        "law_effective_date": d(raw["LawEffectiveDate"]),
        "source": {
            "source_type": "open_data",
            "publisher": "法務部 全國法規資料庫",
            "source_url": raw["LawURL"],
            "api_url": dump["url"],
            "open_data_update_date": dump["update_date"],
            "fetched_at": dump["fetched_at"],
            "raw_file": mm["raw_file"],
            "raw_sha256": mm["sha256"],
            "dump_sha256": dump["sha256"],
            "license": LICENSE,
            "attribution": "資料來源：全國法規資料庫（法務部）",
        },
    }
    return doc, units


# --------------------------------------------------------------------------
# ODT (gift notice)
# --------------------------------------------------------------------------
_NS = {
    "office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
    "text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
    "table": "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
}
_T = "{%s}" % _NS["text"]
_TB = "{%s}" % _NS["table"]


def _odt_ptext(el) -> str:
    out = [el.text or ""]
    for ch in el:
        if ch.tag == _T + "s":
            out.append(" " * int(ch.get(_T + "c", "1")))
        elif ch.tag == _T + "tab":
            out.append("\t")
        elif ch.tag == _T + "line-break":
            out.append("\n")
        else:
            out.append(_odt_ptext(ch))
        out.append(ch.tail or "")
    return "".join(out)


def odt_blocks(path):
    """Return ordered blocks: ('p', text) or ('table', [[cell,...], ...])."""
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read("content.xml"))
    body = root.find("office:body/office:text", _NS)
    blocks = []
    for el in body:
        if el.tag == _T + "p":
            t = _odt_ptext(el).strip()
            if t:
                blocks.append(("p", t))
        elif el.tag == _TB + "table":
            rows, spans = [], {}
            for tr in el.iter(_TB + "table-row"):
                row, col = [], 0
                cells = [c for c in tr if c.tag in (_TB + "table-cell", _TB + "covered-table-cell")]
                for c in cells:
                    while (len(rows), col) in spans:
                        row.append(spans[(len(rows), col)][0])
                        col += 1
                    if c.tag == _TB + "covered-table-cell":
                        # filled by a row span (handled above) -> nothing to add
                        continue
                    text = "\n".join(_odt_ptext(p).strip() for p in c.iter(_T + "p")).strip()
                    row.append((text, False))
                    rs = int(c.get(_TB + "number-rows-spanned", "1"))
                    for k in range(1, rs):
                        spans[(len(rows) + k, col)] = ((text, True),)
                    col += 1
                while (len(rows), col) in spans:
                    row.append(spans[(len(rows), col)][0])
                    col += 1
                rows.append(row)
            blocks.append(("table", rows))
    return blocks


def _marker_no(text: str):
    m = re.match(rf"^([{CN_NUM}]+)、", text)
    return cn2int(m.group(1)) if m else None


def build_gift(manifest):
    doc_id = "gift"
    page, odt = manifest["ey_gift_page"], manifest["ey_gift_odt"]
    ann_lines = ey_announcement(RAW / "ey" / "gift.html")
    blocks = odt_blocks(RAW / "ey" / "gift.odt")
    assert blocks[0][0] == "p" and blocks[1][0] == "p"
    law_name = blocks[0][1]
    announcement = blocks[1][1]
    assert law_name == "商品(服務)禮券定型化契約應記載及不得記載事項", law_name
    for needle in ("經濟部會銜", "109年4月10日", "自110年1月1日生效"):
        assert needle in announcement, needle

    units, order = [], 0
    part, cur, pre = "", None, []
    parts_meta = []
    common = dict(source_url=page["source_url"], fetched_at=odt["fetched_at"])

    def flush():
        nonlocal cur
        if cur:
            cur["text"] = "\n".join(cur.pop("_lines"))
            units.append(cur)
            cur = None

    def add_point(no, first_line):
        nonlocal order, cur
        order += 1
        key = {"應記載事項": "must", "不得記載事項": "mustnot"}[part]
        cur = make_unit(doc_id, law_name, "point", str(no), f"{part}第{_cn(no)}點", "", order,
                        part=part, **common)
        cur["id"] = f"gift-{key}-{no:03d}"
        cur["_lines"] = [first_line]

    appendix_title = None
    for kind, val in blocks[2:]:
        if kind == "table":
            flush()
            header, body = val[0], val[1:]
            heads = [h[0] for h in header]
            assert heads == ["項次", "行業別", "適用範圍", "主管機關"], heads
            for r in body:
                order += 1
                fields = {heads[i]: r[i][0] for i in range(4)}
                inherited = [heads[i] for i in range(4) if r[i][1]]
                text = "\n".join(f"{k}：{v}" for k, v in fields.items())
                no = cn2int(fields["項次"])
                u = make_unit(doc_id, law_name, "table_row", str(no), f"附表第{fields['項次']}項", text,
                              order, part="附表", title=fields["行業別"], fields=fields, **common)
                if inherited:
                    u["inherited_fields"] = inherited
                u["id"] = f"gift-tbl-{no:02d}"
                units.append(u)
            parts_meta.append({"part": "附表", "marker": "", "heading": appendix_title})
            continue
        text = val
        m = re.match(r"^(壹|貳|參)、(.+)$", text)
        if m:
            flush()
            part = m.group(2)
            parts_meta.append({"part": part, "marker": m.group(1), "heading": text})
            if part == "前言":
                order += 1
                cur = make_unit(doc_id, law_name, "preamble", "0", "前言", "", order, part=part, **common)
                cur["id"] = "gift-pre"
                cur["_lines"] = []
            continue
        if text.startswith("附表-") or text.startswith("附表－"):
            flush()
            appendix_title = text
            part = "附表"
            continue
        if part == "前言":
            cur["_lines"].append(text)
            continue
        n = _marker_no(text)
        if n is not None and part in ("應記載事項", "不得記載事項"):
            flush()
            add_point(n, text)
        else:
            assert cur is not None, text
            cur["_lines"].append(text)
    flush()

    doc = {
        "doc_id": doc_id,
        "law_name": law_name,
        "short_name": "商品(服務)禮券",
        "aliases": [],
        "doc_type": "定型化契約應記載及不得記載事項（公告）",
        "unit_kind": "point",
        "authority": "經濟部",
        "issuing_authority": "經濟部會銜行政院農業委員會、衛生福利部、教育部、國家通訊傳播委員會、交通部、文化部、財政部、國軍退除役官兵輔導委員會",
        "announcement": announcement,
        "announcement_page_lines": ann_lines,
        "parts": parts_meta,
        "source": {
            "source_type": "ey_webpage",
            "publisher": "行政院全球資訊網（行政院）",
            "source_url": page["source_url"],
            "file_url": odt["source_url"],
            "file_format": "odt",
            "fetched_at": odt["fetched_at"],
            "page_fetched_at": page["fetched_at"],
            "raw_file": odt["raw_file"],
            "raw_sha256": odt["sha256"],
            "page_raw_file": page["raw_file"],
            "page_raw_sha256": page["sha256"],
            "license": LICENSE,
            "attribution": "資料來源：行政院全球資訊網（行政院）",
        },
    }
    return doc, units


def _cn(n: int) -> str:
    """1 -> 一, 10 -> 十, 24 -> 二十四."""
    if n <= 10:
        return CN_NUM[n - 1]
    if n < 20:
        return "十" + CN_NUM[n - 11]
    t, o = divmod(n, 10)
    return CN_NUM[t - 1] + "十" + (CN_NUM[o - 1] if o else "")


# --------------------------------------------------------------------------
# PDF (gym notice)
# --------------------------------------------------------------------------
_PARA_START = re.compile(rf"^(?:[壹貳參]、|[{CN_NUM}]+、|□|[(（][{CN_NUM}]+[)）]|\d+\.)")
_HEADING = re.compile(rf"^[{CN_NUM}]+、[^，。；：:]{{1,24}}$")
_TERMINAL = tuple("。：；？！:")


def pdf_paragraphs(path) -> list[str]:
    """Re-flow the PDF's hard-wrapped lines into paragraphs.

    Page numbers (digit-only lines) are dropped. Paragraph boundaries are
    detected from list markers and terminal punctuation; they never change
    the wording.
    """
    doc = pymupdf.open(path)
    lines = []
    for page in doc:
        for ln in page.get_text().split("\n"):
            s = ln.strip()
            if s and not s.isdigit():
                lines.append(s)
    paras, cur = [], ""
    for i, s in enumerate(lines):
        if i == 0:                              # title line stands alone
            paras.append(s)
            continue
        if cur and (cur.endswith(_TERMINAL) or _PARA_START.match(s) or _HEADING.match(cur)):
            paras.append(cur)
            cur = ""
        cur += s
    if cur:
        paras.append(cur)
    return paras


def build_gym(manifest):
    doc_id = "gym"
    page, pdf = manifest["ey_gym_page"], manifest["ey_gym_pdf"]
    ann_lines = ey_announcement(RAW / "ey" / "gym.html")
    page_html = (RAW / "ey" / "gym.html").read_text(encoding="utf-8")
    paras = pdf_paragraphs(RAW / "ey" / "gym.pdf")
    law_name, announcement = paras[0], paras[1]
    assert law_name == "健身中心定型化契約應記載及不得記載事項", law_name
    assert "教育部110年11月1日" in announcement and "自111年1月1日生效" in announcement, announcement
    assert "運動部" in page_html

    units, order = [], 0
    part, cur, parts_meta = "", None, []
    common = dict(source_url=page["source_url"], fetched_at=pdf["fetched_at"])

    def flush():
        nonlocal cur
        if cur:
            paras_ = cur.pop("_lines")
            if len(paras_) > 1 and _HEADING.match(paras_[0]):
                cur["title"] = re.sub(rf"^[{CN_NUM}]+、", "", paras_[0])
            cur["text"] = "\n".join(paras_)
            units.append(cur)
            cur = None

    for text in paras[2:]:
        m = re.match(r"^(壹|貳|參)、(.+)$", text)
        if m:
            flush()
            part = m.group(2)
            parts_meta.append({"part": part, "marker": m.group(1), "heading": text})
            continue
        n = _marker_no(text)
        if n is not None:
            flush()
            order += 1
            key = {"應記載事項": "must", "不得記載事項": "mustnot"}[part]
            cur = make_unit(doc_id, law_name, "point", str(n), f"{part}第{_cn(n)}點", "", order,
                            part=part, **common)
            cur["id"] = f"gym-{key}-{n:03d}"
            cur["_lines"] = [text]
        else:
            cur["_lines"].append(text)
    flush()

    doc = {
        "doc_id": doc_id,
        "law_name": law_name,
        "short_name": "健身中心",
        "aliases": [],
        "doc_type": "定型化契約應記載及不得記載事項（公告）",
        "unit_kind": "point",
        "authority": "教育部（自 2025-09-09 起業務移撥運動部）",
        "issuing_authority": "教育部",
        "announcement": announcement,
        "announcement_page_lines": ann_lines,
        "parts": parts_meta,
        "source": {
            "source_type": "ey_webpage",
            "publisher": "行政院全球資訊網（行政院）",
            "source_url": page["source_url"],
            "file_url": pdf["source_url"],
            "file_format": "pdf",
            "fetched_at": pdf["fetched_at"],
            "page_fetched_at": page["fetched_at"],
            "raw_file": pdf["raw_file"],
            "raw_sha256": pdf["sha256"],
            "page_raw_file": page["raw_file"],
            "page_raw_sha256": page["sha256"],
            "license": LICENSE,
            "attribution": "資料來源：行政院全球資訊網（行政院）",
            "text_extraction": "PyMuPDF; hard line wraps and page numbers removed",
        },
    }
    return doc, units


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------
def main() -> None:
    manifest = load_manifest()
    docs, all_units = {}, []
    for doc_id, pcode, aliases, short in MOJ_DOCS:
        doc, units = build_moj(doc_id, pcode, aliases, short, manifest)
        docs[doc_id] = (doc, units)
    docs["gift"] = build_gift(manifest)
    docs["gym"] = build_gym(manifest)
    for _, units in docs.values():
        all_units.extend(units)

    ids = [u["id"] for u in all_units]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        sys.exit(f"duplicate unit ids: {sorted(dup)}")

    names = json.loads((RAW / "moj" / "law_names.json").read_text(encoding="utf-8"))["names"]
    set_known_names(names + [d["law_name"] for d, _ in docs.values()] + [a for d, _ in docs.values() for a in d.get("aliases", [])])
    corpus = Corpus(
        {did: {"law_name": d["law_name"], "aliases": d.get("aliases", []),
               "unit_kinds": {"article"} if d["unit_kind"] == "article" else {"point"}}
         for did, (d, _) in docs.items()},
        all_units)

    edges = []
    for u in all_units:
        if u["unit"] == "table_row" or u["status"] == "deleted":
            continue
        for e in resolve(u, find_mentions(u["text"]), corpus):
            edges.append(e)
            if e.status == "resolved":
                if e.to_id not in u["references"]:
                    u["references"].append(e.to_id)
            elif e.status == "external":
                ext = {"law": e.target_law, "number": e.target_number, "raw": e.raw}
                if ext not in u["external_references"]:
                    u["external_references"].append(ext)
            else:
                u["unresolved_references"].append(
                    {"raw": e.raw, "status": e.status, "note": e.note,
                     **({"candidates": e.candidates} if e.candidates else {})})

    LAWS.mkdir(parents=True, exist_ok=True)
    index = []
    for did, (doc, units) in docs.items():
        doc["unit_count"] = len(units)
        doc["unit_counts_by_kind"] = {}
        for u in units:
            k = u["unit"]
            doc["unit_counts_by_kind"][k] = doc["unit_counts_by_kind"].get(k, 0) + 1
        doc["deleted_unit_count"] = sum(1 for u in units if u["status"] == "deleted")
        out = {"schema_version": SCHEMA_VERSION, "doc": doc, "units": units}
        write_text(LAWS / f"{did}.json", json.dumps(out, ensure_ascii=False, indent=1) + "\n")
        index.append({"doc_id": did, "file": f"{did}.json", "law_name": doc["law_name"],
                      "unit_kind": doc["unit_kind"], "unit_count": doc["unit_count"],
                      "source_type": doc["source"]["source_type"],
                      "source_url": doc["source"]["source_url"],
                      "fetched_at": doc["source"]["fetched_at"]})

    stats = {}
    for e in edges:
        stats[e.status] = stats.get(e.status, 0) + 1
    mention_keys = {(e.from_id, e.span, e.raw) for e in edges}
    refs_out = {
        "schema_version": SCHEMA_VERSION,
        "stats": {"edges": len(edges), "mentions": len(mention_keys), "edges_by_status": stats},
        "edges": [e.to_json() for e in edges],
    }
    write_text(LAWS / "references.json", json.dumps(refs_out, ensure_ascii=False, indent=1) + "\n")

    moj_dump = manifest["moj_dump_law"]
    top = {
        "schema_version": SCHEMA_VERSION,
        "snapshot_date": SNAPSHOT_DATE,
        "open_data_update_date": moj_dump["update_date"],
        "license": LICENSE,
        "attribution": "資料來源：全國法規資料庫（法務部）；行政院全球資訊網（行政院）",
        "documents": index,
        "references_file": "references.json",
    }
    write_text(LAWS / "manifest.json", json.dumps(top, ensure_ascii=False, indent=1) + "\n")
    for row in index:
        print(f"{row['doc_id']:8} {row['unit_count']:3} units  {row['law_name']}")
    print("reference edges:", len(edges), stats)


if __name__ == "__main__":
    main()
