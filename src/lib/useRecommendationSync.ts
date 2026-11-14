import { useEffect } from 'react';
import { useGraphStore, watchedMemberIds } from '../store/useGraphStore';
import { recNodeId } from '../types/contract';
import type {
  AnimeDataSource,
  RecommendationNode,
  RecommendationSet,
  SimulationEdge,
  VoiceActorNode,
} from '../types/contract';

const RETRACT_WAIT_MS = 340;

/**
 * Keeps `store.recommendations` in step with (toggle ON) × (a VA node is selected).
 * OFF / deselect / other VA → retract, then (for another VA) spawn the new satellites.
 * Satellites are created here (not in the engine) so the engine only has to place + simulate them.
 */
export function useRecommendationSync(ds: AnimeDataSource): void {
  const enabled = useGraphStore((s) => s.recommendEnabled);
  const graph = useGraphStore((s) => s.graph);
  const target = useGraphStore((s): VoiceActorNode | null => {
    const node = s.selectedNodeId ? s.graph?.nodes.find((n) => n.id === s.selectedNodeId) : undefined;
    return node?.kind === 'VOICE_ACTOR' ? node : null;
  });
  const targetId = target?.id ?? null;

  useEffect(() => {
    const store = useGraphStore.getState();
    if (!enabled || !target) {
      store.retractRecommendations();
      return;
    }
    const controller = new AbortController();
    let timer = 0;
    const current = store.recommendations;
    const hadOther = current !== null && current.viaNodeId !== target.id;
    if (hadOther) store.retractRecommendations();

    const base: Omit<RecommendationSet, 'status'> = {
      viaNodeId: target.id,
      voiceActorId: target.voiceActor.id,
      nodes: [],
      edges: [],
      retracting: false,
    };
    const commit = (set: RecommendationSet) => {
      if (!controller.signal.aborted) useGraphStore.getState().setRecommendations(set);
    };
    const run = async () => {
      if (!hadOther) commit({ ...base, status: 'loading' });
      try {
        const exclude = [...watchedMemberIds(useGraphStore.getState().watchedAnime)];
        const entries = await ds.getRecommendations(target.voiceActor.id, exclude, controller.signal);
        if (hadOther) await new Promise<void>((r) => { timer = window.setTimeout(r, RETRACT_WAIT_MS); });
        if (controller.signal.aborted) return;
        const nodes: RecommendationNode[] = entries.map((e) => ({
          id: recNodeId(e.anime.id),
          kind: 'RECOMMENDATION',
          anime: e.anime,
          character: e.character,
          role: e.role,
          viaNodeId: target.id,
          roles: [],
          waveIndex: target.waveIndex + 1,
          degree: 1,
          isAnchor: false,
        }));
        const edges: SimulationEdge[] = nodes.map((n) => ({
          id: `${target.id}->${n.id}`,
          source: target.id,
          target: n.id,
          animeId: n.anime.id,
          sharedAnimeIds: [],
          isActiveBridge: false,
          isRecommendation: true,
          color: n.anime.color,
        }));
        commit({ ...base, status: nodes.length ? 'ready' : 'empty', nodes, edges });
      } catch (err) {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
        commit({ ...base, status: 'error', error: err instanceof Error ? err.message : 'error' });
      }
    };
    void run();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
    // `graph` identity change (regenerate / extend) restarts the sync against the new node objects.
  }, [enabled, targetId, graph, ds]);
}
