import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { PRESET_ANIME } from '../src/data/presetAnime';
import { buildGraph } from '../src/engine/graphBuilder';
import { createForceEngine } from '../src/engine/forceSimulation';
import { createGenesis } from '../src/engine/genesisSequencer';
import { createRecommendationOverlay } from '../src/engine/recommendationOverlay';
import { planGenesis } from '../src/engine/bfsChoreographer';
import { carriedEdgeIds } from '../src/engine/graphCarry';
import { deckKeepOut, recommendationOrbit, SATELLITE_ARC } from '../src/engine/forceSimulation';
import type { KeepOut } from '../src/engine/forceSimulation';
import type { RecommendationSet, StageNode, VoiceActorNode } from '../src/types/contract';
import { DEFAULT_GRAPH_OPTIONS, VIEW_MODES, getNodeFootprint } from '../src/types/contract';
import { needsHiResImages } from '../src/components/canvas/GraphStage';

// Medium is sufficient through exactly 100 device pixels; VA faces are wider at the same zoom.
for (const mode of VIEW_MODES) for (const dpr of [1, 2, 3]) {
  const threshold = 100 / (dpr * (mode === 'MODE_VA' ? 120 : 64));
  assert.equal(needsHiResImages(threshold, dpr, mode), false);
  assert.equal(needsHiResImages(threshold - 0.001, dpr, mode), false);
  assert.equal(needsHiResImages(threshold + 0.001, dpr, mode), true);
}
assert.equal(needsHiResImages(0.5, 2, 'MODE_CHARACTER'), false);
assert.equal(needsHiResImages(0.5, 2, 'MODE_VA'), true);
assert.equal(needsHiResImages(0.5, 2, 'MODE_DETAIL'), false);
console.log('PASS: Portrait resolution threshold, device pixel ratios, and view-mode changes.');

