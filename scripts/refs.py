"""Cross-reference extraction for statutory text.

Finds citations such as 第十九條, 本法第十九條第二項, 消費者保護法第四十七條,
第九點至第十一點, 準用第十點, 前條, 前二點 and turns them into edges.

Principles
- Only unit-level targets (an article or a point). Paragraph / sub-paragraph
  locators (第一項第二款) are kept as text, not resolved.
- Never guess. A citation that cannot be pinned to exactly one in-scope unit
  is returned as `unresolved`, `ambiguous` (with candidates) or `external`.
- References to paragraphs/items inside the same unit (前項, 前款, 本條) are
  not cross-unit references and are ignored.

Status values
  resolved    target is an in-scope unit (target_id is set)
  external    names a law outside the corpus (target_law is set)
  ambiguous   in scope but more than one candidate unit (candidates is set)
  unresolved  cannot be determined (see note)
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# --------------------------------------------------------------------------
# Chinese numerals
# --------------------------------------------------------------------------
_DIGITS = {"〇": 0, "零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
           "六": 6, "七": 7, "八": 8, "九": 9}
NUM = r"[〇零一二三四五六七八九十百千0-9]+"


def cn2int(s: str) -> int:
    """'十九' -> 19, '四百三十六' -> 436, '一百零一' -> 101, '19' -> 19."""
    if s.isdigit():
        return int(s)
    total, cur = 0, 0
    units = {"十": 10, "百": 100, "千": 1000}
    for ch in s:
        if ch in _DIGITS:
            cur = _DIGITS[ch]
        elif ch in units:
            total += (cur or 1) * units[ch]
            cur = 0
        else:
            raise ValueError(f"bad numeral {s!r}")
    return total + cur


# --------------------------------------------------------------------------
# Patterns
# --------------------------------------------------------------------------
LOCATOR = rf"(?:第{NUM}項)?(?:第{NUM}款)?(?:至第{NUM}款)?(?:第{NUM}目)?"
CITE_RE = re.compile(rf"第(?P<n>{NUM})(?P<kind>條|點)(?:之(?P<sub>{NUM}))?(?P<loc>{LOCATOR})")
REL_RE = re.compile(r"(?P<w>前(?P<cnt>[二三四五六七八九十]?)(?P<kind>條|點)|次(?P<nk>條|點))")

SELF_WORDS = {"本法": "law", "本條例": "self", "本細則": "self", "本準則": "self",
              "本辦法": "self", "本事項": "self"}

# characters that cannot be part of a law name when scanning backwards
_STOP = "\\s，。；：、（）()「」『』《》及與或於之依並應得其按照所如若但以為而且該各另第"
NAME_RE = re.compile(
    rf"([^{_STOP}\d]{{2,30}}(?:法|條例|辦法|準則|細則|規則|標準|規程|要點))$")

CONT_GAPS = {"、", "及", "或", "和", "與", "，及", "，或", "、及", "、或"}


@dataclass
class Mention:
    """One citation found in a unit's text."""
    raw: str
    span: tuple[int, int]
    kind: str                       # 'article' | 'point'
    number: str                     # normalised, e.g. '19' or '19-1'
    qualifier: tuple | None         # ('self',) | ('law', word|name) | ('same_law',) | None
    locator: str = ""
    relation: str = "refers"        # 'refers' | 'mutatis_mutandis'
    range_with_prev: bool = False
    relative: tuple | None = None   # ('prev', n) | ('next', 1)
    range_start: str | None = None  # for ranges: normalised number of range start


def _norm_no(n: str, sub: str | None) -> str:
    base = str(cn2int(n))
    return f"{base}-{cn2int(sub)}" if sub else base


KNOWN_NAMES: set[str] = set()
_ABBREV_RE = re.compile(r"(.+?)[（(]以下簡稱[^）)]*[）)]$")


