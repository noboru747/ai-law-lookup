# data/

Phase 1 output: official statute text as structured JSON, plus the raw sources it was built from.

```
data/
  raw/                       original source material (verbatim, committed)
    manifest.json            URL, SHA-256, size and fetch time of every source file
    moj/<pcode>.json         the law's original JSON object from the MOJ Open API
    moj/law_names.json       names of all statutes (used only to recognise "民法第N條"-style citations)
    ey/gift.odt|html         商品(服務)禮券 notice: attachment + detail page (Executive Yuan)
    ey/gym.pdf|html          健身中心 notice: attachment + detail page (Executive Yuan)
    _cache/                  large open-data ZIPs (git-ignored, re-fetched by fetch_moj.py)
  laws/                      built corpus (generated, committed)
    manifest.json            document index, snapshot date, open-data update date, license
    <doc_id>.json            one file per document: {schema_version, doc, units[]}
    references.json          cross-reference edge table
```

Rebuild: `python scripts/fetch_moj.py && python scripts/fetch_ey.py && python scripts/build_corpus.py && python scripts/validate.py`
(`fetch_*` use cached files unless `--force`; builds are deterministic.)

## Documents

| doc_id | Name | Source | Units |
|---|---|---|---|
| `cpa` | 消費者保護法 (pcode J0170001) | 全國法規資料庫 open data | 78 articles (1 deleted) |
| `cpa_er` | 消費者保護法施行細則 (J0170002) | 全國法規資料庫 open data | 43 articles (11 deleted) |
| `cpa_ex` | 通訊交易解除權合理例外情事適用準則 (J0170012) | 全國法規資料庫 open data | 4 articles |
| `cpa_med` | 消費爭議調解辦法 (J0170008) | 全國法規資料庫 open data | 33 articles |
| `gift` | 商品(服務)禮券定型化契約應記載及不得記載事項 | 行政院網站 (ODT) | 1 preamble + 16 points + 19 appendix rows |
| `gym` | 健身中心定型化契約應記載及不得記載事項 | 行政院網站 (PDF) | 37 points |

## Design: one flat "unit" record for everything

A **unit** is the smallest citable piece: an article (條), a point (點), the preamble (前言) or one row of the appendix table (附表). All units share one schema so that the Phase 2 front end can index them in one MiniSearch instance and filter on flat fields (`doc_id`, `unit`, `part`, `chapter`, `section`, `status`).

### Unit fields

| Field | Meaning |
|---|---|
| `id` | Globally unique, stable. Articles: `<doc_id>-<3-digit no>[-<sub>]` (`cpa-019`, `cpa-019-1`). Points: `<doc_id>-must|mustnot-<3-digit no>` (`gym-must-010`). Others: `gift-pre`, `gift-tbl-03`. |
| `doc_id`, `law_name` | Owning document and its official name. |
| `unit` | `article` \| `point` \| `preamble` \| `table_row` |
| `no`, `no_label` | Number as a string (`"19-1"`, `"10"`) and its display form (`第 19-1 條`, `應記載事項第十點`). |
| `title` | Point heading when the source has one (gym: `可歸責消費者事由之終止與效果`), table row: 行業別. Else `""`. |
| `part` | Points: `應記載事項` / `不得記載事項` / `前言` / `附表`. Articles: `""`. |
| `chapter`, `section` | Flat copies of the 編/章 and 節 heading labels the article sits under (`""` if none). |
| `hierarchy` | Full heading chain, `[{level, label}]` (法規 → 章 → 節). |
| `path` | `[law_name, ...heading labels, part]`, ready for display or breadcrumbs. |
| `order` | 1-based position in the document. |
| `status` | `active` \| `deleted`. Deleted articles (`（刪除）`) are kept so that numbering and "前條" stay correct; filter them out of search. |
| `text` | Official wording, verbatim. Paragraphs separated by `\n`. Point markers (`一、`) are kept. |
| `references` | Ids of in-scope units this unit cites (resolved only, de-duplicated). |
| `external_references` | Citations of laws outside the corpus: `{law, number, raw}`. |
| `unresolved_references` | Citations that could not be pinned down: `{raw, status: unresolved\|ambiguous, note, candidates?}`. |
| `source_url`, `fetched_at` | Page the text came from; when it was fetched (ISO 8601 with offset). |
| `fields`, `inherited_fields` | `table_row` only: structured cells; names of cells inherited from a row-spanned cell above. |

### Document header (`doc`)

