import { describe, expect, test } from 'vitest';
import { tokenize, tokenizeQuery } from '../src/lib/tokenizer.js';

describe('tokenizer', () => {
  test('CJK runs become overlapping bigrams', () => {
    expect(tokenize('退回商品', { unigrams: 'none' })).toEqual(['退回', '回商', '商品']);
  });

  test('a single CJK character is kept (it cannot form a bigram)', () => {
    expect(tokenize('退', { unigrams: 'none' })).toEqual(['退']);
  });

  test('punctuation and spaces break runs, so bigrams never span them', () => {
    expect(tokenize('解除，契約', { unigrams: 'none' })).toEqual(['解除', '契約']);
    expect(tokenize('解除 契約', { unigrams: 'none' })).toEqual(['解除', '契約']);
  });

  test("'only' emits unigrams without the stop characters", () => {
    // 之 and 或 are stop characters
    expect(tokenize('解除之或權', { unigrams: 'only' })).toEqual(['解', '除', '權']);
  });

  test("'all' keeps stop characters, 'content' drops them", () => {
    expect(tokenize('甲之乙', { unigrams: 'all' })).toEqual(['甲之', '之乙', '甲', '之', '乙']);
    expect(tokenize('甲之乙', { unigrams: 'content' })).toEqual(['甲之', '之乙', '甲', '乙']);
  });

  test('latin and digits are lower-cased words; mixed text keeps both', () => {
    expect(tokenize('Wi-Fi 12號', { unigrams: 'none' })).toEqual(['wi', 'fi', '12', '號']);
  });

  test('NFKC folds full-width forms', () => {
    expect(tokenize('ＡＢＣ１２', { unigrams: 'none' })).toEqual(['abc12']);
  });

  test('empty and non-string-ish input is safe', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(null)).toEqual([]);
    expect(tokenize('，。！')).toEqual([]);
  });

  test('query tokens are de-duplicated, document tokens are not (tf must survive)', () => {
    expect(tokenize('退貨退貨', { unigrams: 'none' }).length).toBe(3); // 退貨 貨退 退貨
    expect(tokenizeQuery('退貨 退貨', { unigrams: 'none' })).toEqual(['退貨']);
  });

  test('a lay word shares unigrams with the statute wording even without a shared bigram', () => {
    const lay = new Set(tokenize('退貨', { unigrams: 'only' }));
    const statute = new Set(tokenize('退回商品', { unigrams: 'only' }));
    expect([...lay].some((t) => statute.has(t))).toBe(true);
    expect(tokenize('退貨', { unigrams: 'none' }).some((t) => tokenize('退回商品', { unigrams: 'none' }).includes(t))).toBe(false);
  });
});
