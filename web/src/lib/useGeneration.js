import { createContext, useContext, useEffect, useState } from 'react';
import { generate } from './generate.js';

export const HealthContext = createContext({ mode: 'degraded' });
export const useHealth = () => useContext(HealthContext);

/** Article ids that may be cited: shown hits, in display order, never deleted ones. */
export function citableIds(items) {
  return [...new Set(items.filter((i) => i.unit.status !== 'deleted').map((i) => i.unit.id))];
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