const distance = (a: StageNode, b: { x?: number; y?: number }) => Math.hypot(a.x! - b.x!, a.y! - b.y!);
function minimumCollisionRatio(nodes: readonly StageNode[], mode: typeof VIEW_MODES[number]) {
  let ratio = Infinity;
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    ratio = Math.min(ratio, distance(nodes[i]!, nodes[j]!) /
      (getNodeFootprint(nodes[i]!, mode).collideRadius + getNodeFootprint(nodes[j]!, mode).collideRadius));
  }
  return ratio;
}
const optionSets = [
  ['default', DEFAULT_GRAPH_OPTIONS],
  ['expanded', { ...DEFAULT_GRAPH_OPTIONS, showSupportingRoles: true, includeSubVoiceActors: true }],
] as const;
console.log(`Preset physics checks: ${PRESET_ANIME.length} anime, default vs expanded (both filters enabled).`);
for (const [label, options] of optionSets) for (const mode of VIEW_MODES) {
  const graph = buildGraph(PRESET_ANIME, PRESET_ANIME[0]!.id, undefined, options);
  const engine = createForceEngine(mode);
  engine.setNodes(graph.nodes, graph.edges);
  const start = performance.now(); engine.sim.tick(400); const ms = (performance.now() - start) / 400;
  assert(graph.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)), `${mode}: invalid position`);
  const hubs = graph.nodes.filter(n => n.kind === 'ANIME');
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const singles = graph.nodes.filter(n => n.kind === 'VOICE_ACTOR' && n.degree === 1);
  const owned = singles.filter(n => {
    const own = byId.get([...graph.neighbors.get(n.id)!][0]!)!;
    return hubs.every(h => h === own || distance(n, own) < distance(n, h));
  }).length / Math.max(1, singles.length);
  // (b) compares hub spacing with the hub→OWN-cast radius: edges to single-show VAs only. Bridge edges are
  // long by design (a bridge sits between its hubs) and are covered by (c).
  const castDistances = graph.edges.filter(e => (e.target as StageNode).degree === 1).map(e => distance(e.source as StageNode, e.target as StageNode)).sort((a, b) => a - b);
  const middle = Math.floor(castDistances.length / 2);
  const median = castDistances.length % 2 ? castDistances[middle]! : (castDistances[middle - 1]! + castDistances[middle]!) / 2;
  let hubMinimum = Infinity, worstBridge = 0;
  for (let i = 0; i < hubs.length; i++) for (let j = i + 1; j < hubs.length; j++) hubMinimum = Math.min(hubMinimum, distance(hubs[i]!, hubs[j]!));
  for (const node of graph.nodes.filter(n => n.kind === 'VOICE_ACTOR' && n.degree >= 2)) {
    const own = [...graph.neighbors.get(node.id)!].map(id => byId.get(id)!);
    const centroid = { x: own.reduce((sum, h) => sum + h.x!, 0) / own.length, y: own.reduce((sum, h) => sum + h.y!, 0) / own.length };
    let total = 0, count = 0;
    for (let i = 0; i < own.length; i++) for (let j = i + 1; j < own.length; j++) { total += distance(own[i]!, own[j]!); count++; }
    const ratio = distance(node, centroid) / (total / count);
    assert(ratio <= 0.6, `${mode}: bridge ${node.id} centroid ratio ${ratio}`);
    worstBridge = Math.max(worstBridge, ratio);
  }
  const collisionRatio = minimumCollisionRatio(graph.nodes, mode);
  assert(owned >= 0.9, `${mode}: own-hub fraction ${owned}`);
  assert(hubMinimum >= median * 2, `${mode}: hub separation ${hubMinimum} < 2 × median own-cast distance ${median}`);
  assert(collisionRatio >= 0.85, `${mode}: collision radius ratio ${collisionRatio}`);
  assert(ms <= 2, `${mode}: ${ms} ms/tick exceeds budget`);
  console.log(`${label} ${mode}: ${graph.nodes.length} nodes, ${graph.edges.length} edges; (a) own hub ${(owned * 100).toFixed(1)}%; (b) min hubs ${hubMinimum.toFixed(2)} / median own-cast ${median.toFixed(2)} = ${(hubMinimum / median).toFixed(3)}×; (c) worst bridge ${worstBridge.toFixed(3)}; (d) min collision ratio ${collisionRatio.toFixed(4)}; ${ms.toFixed(3)} ms/tick`);

  // Exercise the exact helper called by GraphStage, including replacement and frozen exits.
  const via = graph.nodes.find(n => n.kind === 'VOICE_ACTOR')!;
  const rec: RecommendationSet = { viaNodeId: via.id, voiceActorId: via.kind === 'VOICE_ACTOR' ? via.voiceActor.id : 0,
    status: 'ready', retracting: false,
    nodes: Array.from({ length: 4 }, (_, i) => ({ id: `rec:test:${i}`, kind: 'RECOMMENDATION',
      anime: { ...PRESET_ANIME[0]!, id: -1 - i }, character: PRESET_ANIME[0]!.cast[0]!.character, role: 'MAIN',
      viaNodeId: via.id, roles: [], degree: 1, waveIndex: 0, isAnchor: false })), edges: [] };
  rec.edges = rec.nodes.map(node => ({ id: `${via.id}->${node.id}`, source: via.id, target: node.id,
    animeId: node.anime.id, color: node.anime.color, sharedAnimeIds: [], isActiveBridge: false, isRecommendation: true }));
  let freezes = 0;
  const overlay = createRecommendationOverlay(engine, () => graph, () => { freezes++; });
  engine.sim.alpha(0.01); overlay.sync(rec); assert.equal(engine.sim.alpha(), 0.25);
  assert.equal(engine.sim.nodes().length, graph.nodes.length + 4); assert.equal(engine.links.links().length, graph.edges.length + 4);
  rec.nodes.forEach(node => assert(Math.abs(distance(node, via) - 40) < 1e-6));
  const spawn = rec.nodes[0]!.x; overlay.sync(rec); assert.equal(rec.nodes[0]!.x, spawn);
  engine.sim.tick(400);
  const orbitMax = Math.max(...rec.nodes.map(n => distance(n, via)));
  // Satellites own the lower arc (screen y down); the card deck opens above the VA.
  const angles = rec.nodes.map(n => Math.atan2(n.y! - via.y!, n.x! - via.x!) * 180 / Math.PI);
  assert(angles.every(a => a > 0 && a < 180), `${mode}: satellite above its VA ${angles.map(a => a.toFixed(0))}`);
  if (mode === 'MODE_CHARACTER') console.log(`  Satellite angles (target ${SATELLITE_ARC.map(a => (a * 180 / Math.PI).toFixed(0)).join('–')}°): ${angles.map(a => a.toFixed(0)).join(', ')}`);
  // DETAIL cards collide at 130px, so in the dense expanded graph satellites are legitimately pushed further out.
  assert(orbitMax <= (mode === 'MODE_DETAIL' ? 2.2 : 1.8) * recommendationOrbit(mode), `${mode}: recommendation distance ${orbitMax}`);
  assert(minimumCollisionRatio(engine.sim.nodes(), mode) >= 0.85, `${mode}: recommendation overlap`);
  overlay.sync({ ...rec, retracting: true });
  assert.equal(freezes, 4); assert.equal(engine.sim.nodes().length, graph.nodes.length); assert.equal(engine.links.links().length, graph.edges.length);
  const frozen = rec.nodes.map(n => [n.x, n.y]); engine.sim.tick(20); assert.deepEqual(rec.nodes.map(n => [n.x, n.y]), frozen);
  overlay.sync(rec); engine.sim.alpha(0.6); overlay.sync({ ...rec, edges: [...rec.edges] }); assert.equal(engine.sim.alpha(), 0.6);
  overlay.sync({ ...rec, status: 'loading' }); assert.equal(engine.sim.nodes().length, graph.nodes.length);
  overlay.sync(rec); overlay.sync(null); assert.equal(engine.links.links().length, graph.edges.length);
  let available = false;
  const pending = createRecommendationOverlay(engine, () => available ? graph : { nodes: [], edges: [] });
  pending.sync(rec); assert.equal(pending.nodes.length, 0);
  available = true; pending.refresh(); assert.equal(pending.nodes.length, 4);
  const replacementVia = graph.nodes.find(n => n.kind === 'VOICE_ACTOR' && n.id !== via.id)!;
  const replacement: RecommendationSet = { ...rec, viaNodeId: replacementVia.id,
    nodes: rec.nodes.map(n => ({ ...n, viaNodeId: replacementVia.id })),
    edges: rec.edges.map(e => ({ ...e, source: replacementVia.id, target: typeof e.target === 'string' ? e.target : e.target.id })) };
  pending.sync(replacement); assert.equal(engine.sim.nodes().length, graph.nodes.length + 4);
  assert(pending.nodes.every(n => Math.abs(distance(n, replacementVia) - 40) < 1e-6));
  pending.sync(null); pending.dispose(); overlay.dispose();
  console.log(`  Recommendation bloom/removal: 4 satellites, max orbit ${orbitMax.toFixed(2)} / limit ${(1.8 * recommendationOrbit(mode)).toFixed(0)} px; frozen exits and original topology restored.`);
  engine.setPhysicsPaused(true); const x = graph.nodes[0]!.x; engine.tick(); assert.equal(graph.nodes[0]!.x, x);
  engine.setViewMode('MODE_DETAIL'); assert.equal(engine.sim.alpha(), 0.35);
  engine.dispose();
}
// Compare the same bridge topology with only the per-graph ring option changed.
for (const mode of VIEW_MODES) {
  const spans: number[] = [];
  for (const bridgesOnly of [false, true]) {
    const graph = buildGraph(PRESET_ANIME, PRESET_ANIME[0]!.id, null, { ...DEFAULT_GRAPH_OPTIONS, bridgesOnly: true });
    const engine = createForceEngine(mode, undefined, bridgesOnly);
    engine.setNodes(graph.nodes, graph.edges); engine.sim.tick(400);
    assert(graph.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)));
    assert(minimumCollisionRatio(graph.nodes, mode) >= 0.85, `${mode}: bridgesOnly collision ratio`);
    const hubs = graph.nodes.filter(n => n.kind === 'ANIME');
    let total = 0, pairs = 0;
    for (let i = 0; i < hubs.length; i++) for (let j = i + 1; j < hubs.length; j++) { total += distance(hubs[i]!, hubs[j]!); pairs++; }
    spans.push(total / pairs);
    engine.dispose();
  }
  assert(spans[1]! < spans[0]!, `${mode}: bridgesOnly must bring hubs closer`);
}
console.log('PASS: bridgesOnly brings hubs closer in all three view modes with finite positions and collision clearance.');

