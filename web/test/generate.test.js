import { describe, expect, test, vi } from 'vitest';
import { checkHealth, generate, rewrite, route, validateGeneration, MAX_ARTICLES } from '../src/lib/generate.js';
import { assistFreeform, routableLeaf } from '../src/lib/assist.js';
import { citableIds, freeformRequest } from '../src/lib/useGeneration.js';
import { runFreeform, runLeaf } from '../src/lib/retrieve.js';
import { planQuery } from '../src/lib/glossary.js';
import { engine, tree } from './helpers.js';

const ok = (body = {}) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
const status = (code) => Promise.resolve({ ok: false, status: code, json: () => Promise.resolve({}) });
const hang = (_u, { signal }) => new Promise((_res, rej) => signal.addEventListener('abort', () => rej(signal.reason)));
const U = 'https://api.example';

/** Fake backend that follows the agreed contract; per-path overrides replace the response. */
function backend(over = {}) {
  const calls = [];
  const f = vi.fn((url, init) => {
    const path = url.replace(U, '');
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ path, method: init?.method ?? 'GET', body });
    if (over[path]) return typeof over[path] === 'function' ? over[path](body, init) : over[path];
    if (path === '/health') return ok({ status: 'ok', model: 'qwen3:14b' });
    if (path === '/rewrite') return ok({ terms: ['解除權', '通訊交易'] });
    if (path === '/route') return ok({ leaf_id: 'online.return', confidence: 'high' });
    if (path === '/generate') return ok({ answer: '可於七日內解除契約。', citations: [body.article_ids[0]], caveats: ['以原文為準'] });
    return status(404);
  });
  return { f, calls };
}

describe('health check', () => {
  test('no API_URL configured: degraded, and the network is never touched', async () => {
    const f = vi.fn();
    const h = await checkHealth({ apiUrl: '', fetchImpl: f });
    expect(h.mode).toBe('degraded');
    expect(h.label).toBe('降級版（未連線生成服務）');
    expect(f).not.toHaveBeenCalled();
  });
  test('200 {status:ok}: full, carries the model name; trailing slash tolerated', async () => {
    const { f } = backend();
    const h = await checkHealth({ apiUrl: `${U}/`, fetchImpl: f });
    expect(h).toMatchObject({ mode: 'full', model: 'qwen3:14b', label: '完整版（已連線生成服務）' });
    expect(f.mock.calls[0][0]).toBe(`${U}/health`);
  });
  test('503, network error, timeout, 200 with a body that is not status:ok: degraded', async () => {
    expect((await checkHealth({ apiUrl: U, fetchImpl: () => status(503) })).mode).toBe('degraded');
    expect((await checkHealth({ apiUrl: U, fetchImpl: () => Promise.reject(new Error('down')) })).mode).toBe('degraded');
    expect((await checkHealth({ apiUrl: U, fetchImpl: hang, timeoutMs: 20 })).mode).toBe('degraded');
    expect((await checkHealth({ apiUrl: U, fetchImpl: () => ok({ status: 'loading' }) })).mode).toBe('degraded');
    expect((await checkHealth({ apiUrl: U, fetchImpl: () => ok('nope') })).mode).toBe('degraded');
  });
});

