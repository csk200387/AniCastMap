import { planGenesis } from './bfsChoreographer';
import type { GenesisStep } from './bfsChoreographer';
import { animeNodeId } from '../types/contract';
import type { GenesisSpeed, GraphData, StageNode, SimulationEdge } from '../types/contract';
import type { ForceEngine } from './forceSimulation';
import { carriedEdgeIds } from './graphCarry';

export interface GenesisReporter {
  reset(total: number): void;
  carry?(nodeIds: string[], bridgeIds: string[]): void;
  step(step: GenesisStep, done: boolean): void;
  effects(step: GenesisStep, now: number, duration: number): void;
  finish(instant: boolean): void;
}
export function createGenesis(graph: GraphData, engine: ForceEngine, initialSpeed: GenesisSpeed, report: GenesisReporter) {
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const edgeById = new Map(graph.edges.map(e => [e.id, e]));
  let speed = initialSpeed, steps = planGenesis(graph, speed), index = 0, elapsed = 0, last: number | null = null;
  let playing = false, tracking = true;
  const carry = graph.carry && !graph.carry.addedAnimeIds.includes(graph.anchorAnimeId) ? graph.carry : null;
  const carriedEdges = carriedEdgeIds(graph);
  let nodes: StageNode[] = [], edges: SimulationEdge[] = [];
  function restart() {
    steps = planGenesis(graph, speed); index = 0; elapsed = 0; last = null; playing = true; tracking = !carry;
    nodes = []; edges = [];
    for (const n of graph.nodes) {
      if (!carry?.nodeIds.has(n.id)) { delete n.x; delete n.y; delete n.vx; delete n.vy; }
      n.fx = n.fy = null;
    }
    if (carry) {
      nodes = graph.nodes.filter(n => carry.nodeIds.has(n.id));
      edges = graph.edges.filter(e => carriedEdges.has(e.id));
    }
    engine.setNodes(nodes, edges);
    if (carry) engine.sim.alpha(0.3);
    report.reset(steps.length);
    if (carry) {
      const appearances = new Map<string, number>();
      for (const edge of edges) { const id = typeof edge.target === 'string' ? edge.target : edge.target.id; appearances.set(id, (appearances.get(id) ?? 0) + 1); }
      report.carry?.(nodes.map(n => n.id), [...appearances].filter(([, count]) => count >= 2).map(([id]) => id));
    }
  }
  function spawn(step: GenesisStep) {
    const hub = byId.get(animeNodeId(step.animeId))!;
    if (step.kind === 'ANCHOR') { hub.x = hub.y = hub.fx = hub.fy = 0; }
    else if (step.kind === 'ANIME_CLUSTER' && step.nodeIds.includes(hub.id)) {
      let x = 0, y = 0, count = 0;
      const nearby = carry ? [...graph.neighbors.get(hub.id)!].filter(id => carry.nodeIds.has(id)) : step.bridgeNodeIds;
      for (const id of nearby) { const n = byId.get(id)!; if (n.x !== undefined) { x += n.x; y += n.y!; count++; } }
      const angle = count && Math.hypot(x, y) > 1 ? Math.atan2(y / count, x / count) : step.index * Math.PI * (3 - Math.sqrt(5));
      const radius = 220 + hub.waveIndex * 180; hub.x = carry && count ? x / count + Math.cos(angle) * 100 : Math.cos(angle) * radius;
      hub.y = carry && count ? y / count + Math.sin(angle) * 100 : Math.sin(angle) * radius;
    }
    const cast = step.nodeIds.filter(id => id !== hub.id);
    cast.forEach((id, i) => {
      const n = byId.get(id)!, a = i * Math.PI * 2 / Math.max(1, cast.length);
      // Spawn beside the settled owner, or between positioned hubs for a new bridge.
      const owners = carry ? [...graph.neighbors.get(id)!].map(key => byId.get(key)!)
        .filter(owner => owner.x !== undefined && owner.y !== undefined) : [hub];
      const x = owners.length ? owners.reduce((sum, owner) => sum + owner.x!, 0) / owners.length : hub.x ?? 0;
      const y = owners.length ? owners.reduce((sum, owner) => sum + owner.y!, 0) / owners.length : hub.y ?? 0;
      n.x = x + Math.cos(a) * 150;
      n.y = y + Math.sin(a) * 150;
    });
    nodes = [...nodes, ...step.nodeIds.map(id => byId.get(id)!)];
    edges = [...edges, ...step.edgeIds.map(id => edgeById.get(id)!)];
    engine.setNodes(nodes, edges);
    if (carry) engine.sim.alpha(0.3);
  }
  return {
    restart,
    get playing() { return playing; }, get tracking() { return tracking; },
    get nodes() { return nodes; }, get edges() { return edges; },
    stopTracking() { tracking = false; },
    setSpeed(next: GenesisSpeed) {
      if (speed === next) return;
      if (speed !== 'INSTANT' && next !== 'INSTANT') elapsed = elapsed * speed / next;
      speed = next; steps = planGenesis(graph, speed);
    },
    update(now: number) {
      if (!playing) return;
      if (last !== null) elapsed += now - last; last = now;
      if (steps.length === 0) { playing = false; report.finish(speed === 'INSTANT'); return; }
      while (index < steps.length && (speed === 'INSTANT' || elapsed >= steps[index]!.atMs)) {
        const step = steps[index]!; spawn(step); index++;
        if (speed !== 'INSTANT') report.effects(step, now, 450 / speed);
        const done = index === steps.length;
        if (done) {
          playing = false;
          const anchor = byId.get(animeNodeId(graph.anchorAnimeId))!; anchor.fx = anchor.fy = null;
          if (speed === 'INSTANT' && !carry) engine.sim.tick(150);
        }
        report.step(step, done);
        if (done) report.finish(speed === 'INSTANT');
      }
    },
  };
}
export type GenesisSequencer = ReturnType<typeof createGenesis>;
