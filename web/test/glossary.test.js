import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import { corpus, engine } from './helpers.js';
import { SMOKE } from './smoke-queries.js';
import { compileGlossary, expandGlossary, planQuery, sanitizeTerms, toChineseNumber } from '../src/lib/glossary.js';
import raw from '../../data/glossary.json';

function metrics(searchFn) {
  let rr = 0, h5 = 0, h10 = 0;
  const rows = [];
  for (const [q, exp] of SMOKE) {
    const ids = searchFn(q).map((h) => h.unit.id);
    const ranks = exp.map((e) => ids.indexOf(e) + 1).filter((r) => r > 0);
    const best = ranks.length ? Math.min(...ranks) : 0;
    rr += best ? 1 / best : 0;
    if (best && best <= 5) h5++;
    if (best && best <= 10) h10++;
    rows.push({ q, best });
  }
  return { mrr: rr / SMOKE.length, h5, h10, rows };
}

describe('glossary file integrity', () => {
  const text = corpus.units.filter((u) => u.status !== 'deleted').map((u) => `${u.title ?? ''}${u.text}`).join('\n');

  test('every target term really occurs in the (non-deleted) corpus', () => {
    const missing = [];
    for (const e of raw.entries) for (const w of e.to) if (!text.includes(w)) missing.push(`${e.from[0]} -> ${w}`);
    expect(missing).toEqual([]);
  });
  test('every entry has aliases, targets and a note; no alias is empty or duplicated', () => {
    const seen = new Map();
    for (const e of raw.entries) {
      expect(e.from.length).toBeGreaterThan(0);
      expect(e.to.length).toBeGreaterThan(0);
      expect(e.note.length).toBeGreaterThan(5);
      for (const a of e.from) {
        expect(a.trim()).not.toBe('');
        expect(seen.has(a), `duplicate alias ${a}`).toBe(false);
        seen.set(a, true);
      }
    }
  });
});

describe('expansion is deterministic and only adds terms', () => {
  test('7天 / 七天 / 30天 -> statute numerals in 日', () => {
    expect(expandGlossary('7天內退貨').added).toContain('七日');
    expect(expandGlossary('七天鑑賞期').added).toContain('七日');
    expect(expandGlossary('30天內').added).toContain('三十日');
    expect(expandGlossary('12天').added).toContain('十二日');
  });
  test('percent and multiples', () => {
    expect(expandGlossary('手續費20%').added).toContain('百分之二十');
    expect(expandGlossary('賠3倍').added).toContain('三倍');
  });
  test('numbers that are not quantities are left alone (1950 hotline, article numbers)', () => {
    expect(expandGlossary('第19條').added).toEqual([]);
    expect(expandGlossary('打1950').added.some((w) => /[日倍年月]$/.test(w))).toBe(false);
    expect(toChineseNumber(100)).toBeNull();
    expect(toChineseNumber(21)).toBe('二十一');
    expect(toChineseNumber(10)).toBe('十');
  });
  test('the examples from the brief', () => {
    const t = (s) => expandGlossary(s).added;
    expect(t('鑑賞期')).toContain('解除權');
    expect(t('生鮮食品')).toContain('易於腐敗');
    expect(t('內衣褲')).toContain('個人衛生用品');
    expect(t('店家倒閉')).toContain('歇業');
    expect(t('電商')).toContain('通訊交易');
    expect(t('網購')).toContain('通訊交易');
    expect(t('退錢')).toContain('返還');
  });
  test('planQuery keeps the original text first, separates terms with spaces, de-duplicates rewrite terms', () => {
    const p = planQuery('網購鑑賞期', { rewriteTerms: ['解除權', '七日內', '七日內', '', 3, '通訊交易'] });
    expect(p.query.startsWith('網購鑑賞期 ')).toBe(true);
    expect(p.rewriteTerms).toEqual(['七日內']); // 解除權 and 通訊交易 already came from the glossary
    expect(p.query.split(' ').filter((w) => w === '解除權')).toHaveLength(1);
    expect(p.applied.map((a) => a.matched)).toEqual(expect.arrayContaining(['網購', '鑑賞期']));
  });
  test('empty input expands to nothing', () => {
    expect(planQuery('   ').query).toBe('');
    expect(expandGlossary('').added).toEqual([]);
  });
  test('LLM terms are bounded and cleaned', () => {
    expect(sanitizeTerms('nope')).toEqual([]);
    expect(sanitizeTerms(Array.from({ length: 30 }, (_, i) => `詞${i}x`))).toHaveLength(12);
    expect(sanitizeTerms(['  解除權 ', 'x'.repeat(50)])).toEqual(['解除權']);
  });
  test('NFKC and case: full-width digits and upper-case latin still match', () => {
    expect(expandGlossary('７天').added).toContain('七日');
    expect(expandGlossary('買了DVD').added).toContain('影音商品');
  });
});

describe('smoke queries (development data, also used to design the glossary - NOT an evaluation)', () => {
  const g = compileGlossary();
  const before = metrics((q) => engine.search(q, { limit: 50 }));
  const after = metrics((q) => engine.search(planQuery(q, { glossary: g }).query, { limit: 50 }));

  test('report numbers and do not regress', () => {
    const fmt = (m) => `MRR=${m.mrr.toFixed(3)} hit@5=${m.h5}/20 hit@10=${m.h10}/20`;
    const lines = [`before: ${fmt(before)}`, `after:  ${fmt(after)}`];
    for (let i = 0; i < SMOKE.length; i++) lines.push(`${before.rows[i].best || '-'} -> ${after.rows[i].best || '-'}\t${SMOKE[i][0]}`);
    if (process.env.SMOKE_OUT) fs.writeFileSync(process.env.SMOKE_OUT, lines.join('\n'), 'utf8');
    expect(after.h10).toBeGreaterThanOrEqual(before.h10);
    expect(after.mrr).toBeGreaterThan(before.mrr);
  });
});
