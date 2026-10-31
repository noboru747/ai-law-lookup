import { describe, expect, test } from 'vitest';
import { engine, tree } from './helpers.js';
import { activeValues, ruleMatches, runLeaf } from '../src/lib/retrieve.js';

const leaves = tree.leaves();
const queryLeaves = leaves.filter((l) => l.kind === 'query' || l.kind === 'process');

describe('tree structure (data, not code)', () => {
  test('node ids are unique and every leaf has a known type', () => {
    expect(new Set(tree.nodes.keys()).size).toBe(tree.nodes.size);
    for (const l of leaves) expect(['query', 'process', 'out_of_scope', 'freeform']).toContain(l.kind);
  });

  test('depth is at most 3 levels below the root', () => {
    for (const l of leaves) expect(tree.path(l.id).length - 1).toBeLessThanOrEqual(3);
  });

  test('the five required leaves exist with the right answer kinds', () => {
    const kinds = Object.fromEntries(leaves.map((l) => [l.id, l.answer_kind]));
    expect(kinds['online.return']).toBe('rule');
    expect(kinds['online.exception']).toBe('exception');
    expect(kinds['gift']).toBe('rule');
    expect(kinds['gym']).toBe('rule');
    expect(kinds['complaint.flow']).toBe('process');
  });

  test('1-2 out_of_scope demo leaves, each naming laws that are NOT in the corpus', () => {
    const oos = leaves.filter((l) => l.kind === 'out_of_scope');
    expect(oos.length).toBeGreaterThanOrEqual(1);
    expect(oos.length).toBeLessThanOrEqual(2);
    const inCorpus = new Set(Object.values(engine.docs).map((d) => d.law_name));
    for (const l of oos) {
      expect(l.related_laws.length).toBeGreaterThan(0);
      for (const r of l.related_laws) expect(inCorpus.has(r.name)).toBe(false);
    }
  });

  test('law_scope references real documents and is never empty', () => {
    for (const l of queryLeaves) {
      for (const e of l.law_scope) expect(engine.docs[e.doc], `${l.id}: ${e.doc}`).toBeDefined();
      expect(engine.scopeSize(l.law_scope), l.id).toBeGreaterThan(0);
    }
  });

  test('slot show_if / rule when only mention real slots and real option values', () => {
    for (const l of queryLeaves) {
      const slots = new Map(l.slots.map((s) => [s.id, s]));
      const valid = (cond, where) => {
        for (const [k, allowed] of Object.entries(cond)) {
          const s = slots.get(k);
          expect(s, `${l.id} ${where}: unknown slot ${k}`).toBeDefined();
          for (const v of allowed) expect(s.options.map((o) => o.value), `${l.id} ${where}: ${k}=${v}`).toContain(v);
        }
      };
      for (const s of l.slots) if (s.show_if) valid(s.show_if, `show_if(${s.id})`);
      for (const r of l.rules) valid(r.when, 'rule');
      for (const st of l.steps ?? []) valid(st.current_when ?? {}, 'step');
    }
  });

  test('every referenced unit (seed, pin, step) exists and is active', () => {
    for (const l of queryLeaves) {
      const ids = [...l.seed, ...l.rules.flatMap((r) => (r.pin ?? []).map((p) => p.id)), ...(l.steps ?? []).flatMap((s) => s.units)];
      for (const id of ids) {
        const u = engine.byId.get(id);
        expect(u, `${l.id}: ${id}`).toBeDefined();
        expect(u.status, `${l.id}: ${id}`).toBe('active');
      }
    }
  });

  test('every highlight string is a verbatim substring of the cited article', () => {
    for (const l of queryLeaves) {
      for (const r of l.rules) {
        for (const p of r.pin ?? []) {
          for (const m of p.mark ?? []) {
            expect(engine.byId.get(p.id).text.includes(m), `${l.id}: ${p.id}: ${m}`).toBe(true);
          }
        }
      }
    }
  });
});

/** Build slot values that make `when` true and keep every involved slot visible. */
function satisfy(leaf, when) {
  const vals = {};
  for (const [k, allowed] of Object.entries(when)) vals[k] = allowed[0];
  for (let changed = true; changed; ) {
    changed = false;
    for (const s of leaf.slots) {
      if (!s.show_if || vals[s.id] === undefined) continue;
      for (const [k, allowed] of Object.entries(s.show_if)) {
        if (vals[k] === undefined) {
          vals[k] = allowed[0];
          changed = true;
        }
      }
    }
  }
  return vals;
}

describe('slot rules fire deterministically', () => {
  for (const leaf of queryLeaves) {
    test(`${leaf.id}: every rule fires, and its pins show up first, active and highlighted`, () => {
      for (const rule of leaf.rules) {
        const vals = satisfy(leaf, rule.when);
        expect(ruleMatches(rule, activeValues(leaf, vals)), JSON.stringify(rule.when)).toBe(true);
        const res = runLeaf(engine, leaf, vals);
        for (const p of rule.pin ?? []) {
          const item = res.items.find((i) => i.unit.id === p.id);
          expect(item, `${leaf.id} ${JSON.stringify(rule.when)} -> ${p.id}`).toBeDefined();
          expect(item.unit.status).toBe('active');
          for (const m of p.mark ?? []) expect(item.marks).toContain(m);
        }
        if (rule.note) expect(res.notes).toContain(rule.note);
      }
    });
  }

  test('a stale answer for a hidden slot cannot trigger a rule', () => {
    const leaf = tree.node('online.return');
    expect(activeValues(leaf, { item_type: 'general', notified: 'no', opened: 'yes' })).toEqual({ item_type: 'general' });
    const res = runLeaf(engine, leaf, { channel: 'online', item_type: 'general', notified: 'no' });
    expect(res.notes.some((n) => n.includes('沒有被告知') || n.includes('未告知'))).toBe(false);
  });

  test('perishable goods: the exception regulation is pinned ahead of search hits and highlighted', () => {
    const leaf = tree.node('online.return');
    const res = runLeaf(engine, leaf, { channel: 'online', item_type: 'fresh' });
    const first = res.items[0];
    expect(first.unit.id).toBe('cpa_ex-002');
    expect(first.source).toBe('rule');
    expect(first.marks).toContain('易於腐敗、保存期限較短或解約時即將逾期');
    expect(res.facts.map((f) => f.value).join()).toContain('生鮮');
  });

  test('received date becomes a neutral derived fact (days elapsed next to the statute period)', () => {
    const leaf = tree.node('online.return');
    const res = runLeaf(engine, leaf, { channel: 'online', item_type: 'general', received_date: '2026-10-25' }, { today: new Date(2026, 9, 31) });
    const f = res.facts.find((x) => x.slot === 'received_date');
    expect(f.derived).toContain('距今 6 日');
    expect(f.derived).toContain('七日');
    expect(f.derived).not.toMatch(/已逾|未逾|可以退|不能退/);
  });
});