// Exercise the actual incremental injector, speed remapping, replay and instant prewarm.
{
  // Deck keep-out: with the busiest multi-role VA selected, no node box (satellites included) overlaps its deck.
  const graph = buildGraph(PRESET_ANIME, PRESET_ANIME[0]!.id);
  const anchor = graph.nodes.filter((n): n is VoiceActorNode => n.kind === 'VOICE_ACTOR').sort((a, b) => b.roles.length - a.roles.length)[0]!;
  assert(anchor.roles.length >= 2);
  let box: KeepOut | null = null;
  const engine = createForceEngine('MODE_CHARACTER', () => box);
  engine.setNodes(graph.nodes, graph.edges); engine.sim.tick(300);
  const rec: RecommendationSet = { viaNodeId: anchor.id, voiceActorId: anchor.voiceActor.id, status: 'ready', retracting: false,
    nodes: Array.from({ length: 5 }, (_, i) => ({ id: `rec:deck:${i}`, kind: 'RECOMMENDATION', anime: { ...PRESET_ANIME[0]!, id: -100 - i },
      character: PRESET_ANIME[0]!.cast[0]!.character, role: 'MAIN', viaNodeId: anchor.id, roles: [], degree: 1, waveIndex: 0, isAnchor: false })), edges: [] };
  rec.edges = rec.nodes.map(node => ({ id: `${anchor.id}->${node.id}`, source: anchor.id, target: node.id, animeId: node.anime.id,
    color: node.anime.color, sharedAnimeIds: [], isActiveBridge: false, isRecommendation: true }));
  createRecommendationOverlay(engine, () => graph).sync(rec);
  for (const k of [1, 0.5]) {
    box = deckKeepOut(anchor, k); engine.sim.alpha(0.25); engine.sim.tick(300);
    // Overlap depth of each node box with a rect (≤0 = clear).
    const depth = (n: StageNode, r: { left: number; right: number; top: number; bottom: number }) => {
      const { width, height } = getNodeFootprint(n, 'MODE_CHARACTER'), dx = n.x! - anchor.x!, dy = n.y! - anchor.y!;
      return Math.min(dx + width / 2 - r.left, r.right - dx + width / 2, dy + height / 2 - r.top, r.bottom - dy + height / 2);
    };
    // The deck itself (margins stripped): 28px sides, 40px above, bottom edge = node top − gap.
    const deck = { left: box.left + 28, right: box.right - 28, top: box.top + 40, bottom: -46 };
    const others = engine.sim.nodes().filter(n => n !== anchor);
    const behind = others.filter(n => depth(n, deck) > 0), margin = Math.max(...others.map(n => depth(n, box!)));
    assert.equal(behind.length, 0, `deck keep-out @k=${k}: ${behind.map(n => n.id).join(', ')} behind the deck`);
    assert(margin <= 2, `deck keep-out @k=${k}: ${margin.toFixed(1)}px into the margin`);
  }
  console.log(`PASS: deck keep-out — ${anchor.roles.length}-role deck box clear of ${engine.sim.nodes().length - 1} nodes (5 satellites) at zoom 1 and 0.5.`);
  engine.dispose();
}
const graph = buildGraph(PRESET_ANIME, PRESET_ANIME[0]!.id), engine = createForceEngine('MODE_CHARACTER');
let reports = 0, finished = 0, instant = false;
const seq = createGenesis(graph, engine, 1, {
  reset() { reports = 0; }, step() { reports++; }, effects() {}, finish(value) { finished++; instant = value; },
});
seq.restart(); seq.update(0); assert.equal(reports, 1); assert.equal(engine.sim.nodes()[0]!.fx, 0);
seq.update(200); seq.setSpeed(2); seq.update(300); assert.equal(reports, 2);
seq.stopTracking(); assert.equal(seq.tracking, false);
seq.update(10000); assert.equal(seq.playing, false); assert.equal(finished, 1);
assert.equal(seq.nodes.length, graph.nodes.length); assert.equal(seq.edges.length, graph.edges.length);
assert.equal(graph.nodes.find(n => n.isAnchor)!.fx, null);
seq.setSpeed('INSTANT'); seq.restart(); assert.equal(seq.tracking, true); seq.update(20000);
assert.equal(instant, true); assert.equal(seq.playing, false); assert.equal(seq.nodes.length, graph.nodes.length);
assert(seq.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)));
engine.dispose();
console.log('PASS: Genesis timing, speed change, replay, instant prewarm, anchor release, pause and mode reheating.');

