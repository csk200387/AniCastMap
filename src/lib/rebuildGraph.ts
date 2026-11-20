import { buildGraph } from '../engine/graphBuilder';
import { useGraphStore } from '../store/useGraphStore';
import { franchiseMemberIds, type AnimeRecord, type GraphOptions } from '../types/contract';

export const currentGraphOptions = (): GraphOptions => {
  const { showSupportingRoles, includeSubVoiceActors, bridgesOnly } = useGraphStore.getState();
  return { showSupportingRoles, includeSubVoiceActors, bridgesOnly };
};

/**
 * Rebuild the graph from the watched list with the current filters.
 * `extend`: carry node positions from the graph on stage so only what changed ripples in (used by
 * recommendation adds and filter toggles); otherwise a full BFS genesis replays.
 * `fromGraph`: rebuild only from the anime currently on the graph (e.g. filter toggles while liveUpdate is off).
 */
export function rebuildGraph({ extend = false, fromGraph = false }: { extend?: boolean; fromGraph?: boolean } = {}): void {
  const s = useGraphStore.getState();
  const { watchedAnime, anchorAnimeId, graph, setGraph, selectedNodeId } = s;
  let records: readonly AnimeRecord[] = watchedAnime;
  let anchor = anchorAnimeId;
  if (fromGraph && graph) {
    const appliedIds = new Set([...graph.animeById.values()].flatMap(franchiseMemberIds));
    records = watchedAnime.filter((a) => graph.animeById.has(a.id) || franchiseMemberIds(a).some((id) => appliedIds.has(id)));
    if (!records.length) return;
    anchor = records.some((a) => a.id === anchorAnimeId) ? anchorAnimeId : (records.some((a) => a.id === graph.anchorAnimeId) ? graph.anchorAnimeId : records[0]!.id);
  }
  if (anchor === null || !records.some((a) => a.id === anchor)) return;
  setGraph(buildGraph(records, anchor, extend ? graph : null, currentGraphOptions(), extend ? selectedNodeId : null));
}

/** Apply pending watched-list changes to the existing graph without resetting the camera. */
export function applyPendingGraphChanges(): void {
  const s = useGraphStore.getState();
  if (!s.graph) return;
  if (!s.watchedAnime.length) {
    s.setGraph(null);
    return;
  }
  rebuildGraph({ extend: true });
}

/** Toggle live updates; existing graph stays as last drawn until an edit or manual update occurs. */
export function setLiveUpdateMode(enabled: boolean): void {
  useGraphStore.getState().setLiveUpdate(enabled);
}

/** HUD toggle entry point: flip a filter, and if a graph is on stage rebuild it in place. */
export function setGraphFilter(patch: Partial<GraphOptions>): void {
  const store = useGraphStore.getState();
  store.setGraphFilterFlags(patch);
  if (store.graph) rebuildGraph({ extend: true, fromGraph: !store.liveUpdate });
}
