import type { RecommendationSet, StageNode, SimulationEdge } from '../types/contract';
import type { ForceEngine } from './forceSimulation';

/** Owns only the temporary overlay; genesis remains the owner of the base topology. */
export function createRecommendationOverlay(engine: ForceEngine,
  base: () => { nodes: readonly StageNode[]; edges: readonly SimulationEdge[] },
  freeze: (node: StageNode) => void = () => {},
) {
  let active: RecommendationSet | null = null, desired: RecommendationSet | null = null;
  const rebuild = () => {
    const graph = base(), alpha = engine.sim.alpha();
    engine.setNodes(active ? [...graph.nodes, ...active.nodes] : [...graph.nodes],
      active ? [...graph.edges, ...active.edges] : [...graph.edges]);
    // Preserve an already-hot genesis; an overlay itself never heats above .25.
    engine.sim.alpha(alpha);
  };
  return {
    get nodes() { return active?.nodes ?? []; },
    get edges() { return active?.edges ?? []; },
    refresh() { if (active) rebuild(); else if (desired) this.sync(desired); },
    sync(set: RecommendationSet | null) {
      const next = set?.status === 'ready' && !set.retracting ? set : null;
      desired = next;
      if (active && next?.viaNodeId === active.viaNodeId && next.nodes.length === active.nodes.length &&
        next.nodes.every((node, i) => node === active!.nodes[i]) && next.edges === active.edges) return;
      for (const node of active?.nodes ?? []) { node.fx = node.fy = null; freeze(node); }
      const via = next && base().nodes.find(n => n.id === next.viaNodeId);
      active = via ? next : null;
      if (active && via) {
        active.nodes.forEach((node, i) => {
          const angle = i * Math.PI * (3 - Math.sqrt(5));
          node.x = (via.x ?? 0) + Math.cos(angle) * 40; node.y = (via.y ?? 0) + Math.sin(angle) * 40;
          node.vx = node.vy = 0; node.fx = node.fy = null;
        });
        // d3 mutates endpoints; a reused set must resolve against the current sim.
        for (const edge of active.edges) {
          if (typeof edge.source !== 'string') edge.source = edge.source.id;
          if (typeof edge.target !== 'string') edge.target = edge.target.id;
        }
      }
      rebuild();
      if (active) engine.sim.alpha(Math.max(engine.sim.alpha(), 0.25));
    },
    dispose() { for (const node of active?.nodes ?? []) freeze(node); active = desired = null; },
  };
}
