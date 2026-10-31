// Generation layer client (spec 3.2). Phase 2 has no backend: API_URL is empty,
// so every call degrades without touching the network. Phase 3 only has to set
// VITE_API_URL; the degradation rules below are already final.

export const API_URL = (import.meta.env?.VITE_API_URL ?? '').trim();

export const MODES = {
  full: { mode: 'full', label: '完整版（已連線生成服務）' },
  degraded: { mode: 'degraded', label: '降級版（未連線生成服務）' },
};

/**
 * Health check on page load. Any non-2xx, network error or timeout => degraded.
 * @param {{apiUrl?: string, fetchImpl?: typeof fetch, timeoutMs?: number}} [o]
 */
export async function checkHealth({ apiUrl = API_URL, fetchImpl = globalThis.fetch, timeoutMs = 3000 } = {}) {
  if (!apiUrl) return { ...MODES.degraded, reason: 'not_configured' };
  try {
    const res = await fetchImpl(`${apiUrl.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(String(res.status)); // fetch does not reject on HTTP errors
    return { ...MODES.full, reason: 'ok' };
  } catch {
    return { ...MODES.degraded, reason: 'unreachable' };
  }
}

/**
 * Ask the generation service to write an answer from retrieved articles + user facts.
 * Returns { mode: 'full', data } or { mode: 'degraded' } - never throws.
 */
export async function generate(payload, { apiUrl = API_URL, fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  if (!apiUrl) return { mode: 'degraded' };
  try {
    const res = await fetchImpl(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(String(res.status));
    return { mode: 'full', data: await res.json() };
  } catch {
    return { mode: 'degraded' };
  }
}
