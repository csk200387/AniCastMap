import { forceSimulation, forceLink, forceManyBody, forceCollide } from 'd3-force';
import type { Force } from 'd3-force';
import { getNodeFootprint } from '../types/contract';
import type { StageNode, SimulationEdge, ViewMode } from '../types/contract';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
export const clusterDistance = (mode: ViewMode) => mode === 'MODE_DETAIL' ? 560 : mode === 'MODE_VA' ? 220 : 190;
export const recommendationOrbit = (mode: ViewMode) => mode === 'MODE_DETAIL' ? 230 : 130;

/** Topology caches are rebuilt only when nodes/edges change, never during a tick. */
function forceCluster(getEdges: () => SimulationEdge[], getMode: () => ViewMode): Force<StageNode, SimulationEdge> {
  let nodes: StageNode[] = [], hubs: StageNode[] = [];
  let cast: { node: StageNode; hubs: StageNode[] }[] = [];
  let satellites: { node: StageNode; via: StageNode }[] = [];
  let related: { a: StageNode; b: StageNode }[] = [];
  const force = (alpha: number) => {
    const ring = clusterDistance(getMode()) * 0.9;
    // Leave room between hub rings for the full shared cast and recommendation satellites.
    for (let i = 0; i < hubs.length; i++) {
      const a = hubs[i]!;
      a.vx! -= a.x! * alpha * (a.isAnchor ? 0.008 : 0.001);
      a.vy! -= a.y! * alpha * (a.isAnchor ? 0.008 : 0.001);
      for (let j = i + 1; j < hubs.length; j++) {
        const b = hubs[j]!;
        let dx = b.x! - a.x!, dy = b.y! - a.y!, d = Math.hypot(dx, dy);
        if (d < 0.01) { dx = Math.cos(j * GOLDEN_ANGLE); dy = Math.sin(j * GOLDEN_ANGLE); d = 1; }
        const push = Math.max(0, ring * 4.8 - d) * 0.22 * alpha / d;
        a.vx! -= dx * push; a.vy! -= dy * push; b.vx! += dx * push; b.vy! += dy * push;
      }
    }
    for (const { a, b } of related) {
      const dx = b.x! - a.x!, dy = b.y! - a.y!, d = Math.max(1, Math.hypot(dx, dy));
      const pull = (d - ring * 3.8) * 0.002 * alpha / d;
      a.vx! += dx * pull; a.vy! += dy * pull; b.vx! -= dx * pull; b.vy! -= dy * pull;
    }
    for (const entry of cast) {
      const n = entry.node;
      let x = 0, y = 0;
      for (const hub of entry.hubs) { x += hub.x!; y += hub.y!; }
      x /= entry.hubs.length; y /= entry.hubs.length;
      const dx = n.x! - x, dy = n.y! - y;
      if (entry.hubs.length === 1) {
        const d = Math.max(1, Math.hypot(dx, dy));
        const pull = (d - ring) / d * alpha * 0.3;
        n.vx! -= dx * pull; n.vy! -= dy * pull;
      } else {
        n.vx! -= dx * alpha * 0.5; n.vy! -= dy * alpha * 0.5;
      }
    }
    for (const { node, via } of satellites) {
      const dx = node.x! - via.x!, dy = node.y! - via.y!, d = Math.max(1, Math.hypot(dx, dy));
      const pull = (d - recommendationOrbit(getMode())) / d * alpha * 0.6;
      node.vx! -= dx * pull; node.vy! -= dy * pull;
    }
  };
  force.initialize = (next: StageNode[]) => {
    nodes = next; hubs = nodes.filter(n => n.kind === 'ANIME');
    const byId = new Map(nodes.map(n => [n.id, n]));
    const adjacency = new Map<string, StageNode[]>();
    for (const edge of getEdges()) {
      if (edge.isRecommendation) continue;
      const a = byId.get(typeof edge.source === 'string' ? edge.source : edge.source.id);
      const b = byId.get(typeof edge.target === 'string' ? edge.target : edge.target.id);
      if (!a || !b) continue;
      const list = adjacency.get(b.id) ?? []; list.push(a); adjacency.set(b.id, list);
    }
    cast = nodes.filter(n => n.kind === 'VOICE_ACTOR' && adjacency.has(n.id)).map(node => ({ node, hubs: adjacency.get(node.id)! }));
    satellites = [];
    for (const node of nodes) if (node.kind === 'RECOMMENDATION') {
      const via = byId.get(node.viaNodeId); if (via) satellites.push({ node, via });
    }
    related = [];
    const pairs = new Set<string>();
    for (const entry of cast) for (let i = 0; i < entry.hubs.length; i++) for (let j = i + 1; j < entry.hubs.length; j++) {
      const a = entry.hubs[i]!, b = entry.hubs[j]!, key = [a.id, b.id].sort().join('|');
      if (!pairs.has(key)) { pairs.add(key); related.push({ a, b }); }
    }
  };
  return force;
}

/** No internal d3 clock: the stage (or a headless caller) owns every tick. */
export function createForceEngine(initialMode: ViewMode) {
  let mode = initialMode, currentEdges: SimulationEdge[] = [];
  const links = forceLink<StageNode, SimulationEdge>().id(n => n.id);
  const collide = forceCollide<StageNode>().iterations(4);
  const charge = forceManyBody<StageNode>().distanceMax(2400);
  const cluster = forceCluster(() => currentEdges, () => mode);
  const sim = forceSimulation<StageNode>([]).stop().alphaDecay(0.015)
    .force('link', links).force('charge', charge).force('cluster', cluster).force('collide', collide);
  let paused = false;
  function setViewMode(next: ViewMode) {
    mode = next;
    const scale = mode === 'MODE_DETAIL' ? 4 : mode === 'MODE_VA' ? 1.3 : 1;
    links.distance(e => e.isRecommendation ? (mode === 'MODE_DETAIL' ? 220 : 120) : clusterDistance(mode))
      .strength(e => e.isRecommendation ? 0.12 : e.isActiveBridge ? 0.002 : 0.12);
    // Hub exclusion already separates anime. Strong many-body charge additionally pushes
    // shared actors away from their hubs, overwhelming compact clusters as bridges grow.
    charge.strength(n => (n.kind === 'ANIME' ? 0 : n.kind === 'RECOMMENDATION' ? -45 : -20) * scale);
    collide.radius(n => getNodeFootprint(n, mode).collideRadius);
    sim.alpha(0.35);
  }
  setViewMode(initialMode);
  return { sim, links, setViewMode,
    setPhysicsPaused(value: boolean) { paused = value; },
    tick() { if (!paused && (sim.alpha() > sim.alphaMin() || sim.alphaTarget() > 0)) { sim.tick(); return true; } return false; },
    setNodes(nodes: StageNode[], edges: SimulationEdge[]) {
      links.links([]); currentEdges = edges; sim.nodes(nodes); links.links(edges); sim.alpha(0.7);
    },
    dispose() { sim.stop(); links.links([]); currentEdges = []; sim.nodes([]); },
  };
}
export type ForceEngine = ReturnType<typeof createForceEngine>;
