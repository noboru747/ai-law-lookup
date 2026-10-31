// The two LLM helpers that run BEFORE retrieval on the "其他" (free text) branch:
//   /route   - which consultation-tree leaf does this text belong to?
//   /rewrite - lay wording -> statute keywords
// Both are optional. Whatever happens here, the deterministic path (glossary + BM25) still runs.
import { route as apiRoute, rewrite as apiRewrite } from './generate.js';
import { sanitizeTerms } from './glossary.js';

export const SKIPPED = Object.freeze({
  route: { status: 'skipped', leafId: null },
  rewrite: { status: 'skipped', terms: [] },
});

/** A leaf the router may send the user to: answerable (query/process) or a known out-of-scope page. */
export function routableLeaf(tree, id) {
  const n = typeof id === 'string' ? tree.node(id) : null;
  return n && ['query', 'process', 'out_of_scope'].includes(n.kind) ? n : null;
}

/**
 * @param {string} text
 * @param {{ tree: object, api?: object }} deps  `api` is forwarded to the client (apiUrl, fetchImpl, timeoutMs)
 * @returns {Promise<{route: {status: 'high'|'low'|'failed', leafId: string|null, reason?: string},
 *                    rewrite: {status: 'ok'|'failed', terms: string[], reason?: string}}>}
 */
export async function assistFreeform(text, { tree, api = {} }) {
  const r = await apiRoute(text, api);
  let route;
  if (!r.ok) route = { status: 'failed', leafId: null, reason: r.reason };
  else if (r.confidence === 'high' && routableLeaf(tree, r.leafId)) route = { status: 'high', leafId: r.leafId };
  else route = { status: 'low', leafId: null, reason: r.confidence === 'high' ? '服務指定的節點不存在，已忽略' : undefined };

  // /rewrite rejects out_of_scope leaves (400), so only answerable leaves are passed as context
  const ctx = route.status === 'high' ? tree.node(route.leafId) : null;
  const w = await apiRewrite(text, ctx && ctx.kind !== 'out_of_scope' ? ctx.id : null, api);
  const rewrite = w.ok ? { status: 'ok', terms: sanitizeTerms(w.terms) } : { status: 'failed', terms: [], reason: w.reason };
  return { route, rewrite };
}