describe('every endpoint degrades instead of throwing', () => {
  const calls = {
    rewrite: (o) => rewrite('x', null, o),
    route: (o) => route('x', o),
    generate: (o) => generate({ leafId: 'online.return', articleIds: ['cpa-019'] }, o),
  };
  for (const [name, run] of Object.entries(calls)) {
    test(name, async () => {
      const d = (fetchImpl, extra = {}) => run({ apiUrl: U, fetchImpl, ...extra });
      expect((await run({ apiUrl: '', fetchImpl: vi.fn() })).ok).toBe(false);
      const http = await d(() => status(500));
      expect(http).toEqual({ ok: false, reason: '服務回應 500' });
      expect((await d(() => status(503))).ok).toBe(false);
      expect((await d(() => Promise.reject(new TypeError('Failed to fetch')))).reason).toBe('無法連線');
      expect((await d(hang, { timeoutMs: 20 })).reason).toBe('逾時');
      const badJson = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError('bad')) });
      expect((await d(badJson)).ok).toBe(false);
      expect((await d(() => ok(null))).ok).toBe(false);
      expect((await d(() => ok({ unexpected: true }))).ok).toBe(false);
    });
  }
  test('route validates its two fields', async () => {
    const o = (body) => ({ apiUrl: U, fetchImpl: () => ok(body) });
    expect(await route('x', o({ leaf_id: 'gym', confidence: 'high' }))).toEqual({ ok: true, leafId: 'gym', confidence: 'high' });
    expect(await route('x', o({ leaf_id: null, confidence: 'low' }))).toEqual({ ok: true, leafId: null, confidence: 'low' });
    expect((await route('x', o({ leaf_id: 7, confidence: 'high' }))).ok).toBe(false);
    expect((await route('x', o({ leaf_id: 'gym', confidence: 'maybe' }))).ok).toBe(false);
  });
});

describe('request shapes follow the contract', () => {
  test('rewrite / route / generate bodies', async () => {
    const { f, calls } = backend();
    const opts = { apiUrl: U, fetchImpl: f };
    await rewrite('網購鑑賞期', 'online.return', opts);
    await rewrite('網購鑑賞期', undefined, opts);
    await route('網購鑑賞期', opts);
    await generate({ leafId: 'online.return', slots: { channel: 'online' }, query: null, articleIds: ['cpa-019', 'cpa-019', 'cpa-018'] }, opts);
    expect(calls.map((c) => [c.method, c.path])).toEqual([['POST', '/rewrite'], ['POST', '/rewrite'], ['POST', '/route'], ['POST', '/generate']]);
    expect(calls[0].body).toEqual({ query: '網購鑑賞期', leaf_id: 'online.return' });
    expect(calls[1].body).toEqual({ query: '網購鑑賞期', leaf_id: null });
    expect(calls[2].body).toEqual({ text: '網購鑑賞期' });
    expect(calls[3].body).toEqual({ leaf_id: 'online.return', slots: { channel: 'online' }, query: null, article_ids: ['cpa-019', 'cpa-018'] });
  });
  test('generate with no article ids never calls the network', async () => {
    const f = vi.fn();
    const r = await generate({ leafId: 'online.return', articleIds: [] }, { apiUrl: U, fetchImpl: f });
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  test('at most MAX_ARTICLES ids are sent, and validation uses the ids that were sent', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `a-${i}`);
    const { f, calls } = backend({ '/generate': () => ok({ answer: 'x', citations: ['a-20'], caveats: [] }) });
    const r = await generate({ leafId: 'gym', articleIds: ids }, { apiUrl: U, fetchImpl: f });
    expect(calls[0].body.article_ids).toHaveLength(MAX_ARTICLES);
    expect(r.ok).toBe(false); // a-20 was not among the first MAX_ARTICLES
  });
});

