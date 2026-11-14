import { animeNodeId } from '../types/contract';
import { carriedEdgeIds, endpointId } from './graphCarry';
import type { AnimeNode, GenesisSpeed, GraphData, SimulationEdge } from '../types/contract';

export interface GenesisStep {
  index: number;
  atMs: number;
  kind: 'ANCHOR' | 'PRIMARY_CAST' | 'ANIME_CLUSTER';
  animeId: number;
  nodeIds: string[];
  edgeIds: string[];
  bridgeNodeIds: string[];
  focusNodeIds: string[];
}

export function planGenesis(graph: GraphData, speed: GenesisSpeed): GenesisStep[] {
  const anchorId = animeNodeId(graph.anchorAnimeId);
  const anime = graph.nodes.filter((n): n is AnimeNode => n.kind === 'ANIME');
  if (!anime.some(n => n.id === anchorId)) throw new Error(`Missing anchor node ${anchorId}`);
  const byAnime = new Map<number, SimulationEdge[]>();
  for (const edge of graph.edges) {
    const list = byAnime.get(edge.animeId) ?? []; list.push(edge); byAnime.set(edge.animeId, list);
  }
  const time = (ms: number) => speed === 'INSTANT' ? 0 : ms / speed;
  if (graph.carry && !graph.carry.addedAnimeIds.includes(graph.anchorAnimeId)) {
    const carried = graph.carry.nodeIds, spawned = new Set(carried);
    const revealed = carriedEdgeIds(graph), appearances = new Map<string, number>();
    for (const edge of graph.edges) if (revealed.has(edge.id)) {
      const target = endpointId(edge.target);
      appearances.set(target, (appearances.get(target) ?? 0) + 1);
    }
    const affected = anime.filter(node => !carried.has(node.id) ||
      (byAnime.get(node.anime.id) ?? []).some(edge => !revealed.has(edge.id) || !carried.has(endpointId(edge.target))))
      .sort((a, b) => a.waveIndex - b.waveIndex);
    // Every changed hub gets its own reduced step, including already-watched anime.
    return affected.map((node, index) => {
      const nodeIds: string[] = [], edgeIds: string[] = [], bridgeNodeIds: string[] = [], focusNodeIds = [node.id];
      if (!spawned.has(node.id)) { spawned.add(node.id); nodeIds.push(node.id); }
      for (const edge of byAnime.get(node.anime.id) ?? []) {
        const target = endpointId(edge.target);
        if (!spawned.has(target)) { spawned.add(target); nodeIds.push(target); }
        if (revealed.has(edge.id)) continue;
        const count = (appearances.get(target) ?? 0) + 1;
        appearances.set(target, count);
        if (count >= 2) bridgeNodeIds.push(target);
        edgeIds.push(edge.id); focusNodeIds.push(target);
      }
      return { index, atMs: time(index * 450), kind: 'ANIME_CLUSTER' as const, animeId: node.anime.id,
        nodeIds, edgeIds, bridgeNodeIds, focusNodeIds };
    });
  }

  const steps: GenesisStep[] = [{ index: 0, atMs: 0, kind: 'ANCHOR', animeId: graph.anchorAnimeId,
    nodeIds: [anchorId], edgeIds: [], bridgeNodeIds: [], focusNodeIds: [anchorId] }];
  const spawned = new Set([anchorId]);
  const appearances = new Map<string, number>();
  const cluster = (node: AnimeNode, primary: boolean, atMs: number) => {
    const nodeIds: string[] = primary ? [] : [node.id];
    spawned.add(node.id);
    const edgeIds: string[] = [], bridgeNodeIds: string[] = [], focusNodeIds = [node.id];
    for (const edge of byAnime.get(node.anime.id) ?? []) {
      const target = typeof edge.target === 'string' ? edge.target : edge.target.id;
      if (!spawned.has(target)) { spawned.add(target); nodeIds.push(target); }
      const count = (appearances.get(target) ?? 0) + 1;
      appearances.set(target, count);
      if (count >= 2) bridgeNodeIds.push(target);
      edgeIds.push(edge.id); focusNodeIds.push(target);
    }
    steps.push({ index: steps.length, atMs: time(atMs), kind: primary ? 'PRIMARY_CAST' : 'ANIME_CLUSTER',
      animeId: node.anime.id, nodeIds, edgeIds, bridgeNodeIds, focusNodeIds });
  };
  cluster(anime.find(n => n.id === anchorId)!, true, 400);
  // Stable sort preserves watched order among anime at the same BFS depth.
  const remaining = anime.filter(n => n.id !== anchorId).sort((a, b) => a.waveIndex - b.waveIndex);
  remaining.forEach((node, i) => cluster(node, false, 900 + 450 * i));
  return steps;
}
