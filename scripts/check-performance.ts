import assert from 'node:assert/strict';
import { memo } from '../src/services/requestCache';
import { localAnimeHits, localPresetSearch } from '../src/services/anilistClient';

// Shared callers cancel independently, and a later consumer can restore a persisted result.
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
} });
let requests = 0;
const cached = memo<number>('test');
const load = async (signal: AbortSignal) => {
  requests++;
  await new Promise(resolve => setTimeout(resolve, 10));
  assert(!signal.aborted);
  return 42;
};
const a = new AbortController(), b = new AbortController();
const first = cached('shared', load, a.signal);
const second = cached('shared', load, b.signal);
a.abort();
await assert.rejects(first, { name: 'AbortError' });
assert.equal(await second, 42);
assert.equal(requests, 1);
assert.equal(await memo<number>('test')('shared', load), 42);
assert.equal(requests, 1);
let attempts = 0;
const retry = memo<number>();
await assert.rejects(retry('retry', async () => { attempts++; throw new Error('offline'); }));
assert.equal(await retry('retry', async () => { attempts++; return 1; }), 1);
assert.equal(attempts, 2);
assert.deepEqual(localAnimeHits('ぼっち'), localAnimeHits('ボッチ'));
const queries = ['진격', 'ㅈㄱ', '프리렌', 'Frieren', 'ぼっち', 'ボッチ', 'jujutsu', '없는제목'];
const samples: number[] = [];
for (let i = 0; i < 10000; i++) {
  const start = performance.now();
  localAnimeHits(queries[i % queries.length]!);
  localPresetSearch(queries[i % queries.length]!);
  if (i >= 1000) samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
console.log(`PASS: request deduplication, independent abort, persistence and failed-request retry. Search (both indexes): median ${samples[Math.floor(samples.length / 2)]!.toFixed(3)}ms; p99 ${samples[Math.floor(samples.length * 0.99)]!.toFixed(3)}ms.`);