describe('citation validation (the model may only cite what we sent)', () => {
  const sent = ['cpa-019', 'cpa-018'];
  test('valid answer passes, citations de-duplicated, caveats kept', () => {
    const v = validateGeneration({ answer: ' 答 ', citations: ['cpa-019', 'cpa-019'], caveats: ['注意', '', 3] }, sent);
    expect(v).toEqual({ ok: true, answer: '答', citations: ['cpa-019'], caveats: ['注意'] });
  });
  test('one citation outside the sent ids rejects the whole answer', () => {
    const v = validateGeneration({ answer: '答', citations: ['cpa-019', 'cpa-099'], caveats: [] }, sent);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/未提供/);
  });
  test('an article that exists in the corpus but was not sent is still rejected', () => {
    expect(engine.byId.has('gift-must-003')).toBe(true);
    expect(validateGeneration({ answer: '答', citations: ['gift-must-003'] }, sent).ok).toBe(false);
  });
  test('object citations are accepted by article_id / id and checked the same way', () => {
    expect(validateGeneration({ answer: '答', citations: [{ article_id: 'cpa-018' }, { id: 'cpa-019' }] }, sent).citations).toEqual(['cpa-018', 'cpa-019']);
    expect(validateGeneration({ answer: '答', citations: [{ article_id: 'x' }] }, sent).ok).toBe(false);
    expect(validateGeneration({ answer: '答', citations: [{}] }, sent).ok).toBe(false);
    expect(validateGeneration({ answer: '答', citations: [42] }, sent).ok).toBe(false);
  });
  test('malformed bodies are rejected', () => {
    for (const bad of [null, {}, { answer: '', citations: [] }, { answer: 'x' }, { answer: 'x', citations: 'cpa-019' }, { answer: 'x', citations: [], caveats: 'no' }, { answer: 5, citations: [] }]) {
      expect(validateGeneration(bad, sent).ok, JSON.stringify(bad)).toBe(false);
    }
  });
  test('empty citations are allowed (the UI says the answer cites nothing); caveats default to []', () => {
    expect(validateGeneration({ answer: '答', citations: [] }, sent)).toEqual({ ok: true, answer: '答', citations: [], caveats: [] });
  });
  test('end to end through generate(): a hallucinated citation never reaches the caller', async () => {
    const { f } = backend({ '/generate': () => ok({ answer: '答', citations: ['cpa-099'], caveats: [] }) });
    const r = await generate({ leafId: 'online.return', articleIds: ['cpa-019'] }, { apiUrl: U, fetchImpl: f });
    expect(r).toEqual({ ok: false, reason: '回答引用了未提供的條文，已捨棄' });
  });
});

describe('free-text pipeline: route + rewrite + glossary, with every failure mode', () => {
  const run = (over) => {
    const b = backend(over);
    return assistFreeform('網購鑑賞期', { tree, api: { apiUrl: U, fetchImpl: b.f } }).then((a) => ({ a, ...b }));
  };

  test('high confidence: routed, and rewrite is told the leaf', async () => {
    const { a, calls } = await run();
    expect(a.route).toEqual({ status: 'high', leafId: 'online.return' });
    expect(a.rewrite).toEqual({ status: 'ok', terms: ['解除權', '通訊交易'] });
    expect(calls.find((c) => c.path === '/rewrite').body.leaf_id).toBe('online.return');
  });
  test('low confidence or null leaf: not routed, rewrite gets leaf_id null', async () => {
    for (const body of [{ leaf_id: 'gym', confidence: 'low' }, { leaf_id: null, confidence: 'low' }]) {
      const { a, calls } = await run({ '/route': () => ok(body) });
      expect(a.route.status).toBe('low');
      expect(a.route.leafId).toBeNull();
      expect(calls.find((c) => c.path === '/rewrite').body.leaf_id).toBeNull();
    }
  });
  test('router names a node that does not exist, a menu, or the free-text node: ignored', async () => {
    for (const leaf_id of ['nope', 'shopping', 'other', 'root']) {
      const { a } = await run({ '/route': () => ok({ leaf_id, confidence: 'high' }) });
      expect(a.route.status, leaf_id).toBe('low');
      expect(a.route.leafId).toBeNull();
    }
  });
  test('an out-of-scope leaf is a valid destination', () => {
    expect(routableLeaf(tree, 'oos.fraud')?.kind).toBe('out_of_scope');
    expect(routableLeaf(tree, 'other')).toBeNull();
  });
  test('/route fails: failed route, rewrite still tried', async () => {
    const { a } = await run({ '/route': () => status(500) });
    expect(a.route).toMatchObject({ status: 'failed', leafId: null });
    expect(a.rewrite.status).toBe('ok');
  });
  test('/rewrite fails: only the glossary is used, retrieval still works', async () => {
    const { a } = await run({ '/rewrite': () => status(502) });
    expect(a.rewrite).toMatchObject({ status: 'failed', terms: [] });
    const plan = planQuery('網購鑑賞期', { rewriteTerms: a.rewrite.terms });
    expect(plan.rewriteTerms).toEqual([]);
    expect(plan.glossaryTerms).toEqual(expect.arrayContaining(['通訊交易', '解除權']));
    expect(runFreeform(engine, '網購鑑賞期', { query: plan.query }).items.map((i) => i.unit.id)).toContain('cpa-019');
  });
  test('both fail / timeout: same result as the degraded page', async () => {
    const down = () => Promise.reject(new TypeError('Failed to fetch'));
    const { a } = await run({ '/route': down, '/rewrite': down });
    expect(a.route.status).toBe('failed');
    expect(a.rewrite.status).toBe('failed');
  });
  test('rewrite terms really change retrieval (and garbage terms are filtered)', () => {
    const plain = planQuery('東西壞了想換');
    const withTerms = planQuery('東西壞了想換', { rewriteTerms: ['瑕疵', '', null, '商品責任'] });
    expect(withTerms.rewriteTerms).toEqual(['瑕疵', '商品責任']);
    expect(withTerms.query).toBe(`${plain.query} 瑕疵 商品責任`);
  });
});

