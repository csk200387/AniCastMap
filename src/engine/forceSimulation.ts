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

/**
 * Order anime hubs around an outer ring so franchises that share the most bridge voice actors
 * sit next to each other (greedy spectral/TSP ring ordering).
 */
function orderHubsByAffinity(hubs: StageNode[], cast: { node: StageNode; hubs: StageNode[] }[], seedHub?: StageNode): StageNode[] {
  if (hubs.length <= 2) return hubs;
  const weights = new Map<string, number>();
  const anchorWeights = new Map<string, number>();
  const keyOf = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const c of cast) {
    if (c.hubs.length < 2) continue;
    const hasAnchor = c.hubs.some(h => h.isAnchor);
    for (let i = 0; i < c.hubs.length; i++) {
      const a = c.hubs[i]!;
      if (hasAnchor && !a.isAnchor) anchorWeights.set(a.id, (anchorWeights.get(a.id) ?? 0) + 1);
      for (let j = i + 1; j < c.hubs.length; j++) {
        const b = c.hubs[j]!;
        const k = keyOf(a.id, b.id);
        weights.set(k, (weights.get(k) ?? 0) + 1);
      }
    }
  }
  const w = (a: StageNode, b: StageNode) => weights.get(keyOf(a.id, b.id)) ?? 0;
  const sorted = [...hubs].sort((a, b) => (anchorWeights.get(b.id) ?? 0) - (anchorWeights.get(a.id) ?? 0));
  const seed = seedHub ?? sorted[0]!;
  const remaining = new Set(hubs.filter(h => h !== seed));
  const ring: StageNode[] = [seed];
  while (remaining.size > 0) {
    const left = ring[0]!, right = ring[ring.length - 1]!;
    let bestNode: StageNode | null = null, bestScore = -1, placeRight = true;
    for (const candidate of remaining) {
      const sRight = w(right, candidate) * 2 + w(left, candidate) * 0.4 + (anchorWeights.get(candidate.id) ?? 0) * 0.1;
      const sLeft = w(left, candidate) * 2 + w(right, candidate) * 0.4 + (anchorWeights.get(candidate.id) ?? 0) * 0.1;
      if (sRight > bestScore) { bestScore = sRight; bestNode = candidate; placeRight = true; }
      if (sLeft > bestScore) { bestScore = sLeft; bestNode = candidate; placeRight = false; }
    }
    const pick = bestNode ?? remaining.values().next().value!;
    remaining.delete(pick);
    if (placeRight) ring.push(pick);
    else ring.unshift(pick);
  }
  if (seedHub) {
    const idx = ring.indexOf(seedHub);
    return [...ring.slice(idx), ...ring.slice(0, idx)];
  }
  return ring;
}