`doc_id`, `law_name`, `short_name`, `aliases`, `doc_type`, `unit_kind`, `authority` (主管機關), `unit_count`, `unit_counts_by_kind`, `deleted_unit_count`, and `source`:

| `source` field | Meaning |
|---|---|
| `source_type` | `open_data` (全國法規資料庫 Open API) \| `ey_webpage` (行政院網站) |
| `publisher` | Who published it (法務部 全國法規資料庫 / 行政院全球資訊網). |
| `source_url` | Human-readable official page. `file_url` / `api_url`: the machine download. |
| `fetched_at` | When the file was downloaded. |
| `open_data_update_date` | Open-data dumps only: the dump's own `UpdateDate` (the authoritative "as of" for the content). |
| `raw_file`, `raw_sha256` | Verbatim source kept in `data/raw/`, with hash. |
| `license`, `attribution` | 政府資料開放授權條款-第1版; attribution text (see `NOTICE.md`). |

Document-level facts the source happens to carry are kept as-is and not processed further: `law_modified_date`, `law_effective_date` (MOJ docs), `announcement` and `announcement_page_lines` (the official announcement text and 令號 history, industry notices). There is deliberately **no per-article amendment date** (see ADR 0006).

### Example (`data/laws/gym.json`, abbreviated)

```json
{
  "id": "gym-must-010",
  "doc_id": "gym",
  "law_name": "健身中心定型化契約應記載及不得記載事項",
  "unit": "point",
  "no": "10",
  "no_label": "應記載事項第十點",
  "title": "可歸責消費者事由之終止與效果",
  "part": "應記載事項",
  "chapter": "", "section": "", "hierarchy": [],
  "path": ["健身中心定型化契約應記載及不得記載事項", "應記載事項"],
  "order": 10,
  "status": "active",
  "text": "十、可歸責消費者事由之終止與效果\n消費者於契約期間屆滿前，得隨時終止契約。\n…\n消費者係以通訊交易或訪問交易訂約者，雖已使用業者設施，七日內仍可適用消費者保護法第十九條解除契約。",
  "references": ["cpa-019"],
  "external_references": [],
  "unresolved_references": [],
  "source_url": "https://www.ey.gov.tw/Page/DFB720D019CCCB0A/a8a9e88e-6f7a-49bc-a4d7-d990a1d9840d",
  "fetched_at": "2026-10-31T22:27:36+08:00"
}
```

## Reference table (`references.json`)

`{schema_version, stats, edges[]}`. One edge per (citation, target unit); a range such as `第十八條至第十九條之二` yields one edge per unit in the range, all sharing `raw` and `span`.

| Edge field | Meaning |
|---|---|
| `from_id`, `from_doc` | Citing unit. |
| `raw`, `span` | Matched text and `[start, end)` offsets in the citing unit's `text` (`text[span] == raw`). |
| `status` | `resolved` (in-scope target) \| `external` (law outside the corpus) \| `ambiguous` (several candidate units) \| `unresolved` (cannot be determined, never guessed). |
| `to_id`, `to_doc`, `target_number` | Target for `resolved`. |
| `target_law`, `target_number` | Law name and number for `external`. |
| `candidates` | Candidate unit ids for `ambiguous`. |
| `method` | How the target law/unit was decided: `same-doc`, `self-word:本法`, `named-law`, `relative` (前條/前二點/次條), `+range`, `+same-part-convention`. |
| `relation` | `refers` \| `mutatis_mutandis` (準用 within 12 characters before the citation). |
| `locator` | Paragraph/item part kept as text (`第一項第二款`); not resolved below unit level. |
| `note` | Reason for `unresolved`/`ambiguous`; `target-deleted`, `range a-b`. |

Rules in `scripts/refs.py`:

- `本法` means 消費者保護法 in the four 消保法 documents (each defines it in article 1); `本細則/本準則/本辦法/本事項` mean the document itself; `同法` repeats the last named law; `X法（以下簡稱本法）第N條` is read through the abbreviation.
- Law names are recognised only when they match an official statute name (`moj/law_names.json`) or an in-scope document. A string that merely looks like a law name stays `unresolved`.
- Point citations (`第十點`) inside a document's 應記載事項 resolve to the same part, which is how both notices cite themselves. From any other part the same number is `ambiguous`.
- `前項`, `前款`, `本條` etc. point inside the same unit and are not recorded.

## Validation

`python scripts/validate.py` (7,880 checks at the time of writing) reconciles the output with the raw sources: counts, verbatim text, required fields, unique ids, contiguous point numbers, reference targets and spans, hashes, attribution notice. `python scripts/test_refs.py` unit-tests the reference parser.