// Carry is copied before any simulation mutation, revealed synchronously, and never camera-tracked.
const watched = PRESET_ANIME.slice(0, -1), added = PRESET_ANIME.at(-1)!;
const previous = buildGraph(watched, watched[0]!.id), carryEngine = createForceEngine('MODE_CHARACTER');
carryEngine.setNodes(previous.nodes, previous.edges); carryEngine.sim.tick(400);
const extended = buildGraph([...watched, added], previous.anchorAnimeId, previous);
assert.deepEqual(extended.carry!.addedAnimeIds, [added.id]);
const extendedIds = new Set(extended.nodes.map(n => n.id));
const surviving = previous.nodes.filter(n => extendedIds.has(n.id));
assert.deepEqual([...extended.carry!.nodeIds].sort(), surviving.map(n => n.id).sort());
for (const old of surviving) {
  const next = extended.nodes.find(n => n.id === old.id)!;
  for (const key of ['x', 'y', 'vx', 'vy'] as const) assert.equal(next[key], old[key]);
  assert.equal(next.fx, null); assert.equal(next.fy, null);
}
const priorEdgeIds = carriedEdgeIds(extended);
const affectedAnime = extended.nodes.filter(n => n.kind === 'ANIME' && (!extended.carry!.nodeIds.has(n.id) ||
  extended.edges.some(e => e.animeId === n.anime.id && !priorEdgeIds.has(e.id)))).map(n => n.kind === 'ANIME' ? n.anime.id : 0);