/** Topology caches are rebuilt only when nodes/edges change, never during a tick. */
function forceCluster(getEdges: () => SimulationEdge[], getMode: () => ViewMode, bridgesOnly: boolean): Force<StageNode, SimulationEdge> {
  let nodes: StageNode[] = [], planets: StageNode[] = [];
  let planetAngles = new Map<string, number>();
  let cast: {
    node: StageNode;
    hubs: StageNode[];
    soloAngle: number;
    offsetX: number;
    offsetY: number;
    coreX: number;
    coreY: number;
  }[] = [];
  let satellites: { node: StageNode; via: StageNode; angle: number }[] = [];
  const force = (alpha: number) => {
    const mode = getMode();
    // Seiyuu-Centric Core & Outer Rim layout:
    //  - All anime hubs sit on a spacious outer ring, ordered by shared-VA affinity with the anchor at 12 o'clock.
    //  - 3+ anime bridges (Gold Tier) occupy the central core constellation around (0,0), gently biased toward their hubs.
    //  - 2-anime bridges (Neon Tier) hug the inner rim right between their two anime hubs.
    //  - 1-anime solo cast fan out on the exterior crescent outside their anime hub.
    const scale = mode === 'MODE_DETAIL' ? 2.6 : mode === 'MODE_VA' ? 1.15 : 1;
    const ring = clusterDistance(mode) * (bridgesOnly ? 0.68 : 0.9);
    const densityBoost = cast.length > 120 ? 1.38 : 1;
    const P = planets.length;
    const minSep = ring * (mode === 'MODE_DETAIL' ? 2.3 : 2.65) * densityBoost;
    const planetR = P <= 1 ? 0 : P === 2 ? minSep * 0.72 : Math.max(ring * (bridgesOnly ? 2.75 : 3.55) * densityBoost, minSep / (2 * Math.sin(Math.PI / P)));

    for (let i = 0; i < P; i++) {
      const a = planets[i]!;
      if (P >= 2) {
        const angle = planetAngles.get(a.id) ?? ((i / P) * Math.PI * 2 - Math.PI / 2);
        const tx = Math.cos(angle) * planetR;
        const ty = Math.sin(angle) * planetR;
        a.vx! += (tx - a.x!) * alpha * 0.34;
        a.vy! += (ty - a.y!) * alpha * 0.34;
      } else {
        a.vx! -= a.x! * alpha * 0.15;
        a.vy! -= a.y! * alpha * 0.15;
      }

      for (let j = i + 1; j < P; j++) {
        const b = planets[j]!;
        let dx = b.x! - a.x!, dy = b.y! - a.y!, d = Math.hypot(dx, dy);
        if (d < 0.01) { dx = Math.cos(j * GOLDEN_ANGLE); dy = Math.sin(j * GOLDEN_ANGLE); d = 1; }
        const push = Math.max(0, minSep * 0.92 - d) * 0.25 * alpha / d;
        a.vx! -= dx * push; a.vy! -= dy * push; b.vx! += dx * push; b.vy! += dy * push;
      }
    }

    for (const entry of cast) {
      const n = entry.node;
      let x = 0, y = 0;
      for (const hub of entry.hubs) { x += hub.x!; y += hub.y!; }
      x /= entry.hubs.length; y /= entry.hubs.length;

      if (entry.hubs.length === 1) {
        const hub = entry.hubs[0]!;
        if (cast.length > 120) {
          const d = Math.max(1, Math.hypot(n.x! - x, n.y! - y));
          const pull = (d - ring) / d * alpha * 0.35;
          n.vx! -= (n.x! - x) * pull; n.vy! -= (n.y! - y) * pull;
        } else {
          const baseAngle = P >= 2 ? (planetAngles.get(hub.id) ?? Math.atan2(y, x)) : 0;
          const outAngle = baseAngle + entry.soloAngle;
          const soloRadius = ring * 0.94;
          const tx = x + Math.cos(outAngle) * soloRadius;
          const ty = y + Math.sin(outAngle) * soloRadius;
          n.vx! += (tx - n.x!) * alpha * 0.38;
          n.vy! += (ty - n.y!) * alpha * 0.38;
        }
      } else if (entry.hubs.length >= 3) {
        const pullK = cast.length > 120 ? 0.85 : 0.72;
        const tx = x * pullK + entry.coreX * scale * 0.45;
        const ty = y * pullK + entry.coreY * scale * 0.45;
        n.vx! += (tx - n.x!) * alpha * (cast.length > 120 ? 0.38 : 0.5);
        n.vy! += (ty - n.y!) * alpha * (cast.length > 120 ? 0.38 : 0.5);
      } else {
        const pullK = cast.length > 120 ? 0.96 : 0.9;
        const tx = x * pullK + entry.offsetX * scale * 0.85;
        const ty = y * pullK + entry.offsetY * scale * 0.85;
        n.vx! += (tx - n.x!) * alpha * (cast.length > 120 ? 0.38 : 0.5);
        n.vy! += (ty - n.y!) * alpha * (cast.length > 120 ? 0.38 : 0.5);
      }
    }
    const orbit = recommendationOrbit(mode);
    for (const { node, via, angle } of satellites) {
      node.vx! += (via.x! + Math.cos(angle) * orbit - node.x!) * alpha * 0.85;
      node.vy! += (via.y! + Math.sin(angle) * orbit - node.y!) * alpha * 0.85;
      if (node.y! < via.y! + 16) node.vy! += (via.y! + 24 - node.y!) * alpha * 0.8;
    }
  };
  force.initialize = (next: StageNode[]) => {
    nodes = next;
    const hubs = nodes.filter(n => n.kind === 'ANIME');
    const byId = new Map(nodes.map(n => [n.id, n]));
    const adjacency = new Map<string, StageNode[]>();
    for (const edge of getEdges()) {
      if (edge.isRecommendation) continue;
      const a = byId.get(typeof edge.source === 'string' ? edge.source : edge.source.id);
      const b = byId.get(typeof edge.target === 'string' ? edge.target : edge.target.id);
      if (!a || !b) continue;
      const list = adjacency.get(b.id) ?? []; list.push(a); adjacency.set(b.id, list);
    }
    const rawCast = nodes.filter(n => n.kind === 'VOICE_ACTOR' && adjacency.has(n.id)).map(node => ({ node, hubs: adjacency.get(node.id)! }));
    const anchorHub = hubs.find(h => h.isAnchor) ?? hubs[0];
    planets = orderHubsByAffinity(hubs, rawCast, anchorHub);
    planetAngles = new Map(planets.map((h, i) => [h.id, (i / Math.max(1, planets.length)) * Math.PI * 2 - Math.PI / 2]));

    const soloGroups = new Map<string, typeof rawCast>();
    const bridgeGroups = new Map<string, typeof rawCast>();
    for (const item of rawCast) {
      if (item.hubs.length === 1) {
        const key = item.hubs[0]!.id;
        const list = soloGroups.get(key) ?? []; list.push(item); soloGroups.set(key, list);
      } else {
        const key = item.hubs.map(h => h.id).sort().join('|');
        const list = bridgeGroups.get(key) ?? []; list.push(item); bridgeGroups.set(key, list);
      }
    }

    const coreBridges = [...rawCast.filter(c => c.hubs.length >= 3)].sort((a, b) => b.hubs.length - a.hubs.length);
    const coreIndex = new Map(coreBridges.map((c, i) => [c.node.id, i]));

    cast = rawCast.map((item, rawIdx) => {
      if (item.hubs.length === 1) {
        const hub = item.hubs[0]!;
        const siblings = soloGroups.get(hub.id)!;
        const idx = siblings.indexOf(item);
        const span = Math.min(Math.PI * 0.82, Math.max(0.38, (siblings.length - 1) * 0.28));
        const soloAngle = siblings.length <= 1 ? 0 : -span / 2 + (idx / (siblings.length - 1)) * span;
        return { ...item, soloAngle, offsetX: 0, offsetY: 0, coreX: 0, coreY: 0 };
      }
      const key = item.hubs.map(h => h.id).sort().join('|');
      const siblings = bridgeGroups.get(key)!;
      const idx = siblings.indexOf(item);
      const fallbackAngle = rawIdx * GOLDEN_ANGLE;
      const cIdx = coreIndex.get(item.node.id);
      const coreR = cIdx !== undefined ? (cIdx === 0 ? 0 : 68 * Math.sqrt(cIdx)) : 0;
      const coreTheta = (cIdx ?? 0) * GOLDEN_ANGLE;
      const coreX = Math.cos(coreTheta) * coreR;
      const coreY = Math.sin(coreTheta) * coreR;
      if (siblings.length <= 1) return { ...item, soloAngle: fallbackAngle, offsetX: 0, offsetY: 0, coreX, coreY };
      const r = 46 * Math.sqrt(idx + 1);
      const theta = idx * GOLDEN_ANGLE;
      return { ...item, soloAngle: fallbackAngle, offsetX: Math.cos(theta) * r, offsetY: Math.sin(theta) * r, coreX, coreY };
    });
    satellites = [];
    const orbiting = nodes.filter(n => n.kind === 'RECOMMENDATION');
    for (const node of orbiting) {
      const via = byId.get(node.viaNodeId); if (!via) continue;
      const siblings = orbiting.filter(n => n.viaNodeId === node.viaNodeId);
      satellites.push({ node, via, angle: satelliteAngle(siblings.indexOf(node), siblings.length) });
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
    charge.strength(n => (n.kind === 'ANIME' ? 0 : n.kind === 'RECOMMENDATION' ? -45 : -35) * scale);
    collide.radius(n => getNodeFootprint(n, mode).collideRadius + (mode !== 'MODE_DETAIL' && n.kind === 'VOICE_ACTOR' && n.degree >= 2 ? 10 : 0));
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
