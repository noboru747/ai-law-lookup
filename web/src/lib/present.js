// Pure presentation helpers for the result page: short names, one-line summaries, and the split of
// everything retrieved into "core" (shown as evidence) and "more" (collapsed). No React here so it
// can be unit-tested.

/** Names a lay reader recognises, keyed by doc_id. Falls back to the corpus short_name. */
export const SHORT_NAMES = {
  cpa: '消保法',
  cpa_er: '施行細則',
  cpa_ex: '例外準則',
  cpa_med: '調解辦法',
  gift: '禮券規範',
  gym: '健身中心規範',
};

export function lawShortName(unit, doc) {
  return SHORT_NAMES[unit.doc_id] ?? doc?.short_name ?? unit.law_name;
}

/** "消保法 §19" for articles, "健身中心規範 應記載事項第一點" for announcement points. */
export function shortRef(unit, doc) {
  const law = lawShortName(unit, doc);
  const tail = unit.unit === 'article' ? `§${unit.no}` : unit.no_label;
  return `${law} ${tail}`;
}

const LEAD_NUMBER = /^[\s\u3000]*[（(]?[一二三四五六七八九十百零\d]+[、.)）]\s*/;

/** First sentence of the unit text, numbering stripped, capped for a one-line summary. */
export function firstSentence(text, max = 40) {
  const flat = String(text ?? '').replace(LEAD_NUMBER, '').replace(/\s+/g, ' ').trim();
  const m = /^.*?[。]/.exec(flat);
  const s = m ? m[0] : flat;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** The one line shown for a collapsed article: its heading, or else its first sentence. */
export function unitHeadline(unit) {
  return unit.title?.trim() || firstSentence(unit.text);
}

/**
 * Split what was retrieved into core evidence and the rest.
 *  - cited: ids the AI points/answer cite. When present, core = exactly those (in display order).
 *  - otherwise (degraded / failed): core = the pinned articles (rule, seed, step), capped.
 *  - un-routed free text has no pins, so core = the top few hits.
 * Everything else, plus refs, goes to `more`. Deleted articles are never core.
 */
export function splitEvidence({ items, refs = [], cited = [], coreLimit = 5 }) {
  const pool = [...items, ...refs.map((r) => ({ unit: r.unit, source: 'ref', marks: [], via: r.via }))];
  const byId = new Map(pool.map((i) => [i.unit.id, i]));
  let core;
  if (cited.length > 0) {
    core = cited.map((id) => byId.get(id)).filter(Boolean);
  } else {
    const pinned = items.filter((i) => i.source !== 'bm25' && i.unit.status !== 'deleted');
    core = (pinned.length ? pinned : items.filter((i) => i.unit.status !== 'deleted')).slice(0, pinned.length ? coreLimit : 3);
  }
  const coreIds = new Set(core.map((i) => i.unit.id));
  const more = pool.filter((i) => !coreIds.has(i.unit.id));
  return { core, more };
}
