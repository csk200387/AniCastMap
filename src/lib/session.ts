/**
 * Session lifecycle: first visit vs returning visitor, restore, hydration and reset.
 *
 *  - First visit (no valid saved state): seed the curated presets and play the normal genesis.
 *  - Returning visitor: restore EXACTLY the saved list / anchor / preferences (never the default presets), resolve
 *    every anime's cast pool without waiting for the network where possible (bundled preset → localStorage cast cache),
 *    and rebuild the graph instantly if one was on screen.
 */
import { startPersistence, type PersistenceHandle } from '../store/persistence';
import { useGraphStore } from '../store/useGraphStore';
import {
  browserStorage,
  isStale,
  loadUserState,
  readCastCache,
  recordFromPool,
  type CastCache,
  type PersistedState,
  type StorageLike,
} from '../services/userState';
import type { AnimeDataSource, AnimeRecord } from '../types/contract';
import { rebuildGraph } from './rebuildGraph';

const store = useGraphStore;

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
function applyRecord(oldId: number, record: AnimeRecord): void {
  const s = store.getState();
  if (record.id !== oldId && s.watchedAnime.some((a) => a.id === record.id)) s.removeAnime(oldId);
  else s.replaceAnimeRecord(oldId, record);
}

async function hydrate(ds: AnimeDataSource, ids: readonly number[]): Promise<void> {
  await Promise.allSettled(ids.map(async (id) => applyRecord(id, await ds.getAnime(id))));
}

function restore(ds: AnimeDataSource, saved: PersistedState, cache: CastCache): void {
  const presets = new Map<number, AnimeRecord>();
  for (const p of ds.presets) for (const id of [p.id, ...(p.franchise?.members.map((m) => m.id) ?? [])]) presets.set(id, p);
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
  if (saved) restore(ds, saved, cache);
  else seedDefaults(ds);
  const presetIds = new Set(ds.presets.flatMap((p) => [p.id, ...(p.franchise?.members.map((m) => m.id) ?? [])]));
  return startPersistence(storage, (id) => presetIds.has(id), { delay: opts.persistDelay, castCache: cache });
}
