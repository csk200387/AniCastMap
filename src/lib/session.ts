/**
 * Session lifecycle: first visit vs returning visitor, restore, hydration and reset.
 *
 *  - First visit (no valid saved state): seed the curated presets and play the normal genesis.
 *  - Returning visitor: restore EXACTLY the saved list / anchor / preferences (never the default presets), resolve
 *    every anime's cast pool without waiting for the network where possible (bundled preset → localStorage cast cache),
 *    and rebuild the graph instantly if one was on screen.
 */
import { startPersistence, type PersistenceHandle } from '../store/persistence';
import { provisionalRecords, useGraphStore } from '../store/useGraphStore';
import {
  browserStorage,
  isStale,
  loadUserState,
  readCastCache,
  recordFromPool,
  toSummary,
  type CastCache,
  type PersistedState,
  type StorageLike,
} from '../services/userState';
import { decodeShare, sharedParam, type SharedMap } from '../services/shareCodec';
import { franchiseMemberIds, type AnimeDataSource, type AnimeRecord } from '../types/contract';
import { rebuildGraph } from './rebuildGraph';

const store = useGraphStore;
/** The visitor's own storage + parsed cast cache (the shared-view exits restore from these). */
const own: { storage: StorageLike | null; cache: CastCache } = { storage: null, cache: new Map() };

/** Every franchise member id → its preset record. */
const presetIndex = (ds: AnimeDataSource) =>
  new Map(ds.presets.flatMap((p) => [p.id, ...(p.franchise?.members.map((m) => m.id) ?? [])].map((id) => [id, p] as const)));

/** Curated first-visit selection: every preset, anchor = first, graph generated. */
export function seedDefaults(ds: AnimeDataSource): void {
  const { addAnime } = store.getState();
  ds.presets.forEach(addAnime);
  rebuildGraph();
}

/** "Reset" in the watched-list header: clear the list; when it is already empty, restore the presets instead. */
export function resetWatchedList(ds: AnimeDataSource): void {
  const s = store.getState();
  s.closeAnimePreview();
  if (s.watchedAnime.length > 0) {
    store.setState({ watchedAnime: [], anchorAnimeId: null, restoring: false });
    s.setGraph(null);
  } else {
    seedDefaults(ds);
  }
}

/** Rebuild the saved graph without the 1× build-up animation (the stage honours the one-shot `instantGenesis` flag). */
function restoreGraph(): void {
  try {
    rebuildGraph();
  } catch {
    store.setState({ restoring: false });
    return;
  }
  store.setState({ instantGenesis: true, restoring: false });
}

/** Swap in the full record once it arrives (no graph rebuild). A canonical-id collision drops the duplicate instead. */
export function applyRecord(oldId: number, record: AnimeRecord): void {
  const s = store.getState();
  if (record.id !== oldId && s.watchedAnime.some((a) => a.id === record.id)) s.removeAnime(oldId);
  else s.replaceAnimeRecord(oldId, record);
}

async function hydrate(ds: AnimeDataSource, ids: readonly number[]): Promise<void> {
  await Promise.allSettled(ids.map(async (id) => applyRecord(id, await ds.getAnime(id))));
}

function restore(ds: AnimeDataSource, saved: PersistedState, cache: CastCache): void {
  const presets = presetIndex(ds);
  const records: AnimeRecord[] = [];
  const idMap = new Map<number, number>();
  const seen = new Set<number>();
  const missing: number[] = [];
  const stale: number[] = [];
  for (const summary of saved.watched) {
    let record: AnimeRecord;
    const preset = presets.get(summary.id);
    const hit = preset ? undefined : cache.get(summary.id);
    if (preset) record = preset;
    else if (hit) {
      record = recordFromPool(summary, hit.pool);
      if (isStale(hit)) stale.push(record.id);
    } else {
      record = { ...summary, cast: [] }; // summary-only placeholder, hydrated below
      missing.push(record.id);
    }
    idMap.set(summary.id, record.id);
    if (!seen.has(record.id)) {
      seen.add(record.id);
      records.push(record);
    }
  }

  const anchor = records.length ? ((saved.anchorAnimeId !== null ? idMap.get(saved.anchorAnimeId) : undefined) ?? records[0]!.id) : null;
  store.setState({
    watchedAnime: records,
    anchorAnimeId: anchor,
    locale: saved.locale,
    viewMode: saved.viewMode,
    showSupportingRoles: saved.showSupportingRoles,
    includeSubVoiceActors: saved.includeSubVoiceActors,
    restoring: missing.length > 0,
  });

  const wantGraph = saved.hasGeneratedGraph && anchor !== null;
  const finish = () => (wantGraph && store.getState().graph === null ? restoreGraph() : store.setState({ restoring: false }));
  if (missing.length > 0) void hydrate(ds, missing).finally(finish);
  else finish();

  // Expired pools were used instantly above; refresh them quietly (the graph on screen is not rebuilt).
  for (const id of stale) void ds.getAnime(id).then((r) => applyRecord(id, r), () => undefined);
}

/**
 * Call ONCE per page load, before the first render. Returns the persistence handle (flush/stop).
 * `storage` is injectable for tests; without usable storage the app simply runs unpersisted.
 */
export function bootSession(
  ds: AnimeDataSource,
  storage: StorageLike | null = browserStorage(),
  opts: { persistDelay?: number } = {},
): PersistenceHandle {
  const saved = loadUserState(storage);
  const cache = readCastCache(storage);
  Object.assign(own, { storage, cache });
  const shared = decodeShare(sharedParam());
  if (shared) bootShared(ds, shared, saved, cache);
  else if (saved) restore(ds, saved, cache);
  else seedDefaults(ds);
  const presetIds = new Set(ds.presets.flatMap((p) => [p.id, ...(p.franchise?.members.map((m) => m.id) ?? [])]));
  return startPersistence(storage, (id) => presetIds.has(id), { delay: opts.persistDelay, castCache: cache });
}

