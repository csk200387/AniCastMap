import { buildGraph } from '../engine/graphBuilder';
import { useGraphStore } from '../store/useGraphStore';
import type { GraphOptions } from '../types/contract';

export const currentGraphOptions = (): GraphOptions => {
  const { showSupportingRoles, includeSubVoiceActors, bridgesOnly } = useGraphStore.getState();
  return { showSupportingRoles, includeSubVoiceActors, bridgesOnly };
};

/**
 * Rebuild the graph from the watched list with the current filters.
 * `extend`: carry node positions from the graph on stage so only what changed ripples in (used by
 * recommendation adds and filter toggles); otherwise a full BFS genesis replays.
 */
export function rebuildGraph({ extend = false }: { extend?: boolean } = {}): void {
  const { watchedAnime, anchorAnimeId, graph, setGraph } = useGraphStore.getState();
  if (anchorAnimeId === null) return;
  setGraph(buildGraph(watchedAnime, anchorAnimeId, extend ? graph : null, currentGraphOptions()));
}

/** HUD toggle entry point: flip a filter, and if a graph is on stage rebuild it in place. */
export function setGraphFilter(patch: Partial<GraphOptions>): void {
  const store = useGraphStore.getState();
  store.setGraphFilterFlags(patch);
  if (store.graph) rebuildGraph({ extend: true });
}
