import { isEdgeLit, selectSpotlightSource } from '../../store/useGraphStore';
import type { GraphStore } from '../../store/useGraphStore';
import type { CameraTransform, GraphData, SimulationEdge, StageNode } from '../../types/contract';
import type { GenesisStep } from '../../engine/bfsChoreographer';

const endpoint = (e: SimulationEdge['source']): StageNode => e as StageNode;
interface Ring { node: StageNode; start: number; duration: number; radius: number; color: string }
interface Comet { edge: SimulationEdge; start: number; duration: number; color: string }
interface Bucket { color: string; alpha: number; width: number; edges: SimulationEdge[] }
export function createEdgeCanvas(canvas: HTMLCanvasElement, graph: GraphData | null) {
  const ctx = canvas.getContext('2d')!;
  const background = document.createElement('canvas'), bg = background.getContext('2d')!;
  let pattern: CanvasPattern, vignette: CanvasGradient;
  let width = 1, height = 1, dpr = 1;
  let recommendationEdges: readonly SimulationEdge[] = [];
  const dash = [6, 6], solid: number[] = [];
  const rings: Ring[] = [], comets: Comet[] = [], drawIns = new Map<string, { start: number; duration: number }>();
  const ringPool: Ring[] = graph?.nodes[0] ? Array.from({ length: 64 }, () => ({ node: graph.nodes[0]!, start: 0, duration: 1, radius: 0, color: '' })) : [];
  const cometPool: Comet[] = graph?.edges[0] ? Array.from({ length: 192 }, () => ({ edge: graph.edges[0]!, start: 0, duration: 1, color: '' })) : [];
  const nodes = new Map(graph?.nodes.map(n => [n.id, n]));
  const edges = new Map(graph?.edges.map(e => [e.id, e]));
  // Buckets and their buffers are reused on every frame.
  const buckets: Bucket[] = [];
  for (const anime of graph?.animeById.values() ?? []) for (const bridge of [false, true]) for (const lit of [0, 1, 2]) {
    buckets.push({ color: anime.color, alpha: lit === 2 ? 1 : (bridge ? 0.55 : 0.32) * (lit === 0 ? 0.15 : 1), width: bridge ? 1.8 : 1.25, edges: [] });
  }
  const bucketByKey = new Map<string, Bucket>();
  let bi = 0;
  for (const anime of graph?.animeById.values() ?? []) for (const bridge of [false, true]) for (const lit of [0, 1, 2]) bucketByKey.set(`${anime.id}:${bridge}:${lit}`, buckets[bi++]!);
  // Precomputed edge bucket references avoid string keys in the hot path.
  const edgeBuckets = new Map<SimulationEdge, Bucket[]>();
  for (const edge of graph?.edges ?? []) edgeBuckets.set(edge, [0, 1, 2].map(lit => bucketByKey.get(`${edge.animeId}:${edge.isActiveBridge}:${lit}`)!));
  function resize(w: number, h: number) {
    width = w; height = h; dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.ceil(w * dpr); canvas.height = Math.ceil(h * dpr);
    const tileSize = 512;
    background.width = background.height = Math.ceil(tileSize * dpr);
    bg.setTransform(background.width / tileSize, 0, 0, background.height / tileSize, 0, 0);
    bg.fillStyle = '#090A0F'; bg.fillRect(0, 0, tileSize, tileSize);
    bg.fillStyle = 'rgba(150,165,210,0.08)';
    for (let y = 16; y < tileSize; y += 32) for (let x = 16; x < tileSize; x += 32) bg.fillRect(x, y, 1, 1);
    let seed = 1937;
    const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
    for (let i = 0; i < 32; i++) {
      const x = random() * tileSize, y = random() * tileSize, r = 0.4 + random() * 0.8;
      bg.fillStyle = `rgba(210,220,255,${0.12 + random() * 0.4})`;
      // Duplicate boundary-crossing stars so opposite tile edges join seamlessly.
      for (const dx of [-tileSize, 0, tileSize]) for (const dy of [-tileSize, 0, tileSize]) {
        bg.beginPath(); bg.arc(x + dx, y + dy, r, 0, Math.PI * 2); bg.fill();
      }
    }
    pattern = ctx.createPattern(background, 'repeat')!;
    pattern.setTransform(new DOMMatrix().scale(tileSize / background.width));
    vignette = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(1, Math.hypot(w, h) / 2));
    vignette.addColorStop(0, 'rgba(9,10,15,0)'); vignette.addColorStop(1, 'rgba(9,10,15,0.72)');
  }
  function progress(e: SimulationEdge, now: number) { const entry = drawIns.get(e.id); if (!entry) return 1; const p = Math.min(1, (now - entry.start) / entry.duration); if (p === 1) drawIns.delete(e.id); return p; }
  return { resize,
    get active() { return recommendationEdges.length > 0 || rings.length > 0 || comets.length > 0 || drawIns.size > 0; },
    syncRecommendations(edges: readonly SimulationEdge[]) { recommendationEdges = edges; },
    reset() { recommendationEdges = []; ringPool.push(...rings); cometPool.push(...comets); rings.length = comets.length = 0; drawIns.clear(); },
    effects(step: GenesisStep, now: number, duration: number) {
      const color = graph!.animeById.get(step.animeId)!.color;
      for (const id of step.edgeIds) drawIns.set(id, { start: now, duration });
      const addRing = (node: StageNode, radius: number) => {
        const ring = ringPool.pop() ?? rings.shift()!;
        ring.node = node; ring.start = now; ring.duration = duration * 2; ring.radius = radius; ring.color = color; rings.push(ring);
      };
      addRing(nodes.get(`anime:${step.animeId}`)!, step.kind === 'ANCHOR' ? 280 : 180);
      for (const id of step.bridgeNodeIds) {
        addRing(nodes.get(id)!, 110);
        for (const edgeId of step.edgeIds) { const edge = edges.get(edgeId)!; if ((typeof edge.target === 'string' ? edge.target : edge.target.id) === id && typeof edge.source !== 'string' && typeof edge.target !== 'string' && Number.isFinite(edge.source.x) && Number.isFinite(edge.target.x)) {
          const comet = cometPool.pop() ?? comets.shift()!;
          comet.edge = edge; comet.start = now; comet.duration = duration * 1.6; comet.color = color; comets.push(comet);
        } }
      }
    },
    draw(now: number, camera: CameraTransform, visible: readonly SimulationEdge[], state: GraphStore) {
      const { x, y, k } = camera;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1; ctx.fillStyle = '#090A0F'; ctx.fillRect(0, 0, width, height);
      const offsetX = ((x * 0.15) % 512 + 512) % 512, offsetY = ((y * 0.15) % 512 + 512) % 512;
      ctx.translate(offsetX, offsetY); ctx.fillStyle = pattern;
      ctx.fillRect(-offsetX, -offsetY, width, height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = vignette; ctx.fillRect(0, 0, width, height);
      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * x, dpr * y);
      const spotlight = selectSpotlightSource(state);
      for (const bucket of buckets) bucket.edges.length = 0;
      for (const edge of visible) {
        if (edge.isRecommendation) continue;
        const source = endpoint(edge.source), target = endpoint(edge.target);
        const lit = spotlight ? isEdgeLit(state, source.id, target.id) ? 2 : 0 : 1;
        edgeBuckets.get(edge)![lit]!.edges.push(edge);
      }
      for (const bucket of buckets) {
        if (!bucket.edges.length) continue;
        ctx.strokeStyle = bucket.color; ctx.globalAlpha = bucket.alpha; ctx.lineWidth = bucket.width / k; ctx.beginPath();
        for (const edge of bucket.edges) {
          const a = endpoint(edge.source), b = endpoint(edge.target), p = progress(edge, now);
          ctx.moveTo(a.x!, a.y!); ctx.lineTo(a.x! + (b.x! - a.x!) * p, a.y! + (b.y! - a.y!) * p);
        }
        ctx.stroke();
        if (spotlight && bucket.alpha === 1) {
          ctx.fillStyle = bucket.color; ctx.beginPath();
          for (const edge of bucket.edges) {
            const a = endpoint(edge.source), b = endpoint(edge.target), limit = progress(edge, now);
            for (let i = 0; i < 3; i++) { const p = (now / 1800 + i / 3) % 1; if (p > limit) continue; const px = a.x! + (b.x! - a.x!) * p, py = a.y! + (b.y! - a.y!) * p; ctx.moveTo(px + 2.1 / k, py); ctx.arc(px, py, 2.1 / k, 0, Math.PI * 2); }
          }
          ctx.fill();
        }
      }
      // Overlay edges bypass animeById and the normal colour buckets entirely.
      dash[0] = dash[1] = 6 / k;
      ctx.setLineDash(dash); ctx.lineDashOffset = -now / 60;
      for (const edge of recommendationEdges) {
        const a = endpoint(edge.source), b = endpoint(edge.target);
        const lit = !spotlight || isEdgeLit(state, a.id, b.id), opacity = lit ? 1 : 0.15;
        ctx.strokeStyle = edge.color ?? '#9eb8ff';
        ctx.beginPath(); ctx.moveTo(a.x!, a.y!); ctx.lineTo(b.x!, b.y!);
        ctx.globalCompositeOperation = lit && spotlight ? 'lighter' : 'source-over';
        ctx.globalAlpha = 0.18 * opacity; ctx.lineWidth = 5 / k; ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = opacity; ctx.lineWidth = 1.6 / k; ctx.stroke();
      }
      ctx.setLineDash(solid); ctx.lineDashOffset = 0;
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i]!, p = (now - r.start) / r.duration;
        if (p >= 1) { ringPool.push(r); rings.splice(i, 1); continue; }
        ctx.globalAlpha = (1 - p) * 0.65; ctx.strokeStyle = r.color; ctx.lineWidth = 1.5 / k; ctx.beginPath(); ctx.arc(r.node.x!, r.node.y!, 20 + r.radius * p, 0, Math.PI * 2); ctx.stroke();
      }
      for (let i = comets.length - 1; i >= 0; i--) {
        const c = comets[i]!, p = (now - c.start) / c.duration;
        if (p >= 1) { cometPool.push(c); comets.splice(i, 1); continue; }
        const a = endpoint(c.edge.source), b = endpoint(c.edge.target);
        ctx.globalAlpha = Math.sin(p * Math.PI); ctx.strokeStyle = c.color; ctx.lineWidth = 4 / k; ctx.beginPath();
        const tail = Math.max(0, p - 0.12); ctx.moveTo(a.x! + (b.x! - a.x!) * tail, a.y! + (b.y! - a.y!) * tail); ctx.lineTo(a.x! + (b.x! - a.x!) * p, a.y! + (b.y! - a.y!) * p); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
  };
}