const ripple = planGenesis(extended, 1);
assert.deepEqual(ripple.map(step => step.animeId).sort((a, b) => a - b), affectedAnime.sort((a, b) => a - b));
assert(ripple.every(step => step.nodeIds.every(id => !extended.carry!.nodeIds.has(id))));
let carried: string[] = [], carriedBridges: string[] = [], rippleEffects: string[] = [];
const rippleSeq = createGenesis(extended, carryEngine, 1, {
  reset() {}, carry(ids, bridges) { carried = ids; carriedBridges = bridges; }, step() {},
  effects(step) { rippleEffects.push(...step.edgeIds); }, finish() {},
});
rippleSeq.restart(); assert.equal(carryEngine.sim.alpha(), 0.3); assert.equal(rippleSeq.tracking, false);
assert.equal(carried.length, surviving.length); assert.equal(carryEngine.sim.nodes().length, surviving.length);
const carriedEdgeCounts = new Map<string, number>();
for (const edge of extended.edges) {
  const target = typeof edge.target === 'string' ? edge.target : edge.target.id;
  if (priorEdgeIds.has(edge.id)) carriedEdgeCounts.set(target, (carriedEdgeCounts.get(target) ?? 0) + 1);
}
const priorBridges = [...carriedEdgeCounts].filter(([, count]) => count >= 2).map(([id]) => id).sort();
assert.deepEqual(carriedBridges.sort(), priorBridges);
rippleSeq.update(0); rippleSeq.update(10000); assert.equal(rippleSeq.playing, false);
assert.equal(carryEngine.sim.nodes().length, extended.nodes.length);
assert.deepEqual(rippleEffects.sort(), extended.edges.filter(e => !priorEdgeIds.has(e.id)).map(e => e.id).sort());
assert.equal(carryEngine.links.links().length, extended.edges.length);
assert.equal(new Set(carryEngine.sim.nodes().map(n => n.id)).size, extended.nodes.length);
carryEngine.dispose();
console.log('PASS: Surviving carry coordinates/velocity, synchronous reveal and active bridges, reduced genesis, all newly selected edges, unchanged tracking.');

// Known detail bbox: [-10, 45]..[610, 355], centered at (300, 200).
const { createCamera, bindCamera } = await import('../src/engine/camera');
const camera = createCamera(); camera.resize(1440, 900);
const bounds = [{ ...graph.nodes[0]!, x: 100, y: 100 }, { ...graph.nodes[1]!, x: 500, y: 300 }];
const distantRec: StageNode = { id: 'rec:camera', kind: 'RECOMMENDATION', anime: PRESET_ANIME[0]!,
  character: PRESET_ANIME[0]!.cast[0]!.character, role: 'MAIN', viaNodeId: graph.nodes[0]!.id,
  roles: [], degree: 1, waveIndex: 0, isAnchor: false, x: 100000, y: -100000 };
