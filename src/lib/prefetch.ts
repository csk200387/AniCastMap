import { useEffect } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import type { AnimeDataSource, StageNode, VoiceActorNode } from '../types/contract';

/**
 * Background cache warming. ONE prefetch is in flight at a time, so a click never queues behind a burst of
 * speculative requests (AniList is paced at 750ms per start). Hover jobs are latest-wins; idle jobs (bridge VAs
 * after genesis) run only when the lane is empty and the browser is idle. Cached targets resolve instantly.
 */
type Job = () => Promise<unknown>;
let hot: Job | null = null;
let cold: Job[] = [];
let busy = false;
let idleWait = false;

const whenIdle = (fn: () => void) =>
  typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 200);

function run(job: Job): void {
  busy = true;
  void job().catch(() => undefined).finally(() => { busy = false; pump(); });
}
function pump(): void {
  if (busy) return;
  if (hot) { const job = hot; hot = null; run(job); return; }
  if (!cold.length || idleWait) return;
  idleWait = true;
  whenIdle(() => { idleWait = false; if (!busy && !hot && cold.length) run(cold.shift()!); else pump(); });
}
const hotJob = (job: Job) => { hot = job; pump(); };

export const prefetchFilmography = (ds: AnimeDataSource, voiceActorId: number) =>
  hotJob(() => ds.getVoiceActorFilmography(voiceActorId));
export const prefetchAnime = (ds: AnimeDataSource, animeId: number) => hotJob(() => ds.getAnime(animeId));

let hoverTimer: ReturnType<typeof setTimeout> | undefined;
/** Pointer handlers that fire `fn` after the pointer rests `ms` on an element (one pointer → one shared timer). */
export function hoverIntent(fn: () => void, ms = 80) {
  return {
    onPointerEnter: () => { clearTimeout(hoverTimer); hoverTimer = setTimeout(fn, ms); },
    onPointerLeave: () => clearTimeout(hoverTimer),
  };
}

const TOP_BRIDGES = 8;

/**
 * Graph-level warming: a VA node rested on for 60ms prefetches its filmography (inspector + recommendations
 * then render from cache); a recommendation satellite rested on for 80ms prefetches its cast bundle ("+" adds
 * from cache). After genesis settles, the top bridge VAs' filmographies warm during idle time.
 */
export function useGraphPrefetch(ds: AnimeDataSource): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useGraphStore.subscribe((s, prev) => {
      if (s.hoveredNodeId !== prev.hoveredNodeId) {
        clearTimeout(timer);
        const id = s.hoveredNodeId;
        const node: StageNode | undefined = id
          ? (s.graph?.nodes.find((n) => n.id === id) ?? s.recommendations?.nodes.find((n) => n.id === id))
          : undefined;
        if (node?.kind === 'VOICE_ACTOR') timer = setTimeout(() => prefetchFilmography(ds, node.voiceActor.id), 60);
        else if (node?.kind === 'RECOMMENDATION') timer = setTimeout(() => prefetchAnime(ds, node.anime.id), 80);
      }
      if (s.graph !== prev.graph) cold = [];
      if (s.genesis.status === 'done' && prev.genesis.status !== 'done' && s.graph) {
        cold = s.graph.nodes
          .filter((n): n is VoiceActorNode => n.kind === 'VOICE_ACTOR' && n.degree >= 2)
          .sort((a, b) => b.degree - a.degree)
          .slice(0, TOP_BRIDGES)
          .map((n) => () => ds.getVoiceActorFilmography(n.voiceActor.id));
        pump();
      }
    });
    return () => { clearTimeout(timer); unsubscribe(); cold = []; };
  }, [ds]);
}
