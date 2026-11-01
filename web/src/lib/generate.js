// Client for the generation service (spec 3.2, API contract fixed with the backend):
//
//   GET  /health    -> 200 {"status":"ok","model":"..."}        (503 when unavailable)
//   POST /rewrite   {query, leaf_id|null}              -> {terms:[...]}
//   POST /route     {text}                             -> {leaf_id|null, confidence:"high"|"low"}
//   POST /generate  {leaf_id, slots, query|null, article_ids:[...]}
//                   -> {summary?, points?:[{text, citations}], answer, citations, caveats}
//
// Rules shared by every call: any non-2xx, network error, timeout (15 s) or malformed body means
// "that feature is degraded". Nothing here ever throws, and nothing else on the page depends on it.

export const API_URL = (import.meta.env?.VITE_API_URL ?? '').trim();
export const TIMEOUT_MS = 15000;
/** Cap on article_ids sent to /generate (the server re-reads the text of every one). */
export const MAX_ARTICLES = 10;

export const MODES = {
  checking: { mode: 'checking', label: '檢查生成服務中…' },
  full: { mode: 'full', label: '完整版（已連線生成服務）' },
  degraded: { mode: 'degraded', label: '降級版（未連線生成服務）' },
};

const base = (apiUrl) => apiUrl.replace(/\/+$/, '');

/** Why a call failed, in words the UI can show. */
function describeFailure(err) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return '逾時';
  if (err?.status) return `服務回應 ${err.status}`;
  if (err?.badBody) return '服務回應格式不符';
  return '無法連線';
}

/**
 * @returns {Promise<{ok: true, data: any} | {ok: false, reason: string}>}
 */
async function call(path, { method = 'GET', body, apiUrl = API_URL, fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  if (!apiUrl) return { ok: false, reason: '未設定生成服務' };
  try {
    const res = await fetchImpl(`${base(apiUrl)}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw Object.assign(new Error(String(res.status)), { status: res.status }); // fetch does not reject on HTTP errors
    let data;
    try {
      data = await res.json();
    } catch {
      throw Object.assign(new Error('bad json'), { badBody: true });
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, reason: describeFailure(err) };
  }
}

/** Health check on page load. 2xx with {status:"ok"} => full; anything else => degraded. */
export async function checkHealth({ apiUrl = API_URL, fetchImpl, timeoutMs = 3000 } = {}) {
  if (!apiUrl) return { ...MODES.degraded, reason: 'not_configured' };
  const r = await call('/health', { apiUrl, fetchImpl, timeoutMs });
  if (r.ok && r.data?.status === 'ok') return { ...MODES.full, reason: 'ok', model: typeof r.data.model === 'string' ? r.data.model : null };
  return { ...MODES.degraded, reason: r.ok ? 'not_ok' : 'unreachable' };
}

/** Lay wording -> statute keywords. { ok:true, terms } | { ok:false, reason } */
export async function rewrite(query, leafId, opts = {}) {
  const r = await call('/rewrite', { ...opts, method: 'POST', body: { query, leaf_id: leafId ?? null } });
  if (!r.ok) return r;
  if (!Array.isArray(r.data?.terms)) return { ok: false, reason: '服務回應格式不符' };
  return { ok: true, terms: r.data.terms.filter((t) => typeof t === 'string') };
}

/** Free text -> leaf node id. { ok:true, leafId|null, confidence } | { ok:false, reason } */
export async function route(text, opts = {}) {
  const r = await call('/route', { ...opts, method: 'POST', body: { text } });
  if (!r.ok) return r;
  const { leaf_id: leafId, confidence } = r.data ?? {};
  if ((leafId !== null && typeof leafId !== 'string') || (confidence !== 'high' && confidence !== 'low')) {
    return { ok: false, reason: '服務回應格式不符' };
  }
  return { ok: true, leafId, confidence };
}

/** id of a citation given as a string or as an object carrying `article_id` / `id`. */
function citationId(c) {
  return typeof c === 'string' ? c : c && typeof c === 'object' ? (c.article_id ?? c.id) : null;
}

/**
 * Check a /generate response against what we actually sent. Two formats are understood:
 *
 *  - new: {summary, points:[{text, citations:[id]}], caveats, ...}. Each point is checked on its own:
 *    a point is kept only if it has text and EVERY citation is one of this request's article ids.
 *    Bad points are dropped; if none survive, the whole answer is rejected (nothing is shown).
 *    The legacy `answer`/`citations` fields are ignored in this case.
 *  - old: {answer, citations, caveats}. All-or-nothing: one foreign citation rejects the answer.
 *
 * Either way a model that invents or recalls an article we did not give it can never put it on screen.
 * @returns {{ok: true, summary: string, points: {text: string, citations: string[]}[], answer: string, citations: string[], caveats: string[]} | {ok: false, reason: string}}
 *   `points` is [] for the old format (the UI then shows `answer`).
 */
export function validateGeneration(data, sentIds) {
  const allowed = new Set(sentIds);
  if (data?.caveats !== undefined && !Array.isArray(data.caveats)) return { ok: false, reason: '服務回應格式不符' };
  const caveats = (data?.caveats ?? []).filter((c) => typeof c === 'string' && c.trim()).map((c) => c.trim());

  if (data && Array.isArray(data.points) && data.points.length > 0) {
    const points = [];
    for (const p of data.points) {
      if (!p || typeof p.text !== 'string' || !p.text.trim() || !Array.isArray(p.citations) || p.citations.length === 0) continue;
      const ids = p.citations.map(citationId);
      if (ids.some((id) => typeof id !== 'string' || !allowed.has(id))) continue;
      points.push({ text: p.text.trim(), citations: [...new Set(ids)] });
    }
    if (points.length === 0) return { ok: false, reason: '回答的重點都沒有可驗證的條文依據，已捨棄' };
    const summary = typeof data.summary === 'string' ? data.summary.trim() : '';
    const citations = [...new Set(points.flatMap((p) => p.citations))];
    return { ok: true, summary, points, answer: typeof data.answer === 'string' ? data.answer.trim() : '', citations, caveats };
  }

  if (!data || typeof data.answer !== 'string' || !data.answer.trim()) return { ok: false, reason: '服務回應格式不符' };
  if (!Array.isArray(data.citations)) return { ok: false, reason: '服務回應格式不符' };
  const citations = [];
  for (const c of data.citations) {
    const id = citationId(c);
    if (typeof id !== 'string' || !allowed.has(id)) return { ok: false, reason: '回答引用了未提供的條文，已捨棄' };
    if (!citations.includes(id)) citations.push(id);
  }
  return { ok: true, summary: '', points: [], answer: data.answer.trim(), citations, caveats };
}

/**
 * Ask the service to write an answer from articles it reads itself (we send ids only).
 * Never calls the network when there is nothing to cite.
 * @returns {Promise<{ok: true, answer, citations, caveats} | {ok: false, reason: string}>}
 */
export async function generate({ leafId, slots = {}, query = null, articleIds }, opts = {}) {
  const ids = [...new Set(articleIds ?? [])].slice(0, MAX_ARTICLES);
  if (ids.length === 0) return { ok: false, reason: '沒有可供整理的條文' };
  const r = await call('/generate', { ...opts, method: 'POST', body: { leaf_id: leafId, slots, query, article_ids: ids } });
  if (!r.ok) return r;
  return validateGeneration(r.data, ids);
}