assert.deepEqual(camera.frame([...bounds, distantRec], 'MODE_DETAIL'), camera.frame(bounds, 'MODE_DETAIL'));
assert.equal(camera.frame([distantRec], 'MODE_DETAIL'), null);
assert(camera.frame([distantRec], 'MODE_DETAIL', undefined, true));
for (const left of [0, 384]) for (const right of [0, 404]) {
  const insets = { left, right, top: 72, bottom: 96 };
  const framed = camera.frame(bounds, 'MODE_DETAIL', insets)!;
  assert(Math.abs(300 * framed.k + framed.x - (left + (1440 - left - right) / 2)) < 1);
  assert(Math.abs(200 * framed.k + framed.y - (72 + (900 - 72 - 96) / 2)) < 1);
  assert(-10 * framed.k + framed.x >= left + 48 - 1);
  assert(610 * framed.k + framed.x <= 1440 - right - 48 + 1);
}
// Event harness: a node target must zoom, and input must never read layout.
const listeners = new Map<string, EventListener>();
const captured = new Set<number>();
const stage = {
  setPointerCapture(id: number) { captured.add(id); }, hasPointerCapture(id: number) { return captured.has(id); },
  releasePointerCapture(id: number) { captured.delete(id); },
  addEventListener(name: string, fn: EventListener) { listeners.set(name, fn); },
  removeEventListener(name: string) { listeners.delete(name); },
  getBoundingClientRect() { throw new Error('Input handler read layout'); },
} as unknown as HTMLElement;
let tapTarget: EventTarget | null = null, taps = 0;
const unbind = bindCamera(stage, camera, () => {}, event => { tapTarget = event.target; taps++; }, { left: 80, top: 40, width: 1440, height: 900 });
let prevented = false;
const before = camera.world(120, 160);
listeners.get('wheel')!({ clientX: 200, clientY: 200, deltaY: -100, deltaMode: 0, target: { closest: () => ({}) }, preventDefault() { prevented = true; } } as unknown as Event);
assert(prevented); assert(camera.value.k > 1);
assert(Math.abs(camera.world(120, 160).x - before.x) < 1e-9);
assert(Math.abs(camera.world(120, 160).y - before.y) < 1e-9);
const nodeTarget = { closest: () => ({}) };
const pointer = (pointerId: number, x: number, y: number, type: string, pointerType = 'touch') => ({
  pointerId, clientX: x, clientY: y, button: 0, pointerType, type, target: nodeTarget,
}) as unknown as Event;
listeners.get('pointerdown')!(pointer(1, 200, 200, 'pointerdown', 'mouse'));
assert.equal(unbind.isGesturing(), false); // Mouse node drags belong to NodeLayer.
listeners.get('pointerdown')!(pointer(1, 200, 200, 'pointerdown'));
assert.equal(unbind.isGesturing(), true);
listeners.get('pointerup')!({ ...pointer(1, 200, 200, 'pointerup'), target: stage } as unknown as Event);
assert.equal(taps, 1); assert.equal(tapTarget, nodeTarget); assert.equal(unbind.isGesturing(), false);
listeners.get('pointerdown')!(pointer(1, 200, 200, 'pointerdown'));
listeners.get('pointerdown')!(pointer(2, 300, 200, 'pointerdown'));
const pinchZoom = camera.value.k;
listeners.get('pointermove')!(pointer(2, 350, 200, 'pointermove'));
assert(camera.value.k > pinchZoom);
listeners.get('pointerup')!(pointer(1, 200, 200, 'pointerup'));
listeners.get('pointerup')!(pointer(2, 350, 200, 'pointerup'));
assert.equal(taps, 1); assert.equal(captured.size, 0);
unbind(); assert.equal(listeners.size, 0);

// Measure the settled headless idle gate (no DOM/canvas/browser scheduling cost).
engine.setPhysicsPaused(false); engine.sim.alpha(0).alphaTarget(0); camera.cancel();
let workFrames = 0;
const idleFrame = (now: number) => {
  const ticked = engine.tick();
  const { x, y, k } = camera.value;
  camera.update(now);
  if (ticked || camera.active || x !== camera.value.x || y !== camera.value.y || k !== camera.value.k) workFrames++;
};
for (let i = 0; i < 10000; i++) idleFrame(i);
const idleStart = performance.now(), idleSamples = 1000000;
for (let i = 0; i < idleSamples; i++) idleFrame(i);
const idleMs = (performance.now() - idleStart) / idleSamples;
assert.equal(workFrames, 0);
console.log(`PASS: Inset framing (all drawer combinations), node-target wheel zoom, cached input coordinates. Headless idle gate: ${idleMs.toFixed(6)} ms/frame (${idleSamples} samples; zero work frames; excludes browser scheduling/DOM).`);
