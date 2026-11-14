// Persistence checks (offline, Node): schema validation, storage failure modes, cast cache limits, debounce/isolation
// from hot-path store traffic, and the first-visit / returning-visitor / hydration / reset flows.
// Run: node --import tsx scripts/check-persistence.ts
import assert from 'node:assert/strict';
import { PRESET_ANIME } from '../src/data/presetAnime';
import { setGraphFilter } from '../src/lib/rebuildGraph';
import { bootSession, resetWatchedList } from '../src/lib/session';
import {
  CAST_CACHE_KEY, CAST_CACHE_MAX_CHARS, CAST_CACHE_MAX_ENTRIES, USER_STATE_KEY,
  isStale, loadUserState, parseUserState, readCastCache, saveUserState, serializeUserState, writeCastCache,
  type PersistedState, type StorageLike,
} from '../src/services/userState';
import { selectCanGenerate, useGraphStore } from '../src/store/useGraphStore';
import type { AnimeDataSource, AnimeRecord, AnimeSummary, CastEntry, VoiceActorRecord } from '../src/types/contract';

/* ----------------------------- fixtures ----------------------------- */
class FakeStorage implements StorageLike {
  data = new Map<string, string>();
  writes = new Map<string, number>();
  constructor(private limit = Infinity) {}
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) {
    if (v.length > this.limit) throw new DOMException('quota', 'QuotaExceededError');
    this.data.set(k, v); this.writes.set(k, (this.writes.get(k) ?? 0) + 1);
  }
  removeItem(k: string) { this.data.delete(k); }
}
const brokenStorage: StorageLike = {
  getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); }, removeItem() { throw new Error('SecurityError'); },
};
const person = (id: number, full: string, native: string): VoiceActorRecord => ({ id, name: { full, native, ko: `${full}-ko` }, image: `https://img/${id}.png` });
const SHARED = person(777, 'Yoshitsugu Matsuoka', '松岡禎丞');
function customAnime(id: number, extraChars = 0): AnimeRecord {
  const pool: CastEntry[] = [];
  for (let i = 0; i < 30 + extraChars; i++) {
    pool.push({
      character: { id: id * 100 + i, name: { full: `Char ${id}-${i}`, native: null, ko: `캐릭터 ${id}-${i}` }, image: '' },
      role: i < 4 ? 'MAIN' : 'SUPPORTING',
      voiceActor: i === 5 ? SHARED : person(id * 1000 + i, `VA ${id}-${i}`, `声優${id}${i}`),
      ...(i === 0 ? { subVoiceActors: [{ voiceActor: person(id * 1000 + 500, 'Sub VA', '子役'), kind: 'CHILDHOOD' as const, roleNote: 'Childhood' }] } : {}),
    });
  }
  const t = { romaji: `Custom ${id}`, english: `Custom ${id} EN`, native: `カスタム${id}`, ko: `커스텀 ${id}` };
  return {
    id, title: t, coverImage: 'https://img/c.png', color: '#aa5533', seasonYear: 2024, format: 'TV', studio: 'Studio X', genres: ['Action'], popularity: 1234,
    franchise: { rootId: id, members: [{ id, title: t, format: 'TV', seasonYear: 2024 }, { id: id + 1, title: t, format: 'MOVIE', seasonYear: 2025 }] },
    cast: pool.slice(0, 16), fullCastPool: pool,
  };
}
const A = customAnime(900001), B = customAnime(900010);
const summaryOf = ({ cast: _c, fullCastPool: _p, ...s }: AnimeRecord): AnimeSummary => s;

