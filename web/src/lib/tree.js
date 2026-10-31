import rawTree from '@data/tree.json';

/**
 * Resolve `$ref`s (shared slot definitions and rule sets) and index the tree.
 * Pure function so tests can feed it a modified tree.
 */
export function resolveTree(raw) {
  const { defs = {}, templates = {} } = raw;
  const nodes = new Map();
  const parent = new Map();

  function walk(node, parentId) {
    const n = { ...node };
    if (n.children) {
      n.kind = 'menu';
      n.children = n.children.map((c) => walk(c, n.id));
    } else {
      n.kind = n.type; // query | process | out_of_scope | freeform
      n.slots = (n.slots ?? []).map((s) => (s.$ref ? { ...defs.slots[s.$ref] } : s));
      n.rules = (n.rules ?? []).flatMap((r) => (r.$ref ? defs.rule_sets[r.$ref] : [r]));
      n.seed = n.seed ?? [];
      n.top_k = n.top_k ?? 6;
      n.caveat = n.caveat_ref ? templates[n.caveat_ref] : n.caveat;
    }
    nodes.set(n.id, n);
    if (parentId) parent.set(n.id, parentId);
    return n;
  }
  const root = walk(raw.root, null);

  return {
    root,
    templates,
    node: (id) => nodes.get(id),
    nodes,
    /** root -> ... -> node (inclusive) */
    path(id) {
      const out = [];
      for (let cur = id; cur; cur = parent.get(cur)) out.unshift(nodes.get(cur));
      return out;
    },
    leaves: () => [...nodes.values()].filter((n) => n.kind !== 'menu'),
  };
}

export const tree = resolveTree(rawTree);
