import { describe, expect, test, vi } from 'vitest';
import { checkHealth, generate } from '../src/lib/generate.js';

const ok = (body = {}) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
const status = (code) => Promise.resolve({ ok: false, status: code, json: () => Promise.resolve({}) });

describe('health check', () => {
  test('no API_URL configured: degraded, and the network is never touched', async () => {
    const f = vi.fn();
    const h = await checkHealth({ apiUrl: '', fetchImpl: f });
    expect(h.mode).toBe('degraded');
    expect(h.label).toBe('降級版（未連線生成服務）');
    expect(f).not.toHaveBeenCalled();
  });
  test('2xx: full', async () => {
    const f = vi.fn(() => ok());
    const h = await checkHealth({ apiUrl: 'https://x.example/', fetchImpl: f });
    expect(h.mode).toBe('full');
    expect(f.mock.calls[0][0]).toBe('https://x.example/health');
  });
  test('non-2xx and network errors: degraded', async () => {
    expect((await checkHealth({ apiUrl: 'https://x', fetchImpl: () => status(503) })).mode).toBe('degraded');
    expect((await checkHealth({ apiUrl: 'https://x', fetchImpl: () => Promise.reject(new Error('down')) })).mode).toBe('degraded');
  });
});

describe('generate() degradation (spec 3.2)', () => {
  test('no API_URL: degraded without a request', async () => {
    const f = vi.fn();
    expect(await generate({ q: 1 }, { apiUrl: '', fetchImpl: f })).toEqual({ mode: 'degraded' });
    expect(f).not.toHaveBeenCalled();
  });
  test('2xx: full with parsed body', async () => {
    const r = await generate({ q: 1 }, { apiUrl: 'https://x', fetchImpl: () => ok({ answer: 'a' }) });
    expect(r).toEqual({ mode: 'full', data: { answer: 'a' } });
  });
  test('HTTP 500 is not a success even though fetch resolved', async () => {
    expect(await generate({}, { apiUrl: 'https://x', fetchImpl: () => status(500) })).toEqual({ mode: 'degraded' });
  });
  test('network error and timeout degrade', async () => {
    expect(await generate({}, { apiUrl: 'https://x', fetchImpl: () => Promise.reject(new TypeError('fail')) })).toEqual({ mode: 'degraded' });
    const hang = (_u, { signal }) => new Promise((_res, rej) => signal.addEventListener('abort', () => rej(signal.reason)));
    expect(await generate({}, { apiUrl: 'https://x', fetchImpl: hang, timeoutMs: 20 })).toEqual({ mode: 'degraded' });
  });
  test('bad JSON body degrades instead of throwing', async () => {
    const f = () => Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError('bad')) });
    expect(await generate({}, { apiUrl: 'https://x', fetchImpl: f })).toEqual({ mode: 'degraded' });
  });
});