function makeDs(custom: AnimeRecord[], opts: { fail?: boolean; delay?: number } = {}) {
  const calls: number[] = [];
  const ds: AnimeDataSource & { calls: number[] } = {
    calls, presets: PRESET_ANIME,
    searchAnime: async () => [], getVoiceActorFilmography: async () => [], getRecommendations: async () => [],
    async getAnime(id) {
      calls.push(id);
      if (opts.delay) await new Promise((r) => setTimeout(r, opts.delay));
      if (opts.fail) throw new Error('offline');
      const r = [...custom, ...PRESET_ANIME].find((x) => x.id === id);
      if (!r) throw new Error('unknown');
      return { ...r, fullCastPool: [...r.fullCastPool!] }; // a NEW pool identity, like a fresh fetch
    },
  };
  return ds;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const resetStore = () => useGraphStore.setState(useGraphStore.getInitialState(), true);
const store = useGraphStore;
const state = (over: Partial<PersistedState> = {}): PersistedState => ({
  watched: [summaryOf(A), summaryOf(B)], anchorAnimeId: B.id, locale: 'ja', viewMode: 'MODE_VA',
  showSupportingRoles: true, includeSubVoiceActors: true, hasGeneratedGraph: true, ...over,
});
const saved = (storage: FakeStorage) => JSON.parse(storage.data.get(USER_STATE_KEY)!);
const section = (name: string) => console.log(`  ${name}`);

/* ----------------------- 1. schema validation ----------------------- */
section('schema + validation');
{
  const good = parseUserState(serializeUserState(state()))!;
  assert.deepEqual(good.watched, [summaryOf(A), summaryOf(B)], 'summaries round-trip exactly (title/cover/year/franchise)');
  assert.equal(good.anchorAnimeId, B.id); assert.equal(good.locale, 'ja'); assert.equal(good.viewMode, 'MODE_VA');
  assert(good.showSupportingRoles && good.includeSubVoiceActors && good.hasGeneratedGraph);
  const env = JSON.parse(serializeUserState(state(), 42)); assert.equal(env.version, 1); assert.equal(env.updatedAt, 42);
  assert(!JSON.stringify(env).includes('fullCastPool') && !JSON.stringify(env).includes('"cast"'), 'user-state carries NO cast arrays');

  for (const bad of ['', 'not json', '{}', '[]', 'null', '"x"', JSON.stringify({ version: 2, state: { watched: [] } }), JSON.stringify({ version: 1 }),
    JSON.stringify({ version: 1, state: { watched: 'x' } }), JSON.stringify({ version: 1, state: { watched: [{ id: 'a' }, null, 5, []] } })]) {
    assert.equal(parseUserState(bad), null, `rejects ${bad.slice(0, 40)}`);
  }
  const empty = parseUserState(JSON.stringify({ version: 1, updatedAt: 1, state: { watched: [], anchorAnimeId: 5, hasGeneratedGraph: true } }))!;
  assert.deepEqual(empty.watched, []); assert.equal(empty.anchorAnimeId, null); assert.equal(empty.hasGeneratedGraph, false, 'an emptied list is valid, graph flag forced off');

  const messy = parseUserState(JSON.stringify({
    version: 1, updatedAt: 1, state: {
      watched: [{ ...summaryOf(A), evil: 1, __proto__: { polluted: true }, color: 'red', seasonYear: 'x' }, { id: -3, title: { romaji: 'n' } }, summaryOf(A), summaryOf(B)],
      anchorAnimeId: 424242, locale: 'xx', viewMode: 'NOPE', showSupportingRoles: 'yes', includeSubVoiceActors: 1, hasGeneratedGraph: true,
    },
  }))!;
  assert.deepEqual(messy.watched.map((w) => w.id), [A.id, B.id], 'bad item skipped, duplicate dropped, order kept');
  assert.equal(messy.anchorAnimeId, A.id, 'unknown anchor repaired to the first entry');
  assert.equal(messy.locale, 'ko'); assert.equal(messy.viewMode, 'MODE_CHARACTER');
  assert.equal(messy.showSupportingRoles, false); assert.equal(messy.includeSubVoiceActors, false);
  assert.equal(messy.watched[0]!.color, '#8b9cff'); assert.equal(messy.watched[0]!.seasonYear, null);
  assert(!('evil' in messy.watched[0]!)); assert.equal(({} as { polluted?: boolean }).polluted, undefined, 'no prototype pollution');
}

/* ------------------------ 2. storage failures ----------------------- */
section('storage failure modes');
{
  assert.equal(loadUserState(null), null); assert.equal(saveUserState(null, state()), false);
  assert.equal(loadUserState(brokenStorage), null); assert.equal(saveUserState(brokenStorage, state()), false);
  assert.equal(readCastCache(brokenStorage).size, 0); assert.equal(writeCastCache(brokenStorage, new Map()), false);
  assert.equal(saveUserState(new FakeStorage(10), state()), false, 'QuotaExceededError is swallowed');
}

/* --------------------------- 3. cast cache -------------------------- */
section('cast cache');
{
  const s = new FakeStorage();
  const cache = new Map([[A.id, { savedAt: 1000, pool: A.fullCastPool! }]]);
  assert(writeCastCache(s, cache));
  const back = readCastCache(s);
  assert.deepEqual(back.get(A.id)!.pool, A.fullCastPool, 'pool (incl. sub voice actors + Korean names) round-trips');
  assert(isStale(back.get(A.id)!) && !isStale({ savedAt: Date.now(), pool: [] }));

  // Regression: a crowd credit ("other voices") carries ~19 sub actors; a restored graph must be identical to the live one.
  const crowd: CastEntry = { ...A.fullCastPool![0]!, subVoiceActors: Array.from({ length: 25 }, (_, i) => ({ voiceActor: person(8000 + i, `Extra ${i}`, `端役${i}`), kind: 'ALTERNATE' as const, roleNote: null })) };
  const sc = new FakeStorage(); writeCastCache(sc, new Map([[1, { savedAt: 1, pool: [crowd] }]]));
  assert.deepEqual(readCastCache(sc).get(1)!.pool, [crowd], 'all 25 sub voice actors survive the round trip (no silent truncation)');

  const dirty = JSON.parse(s.data.get(CAST_CACHE_KEY)!); dirty.entries[String(A.id)].pool.push({ nope: 1 }, { character: { id: 1 }, role: 'MAIN' }, { character: { id: 2, name: { full: 'x' } }, role: 'WRONG' });
  s.data.set(CAST_CACHE_KEY, JSON.stringify(dirty));
  assert.equal(readCastCache(s).get(A.id)!.pool.length, A.fullCastPool!.length, 'invalid pool entries are dropped, valid ones kept');
  s.data.set(CAST_CACHE_KEY, '{broken'); assert.equal(readCastCache(s).size, 0, 'corrupt cache = empty cache');

  const many = new Map<number, { savedAt: number; pool: CastEntry[] }>();
  for (let i = 1; i <= 40; i++) many.set(i, { savedAt: i, pool: customAnime(5000 + i).fullCastPool! });
  const s2 = new FakeStorage(); writeCastCache(s2, many);
  assert(many.size <= CAST_CACHE_MAX_ENTRIES && !many.has(1) && many.has(40), 'oldest-saved evicted first, entry cap enforced');
  assert(s2.data.get(CAST_CACHE_KEY)!.length <= CAST_CACHE_MAX_CHARS, 'size cap enforced');
  const s3 = new FakeStorage(60_000), tight = new Map([[1, { savedAt: 1, pool: customAnime(6001).fullCastPool! }], [2, { savedAt: 2, pool: customAnime(6002).fullCastPool! }], [3, { savedAt: 3, pool: customAnime(6003).fullCastPool! }]]);
  assert.doesNotThrow(() => writeCastCache(s3, tight), 'quota pressure never throws (halves the cache and retries)');
}

/* ----------------- 4. debounce + hot-path isolation ----------------- */
section('debounced writes, hot-path isolation');
{
  resetStore();
  const s = new FakeStorage(); const ds = makeDs([A, B]);
  store.setState({ watchedAnime: [PRESET_ANIME[0]!, PRESET_ANIME[1]!], anchorAnimeId: PRESET_ANIME[0]!.id });
  const h = bootSession(ds, s, { persistDelay: 20 }); // saved state absent → first visit would re-seed; so measure from a restored session below
  h.stop(); resetStore();
  s.data.set(USER_STATE_KEY, serializeUserState(state({ watched: [summaryOf(PRESET_ANIME[0]!), summaryOf(PRESET_ANIME[1]!)], anchorAnimeId: PRESET_ANIME[0]!.id, locale: 'ko', viewMode: 'MODE_CHARACTER', showSupportingRoles: false, includeSubVoiceActors: false })));
  s.writes.clear();
  const p = bootSession(ds, s, { persistDelay: 20 });
  await sleep(60); assert.equal(s.writes.get(USER_STATE_KEY) ?? 0, 0, 'booting a restored session writes nothing');

  for (let i = 0; i < 50; i++) store.getState().setAnchor(i % 2 ? PRESET_ANIME[0]!.id : PRESET_ANIME[1]!.id);
  assert.equal(s.writes.get(USER_STATE_KEY) ?? 0, 0, 'writes are deferred, not synchronous');
  await sleep(80); assert.equal(s.writes.get(USER_STATE_KEY), 1, '50 rapid changes coalesce into ONE write');

  const before = s.writes.get(USER_STATE_KEY)!;
  for (let i = 0; i < 2000; i++) store.getState().setHoveredNode(i % 2 ? 'va:1' : null);          // hover spotlight
  store.getState().selectNode('va:1'); store.getState().selectNode(null);                           // selection
  store.getState().setGenesisState({ status: 'playing', step: 3, totalSteps: 12 }); store.getState().revealNodes(['a', 'b']); // genesis frames
  store.getState().setPhysicsPaused ? store.setState({ physicsPaused: true }) : 0;                // physics toggle
  store.getState().setGraph(store.getState().graph);                                               // same-nullness graph swap
  await sleep(80);
  assert.equal(s.writes.get(USER_STATE_KEY), before, 'hover / selection / genesis / physics traffic causes ZERO writes');

  store.getState().setLocale('en'); p.flush();
  assert.equal(saved(s).state.locale, 'en', 'flush() writes immediately (pagehide path)');
  p.stop(); resetStore();
}

/* ---------------------- 5. session flows ---------------------------- */
section('first visit');
{
  resetStore();
  const s = new FakeStorage(), ds = makeDs([]);
  const h = bootSession(ds, s, { persistDelay: 10 });
  assert.equal(store.getState().watchedAnime.length, PRESET_ANIME.length, 'defaults seeded'); assert(store.getState().graph, 'graph generated');
  assert.equal(store.getState().instantGenesis, false, 'first visit keeps the animated genesis'); assert.equal(ds.calls.length, 0, 'zero network');
  setGraphFilter({ includeSubVoiceActors: true }); h.flush();
  const st = saved(s).state;
  assert.equal(st.watched.length, PRESET_ANIME.length); assert.equal(st.includeSubVoiceActors, true); assert.equal(st.hasGeneratedGraph, true);
  h.stop();
}
section('corrupt storage = first visit');
{
  resetStore(); const s = new FakeStorage(); s.data.set(USER_STATE_KEY, '{"version":1,"state":{"watched":[{"id":"x"}]}}');
  const h = bootSession(makeDs([]), s, { persistDelay: 10 }); assert.equal(store.getState().watchedAnime.length, PRESET_ANIME.length); h.stop();
  resetStore(); const h2 = bootSession(makeDs([]), brokenStorage); assert.equal(store.getState().watchedAnime.length, PRESET_ANIME.length, 'works with unusable storage'); h2.stop();
}
section('returning visitor: exact list, not defaults');
{
  resetStore();
  const s = new FakeStorage(), ds = makeDs([]);
  const picks = [PRESET_ANIME[3]!, PRESET_ANIME[5]!];
  s.data.set(USER_STATE_KEY, serializeUserState(state({ watched: picks.map(summaryOf), anchorAnimeId: picks[1]!.id })));
  const h = bootSession(ds, s, { persistDelay: 10 });
  const g = store.getState();
  assert.deepEqual(g.watchedAnime.map((a) => a.id), picks.map((a) => a.id), 'exact saved order, NOT the default presets');
  assert.equal(g.anchorAnimeId, picks[1]!.id); assert.equal(g.locale, 'ja'); assert.equal(g.viewMode, 'MODE_VA');
  assert(g.showSupportingRoles && g.includeSubVoiceActors); assert(g.graph && g.graph.anchorAnimeId === picks[1]!.id);
  assert.deepEqual(g.graph!.options, { showSupportingRoles: true, includeSubVoiceActors: true }, 'filters applied to the restored graph');
  assert.equal(g.instantGenesis, true, 'restore skips the build-up animation (one-shot flag)'); assert.equal(g.genesisSpeed, 1, 'the user-facing speed setting is never touched');
  assert.equal(g.restoring, false); assert.equal(ds.calls.length, 0, 'presets need no network');
  setGraphFilter({ showSupportingRoles: false }); assert.equal(store.getState().instantGenesis, false, 'any later rebuild animates normally again');
  h.stop();

  resetStore(); const s2 = new FakeStorage(); s2.data.set(USER_STATE_KEY, serializeUserState(state({ watched: [], anchorAnimeId: null, hasGeneratedGraph: false })));
  const h2 = bootSession(makeDs([]), s2, { persistDelay: 10 });
  assert.equal(store.getState().watchedAnime.length, 0, 'a cleared list stays cleared'); assert.equal(store.getState().graph, null); h2.stop();

  resetStore(); const s3 = new FakeStorage(); s3.data.set(USER_STATE_KEY, serializeUserState(state({ watched: [summaryOf(PRESET_ANIME[0]!)], anchorAnimeId: PRESET_ANIME[0]!.id, hasGeneratedGraph: false })));
  const h3 = bootSession(makeDs([]), s3, { persistDelay: 10 }); assert.equal(store.getState().graph, null, 'no graph if none was on screen'); assert.equal(store.getState().watchedAnime.length, 1); h3.stop();
}
section('custom anime: cast cache hit (no network), miss (hydrate), failure, stale');
{
  // hit
  resetStore();
  const s = new FakeStorage(), ds = makeDs([A, B]);
  writeCastCache(s, new Map([[A.id, { savedAt: Date.now(), pool: A.fullCastPool! }]]));
  s.data.set(USER_STATE_KEY, serializeUserState(state({ watched: [summaryOf(PRESET_ANIME[0]!), summaryOf(A)], anchorAnimeId: A.id, showSupportingRoles: false, includeSubVoiceActors: false })));
  let h = bootSession(ds, s, { persistDelay: 10 });
  assert.equal(ds.calls.length, 0, 'warm cast cache → zero network'); assert.equal(store.getState().restoring, false);
  const a = store.getState().watchedAnime[1]!; assert.equal(a.fullCastPool!.length, A.fullCastPool!.length); assert.equal(a.cast.length, 16);
  const castWrites = s.writes.get(CAST_CACHE_KEY)!; const savedAt0 = JSON.parse(s.data.get(CAST_CACHE_KEY)!).entries[String(A.id)].savedAt;
  store.getState().setLocale('en'); store.getState().setViewMode('MODE_DETAIL'); h.flush();
  assert.equal(s.writes.get(CAST_CACHE_KEY), castWrites, 'unrelated state changes never rewrite the heavy cast cache');
  assert.equal(JSON.parse(s.data.get(CAST_CACHE_KEY)!).entries[String(A.id)].savedAt, savedAt0, 'savedAt (the TTL clock) is not reset by being restored');
  assert.equal(a.title.ko, '커스텀 900001'); assert.equal(a.fullCastPool![3]!.character.name.ko, '캐릭터 900001-3', 'Korean names survive the round trip');
  assert(store.getState().graph!.nodes.some((n) => n.id === `va:${A.id * 1000 + 1}`), 'graph restored with the custom anime\'s cast');
  h.stop();

  // miss → hydrate
  resetStore(); const s2 = new FakeStorage(), ds2 = makeDs([A, B], { delay: 15 });
  s2.data.set(USER_STATE_KEY, serializeUserState(state({ watched: [summaryOf(A), summaryOf(PRESET_ANIME[0]!), summaryOf(B)], anchorAnimeId: B.id, showSupportingRoles: false, includeSubVoiceActors: false })));
  h = bootSession(ds2, s2, { persistDelay: 10 });
  assert.equal(store.getState().restoring, true, 'restoring while pools hydrate'); assert.equal(selectCanGenerate(store.getState()), false, 'Generate disabled meanwhile');
  assert.deepEqual(store.getState().watchedAnime.map((x) => x.id), [A.id, PRESET_ANIME[0]!.id, B.id], 'list shown immediately from summaries, order intact');
  assert.equal(store.getState().graph, null);
  store.getState().setLocale('en'); h.flush(); // a REAL change while hydrating forces a write with graph === null
  assert.equal(saved(s2).state.locale, 'en'); assert.equal(saved(s2).state.hasGeneratedGraph, true, 'graph intent survives a write made while hydrating');
  await sleep(80);
  assert.deepEqual([...ds2.calls].sort(), [A.id, B.id], 'only the custom anime hit the network'); assert.equal(store.getState().restoring, false);
  assert(store.getState().graph, 'graph rebuilt once hydrated'); assert.deepEqual(store.getState().watchedAnime.map((x) => x.id), [A.id, PRESET_ANIME[0]!.id, B.id]);
  assert.equal(store.getState().anchorAnimeId, B.id); h.flush();
  assert.deepEqual([...readCastCache(s2).keys()].sort(), [A.id, B.id], 'hydrated pools written to the persistent cast cache (presets are not)');
  h.stop();

  // failure
  resetStore(); const s3 = new FakeStorage(), ds3 = makeDs([A], { fail: true });
  s3.data.set(USER_STATE_KEY, serializeUserState(state({ watched: [summaryOf(PRESET_ANIME[0]!), summaryOf(A)], anchorAnimeId: PRESET_ANIME[0]!.id })));
  h = bootSession(ds3, s3, { persistDelay: 10 }); await sleep(30);
  assert.equal(store.getState().restoring, false); assert.equal(store.getState().watchedAnime.length, 2, 'offline: the list is intact'); assert(store.getState().graph, 'graph still restored'); h.stop();

  // stale → used instantly, refreshed quietly
  resetStore(); const s4 = new FakeStorage(), ds4 = makeDs([A]);
  writeCastCache(s4, new Map([[A.id, { savedAt: Date.now() - 30 * 86400_000, pool: A.fullCastPool! }]]));
  s4.data.set(USER_STATE_KEY, serializeUserState(state({ watched: [summaryOf(PRESET_ANIME[0]!), summaryOf(A)], anchorAnimeId: A.id })));
  h = bootSession(ds4, s4, { persistDelay: 10 });
  assert(store.getState().graph, 'stale pool restores instantly'); const g0 = store.getState().graph; const pool0 = store.getState().watchedAnime[1]!.fullCastPool;
  await sleep(20);
  assert.deepEqual(ds4.calls, [A.id], 'background refresh fired'); assert.notEqual(store.getState().watchedAnime[1]!.fullCastPool, pool0, 'record replaced with the fresh pool');
  assert.equal(store.getState().graph, g0, 'the graph on screen is NOT rebuilt by a refresh'); h.stop();
}
section('persistence of custom anime + reset');
{
  resetStore();
  const s = new FakeStorage(), ds = makeDs([A]);
  const h = bootSession(ds, s, { persistDelay: 10 });
  store.getState().addAnime(A); h.flush();
  assert(readCastCache(s).has(A.id) && !readCastCache(s).has(PRESET_ANIME[0]!.id), 'custom pool cached, presets never');
  assert.equal(saved(s).state.watched.at(-1).title.ko, '커스텀 900001');
  store.getState().removeAnime(A.id); h.flush(); assert(!readCastCache(s).has(A.id), 'pool dropped when the anime leaves the list');

  resetWatchedList(ds); h.flush();
  assert.equal(store.getState().watchedAnime.length, 0); assert.equal(store.getState().graph, null);
  assert.deepEqual(saved(s).state.watched, [], 'reset persisted'); assert.equal(saved(s).state.hasGeneratedGraph, false);
  resetWatchedList(ds); h.flush();
  assert.equal(store.getState().watchedAnime.length, PRESET_ANIME.length, 'reset on an empty list restores the presets'); assert(store.getState().graph);
  assert.equal(saved(s).state.watched.length, PRESET_ANIME.length);
  h.stop();
}

console.log('PASS: persistence — schema/validation, storage failures, cast cache limits, debounce + hot-path isolation, restore/hydrate/refresh/reset flows.');
