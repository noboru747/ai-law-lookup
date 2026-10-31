// Tiny hash router so every screen is linkable and the browser Back button works.
//   #/                      root menu
//   #/n/<node id>           menu node, or the slot form of a leaf
//   #/r/<leaf id>?k=v&...   result (slot values live in the query string)
import { useEffect, useState } from 'react';

export function parseHash(hash) {
  const raw = (hash || '').replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(qs));
  if (parts[0] === 'n' && parts[1]) return { name: 'node', id: decodeURIComponent(parts[1]), params };
  if (parts[0] === 'r' && parts[1]) return { name: 'result', id: decodeURIComponent(parts[1]), params };
  return { name: 'node', id: 'root', params: {} };
}

export function hrefNode(id) {
  return id === 'root' ? '#/' : `#/n/${encodeURIComponent(id)}`;
}

export function hrefResult(id, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString();
  return `#/r/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`;
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
