// Deterministic "answer assembly" for one tree leaf (spec section 3, steps [2]-[4]).
// No model involved: slot values -> rules -> pins/marks/notes, then scope filter + BM25,
// then reference expansion.

const MS_PER_DAY = 86400000;

/** A slot is visible when every key of its show_if matches the (already visible) values. */
function slotVisible(slot, values) {
  if (!slot.show_if) return true;
  return Object.entries(slot.show_if).every(([k, allowed]) => allowed.includes(values[k]));
}

/** Drop values of hidden or unknown slots (so a stale answer cannot trigger a rule). */
export function activeValues(leaf, values) {
  const out = {};
  for (const s of leaf.slots ?? []) {
    if (!slotVisible(s, out)) continue;
    const v = values?.[s.id];
    if (v !== undefined && v !== '') out[s.id] = v;
  }
  return out;
}

export function ruleMatches(rule, vals) {
  return Object.entries(rule.when ?? {}).every(([k, allowed]) => vals[k] !== undefined && allowed.includes(vals[k]));
}

function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}

/** "Facts" = what the user told us, echoed back next to the articles (plus derived numbers). */
export function buildFacts(leaf, vals, today = new Date()) {
  const facts = [];
  const t0 = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  for (const s of leaf.slots ?? []) {
    const v = vals[s.id];
    if (v === undefined) continue;
    if (s.type === 'select') {
      const opt = s.options.find((o) => o.value === v);
      facts.push({ slot: s.id, label: s.label.replace(/[？?]$/, ''), value: opt ? opt.label : v });
    } else if (s.type === 'date') {
      const d = parseDate(v);
      const fact = { slot: s.id, label: s.label, value: v };
      if (d !== null && s.derive?.kind === 'days_since') {
        const days = Math.round((t0 - d) / MS_PER_DAY);
        fact.derived =
          days < 0
            ? '這個日期晚於今天，請確認是否填錯。'
            : `距今 ${days} 日。條文所載期間為「${s.derive.statute_period}」；起算方式與例外請對照條文，本系統不判斷是否逾期。`;
        fact.cite = s.derive.cite;
      }
      facts.push(fact);
    } else {
      facts.push({ slot: s.id, label: s.label, value: v });
    }
  }
  return facts;
}

/**
 * Item = { unit, source: 'rule'|'seed'|'step'|'bm25', marks: string[], score?: number }
 */
export function runLeaf(engine, leaf, values, { today = new Date() } = {}) {
  const vals = activeValues(leaf, values);
  const facts = buildFacts(leaf, vals, today);
  const fired = (leaf.rules ?? []).filter((r) => ruleMatches(r, vals));
  const notes = [...new Set(fired.map((r) => r.note).filter(Boolean))];

  const items = new Map(); // id -> Item, insertion order = display order
  const put = (id, source, marks = [], extra = {}) => {
    const unit = engine.byId.get(id);
    if (!unit) return;
    const cur = items.get(id);
    if (cur) {
      for (const m of marks) if (!cur.marks.includes(m)) cur.marks.push(m);
      return;
    }
    items.set(id, { unit, source, marks: [...marks], ...extra });
  };

  // 1. rule pins (slot answers) first, then curated seeds, then "background" pins
  //    (definitions etc. that explain a note but should not outrank the core article)
  const pins = fired.flatMap((r) => r.pin ?? []);
  for (const p of pins) if (!p.background) put(p.id, 'rule', p.mark ?? []);
  for (const id of leaf.seed ?? []) put(id, 'seed');
  for (const p of pins) if (p.background) put(p.id, 'rule', p.mark ?? []);

  // 2. step units for process leaves
  const steps = (leaf.steps ?? []).map((st) => {
    const current = st.current_when ? ruleMatches({ when: st.current_when }, vals) : false;
    for (const id of st.units) put(id, 'step');
    return { label: st.label, current, unitIds: st.units };
  });

  // 3. BM25 inside the scope
  const query = [leaf.query, ...fired.map((r) => r.add_query)].filter(Boolean).join(' ');
  const hits = engine.search(query, { scope: leaf.law_scope, limit: 40 });
  let added = 0;
  for (const h of hits) {
    if (items.has(h.unit.id)) {
      items.get(h.unit.id).score = h.score;
      continue;
    }
    if (added >= (leaf.top_k ?? 6)) continue;
    put(h.unit.id, 'bm25', [], { score: h.score });
    added++;
  }

  // 4. reference expansion (one hop, from everything shown)
  const shown = new Set(items.keys());
  const { refs, external } = engine.expand([...shown], { exclude: shown });

  return { facts, notes, items: [...items.values()], steps, refs, external, query, vals };
}

/** Free-text search over the whole corpus (the "其他" branch). No slots, no pins. */
export function runFreeform(engine, text, { limit = 10 } = {}) {
  const hits = text.trim() ? engine.search(text, { limit }) : [];
  const items = hits.map((h) => ({ unit: h.unit, source: 'bm25', marks: [], score: h.score }));
  const shown = new Set(items.map((i) => i.unit.id));
  const { refs, external } = engine.expand([...shown], { exclude: shown });
  return { items, refs, external, query: text };
}
