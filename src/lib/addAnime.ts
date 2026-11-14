import { provisionalRecords, useGraphStore } from '../store/useGraphStore';
import { rebuildGraph } from './rebuildGraph';
import { applyRecord } from './session';
import { animeNodeId, type AnimeDataSource, type AnimeRecord, type AnimeSummary, type CastEntry } from '../types/contract';

const inList = (record: AnimeRecord) => useGraphStore.getState().watchedAnime.includes(record);
/** Cached records resolve within microtasks; anything still pending after one macrotask is a network load. */
const nextTask = () => new Promise<null>((resolve) => setTimeout(() => resolve(null), 0));
/** Resolves once genesis has placed `nodeId` (or it is no longer on stage), so a carry rebuild inherits real x/y. */
function placed(nodeId: string): Promise<void> {
  return new Promise((resolve) => {
    const ok = () => { const s = useGraphStore.getState(); return !s.graph?.neighbors.has(nodeId) || s.revealedNodeIds.has(nodeId); };
    if (ok()) return resolve();
    const done = () => { off(); clearTimeout(timer); resolve(); };
    const off = useGraphStore.subscribe(() => { if (ok()) done(); });
    const timer = setTimeout(done, 3000);
  });
}

/**
 * Resolve the canonical (franchise-merged) record and add it to the watched list.
 * `extendGraph`: when a graph is already on stage, rebuild it carrying the old positions so only the
 * new anime plays a ripple pass (recommendation → "add to graph").
 * `seed`: the credit the caller already knows (filmography / recommendation: this character ⇄ this VA). When the
 * full record is not cached, stage 1 inserts the anime with just that credit at once (node + bridge edge, no
 * network wait); stage 2 swaps in the full record when it lands and ripples in the remaining cast.
 */
export async function addAnimeToWatched(
  ds: AnimeDataSource,
  summary: AnimeSummary,
  opts: { extendGraph?: boolean; seed?: CastEntry } = {},
): Promise<boolean> {
  const store = useGraphStore.getState();
  if (store.addingAnimeIds.has(summary.id)) return false;
  store.markAdding(summary.id, true);
  const extend = () => { if (opts.extendGraph && useGraphStore.getState().graph) rebuildGraph({ extend: true }); };
  try {
    const loading = ds.getAnime(summary.id);
    let placeholder: AnimeRecord | null = null;
    if (opts.seed && !(await Promise.race([loading, nextTask()]))) {
      placeholder = { ...summary, cast: [opts.seed], fullCastPool: [opts.seed] };
      provisionalRecords.add(placeholder);
      store.addAnime(placeholder);
      if (inList(placeholder)) extend();
      else placeholder = null; // a franchise member is already watched: nothing to hydrate
    }
    const record = await loading;
    if (!placeholder) {
      useGraphStore.getState().addAnime(record);
      extend();
    } else if (inList(placeholder)) {
      await placed(animeNodeId(placeholder.id));
      if (inList(placeholder)) { applyRecord(placeholder.id, record); extend(); }
    }
    useGraphStore.getState().markAdding(summary.id, false);
    return true;
  } catch (err) {
    // A failed hydration keeps the optimistic entry (its one credit is real); a reload re-fetches it.
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    useGraphStore.getState().markAdding(summary.id, false, aborted ? undefined : err instanceof Error ? err.message : 'error');
    return false;
  }
}
