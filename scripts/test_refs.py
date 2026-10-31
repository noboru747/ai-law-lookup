"""Unit tests for the reference parser. Run: python scripts/test_refs.py"""
import unittest

from refs import Corpus, cn2int, find_mentions, resolve, set_known_names


def art(doc, no, order, text="x", status="active"):
    return {"id": f"{doc}-{no}", "doc_id": doc, "unit": "article", "no": no, "part": "",
            "order": order, "status": status, "text": text}


def pt(doc, part, no, order, text="x"):
    return {"id": f"{doc}-{part}-{no}", "doc_id": doc, "unit": "point", "no": no, "part": part,
            "order": order, "status": "active", "text": text}


DOCS = {
    "cpa": {"law_name": "消費者保護法", "aliases": [], "unit_kinds": {"article"}},
    "cpa_er": {"law_name": "消費者保護法施行細則", "aliases": [], "unit_kinds": {"article"}},
    "n": {"law_name": "某某事項", "aliases": [], "unit_kinds": {"point"}},
}
UNITS = (
    [art("cpa", n, i + 1, status="deleted" if n == "19-1" else "active")
     for i, n in enumerate([str(k) for k in range(1, 20)] + ["19-1"] + [str(k) for k in range(20, 30)])]
    + [art("cpa_er", str(i), i) for i in range(1, 6)]
    + [pt("n", "應記載事項", str(i), i) for i in range(1, 6)]
    + [pt("n", "不得記載事項", str(i), 10 + i) for i in range(1, 4)]
)
set_known_names(["消費者保護法", "消費者保護法施行細則", "民法", "民事訴訟法", "某某事項"])
CORPUS = Corpus(DOCS, UNITS)


def run(unit_id, text):
    u = next(x for x in UNITS if x["id"] == unit_id)
    u = dict(u, text=text)
    return resolve(u, find_mentions(text), CORPUS)


class Numerals(unittest.TestCase):
    def test_values(self):
        for s, n in [("十九", 19), ("四百三十六", 436), ("二十", 20), ("一百零一", 101), ("五", 5), ("19", 19)]:
            self.assertEqual(cn2int(s), n)


class Parsing(unittest.TestCase):
    def test_plain_article_same_doc(self):
        e = run("cpa-5", "依第十九條規定")
        self.assertEqual([(x.status, x.to_id) for x in e], [("resolved", "cpa-19")])

    def test_sub_number(self):
        e = run("cpa-5", "準用第十九條之一")
        self.assertEqual(e[0].to_id, "cpa-19-1")
        self.assertEqual(e[0].relation, "mutatis_mutandis")
        self.assertIn("target-deleted", e[0].note)

    def test_self_word_law_from_rules(self):
        e = run("cpa_er-2", "本法第十九條第一項")
        self.assertEqual((e[0].status, e[0].to_id, e[0].locator), ("resolved", "cpa-19", "第一項"))

    def test_named_in_scope_law(self):
        e = run("n-應記載事項-3", "依消費者保護法第十九條解除")
        self.assertEqual(e[0].to_id, "cpa-19")

    def test_external_law_and_list_continuation(self):
        e = run("cpa-5", "民事訴訟法第二十八條第二項、第四百三十六條之九")
        self.assertEqual([(x.status, x.target_law, x.target_number) for x in e],
                         [("external", "民事訴訟法", "28"), ("external", "民事訴訟法", "436-9")])

    def test_range_expands_in_document_order(self):
        e = run("cpa-29", "第十八條至第二十條")
        self.assertEqual([x.to_id for x in e], ["cpa-18", "cpa-19", "cpa-19-1", "cpa-20"])
        self.assertEqual(e[0].raw, "第十八條至第二十條")

    def test_relative(self):
        self.assertEqual([x.to_id for x in run("cpa-5", "依前條規定")], ["cpa-4"])
        self.assertEqual([x.to_id for x in run("cpa-5", "前二條")], ["cpa-3", "cpa-4"])
        self.assertEqual([x.to_id for x in run("cpa-5", "次條")], ["cpa-6"])

    def test_relative_without_enough_units_is_unresolved(self):
        e = run("cpa-1", "依前條規定")
        self.assertEqual(e[0].status, "unresolved")

    def test_missing_target_is_unresolved_not_guessed(self):
        e = run("cpa-5", "依第九十九條")
        self.assertEqual((e[0].status, e[0].to_id), ("unresolved", None))

    def test_unknown_law_name_is_unresolved(self):
        e = run("cpa-5", "依某某特別法第三條")
        self.assertEqual(e[0].status, "unresolved")

    def test_same_law_without_antecedent(self):
        e = run("cpa-5", "同法第三條")
        self.assertEqual(e[0].status, "unresolved")

    def test_same_law_with_antecedent(self):
        e = run("cpa-5", "民法第一條及同法第二條")
        self.assertEqual([x.target_law for x in e], ["民法", "民法"])

    def test_article_cited_in_point_document_is_unresolved(self):
        e = run("n-應記載事項-1", "第三條")
        self.assertEqual(e[0].status, "unresolved")

    def test_points_same_part_convention(self):
        e = run("n-應記載事項-4", "依第二點規定")
        self.assertEqual((e[0].status, e[0].to_id), ("resolved", "n-應記載事項-2"))

    def test_points_from_other_part_are_ambiguous(self):
        e = run("n-不得記載事項-2", "依第二點規定")
        self.assertEqual(e[0].status, "ambiguous")
        self.assertEqual(sorted(e[0].candidates), ["n-不得記載事項-2", "n-應記載事項-2"])

    def test_intra_unit_references_are_ignored(self):
        self.assertEqual(run("cpa-5", "前項及本條第二項、前款規定"), [])


if __name__ == "__main__":
    unittest.main()
