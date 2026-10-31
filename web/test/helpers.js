import { loadCorpus } from '../src/lib/corpus.js';
import { createEngine } from '../src/lib/engine.js';
import { tree } from '../src/lib/tree.js';

export const corpus = loadCorpus();
export const engine = createEngine(corpus);
export { tree };

/** 1-based rank of `id` in a BM25 result list, or 0 when absent. */
export function rankOf(hits, id) {
  return hits.findIndex((h) => h.unit.id === id) + 1;
}

/** BM25-only ranking for a leaf: scope filter + its base query, no pins, no seeds. */
export function bm25ForLeaf(leaf, extraQuery = '') {
  return engine.search(`${leaf.query} ${extraQuery}`.trim(), { scope: leaf.law_scope, limit: 60 });
}
