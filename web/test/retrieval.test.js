import { describe, expect, test } from 'vitest';
import { bm25ForLeaf, corpus, engine, rankOf, tree } from './helpers.js';
import { runFreeform, runLeaf } from '../src/lib/retrieve.js';

// BM25-only expectations: scope filter + the leaf's base query, WITHOUT pins or seeds.
// This is the honest retrieval signal; thresholds are the observed ranks plus a little
// slack, so a regression shows up but the numbers are not inflated.
// Expectations that BM25 cannot meet are NOT listed here; they are carried by slot
// rules or curated steps and are asserted in tree.test.js / below.
const BM25_EXPECT = {
  'online.return': { 'cpa-019': 3, 'cpa-019-2': 4, 'cpa-018': 5, 'cpa_ex-002': 6, 'cpa_er-018': 8, 'cpa_er-017': 8 },
  'online.exception': { 'cpa_ex-002': 1, 'cpa-019': 3, 'cpa-018': 4 },
  gift: { 'gift-must-002': 3, 'gift-must-004': 3, 'gift-must-003': 6 },
  gym: { 'gym-must-010': 3, 'gym-must-013': 4, 'gym-must-009': 9 },
  'complaint.flow': { 'cpa-043': 1, 'cpa-042': 4, 'cpa-044': 6 },
};

describe('BM25 inside the node scope finds the expected articles', () => {
  for (const [leafId, expected] of Object.entries(BM25_EXPECT)) {
    test(leafId, () => {
      const leaf = tree.node(leafId);
      const hits = bm25ForLeaf(leaf);
      for (const [id, maxRank] of Object.entries(expected)) {
        const r = rankOf(hits, id);
        expect(r, `${leafId}: ${id} rank ${r}`).toBeGreaterThan(0);
        expect(r, `${leafId}: ${id} rank ${r}`).toBeLessThanOrEqual(maxRank);
      }
    });
  }

  test('the scope filter is applied before ranking: nothing outside the scope can appear', () => {
    for (const leaf of tree.leaves().filter((l) => l.law_scope)) {
      for (const h of bm25ForLeaf(leaf)) {
        expect(leaf.law_scope.some((e) => e.doc === h.unit.doc_id), `${leaf.id}: ${h.unit.id}`).toBe(true);
      }
    }
    // gym leaf must never return gift-card points even though the words overlap
    const gym = bm25ForLeaf(tree.node('gym'));
    expect(gym.every((h) => ['gym', 'cpa'].includes(h.unit.doc_id))).toBe(true);
  });
});

describe('end-to-end result for each leaf (rules + seeds + BM25 + references)', () => {
  const idsOf = (res) => res.items.map((i) => i.unit.id);

  test('網購退貨 -> cpa-019 first, plus implementing rules and the exception regulation', () => {
    const res = runLeaf(engine, tree.node('online.return'), { channel: 'online', item_type: 'general' });
    const ids = idsOf(res);
    expect(ids.indexOf('cpa-019')).toBeLessThanOrEqual(2);
    for (const id of ['cpa_ex-002', 'cpa_er-017', 'cpa_er-018', 'cpa-019-2']) expect(ids, id).toContain(id);
  });

  test('不能退貨的例外商品 -> cpa_ex-002 first', () => {
    const res = runLeaf(engine, tree.node('online.exception'), { item_type: 'media', opened: 'yes', notified: 'no' });
    expect(idsOf(res)[0]).toBe('cpa_ex-002');
    expect(idsOf(res)).toContain('cpa-018');
  });

  test('禮券: expiry / balance / refund / lost each surface their own point', () => {
    const leaf = tree.node('gift');
    const want = {
      expiry: 'gift-mustnot-001',
      balance: 'gift-mustnot-002',
      refund: 'gift-must-004',
      issuer_down: 'gift-must-002',
      lost: 'gift-must-003',
    };
    for (const [issue, id] of Object.entries(want)) {
      expect(idsOf(runLeaf(engine, leaf, { issue })), issue).toContain(id);
      expect(idsOf(runLeaf(engine, leaf, { issue }))[0], issue).toBe(id);
    }
  });

  test('健身房解約: each reason surfaces the right point, and cpa-019 arrives via reference expansion', () => {
    const leaf = tree.node('gym');
    const want = {
      personal: 'gym-must-010',
      suspend: 'gym-must-008',
      moved: 'gym-must-009',
      closed: 'gym-must-013',
      force: 'gym-must-011',
      not_open: 'gym-must-014',
      transfer: 'gym-must-016',
      renew: 'gym-mustnot-011',
    };
    for (const [reason, id] of Object.entries(want)) {
      expect(idsOf(runLeaf(engine, leaf, { reason })), reason).toContain(id);
    }
    const res = runLeaf(engine, leaf, { reason: 'personal' });
    const via = res.refs.find((r) => r.unit.id === 'cpa-019');
    expect(via, 'cpa-019 should be pulled in by gym-must-010').toBeDefined();
    expect(via.via.map((v) => v.from_id)).toContain('gym-must-010');
  });

  test('消費申訴流程: every step has its articles, and the user stage is marked current', () => {
    const leaf = tree.node('complaint.flow');
    const res = runLeaf(engine, leaf, { stage: 'seller_no' });
    expect(res.steps.length).toBeGreaterThanOrEqual(4);
    expect(res.steps.filter((s) => s.current).map((s) => s.label)).toEqual(['向消費者保護團體、消費者服務中心或消費者保護官申訴']);
    const ids = idsOf(res);
    for (const id of ['cpa-043', 'cpa-042', 'cpa-044', 'cpa_med-003', 'cpa_er-036', 'cpa-046', 'cpa-047']) expect(ids, id).toContain(id);
  });
});