def set_known_names(names) -> None:
    """Register official law names (used to recognise 'X法第N條' safely)."""
    KNOWN_NAMES.clear()
    KNOWN_NAMES.update(n for n in names if len(n) >= 2)


def _longest_known_suffix(s: str) -> str | None:
    for ln in range(min(len(s), 40), 1, -1):
        if s[-ln:] in KNOWN_NAMES:
            return s[-ln:]
    return None


def _qualifier_before(text: str, start: int):
    pre = text[:start]
    for w in sorted(SELF_WORDS, key=len, reverse=True):
        if pre.endswith(w):
            return ("self_word", w)
    if pre.endswith("同法"):
        return ("same_law",)
    m = _ABBREV_RE.match(pre)               # 消費者保護法（以下簡稱本法）第六十三條
    if m:
        name = _longest_known_suffix(m.group(1))
        if name:
            return ("law", name)
    name = _longest_known_suffix(pre)
    if name:
        return ("law", name)
    m = NAME_RE.search(pre)                 # looks like a law name but is not in the list
    if m:
        return ("maybe_law", m.group(1))
    return None


def _relation_before(text: str, start: int) -> str:
    window = text[max(0, start - 12):start]
    return "mutatis_mutandis" if "準用" in window else "refers"


def find_mentions(text: str) -> list[Mention]:
    """Extract citations from one unit's text, in text order."""
    events = []
    for m in CITE_RE.finditer(text):
        events.append(("cite", m.start(), m))
    for m in REL_RE.finditer(text):
        events.append(("rel", m.start(), m))
    events.sort(key=lambda e: e[1])

    out: list[Mention] = []
    prev: Mention | None = None
    prev_end = -1
    last_named_law: tuple | None = None
    for etype, start, m in events:
        if etype == "rel":
            if start < prev_end:
                continue
            if m.group("w").startswith("次"):
                rel = ("next", 1)
                kind = "article" if m.group("nk") == "條" else "point"
            else:
                cnt = m.group("cnt")
                rel = ("prev", cn2int(cnt) if cnt else 1)
                kind = "article" if m.group("kind") == "條" else "point"
            men = Mention(raw=m.group(0), span=(m.start(), m.end()), kind=kind,
                          number="", qualifier=None, relation=_relation_before(text, start),
                          relative=rel)
            out.append(men)
            prev, prev_end = men, m.end()
            continue

        kind = "article" if m.group("kind") == "條" else "point"
        number = _norm_no(m.group("n"), m.group("sub"))
        loc = m.group("loc") or ""
        gap = text[prev_end:start] if prev is not None and prev.relative is None else None
        qual = None
        range_with_prev = False
        range_start = None
        if gap is not None and prev is not None and prev.kind == kind and gap in CONT_GAPS:
            qual = prev.qualifier           # list continuation: same law as previous
        elif gap is not None and prev is not None and prev.kind == kind and gap == "至":
            qual = prev.qualifier
            range_with_prev = True
            range_start = prev.number
        else:
            qual = _qualifier_before(text, start)
            if qual and qual[0] == "same_law":
                qual = ("law", last_named_law[1]) if last_named_law else ("same_law",)
        if qual and qual[0] == "law":
            last_named_law = qual
        span = (m.start(), m.end())
        raw = m.group(0)
        if range_with_prev:                 # 第X條至第Y條 becomes one mention
            old_prev = out.pop()
            span = (old_prev.span[0], m.end())
            raw = text[span[0]:span[1]]
        men = Mention(raw=raw, span=span, kind=kind, number=number,
                      qualifier=qual, locator=loc, relation=_relation_before(text, span[0]),
                      range_with_prev=range_with_prev, range_start=range_start)
        out.append(men)
        prev, prev_end = men, m.end()
    return out


