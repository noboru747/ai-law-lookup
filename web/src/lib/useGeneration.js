import { createContext, useContext, useEffect, useState } from 'react';
import { generate } from './generate.js';

export const HealthContext = createContext({ mode: 'degraded' });
export const useHealth = () => useContext(HealthContext);

/** Article ids that may be cited: shown hits, in display order, never deleted ones. */
export function citableIds(items) {
  return [...new Set(items.filter((i) => i.unit.status !== 'deleted').map((i) => i.unit.id))];
}

/**
 * Request for the free-text ("其他") page. Generation needs a leaf (the server rejects unknown
 * leaves), so an un-routed search deliberately gets NO request: scope unknown => no AI answer.
 */
export function freeformRequest({ routedLeaf, text, items }) {
  if (!routedLeaf || routedLeaf.kind === 'out_of_scope') return null;
  return { leafId: routedLeaf.id, slots: {}, query: text, articleIds: citableIds(items) };
}

/**
 * Generate the AI answer for a result page.
 * status: 'off' (degraded mode: nothing to show) | 'loading' | 'ok' | 'failed'
 * @param {{leafId: string, slots: object, query: string|null, articleIds: string[]} | null} request
 */
export function useGeneration(request) {
  const health = useHealth();
  const [state, setState] = useState({ key: null, status: 'loading' });
  const key = request ? JSON.stringify(request) : null;

  useEffect(() => {
    if (health.mode !== 'full' || !request || request.articleIds.length === 0) return undefined;
    let alive = true;
    generate(request).then((r) => {
      if (alive) setState({ key, ...(r.ok ? { status: 'ok', answer: r.answer, citations: r.citations, caveats: r.caveats } : { status: 'failed', reason: r.reason }) });
    });
    return () => {
      alive = false;
    };
    // `request` is fully described by `key`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, health.mode]);

  if (health.mode !== 'full' || !request || request.articleIds.length === 0) return { status: 'off' };
  return state.key === key ? state : { status: 'loading' };
}