/* ------------------------------------------------------------------ */
/* Shared map sandbox (`?s=`)                                          */
/* ------------------------------------------------------------------ */

/** Resolves once the current genesis is no longer playing (or there is no graph). */
function genesisSettled(): Promise<void> {
  return new Promise((resolve) => {
    const ok = () => { const s = store.getState(); return !s.graph || s.genesis.status === 'done'; };
    if (ok()) return resolve();
    const off = store.subscribe(() => { if (ok()) { off(); resolve(); } });
  });
}

/**
 * Sandbox boot: the sender's list, anchor, mode, filters and language — while the visitor's saved map stays
 * untouched (persistence is paused for `isSharedView`). Presets and the visitor's own cast cache resolve
 * instantly; every other id comes from ONE batched request, then the BFS ripple plays from the sender's favourite.
 * Franchise-merged records hydrate afterwards and land in a single carry rebuild once the ripple has finished.
 */
function bootShared(ds: AnimeDataSource, shared: SharedMap, saved: PersistedState | null, cache: CastCache): void {
  const presets = presetIndex(ds);
  const savedById = new Map(saved?.watched.map((s) => [s.id, s]) ?? []);
  const loaded = new Map<number, AnimeRecord>();
  for (const id of shared.watched) {
    const preset = presets.get(id), summary = savedById.get(id), hit = cache.get(id);
    if (preset) loaded.set(id, preset);
    else if (summary && hit) loaded.set(id, recordFromPool(summary, hit.pool));
  }
  const missing = shared.watched.filter((id) => !loaded.has(id));
  store.setState({
    isSharedView: true,
    watchedAnime: [],
    anchorAnimeId: null,
    locale: shared.locale,
    viewMode: shared.viewMode,
    showSupportingRoles: shared.showSupportingRoles,
    includeSubVoiceActors: shared.includeSubVoiceActors,
    restoring: missing.length > 0,
  });
  const start = () => {
    const s = store.getState();
    for (const id of shared.watched) { const r = loaded.get(id); if (r) s.addAnime(r); }
    const watched = store.getState().watchedAnime;
    const anchor = watched.find((r) => franchiseMemberIds(r).includes(shared.anchorAnimeId)) ?? watched[0];
    store.setState({ anchorAnimeId: anchor?.id ?? null, restoring: false });
    if (anchor) rebuildGraph();
  };
  if (!missing.length) return start();

  const first = ds.getAnimeShallow ? ds.getAnimeShallow(missing) : Promise.all(missing.map((id) => ds.getAnime(id)));
  void first.then(
    (records) => {
      if (!store.getState().isSharedView) return;
      for (const id of missing) {
        const r = records.find((x) => x.id === id || franchiseMemberIds(x).includes(id));
        if (!r) continue;
        if (ds.peekAnime?.(id) !== r) provisionalRecords.add(r);
        loaded.set(id, r);
      }
      start();
      let changed = false;
      void Promise.allSettled(missing.map((id) => ds.getAnime(id).then((full) => {
        const current = loaded.get(id);
        if (!current || current === full || !store.getState().isSharedView) return;
        loaded.set(id, full);
        applyRecord(current.id, full);
        changed = true;
      }))).then(async () => {
        await genesisSettled();
        if (changed && store.getState().isSharedView && store.getState().graph) rebuildGraph({ extend: true });
      });
    },
    () => { if (store.getState().isSharedView) start(); }, // offline: show whatever resolved locally
  );
}

function clearShareParam(): void {
  if (typeof location === 'undefined') return;
  const url = new URL(location.href);
  url.searchParams.delete('s');
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
}

/** "내 지도로 덮어쓰기": the shared list becomes the visitor's saved map (persistence resumes and writes it). */
export function saveSharedAsMine(): void {
  store.setState({ isSharedView: false });
  clearShareParam();
}

/** "내 원래 지도로 돌아가기": drop the sandbox and restore exactly what the visitor had saved (or the first-visit defaults). */
export function returnToMyMap(ds: AnimeDataSource): void {
  const saved = loadUserState(own.storage);
  store.getState().closeAnimePreview();
  store.getState().setGraph(null);
  store.setState({ watchedAnime: [], anchorAnimeId: null });
  if (saved) restore(ds, saved, own.cache);
  else seedDefaults(ds);
  store.setState({ isSharedView: false });
  clearShareParam();
}

/** "내 목록에 병합": the visitor's saved map plus every shared anime it lacks (franchise-aware), kept as their own. */
export function mergeSharedIntoMine(ds: AnimeDataSource): void {
  const saved = loadUserState(own.storage);
  if (!saved) return saveSharedAsMine();
  const savedIds = new Set(saved.watched.flatMap(franchiseMemberIds));
  const presets = presetIndex(ds);
  const extras = store.getState().watchedAnime.filter((r) => !franchiseMemberIds(r).some((id) => savedIds.has(id)));
  // Hand the already-loaded casts to restore() through the cast cache, so the merge needs no network.
  for (const r of extras) {
    const pool = r.fullCastPool ?? r.cast;
    if (pool.length && !presets.has(r.id) && !provisionalRecords.has(r)) own.cache.set(r.id, { savedAt: Date.now(), pool });
  }
  store.getState().setGraph(null);
  store.setState({ watchedAnime: [], anchorAnimeId: null });
  restore(ds, { ...saved, watched: [...saved.watched, ...extras.map(toSummary)], hasGeneratedGraph: true }, own.cache);
  store.setState({ isSharedView: false });
  clearShareParam();
}
