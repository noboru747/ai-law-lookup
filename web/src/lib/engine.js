import MiniSearch from 'minisearch';
import { tokenize, tokenizeQuery } from './tokenizer.js';

const arr = (x) => (Array.isArray(x) ? x : [x]);

/** Does a unit fall inside one law_scope entry? All given keys must match (AND). */
export function matchesEntry(u, e) {
  if (e.doc && e.doc !== '*' && e.doc !== u.doc_id) return false;
  if (e.part && !arr(e.part).includes(u.part)) return false;
  if (e.chapter && !(u.chapter || '').includes(e.chapter)) return false;
  if (e.section && !(u.section || '').includes(e.section)) return false;
  if (e.ids && !e.ids.includes(u.id)) return false;
  return true;
}

/** Deterministic metadata filter. `status: deleted` units never enter a scope. */
export function inScope(u, scope) {
  if (u.status === 'deleted') return false;
  if (!scope || scope.length === 0) return true;
  return scope.some((e) => matchesEntry(u, e));
}

// Bigram fields carry the main signal. The `*_uni` fields hold single characters
// and are down-weighted: they rescue lay wording that shares a character with the
// statute ("退貨" vs "退回商品") without letting one shared character outrank a
// real two-character match. See ADR 0007.
const DEFAULT_UNIGRAM_BOOST = 0.25;

function fieldsAndBoost(unigramBoost) {
  const fields = ['text', 'title', 'heading', 'law_name'];
  const boost = { title: 2, text: 1, heading: 0.5, law_name: 0.5 };
  if (unigramBoost > 0) {
    fields.push('text_uni', 'title_uni');
    boost.text_uni = unigramBoost;
    boost.title_uni = unigramBoost * 2;
  }
  return { fields, boost };
}

function toDoc(u) {
  const title = u.title || '';
  return {
    id: u.id,
    text: u.text,
    title,
    text_uni: u.text,
    title_uni: title,
    heading: [u.chapter, u.section, u.part].filter(Boolean).join(' '),
    law_name: u.law_name,
  };
}

/**
 * Retrieval engine over the whole corpus.
 *
 * Order of operations (spec section 3, steps [3] then [4]):
 *   1. filter units by the node's law_scope (metadata, deterministic)
 *   2. build / reuse a MiniSearch index over ONLY those units, so BM25's IDF
 *      reflects the scoped population
 *   3. BM25 rank
 *   4. reference expansion (resolved edges -> cited units; external -> name only)
 */
export function createEngine(corpus, { unigramBoost = DEFAULT_UNIGRAM_BOOST } = {}) {
  const { docs, units, edges } = corpus;
  const byId = new Map(units.map((u) => [u.id, u]));
  const { fields, boost } = fieldsAndBoost(unigramBoost);
  const tok = (s, field) =>
    tokenize(s, { unigrams: field && field.endsWith('_uni') ? 'only' : 'none' });
  const queryOpts = { unigrams: unigramBoost > 0 ? 'content' : 'none' };
  const indexCache = new Map();

  const edgesFrom = new Map();
  for (const e of edges) {
    if (!edgesFrom.has(e.from_id)) edgesFrom.set(e.from_id, []);
    edgesFrom.get(e.from_id).push(e);
  }

  function scopedUnits(scope) {
    return units.filter((u) => inScope(u, scope));
  }

  function indexFor(scope) {
    const key = JSON.stringify(scope ?? []);
    let hit = indexCache.get(key);
    if (!hit) {
      const scoped = scopedUnits(scope);
      const ms = new MiniSearch({
        fields,
        idField: 'id',
        tokenize: tok,
        processTerm: (t) => t,
        searchOptions: { boost, combineWith: 'OR', prefix: false, fuzzy: false },
      });
      ms.addAll(scoped.map(toDoc));
      hit = { ms, size: scoped.length };
      indexCache.set(key, hit);
    }
    return hit;
  }

  /** @returns {{unit: object, score: number, matched: string[]}[]} best first */
  function search(query, { scope, limit = 10 } = {}) {
    const { ms } = indexFor(scope);
    const terms = tokenizeQuery(query, queryOpts);
    if (terms.length === 0) return [];
    // Pass pre-tokenised terms as a query tree so the query-side de-duplication is honoured.
    const res = ms.search({ queries: terms, combineWith: 'OR' }, { tokenize: (s) => [s] });
    return res.slice(0, limit).map((r) => ({
      unit: byId.get(r.id),
      score: r.score,
      matched: Object.keys(r.match),
    }));
  }

  /**
   * One-hop reference expansion.
   * resolved edges -> the cited unit (deleted ones are still returned, flagged);
   * external edges -> law name + number only.
   * Units listed in `exclude` (already shown) are skipped, but the edge is still
   * recorded on the shown unit via `viaMap` so the UI can say who cited whom.
   */
  function expand(ids, { exclude = new Set() } = {}) {
    const cited = new Map(); // to_id -> [{from_id, raw, relation}]
    const external = [];
    const seenExt = new Set();
    for (const id of ids) {
      for (const e of edgesFrom.get(id) ?? []) {
        if (e.status === 'resolved') {
          if (exclude.has(e.to_id) || e.to_id === id) continue;
          const list = cited.get(e.to_id) ?? [];
          if (!list.some((v) => v.from_id === e.from_id && v.raw === e.raw)) {
            list.push({ from_id: e.from_id, raw: e.raw, relation: e.relation });
          }
          cited.set(e.to_id, list);
        } else if (e.status === 'external') {
          const k = `${e.from_id}|${e.target_law}|${e.target_number}`;
          if (seenExt.has(k)) continue;
          seenExt.add(k);
          external.push({
            from_id: e.from_id,
            law: e.target_law,
            number: e.target_number,
            raw: e.raw,
            relation: e.relation,
          });
        }
      }
    }
    const refs = [...cited.entries()].map(([to_id, via]) => ({ unit: byId.get(to_id), via }));
    return { refs, external };
  }

  return {
    docs,
    units,
    byId,
    search,
    expand,
    scopedUnits,
    scopeSize: (scope) => scopedUnits(scope).length,
  };
}