describe('routed free text uses the leaf scope without slot rules', () => {
  test('runLeaf with extraQuery and no slots: seeds + scoped BM25, no pins from rules, stays inside the scope', () => {
    const leaf = tree.node('gym');
    const plan = planQuery('健身房倒閉了會費要退嗎');
    const res = runLeaf(engine, leaf, {}, { extraQuery: plan.query });
    expect(res.notes).toEqual([]);
    expect(res.facts).toEqual([]);
    expect(res.items.every((i) => leaf.law_scope.some((e) => e.doc === i.unit.doc_id))).toBe(true);
    expect(res.items.map((i) => i.unit.id)).toContain('gym-must-013');
    expect(res.query).toContain('歇業');
  });
  test('citableIds: shown order, no duplicates, never deleted units', () => {
    const del = engine.units.find((u) => u.status === 'deleted');
    const live = engine.units.filter((u) => u.status !== 'deleted').slice(0, 2);
    const items = [{ unit: live[0] }, { unit: del }, { unit: live[1] }, { unit: live[0] }];
    expect(citableIds(items)).toEqual([live[0].id, live[1].id]);
  });
});

describe('un-routed free text never calls /generate', () => {
  const items = [{ unit: engine.byId.get('cpa-019') }];
  test('no routed leaf, or an out-of-scope leaf: no request is built, so zero network calls', async () => {
    const { f, calls } = backend();
    for (const routedLeaf of [null, undefined, tree.node('oos.fraud')]) {
      const req = freeformRequest({ routedLeaf, text: '網購鑑賞期', items });
      expect(req).toBeNull();
      if (req) await generate(req, { apiUrl: U, fetchImpl: f });
    }
    expect(calls.filter((c) => c.path === '/generate')).toHaveLength(0);
  });
  test('routed to an answerable leaf: generates with that leaf id (never "other")', async () => {
    const { f, calls } = backend();
    const req = freeformRequest({ routedLeaf: tree.node('online.return'), text: '網購鑑賞期', items });
    expect(req).toMatchObject({ leafId: 'online.return', slots: {}, query: '網購鑑賞期', articleIds: ['cpa-019'] });
    await generate(req, { apiUrl: U, fetchImpl: f });
    expect(calls.filter((c) => c.path === '/generate')).toHaveLength(1);
    expect(calls[0].body.leaf_id).not.toBe('other');
  });
});
