import { useGraphStore } from '../store/useGraphStore';
import { rebuildGraph } from './rebuildGraph';
import type { AnimeDataSource, AnimeSummary } from '../types/contract';

/**
 * Resolve the canonical (franchise-merged) record and add it to the watched list.
 * `extendGraph`: when a graph is already on stage, rebuild it carrying the old positions so only the
 * new anime plays a ripple pass (recommendation → "add to graph").
 */
export async function addAnimeToWatched(
  ds: AnimeDataSource,
  summary: AnimeSummary,
  opts: { extendGraph?: boolean } = {},
): Promise<boolean> {
  const store = useGraphStore.getState();
  if (store.addingAnimeIds.has(summary.id)) return false;
  store.markAdding(summary.id, true);
  try {
    const record = await ds.getAnime(summary.id);
    const s = useGraphStore.getState();
    s.addAnime(record);
    if (opts.extendGraph && useGraphStore.getState().graph) rebuildGraph({ extend: true });
    useGraphStore.getState().markAdding(summary.id, false);
    return true;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      useGraphStore.getState().markAdding(summary.id, false);
    } else {
      useGraphStore.getState().markAdding(summary.id, false, err instanceof Error ? err.message : 'error');
    }
    return false;
  }
}