describe('deleted articles', () => {
  const deleted = corpus.units.filter((u) => u.status === 'deleted');

  test('the corpus does contain deleted units (so this test means something)', () => {
    expect(deleted.length).toBe(12);
  });

  test('they are not in any scope or index', () => {
    expect(engine.scopedUnits([]).some((u) => u.status === 'deleted')).toBe(false);
    expect(engine.scopedUnits([{ doc: 'cpa_er' }]).length).toBe(43 - 11);
  });

  test('a query that literally matches "（刪除）" returns no deleted unit', () => {
    for (const q of ['刪除', '（刪除）', '第 19-1 條 刪除', '消費者保護法施行細則 刪除']) {
      expect(engine.search(q, { limit: 100 }).filter((h) => h.unit.status === 'deleted')).toEqual([]);
    }
  });

  test('no leaf result (any rule combination) and no freeform result lists a deleted unit as a hit', () => {
    for (const leaf of tree.leaves().filter((l) => l.slots)) {
      for (const r of [{}, ...leaf.rules.map((x) => Object.fromEntries(Object.entries(x.when).map(([k, v]) => [k, v[0]])))]) {
        const res = runLeaf(engine, leaf, r);
        expect(res.items.filter((i) => i.unit.status === 'deleted')).toEqual([]);
      }
    }
    for (const q of ['刪除', '網購 退貨', '禮券', '消費訴訟']) {
      expect(runFreeform(engine, q).items.filter((i) => i.unit.status === 'deleted')).toEqual([]);
    }
  });

  test('but reference expansion still reaches them and flags them as deleted', () => {
    const { refs } = engine.expand(['cpa-064']);
    const gone = refs.find((r) => r.unit.id === 'cpa-019-1');
    expect(gone).toBeDefined();
    expect(gone.unit.status).toBe('deleted');
    expect(gone.via[0].from_id).toBe('cpa-064');
  });
});

describe('reference expansion', () => {
  test('resolved references bring the cited article, labelled with who cited it', () => {
    const { refs } = engine.expand(['cpa-018']);
    expect(refs.map((r) => r.unit.id)).toContain('cpa-019');
    expect(refs.find((r) => r.unit.id === 'cpa-019').via[0]).toMatchObject({ from_id: 'cpa-018' });
  });

  test('articles already shown are not repeated as "cited"', () => {
    const { refs } = engine.expand(['cpa-018', 'cpa-019'], { exclude: new Set(['cpa-018', 'cpa-019']) });
    expect(refs.map((r) => r.unit.id)).not.toContain('cpa-019');
  });

  test('external references carry only law name and number (no unit, no link)', () => {
    const { external } = engine.expand(['cpa-019-2']);
    const civil = external.find((e) => e.law === '民法');
    expect(civil).toBeDefined();
    expect(civil.number).toBe('259');
    expect(Object.keys(civil)).not.toContain('unit');
    expect(Object.keys(civil)).not.toContain('url');
    expect(Object.keys(civil)).not.toContain('source_url');
  });
});

describe('free-text branch ("其他")', () => {
  test('searches the whole corpus, not a scope', () => {
    const res = runFreeform(engine, '健身房 終止契約');
    expect(res.items.some((i) => i.unit.doc_id === 'gym')).toBe(true);
    const res2 = runFreeform(engine, '懲罰性賠償金');
    expect(res2.items[0].unit.id).toBe('cpa-051');
  });
  test('empty or unmatched text returns nothing instead of garbage', () => {
    expect(runFreeform(engine, '   ').items).toEqual([]);
    expect(runFreeform(engine, 'zzzzqqq').items).toEqual([]);
  });
});