# --------------------------------------------------------------------------
# Resolution against the corpus
# --------------------------------------------------------------------------
@dataclass
class Edge:
    from_id: str
    from_doc: str
    status: str
    raw: str
    span: tuple[int, int]
    relation: str
    method: str
    to_id: str | None = None
    to_doc: str | None = None
    target_law: str | None = None
    target_number: str | None = None
    locator: str = ""
    candidates: list[str] = field(default_factory=list)
    note: str = ""

    def to_json(self) -> dict:
        d = {k: v for k, v in self.__dict__.items()}
        d["span"] = list(self.span)
        return {k: v for k, v in d.items() if v not in (None, "", [])}


class Corpus:
    """Lookup structure over built units.

    docs: {doc_id: {"law_name": str, "aliases": [str], "unit_kinds": {'article'|'point'}}}
    units: list of unit dicts (needs id, doc_id, unit, no, part, order, status)
    """

    def __init__(self, docs: dict, units: list[dict]):
        self.docs = docs
        self.units = units
        self.by_doc: dict[str, list[dict]] = {}
        for u in sorted(units, key=lambda u: (u["doc_id"], u["order"])):
            self.by_doc.setdefault(u["doc_id"], []).append(u)
        self.name_to_doc = {}
        for did, d in docs.items():
            self.name_to_doc[d["law_name"]] = did
            for a in d.get("aliases", []):
                self.name_to_doc[a] = did

    def find(self, doc_id: str, kind: str, number: str, part: str | None = None) -> list[dict]:
        unit_kind = "article" if kind == "article" else "point"
        return [u for u in self.by_doc.get(doc_id, [])
                if u["unit"] == unit_kind and u["no"] == number
                and (part is None or u["part"] == part)]


# Part (section) that holds the numbered points other points normally cite.
# For both industry notices, citations such as 「第十點」 inside the 應記載事項
# refer to that same part; the notices never cite across parts by bare number.
MUST_PART = "應記載事項"


def _resolve_self_word(word: str, doc_id: str, corpus: Corpus):
    kind = SELF_WORDS[word]
    if kind == "self":
        return doc_id
    if word == "本法":
        # In the cpa implementing rules, the exceptions standard and the
        # mediation measures, article 1 defines 本法 = 消費者保護法.
        return "cpa" if doc_id in ("cpa", "cpa_er", "cpa_ex", "cpa_med") else None
    return None


