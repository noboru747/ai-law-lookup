// Deterministic query expansion: lay wording -> statute wording (ADR 0010).
// Pure and synchronous, so it works in the degraded (no backend) mode too.
//
// Two mechanisms:
//   1. data/glossary.json  - curated entries { from: [aliases], to: [statute terms], note }
//   2. built-in numeral rules - "7天" -> "七日", "30%" -> "百分之三十", "3倍" -> "三倍"
//      (statutes write Chinese numerals and count in 日; BM25 sees them as unrelated tokens)
//
// Expansion only ADDS terms after the user's own text; nothing the user typed is removed.
import rawGlossary from '@data/glossary.json';

const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase();

const DIGITS = '零一二三四五六七八九';
/** 1-99 -> Chinese numeral, otherwise null. */
export function toChineseNumber(n) {
  if (!Number.isInteger(n) || n < 1 || n > 99) return null;
  if (n < 10) return DIGITS[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return (tens === 1 ? '十' : `${DIGITS[tens]}十`) + (ones ? DIGITS[ones] : '');
}

const UNIT_MAP = { 天: '日', 日: '日', 個月: '個月', 月: '月', 年: '年', 倍: '倍', 小時: '小時' };
const ARABIC_UNIT = /(?<!\d)(\d{1,2})\s*(個月|小時|天|日|月|年|倍)/g;
const ARABIC_PERCENT = /(?<!\d)(\d{1,2})\s*%/g;
const CN_DAYS = /([一二三四五六七八九十]{1,3})天/g;

function numeralTerms(text) {
  const out = [];
  for (const m of text.matchAll(ARABIC_UNIT)) {
    const cn = toChineseNumber(Number(m[1]));
    if (cn) out.push({ matched: m[0], to: [`${cn}${UNIT_MAP[m[2]]}`], note: '阿拉伯數字轉中文數字；條文以中文數字、以「日」計期間' });
  }
  for (const m of text.matchAll(ARABIC_PERCENT)) {
    const cn = toChineseNumber(Number(m[1]));
    if (cn) out.push({ matched: m[0], to: [`百分之${cn}`], note: '百分比轉條文寫法' });
  }
  for (const m of text.matchAll(CN_DAYS)) {
    out.push({ matched: m[0], to: [`${m[1]}日`], note: '條文以「日」計期間，不寫「天」' });
  }
  return out;
}

/** Normalise the glossary once (lower-cased aliases). */
export function compileGlossary(raw = rawGlossary) {
  return (raw.entries ?? []).map((e) => ({ from: e.from.map(norm), fromRaw: e.from, to: e.to, note: e.note ?? '' }));
}

const DEFAULT = compileGlossary();

/**
 * @param {string} text user's own words
 * @param {ReturnType<typeof compileGlossary>} [glossary]
 * @returns {{ applied: {matched: string, to: string[], note: string}[], added: string[] }}
 *   `applied` is for the trace UI; `added` is the de-duplicated list of terms appended to the query.
 */
export function expandGlossary(text, glossary = DEFAULT) {
  const t = norm(text);
  const applied = [];
  if (!t.trim()) return { applied, added: [] };
  for (const e of glossary) {
    // longest matching alias, so the trace shows the most specific one
    const hit = [...e.from.keys()].filter((i) => t.includes(e.from[i])).sort((a, b) => e.from[b].length - e.from[a].length)[0];
    if (hit !== undefined) applied.push({ matched: e.fromRaw[hit], to: e.to, note: e.note });
  }
  applied.push(...numeralTerms(t));
  const added = [];
  for (const a of applied) for (const w of a.to) if (!added.includes(w)) added.push(w);
  return { applied, added };
}

/** Clean a list of terms coming from the LLM: strings only, trimmed, bounded, de-duplicated. */
export function sanitizeTerms(terms, { max = 12, maxLen = 20 } = {}) {
  if (!Array.isArray(terms)) return [];
  const out = [];
  for (const w of terms) {
    if (typeof w !== 'string') continue;
    const s = w.normalize('NFKC').trim();
    if (!s || s.length > maxLen || out.includes(s)) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Build the string that is actually handed to BM25, plus everything the UI needs to show where
 * each term came from.  Terms are separated by spaces so the tokenizer never forms a bigram
 * across two terms.
 * @param {string} text
 * @param {{ rewriteTerms?: string[], glossary?: object }} [o]
 */
export function planQuery(text, { rewriteTerms = [], glossary = DEFAULT } = {}) {
  const original = String(text ?? '').trim();
  const { applied, added } = expandGlossary(original, glossary);
  const rewrite = sanitizeTerms(rewriteTerms).filter((w) => !added.includes(w));
  const query = [original, ...added, ...rewrite].filter(Boolean).join(' ');
  return { original, applied, glossaryTerms: added, rewriteTerms: rewrite, query };
}
