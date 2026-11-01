import { describe, expect, test } from 'vitest';
import { engine, tree } from './helpers.js';
import { runLeaf } from '../src/lib/retrieve.js';
import { firstSentence, lawShortName, shortRef, splitEvidence, unitHeadline } from '../src/lib/present.js';

const u = (id) => engine.byId.get(id);

describe('names', () => {
  test('lay short names, not the long titles', () => {
    expect(shortRef(u('cpa-019'), engine.docs.cpa)).toBe('消保法 §19');
    expect(lawShortName(u('cpa_ex-001'), engine.docs.cpa_ex)).toBe('例外準則');
    expect(lawShortName(u('gift-must-001'), engine.docs.gift)).toBe('禮券規範');
    expect(shortRef(u('gym-must-001'), engine.docs.gym)).toBe('健身中心規範 應記載事項第一點');
  });
  test('every corpus doc has a lay short name', () => {
    for (const id of Object.keys(engine.docs)) expect(lawShortName({ doc_id: id, law_name: 'x' }, null), id).not.toBe('x');
  });
});

describe('one-line headlines', () => {
  test('title wins, otherwise the first sentence without its numbering', () => {
    expect(unitHeadline(u('gym-must-001'))).toBe('審閱期及當事人資料');
    expect(firstSentence('一、消費者：指以消費為目的者。其他')).toBe('消費者：指以消費為目的者。');
    expect(firstSentence('甲'.repeat(80), 10)).toBe(`${'甲'.repeat(10)}…`);
  });
  test('no article headline is empty', () => {
    for (const unit of engine.byId.values()) expect(unitHeadline(unit).length, unit.id).toBeGreaterThan(0);
  });
});

describe('splitEvidence', () => {
  const leaf = tree.node('online.return');
  const res = runLeaf(engine, leaf, { item_type: 'general' });

  test('with citations: core is exactly the cited articles, rest goes to more', () => {
    const cited = [res.items[1].unit.id];
    const { core, more } = splitEvidence({ items: res.items, refs: res.refs, cited });
    expect(core.map((i) => i.unit.id)).toEqual(cited);
    expect(more.length).toBe(res.items.length + res.refs.length - 1);
    expect(more.some((i) => i.unit.id === cited[0])).toBe(false);
  });
  test('a citation that is not on screen is ignored, never invented', () => {
    const { core } = splitEvidence({ items: res.items, refs: res.refs, cited: ['nope-1'] });
    expect(core).toEqual([]);
  });
  test('without citations (degraded): pinned articles are the core, bm25 hits are not', () => {
    const { core, more } = splitEvidence({ items: res.items, refs: res.refs });
    expect(core.length).toBeGreaterThan(0);
    expect(core.length).toBeLessThanOrEqual(5);
    expect(core.every((i) => i.source !== 'bm25')).toBe(true);
    expect(core.length + more.length).toBe(res.items.length + res.refs.length);
  });
  test('un-routed free text (no pins): top 3 hits are the core', () => {
    const items = res.items.filter((i) => i.source === 'bm25');
    const { core } = splitEvidence({ items, refs: [] });
    expect(core.length).toBe(Math.min(3, items.length));
  });
  test('deleted articles are never core', () => {
    const del = { unit: { ...res.items[0].unit, status: 'deleted' }, source: 'seed', marks: [] };
    const { core } = splitEvidence({ items: [del, ...res.items.slice(1)], refs: [] });
    expect(core.some((i) => i.unit.status === 'deleted')).toBe(false);
  });
});
