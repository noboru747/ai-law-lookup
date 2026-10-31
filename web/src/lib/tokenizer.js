// Chinese has no whitespace word boundaries, so BM25 needs a tokenizer that
// does not rely on a dictionary. We use overlapping character n-grams
// (see docs/decisions/0007-chinese-tokenizer.md for the reasoning and numbers).
//
//   "退回商品" -> bigrams 退回 回商 商品  (+ unigrams 退 回 商 品 when enabled)
//   "ABC-12"   -> latin/digit words abc, 12
//
// The same function is used for indexing and for queries.

// CJK Unified Ideographs, Extension A, and Compatibility Ideographs.
const SEGMENT = /[㐀-䶿一-鿿豈-﫿]+|[a-z0-9]+/g;

// Function words / very common legal filler. They are kept in bigrams (where
// they are part of a meaningful pair) but skipped as unigrams, because a
// single-character match on them carries no information.
export const UNIGRAM_STOP = new Set(
  Array.from('之或及與者其於為以不並係該應得有無是在而而前後項款條本法第一二三四五六七八九十'),
);

/**
 * @param {string} text
 * @param {{unigrams?: 'only'|'none'|'content'|'all'}} [opts]
 *   only    - unigrams (minus stop characters) only; used for the low-weight index field
 *   none    - bigrams only (single-char runs still emit the char)
 *   content - bigrams + unigrams except stop characters (default)
 *   all     - bigrams + every unigram
 * @returns {string[]} tokens (duplicates kept, so term frequency survives)
 */
export function tokenize(text, opts = {}) {
  const mode = opts.unigrams ?? 'content';
  if (!text) return [];
  const s = String(text).normalize('NFKC').toLowerCase();
  const out = [];
  for (const m of s.matchAll(SEGMENT)) {
    const run = m[0];
    if (!/^[a-z0-9]/.test(run)) {
      const chars = Array.from(run);
      if (chars.length === 1) {
        out.push(chars[0]);
        continue;
      }
      for (let i = 0; i < chars.length - 1; i++) out.push(chars[i] + chars[i + 1]);
      if (mode === 'only') out.length -= chars.length - 1; // drop the bigrams just pushed
      if (mode !== 'none') {
        for (const c of chars) if (mode === 'all' || !UNIGRAM_STOP.has(c)) out.push(c);
      }
    } else {
      out.push(run);
    }
  }
  return out;
}

/** Query-side variant: same tokens, de-duplicated so repeated words in a query do not double-count. */
export function tokenizeQuery(text, opts) {
  return Array.from(new Set(tokenize(text, opts)));
}