def resolve(unit: dict, mentions: list[Mention], corpus: Corpus) -> list[Edge]:
    edges: list[Edge] = []
    doc_id = unit["doc_id"]
    doc_units = corpus.by_doc[doc_id]
    idx = next(i for i, u in enumerate(doc_units) if u["id"] == unit["id"])

    def mk(men, status, method, **kw):
        return Edge(from_id=unit["id"], from_doc=doc_id, status=status, raw=men.raw,
                    span=men.span, relation=men.relation, method=method,
                    locator=men.locator, **kw)

    for men in mentions:
        unit_kind = "article" if men.kind == "article" else "point"
        # ---- relative citations: 前條 / 前二點 / 次條 ---------------------
        if men.relative:
            direction, n = men.relative
            same = [u for u in doc_units if u["unit"] == unit_kind
                    and (unit_kind == "article" or u["part"] == unit["part"])]
            ids = [u["id"] for u in same]
            if unit["unit"] != unit_kind or unit["id"] not in ids:
                edges.append(mk(men, "unresolved", "relative",
                                note="relative citation from a unit of a different kind"))
                continue
            pos = ids.index(unit["id"])
            targets = same[max(0, pos - n):pos] if direction == "prev" else same[pos + 1:pos + 2]
            if direction == "prev" and len(targets) < n:
                edges.append(mk(men, "unresolved", "relative", note="not enough preceding units"))
                continue
            if not targets:
                edges.append(mk(men, "unresolved", "relative", note="no such neighbouring unit"))
                continue
            for t in targets:
                edges.append(mk(men, "resolved", "relative", to_id=t["id"], to_doc=doc_id,
                                target_number=t["no"]))
            continue

        # ---- decide which law the citation points to ----------------------
        q = men.qualifier
        target_doc: str | None = None
        method = "same-doc"
        if q is None:
            target_doc = doc_id
        elif q[0] == "self_word":
            target_doc = _resolve_self_word(q[1], doc_id, corpus)
            method = f"self-word:{q[1]}"
            if target_doc is None:
                edges.append(mk(men, "unresolved", method,
                                note=f"{q[1]} does not denote a known law in this document"))
                continue
        elif q[0] == "law":
            name = q[1]
            target_doc = corpus.name_to_doc.get(name)
            method = "named-law"
            if target_doc is None:
                num = f"{men.range_start}至{men.number}" if men.range_with_prev else men.number
                edges.append(mk(men, "external", method, target_law=name, target_number=num))
                continue
        elif q[0] == "maybe_law":
            edges.append(mk(men, "unresolved", "named-law", target_law=q[1],
                            note=f"looks like a law name but is not a known law: {q[1]}"))
            continue
        else:  # same_law with no earlier named law
            edges.append(mk(men, "unresolved", "same-law", note="同法 with no preceding law name"))
            continue

        target_kinds = corpus.docs[target_doc]["unit_kinds"]
        if unit_kind not in target_kinds:
            edges.append(mk(men, "unresolved", method,
                            note=f"{corpus.docs[target_doc]['law_name']} has no {unit_kind} units"))
            continue

        numbers = [men.number]
        range_note = ""
        if men.range_with_prev:
            # 第X條至第Y條: expand over the units lying between the endpoints (document order)
            lo_c = corpus.find(target_doc, men.kind, men.range_start,
                               unit["part"] if target_doc == doc_id and men.kind == "point" and unit["part"] == MUST_PART else None)
            hi_c = corpus.find(target_doc, men.kind, men.number,
                               unit["part"] if target_doc == doc_id and men.kind == "point" and unit["part"] == MUST_PART else None)
            if len(lo_c) != 1 or len(hi_c) != 1:
                edges.append(mk(men, "unresolved", method + "+range",
                                note="range endpoint not found or ambiguous"))
                continue
            seq = corpus.by_doc[target_doc]
            i0, i1 = seq.index(lo_c[0]), seq.index(hi_c[0])
            if i0 > i1:
                edges.append(mk(men, "unresolved", method + "+range", note="range endpoints out of order"))
                continue
            numbers = [u["no"] for u in seq[i0:i1 + 1] if u["unit"] == lo_c[0]["unit"]
                       and (lo_c[0]["unit"] == "article" or u["part"] == lo_c[0]["part"])]
            range_note = f"range {men.range_start}-{men.number}"

        for number in numbers:
            if unit_kind == "article":
                cands = corpus.find(target_doc, "article", number)
            elif target_doc == doc_id and unit["part"] == MUST_PART:
                cands = corpus.find(target_doc, "point", number, MUST_PART)
                method_used = method + "+same-part-convention"
                if len(cands) == 1:
                    edges.append(mk(men, "resolved", method_used, to_id=cands[0]["id"],
                                    to_doc=target_doc, target_number=number,
                                    note=range_note))
                    continue
            else:
                cands = corpus.find(target_doc, "point", number)
            if len(cands) == 1:
                t = cands[0]
                note = range_note
                if t["status"] == "deleted":
                    note = (note + "; " if note else "") + "target-deleted"
                edges.append(mk(men, "resolved", method + ("+range" if men.range_with_prev else ""),
                                to_id=t["id"], to_doc=target_doc, target_number=number,
                                note=note))
            elif len(cands) > 1:
                edges.append(mk(men, "ambiguous", method, to_doc=target_doc,
                                target_number=number, candidates=[c["id"] for c in cands],
                                note="same point number exists in more than one part"))
            else:
                edges.append(mk(men, "unresolved", method, to_doc=target_doc,
                                target_number=number, note="target not found in corpus"))
    return edges
