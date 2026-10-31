"""Read-only access to the official statute text and the consultation tree.

The server is the only place article text is read from: the client sends ids only.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

_CN = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}


def cn_to_int(s: str) -> int | None:
    """Chinese numeral up to 99 (enough for 點 numbers) -> int."""
    if not s:
        return None
    if "十" in s:
        a, _, b = s.partition("十")
        tens = _CN.get(a, 1) if a else 1
        if a and a not in _CN:
            return None
        if b and b not in _CN:
            return None
        return tens * 10 + (_CN[b] if b else 0)
    return _CN.get(s) if len(s) == 1 else None


@dataclass(frozen=True)
class Unit:
    id: str
    doc_id: str
    law_name: str
    unit: str
    no: str
    no_label: str
    title: str
    part: str
    status: str
    text: str


class Corpus:
    def __init__(self, data_dir: Path) -> None:
        self.units: dict[str, Unit] = {}
        for p in sorted((data_dir / "laws").glob("*.json")):
            if p.name in ("manifest.json", "references.json"):
                continue
            d = json.loads(p.read_text(encoding="utf-8"))
            for u in d.get("units", []):
                self.units[u["id"]] = Unit(
                    id=u["id"], doc_id=u["doc_id"], law_name=u["law_name"], unit=u["unit"],
                    no=str(u.get("no", "")), no_label=u.get("no_label", ""), title=u.get("title", ""),
                    part=u.get("part", ""), status=u["status"], text=u["text"],
                )
        self.tree = json.loads((data_dir / "tree.json").read_text(encoding="utf-8"))
        self.leaves: dict[str, dict] = {}
        self._collect(self.tree["root"])
        self.slot_defs: dict = self.tree.get("defs", {}).get("slots", {})

    def _collect(self, node: dict) -> None:
        if node.get("type") in ("query", "process", "out_of_scope"):
            self.leaves[node["id"]] = node
        for c in node.get("children", []) or []:
            self._collect(c)

    # -- slots -------------------------------------------------------------
    def slot_def(self, leaf_id: str, slot_id: str) -> dict | None:
        leaf = self.leaves.get(leaf_id) or {}
        for s in leaf.get("slots", []) or []:
            if isinstance(s, dict) and "$ref" in s:
                s = self.slot_defs.get(s["$ref"], {})
            if s.get("id") == slot_id:
                return s
        return None

    def describe_slots(self, leaf_id: str, slots: dict) -> list[tuple[str, str]]:
        """(label, human value) for known slots only; unknown keys are dropped."""
        out = []
        for key, val in slots.items():
            d = self.slot_def(leaf_id, key)
            if not d or val is None or val == "":
                continue
            label = d.get("label", key)
            shown = str(val)
            for o in d.get("options", []) or []:
                if o.get("value") == val:
                    shown = o.get("label", shown)
            out.append((label, shown))
        return out

    # -- numbering allowed in an answer ------------------------------------
    def allowed_numbers(self, units: list[Unit]) -> set[str]:
        """Article/point numbers an answer may legitimately mention.

        Own numbers of the supplied units, plus numbers the supplied text itself cites.
        """
        ok: set[str] = set()
        for u in units:
            ok.add(u.no)
            ok |= mentioned_numbers(u.text)
        return ok


_ART = re.compile(r"第\s*(\d+(?:\s*[-－]\s*\d+)?)\s*條(?:之\s*(\d+))?")
_ART_CN = re.compile(r"第\s*([一二三四五六七八九十]{1,3})\s*條")
_PT = re.compile(r"第\s*([一二三四五六七八九十]{1,3}|\d+)\s*點")


def _norm(n: str) -> str:
    return re.sub(r"\s*[-－之]\s*", "-", n.strip())


def mentioned_numbers(text: str) -> set[str]:
    """Normalised numbers cited as 第N條 / 第N點 in a piece of text."""
    out = {_norm(a) + (f"-{b}" if b else "") for a, b in _ART.findall(text)}
    for m in _ART_CN.findall(text) + _PT.findall(text):
        out.add(str(cn_to_int(m) or m) if not m.isdigit() else m)
    return out
