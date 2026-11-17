import { forceSimulation, forceLink, forceManyBody, forceCollide } from 'd3-force';
import type { Force } from 'd3-force';
import { getNodeFootprint, ROLE_DECK } from '../types/contract';
import type { StageNode, SimulationEdge, ViewMode, VoiceActorNode } from '../types/contract';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
export const clusterDistance = (mode: ViewMode) => mode === 'MODE_DETAIL' ? 560 : mode === 'MODE_VA' ? 220 : 190;
/** Satellites sit well outside the VA's own chrome (badge, name pill, card deck). */
export const recommendationOrbit = (mode: ViewMode) => mode === 'MODE_DETAIL' ? 260 : 190;
/** Screen-space sector for satellites (y grows downward, 90° = straight below): the deck owns the space above. */
export const SATELLITE_ARC: readonly [number, number] = [25 * Math.PI / 180, 155 * Math.PI / 180];
export const satelliteAngle = (i: number, n: number) => SATELLITE_ARC[0] + (SATELLITE_ARC[1] - SATELLITE_ARC[0]) * (i + 0.5) / n;

/** Exclusion box around an open card deck, relative to its anchor's centre (world px). */
export interface KeepOut { anchor: StageNode; left: number; right: number; top: number; bottom: number }
/** The selected VA's deck box at camera zoom `k` (the deck counter-scales to stay legible when zoomed out). */
export function deckKeepOut(anchor: VoiceActorNode, k: number): KeepOut {
  const s = Math.min(5, Math.max(0.9, 1 / k));
  // The VA name pill under the cards can be wider than a two-card fan.
  const half = Math.max(ROLE_DECK.card + (anchor.roles.length - 1) * ROLE_DECK.step, 150) / 2 * s + 28;
  const deckTop = -(ROLE_DECK.card / 2 + ROLE_DECK.gap + ROLE_DECK.height * s);
  return { anchor, left: -half, right: half, top: deckTop - 40, bottom: 10 };
}

/** Pushes every node's box out of the deck box through the nearest side. Position-based like forceCollide. */
function forceKeepOut(get: () => KeepOut | null, getMode: () => ViewMode): Force<StageNode, SimulationEdge> {
  let nodes: StageNode[] = [];
  const force = () => {
    const box = get(); if (!box) return;
    const ax = box.anchor.x!, ay = box.anchor.y!, mode = getMode();
    for (const n of nodes) {
      if (n === box.anchor) continue;
      const { width, height } = getNodeFootprint(n, mode);
      const dx = n.x! - ax, dy = n.y! - ay;
      const left = box.left - width / 2 - dx, right = box.right + width / 2 - dx;
      const top = box.top - height / 2 - dy, bottom = box.bottom + height / 2 - dy;
      if (left >= 0 || right <= 0 || top >= 0 || bottom <= 0) continue;
      // Nearest exit; sideways/down win ties because the deck opens upward.
      const k = n.kind === 'RECOMMENDATION' ? 0.6 : 0.4;
      const side = -left < right ? left : right, vertical = bottom <= -top ? bottom : top;
      if (Math.abs(side) < Math.abs(vertical)) n.vx! += side * k; else n.vy! += vertical * k;
    }
  };
  force.initialize = (next: StageNode[]) => { nodes = next; };
  return force;
}

/** Topology caches are rebuilt only when nodes/edges change, never during a tick. */
function forceCluster(getEdges: () => SimulationEdge[], getMode: () => ViewMode, bridgesOnly: boolean): Force<StageNode, SimulationEdge> {
  let nodes: StageNode[] = [], hubs: StageNode[] = [];
  let cast: { node: StageNode; hubs: StageNode[] }[] = [];
  let satellites: { node: StageNode; via: StageNode; angle: number }[] = [];
  let related: { a: StageNode; b: StageNode }[] = [];
  const force = (alpha: number) => {
    const ring = clusterDistance(getMode()) * (bridgesOnly ? 0.68 : 0.9);
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
    // Angular target: each satellite springs to its own slot on the lower arc, fanned evenly across the sector.
    const orbit = recommendationOrbit(getMode());
    for (const { node, via, angle } of satellites) {
      node.vx! += (via.x! + Math.cos(angle) * orbit - node.x!) * alpha * 0.4;
      node.vy! += (via.y! + Math.sin(angle) * orbit - node.y!) * alpha * 0.4;
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
    const orbiting = nodes.filter(n => n.kind === 'RECOMMENDATION');
    for (const node of orbiting) {
      const via = byId.get(node.viaNodeId); if (!via) continue;
      const siblings = orbiting.filter(n => n.viaNodeId === node.viaNodeId);
      satellites.push({ node, via, angle: satelliteAngle(siblings.indexOf(node), siblings.length) });
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
export function createForceEngine(initialMode: ViewMode, keepOut: () => KeepOut | null = () => null, bridgesOnly = false) {
  let mode = initialMode, currentEdges: SimulationEdge[] = [];
  const links = forceLink<StageNode, SimulationEdge>().id(n => n.id);
  const collide = forceCollide<StageNode>().iterations(4);
  const charge = forceManyBody<StageNode>().distanceMax(2400);
  const cluster = forceCluster(() => currentEdges, () => mode, bridgesOnly);
  const sim = forceSimulation<StageNode>([]).stop().alphaDecay(0.015)
    .force('link', links).force('charge', charge).force('cluster', cluster).force('collide', collide)
    .force('keepOut', forceKeepOut(keepOut, () => mode));
  let paused = false;
  function setViewMode(next: ViewMode) {
    mode = next;
    const scale = mode === 'MODE_DETAIL' ? 4 : mode === 'MODE_VA' ? 1.3 : 1;
    links.distance(e => e.isRecommendation ? recommendationOrbit(mode) : clusterDistance(mode))
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
