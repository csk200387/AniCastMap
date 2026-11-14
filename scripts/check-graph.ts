import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { PRESET_ANIME } from '../src/data/presetAnime';
import { buildGraph } from '../src/engine/graphBuilder';
import { carriedEdgeIds } from '../src/engine/graphCarry';
import { createGenesis } from '../src/engine/genesisSequencer';
import { createForceEngine } from '../src/engine/forceSimulation';
import { planGenesis } from '../src/engine/bfsChoreographer';
import { hexToHsl } from '../src/services/accent';
import { anilistDataSource, readableAccent } from '../src/services/anilistClient';
import { animeNodeId, DEFAULT_GRAPH_OPTIONS, DISPLAY_CAST, MAX_SOLO_NODES, MIN_SOLO_NODES, vaNodeId } from '../src/types/contract';
import type { AnimeRecord, BuildGraph, CastEntry, GraphData, SimulationEdge, VoiceActorNode, VoiceActorRecord } from '../src/types/contract';

const endpointId = (value: SimulationEdge['source']) => typeof value === 'string' ? value : value.id;
function verify(graph: GraphData) {
  const ids = new Set(graph.nodes.map(n => n.id));
  assert.equal(ids.size, graph.nodes.length);
  const anchor = graph.nodes.find(n => n.isAnchor)!;
  assert.equal(anchor.waveIndex, 0);
  assert.equal(graph.nodes.filter(n => n.isAnchor).length, 1);
  for (const id of graph.neighbors.get(anchor.id)!) assert.equal(graph.nodes.find(n => n.id === id)!.waveIndex, 1);
  for (const node of graph.nodes) {
    assert.equal(node.degree, graph.neighbors.get(node.id)!.size);
    for (const key of ['x', 'y', 'vx', 'vy', 'fx', 'fy']) assert.equal(key in node, false);
  }
  for (const edge of graph.edges) {
    const source = endpointId(edge.source), target = endpointId(edge.target);
    assert(ids.has(source) && ids.has(target));
    assert(graph.neighbors.get(source)!.has(target));
    assert(graph.neighbors.get(target)!.has(source));
    assert(!edge.sharedAnimeIds.includes(edge.animeId));
    assert.equal(edge.isActiveBridge, edge.sharedAnimeIds.length > 0);
  }
  const normal = planGenesis(graph, 1);
  for (const speed of [1, 2, 'INSTANT'] as const) {
    const steps = planGenesis(graph, speed);
    const nodes = new Set<string>(), edges = new Set<string>();
    const appearances = new Map<string, number>();
    let atMs = -1;
    for (const step of steps) {
      assert(step.atMs >= atMs); atMs = step.atMs;
      assert.equal(step.atMs, speed === 'INSTANT' ? 0 : normal[step.index]!.atMs / speed);
      for (const id of step.nodeIds) { assert(ids.has(id)); assert(!nodes.has(id)); nodes.add(id); }
      const expectedBridges: string[] = [];
      for (const id of step.edgeIds) {
        assert(!edges.has(id)); edges.add(id);
        const edge = graph.edges.find(e => e.id === id)!;
        assert(edge);
        assert(nodes.has(endpointId(edge.source)) && nodes.has(endpointId(edge.target)));
        const target = endpointId(edge.target), count = (appearances.get(target) ?? 0) + 1;
        appearances.set(target, count);
        if (count >= 2) expectedBridges.push(target);
      }
      assert.deepEqual(step.bridgeNodeIds, expectedBridges);
      for (const id of step.focusNodeIds) assert(nodes.has(id));
    }
    assert.equal(nodes.size, graph.nodes.length);
    assert.equal(edges.size, graph.edges.length);
  }
  assert.equal(normal[0]!.kind, 'ANCHOR'); assert.equal(normal[1]!.atMs, 400);
  normal.slice(2).forEach((step, i) => assert.equal(step.atMs, 900 + 450 * i));
}
assert(PRESET_ANIME.length > 0);
for (const anime of PRESET_ANIME) {
  assert(anime.title.ko); assert(anime.cast.length <= DISPLAY_CAST); assert.match(anime.color, /^#[a-f0-9]{6}$/i);
  verify(buildGraph(PRESET_ANIME, anime.id));
}
const graph = buildGraph(PRESET_ANIME, PRESET_ANIME[0]!.id);
const bridges = graph.nodes.filter(n => n.kind === 'VOICE_ACTOR' && n.degree >= 2);
assert.equal(new Set(PRESET_ANIME.map(a => a.franchise?.rootId ?? a.id)).size, PRESET_ANIME.length);
for (const node of bridges) if (node.kind === 'VOICE_ACTOR') {
  assert(new Set(node.roles.map(r => r.animeId)).size >= 2);
}
for (const [i, a] of PRESET_ANIME.entries()) {
  const [h, s, l] = hexToHsl(a.color);
  assert(l >= 0.58 && l <= 0.76, `${a.title.romaji}: lightness ${l}`);
  assert(s >= 0.45);
  for (const b of PRESET_ANIME.slice(i + 1)) {
    const d = Math.abs(h - hexToHsl(b.color)[0]);
    assert(Math.min(d, 360 - d) >= 28, `${a.title.romaji} / ${b.title.romaji}: hue collision`);
  }
  for (const c of a.cast) {
    if (c.role === 'MAIN') { assert(c.character.name.ko); if(c.voiceActor) assert(c.voiceActor.name.ko); }
    if(c.voiceActor && bridges.some(n => n.kind === 'VOICE_ACTOR' && n.voiceActor.id === c.voiceActor!.id)) assert(c.voiceActor.name.ko);
  }
}
for (const input of ['#000000', '#ffffff', '#6b1a1a', '#0d43f1', '#808080', '#ff0000', 'invalid']) {
  const color = readableAccent(input), [, s, l] = hexToHsl(color);
  assert.match(color, /^#[a-f0-9]{6}$/);
  assert(l >= 0.58 && l <= 0.76 && s >= 0.45, `${input} => ${color}`);
  assert.equal(readableAccent(color), color);
}
assert.throws(() => buildGraph([], 123), /Anchor anime 123.*watched/);
assert.deepEqual(graph, buildGraph(PRESET_ANIME, PRESET_ANIME[0]!.id));
// Adversarial fixtures: multiple characters per VA, role priority, null VA,
// non-first anchor, shared cycles, disconnected components, and isolated anime.
const cast = (id: number, role: CastEntry['role'], actor: number | null): CastEntry => ({
  character: { id, name: { full: `Character ${id}`, native: null }, image: '' }, role,
  voiceActor: actor === null ? null : { id: actor, name: { full: `Actor ${actor}`, native: null }, image: '' },
});
const anime = (id: number, entries: CastEntry[]): AnimeRecord => ({ id, title: { romaji: String(id), english: null, native: null },
  coverImage: '', color: '#112233', seasonYear: null, cast: entries });
const pooledAnime = (id: number, entries: CastEntry[]): AnimeRecord => ({ ...anime(id, entries.slice(0, DISPLAY_CAST)), fullCastPool: entries });
const actorNodes = (graph: GraphData): VoiceActorNode[] => graph.nodes.filter((n): n is VoiceActorNode => n.kind === 'VOICE_ACTOR');
const withActor = (entry: CastEntry, actor: VoiceActorRecord): CastEntry => ({ ...entry, voiceActor: actor });

const expandedOptions = { ...DEFAULT_GRAPH_OPTIONS, showSupportingRoles: true };
const buildExpanded: BuildGraph = (watched, anchor, previous) => buildGraph(watched, anchor, previous, expandedOptions);

// Deep supporting roles must survive in both anchors, even outside the display slice.
const matsuoka: VoiceActorRecord = { id: 106817, name: { full: 'Yoshitsugu Matsuoka', native: '松岡禎丞' }, image: '' };
const deepA = Array.from({ length: 60 }, (_, i) => cast(1000 + i, i < 6 ? 'MAIN' : 'SUPPORTING', 1000 + i));
const deepB = Array.from({ length: 15 }, (_, i) => cast(2000 + i, i < 6 ? 'MAIN' : 'SUPPORTING', 2000 + i));
deepA[37] = withActor(deepA[37]!, matsuoka);
deepB[8] = withActor(deepB[8]!, matsuoka);
const deepWatched = [pooledAnime(100, deepA), pooledAnime(200, deepB)];
const assertDeepBridge = (watched: AnimeRecord[], anchor: number, canonicalId = matsuoka.id) => {
  const graph = buildExpanded(watched, anchor);
  verify(graph);
  assert.deepEqual(graph, buildExpanded(watched, anchor));
  const shared = actorNodes(graph).filter(n => n.voiceActor.name.full.includes('Matsuoka'));
  assert.equal(shared.length, 1);
  const node = shared[0]!;
  assert.equal(node.id, vaNodeId(canonicalId)); assert.equal(node.degree, 2);
  assert.deepEqual(node.roles.map(r => r.character.id), anchor === 100 ? [1037, 2008] : [2008, 1037]);
  const links = graph.edges.filter(e => endpointId(e.target) === node.id);
  assert.equal(links.length, 2);
  for (const edge of links) {
    assert(edge.isActiveBridge);
    assert.deepEqual(edge.sharedAnimeIds, [edge.animeId === 100 ? 200 : 100]);
  }
};
for (const anchor of [100, 200]) {
  assertDeepBridge(deepWatched, anchor);
  assertDeepBridge([anime(100, deepA), anime(200, deepB)], anchor); // legacy cast-only input
}
const alias: VoiceActorRecord = { id: 906817, name: { full: 'Matsuoka Yoshitsugu', native: '松岡 禎丞' }, image: 'portrait.jpg' };
const aliasB = deepB.map(entry => entry.voiceActor === matsuoka ? withActor(entry, alias) : entry);
for (const anchor of [100, 200]) assertDeepBridge([deepWatched[0]!, pooledAnime(200, aliasB)], anchor, alias.id);
// Identity is transitive; a later record can connect independent id/native/name groups.
const identityFixtures = [
  { id: 301, name: { full: 'First Person', native: '松岡禎丞' }, image: 'first.jpg' },
  { id: 302, name: { full: 'Yoshitsugu Matsuoka', native: null }, image: 'second.jpg' },
  { id: 303, name: { full: 'Matsuoka Yoshitsugu', native: '松岡 禎丞' }, image: 'third.jpg' },
] satisfies VoiceActorRecord[];
const unified = buildExpanded(identityFixtures.map((va, i) => anime(300 + i, [withActor(cast(300 + i, 'MAIN', null), va)])), 301);
assert.equal(actorNodes(unified).length, 1);
assert.equal(actorNodes(unified)[0]!.voiceActor, identityFixtures[1]); // anchor's first image wins
assert.equal(actorNodes(unified)[0]!.degree, 3);
assert.equal(actorNodes(unified)[0]!.roles.length, 3);
for (const pair of [
  [{ id: 401, name: { full: 'Akira', native: null }, image: '' }, { id: 402, name: { full: 'Akira', native: null }, image: '' }],
  [{ id: 403, name: { full: 'Yoshitsugu Matsuoka', native: null }, image: '' }, { id: 404, name: { full: 'Matsuoka Yoshitsugu', native: null }, image: '' }],
  [{ id: 405, name: { full: 'First Person', native: '松岡禎丞' }, image: '' }, { id: 406, name: { full: 'Second Person', native: '松岡 禎丞' }, image: '' }],
] satisfies VoiceActorRecord[][]) {
  const graph = buildExpanded(pair.map((va, i) => anime(400 + i, [withActor(cast(400 + i, 'MAIN', null), va)])), 400);
  assert.equal(actorNodes(graph).length, pair[0]!.name.full === 'Akira' ? 2 : 1);
}
// Empty full pools take precedence over display cast; null voice actors never consume quota.
assert.equal(actorNodes(buildExpanded([{ ...deepWatched[0]!, fullCastPool: [] }], 100)).length, 0);
const quotaPool = [cast(500, 'BACKGROUND', 500), cast(501, 'SUPPORTING', 501), cast(502, 'MAIN', null),
  ...Array.from({ length: 16 }, (_, i) => cast(510 + i, 'MAIN', 510 + i)), cast(599, 'BACKGROUND', 510)];
const quotaGraph = buildExpanded([pooledAnime(500, quotaPool)], 500);
assert.equal(actorNodes(quotaGraph).length, MAX_SOLO_NODES);
assert.deepEqual(actorNodes(quotaGraph).map(n => n.voiceActor.id), Array.from({ length: MAX_SOLO_NODES }, (_, i) => 510 + i));
assert.deepEqual(quotaGraph.nodes.find(n => n.id === vaNodeId(510))!.roles.map(r => r.character.id), [510, 599]);
for (const bridgeCount of [1, 8, 9, 12, 20]) {
  const shared = Array.from({ length: bridgeCount }, (_, i) => cast(600 + i, 'BACKGROUND', 600 + i));
  const solo = Array.from({ length: 20 }, (_, i) => cast(700 + i, 'MAIN', 700 + i));
  const watched = [pooledAnime(600, [...shared, ...solo]), pooledAnime(601, shared.map(e => ({ ...e, character: { ...e.character, id: e.character.id + 1000 } })))];
  const graph = buildExpanded(watched, 600);
  verify(graph);
  const actors = actorNodes(graph);
  assert.equal(actors.filter(n => n.degree === 2).length, bridgeCount);
  const quota = Math.max(MIN_SOLO_NODES, Math.min(MAX_SOLO_NODES, MAX_SOLO_NODES - bridgeCount));
  assert.equal(actors.filter(n => n.degree === 1).length, quota);
  assert.equal(graph.neighbors.get(animeNodeId(600))!.size, bridgeCount + quota);
  assert(actors.filter(n => n.degree === 2).every(n => n.roles.length === 2));
}
// Quota fill retains every character of a selected bridge, including alias records deep in a pool.
const multiBridge = buildExpanded([
  pooledAnime(100, [...deepA, withActor(cast(1099, 'BACKGROUND', null), alias)]),
  pooledAnime(200, aliasB),
], 100);
assert.deepEqual(multiBridge.nodes.find(n => n.id === vaNodeId(alias.id))!.roles.map(r => r.character.id), [1037, 2008, 1099]);
assert.equal(multiBridge.edges.filter(e => endpointId(e.target) === vaNodeId(alias.id)).length, 2);
const timingWatched = Array.from({ length: 12 }, (_, a) => pooledAnime(800 + a,
  Array.from({ length: 75 }, (_, i) => cast(10000 + a * 100 + i, i < 12 ? 'MAIN' : 'SUPPORTING', i < 30 ? 20000 + i : 30000 + a * 100 + i))));
buildExpanded(timingWatched, 800); // warm module/JIT setup before the bounded sample
const buildStart = performance.now();
const timedGraph = buildExpanded(timingWatched, 800);
const buildMs = performance.now() - buildStart;
assert(buildMs < 20, `12 × 75 bridge-first graph took ${buildMs.toFixed(3)} ms`);
verify(timedGraph);
assert.equal(actorNodes(timedGraph).filter(n => n.degree === 12).length, 30);
console.log(`PASS: Deep bridges, legacy casts, transitive identities/canonical portraits, single-token isolation, solo quotas and all bridge roles; 12 × 75 pools: ${timedGraph.nodes.length} nodes, ${timedGraph.edges.length} edges in ${buildMs.toFixed(3)} ms.`);
const fixture = [anime(1, [cast(1, 'MAIN', 1), cast(2, 'SUPPORTING', 1), cast(3, 'BACKGROUND', null)]),
  anime(2, [cast(4, 'SUPPORTING', 1), cast(5, 'MAIN', 2)]),
  anime(3, [cast(6, 'MAIN', 3)]), anime(4, []), anime(5, [cast(7, 'MAIN', 3)])];
const special = buildExpanded(fixture, 2);
verify(special);
assert.equal(special.edges.length, 5);
assert.deepEqual(special.nodes.find(n => n.id === vaNodeId(1))!.roles.map(r => r.character.id), [1, 4, 2]);
assert.deepEqual([1, 2, 3, 4, 5].map(id => special.nodes.find(n => n.id === animeNodeId(id))!.waveIndex), [2, 0, 3, 6, 5]);
assert.equal(buildExpanded([...fixture, fixture[0]!], 2).nodes.length, special.nodes.length);
// Choreography also accepts endpoints already mutated by d3-force.
const linked = { ...special, edges: special.edges.map(e => ({ ...e,
  source: special.nodes.find(n => n.id === e.source)!, target: special.nodes.find(n => n.id === e.target)! })) };
assert.deepEqual(planGenesis(linked, 1), planGenesis(special, 1));

// Incremental choreography must use current topology without changing the cold-build contract.
const before = buildExpanded(fixture.slice(0, 1), 1);
before.nodes.forEach((node, i) => { node.x = i * 123.5; node.y = i * -42.25; node.vx = i + 0.1; node.vy = i - 0.2; node.fx = 99; node.fy = 99; });
const carry = buildExpanded(fixture.slice(0, 2), 1, before);
assert.deepEqual([...carry.carry!.nodeIds], before.nodes.map(n => n.id));
assert.deepEqual(carry.carry!.addedAnimeIds, [fixture[1]!.id]);
for (const node of before.nodes) {
  const next = carry.nodes.find(n => n.id === node.id)!;
  assert.notEqual(next, node);
  for (const key of ['x', 'y', 'vx', 'vy'] as const) assert.equal(next[key], node[key]);
  assert.equal(next.fx, null); assert.equal(next.fy, null);
}
const newHubId = animeNodeId(fixture[1]!.id);
for (const speed of [1, 2, 'INSTANT'] as const) {
  const steps = planGenesis(carry, speed);
  assert.equal(steps.length, 1);
  assert.equal(steps[0]!.kind, 'ANIME_CLUSTER'); assert.equal(steps[0]!.atMs, 0);
  assert.deepEqual(steps[0]!.nodeIds, [newHubId, vaNodeId(2)]);
  assert.deepEqual(steps[0]!.bridgeNodeIds, [vaNodeId(1)]);
  assert.deepEqual(steps[0]!.edgeIds, carry.edges.filter(e => e.animeId === fixture[1]!.id).map(e => e.id));
}
const multiple = buildExpanded(fixture.slice(0, 3), 1, before);
for (const speed of [1, 2, 'INSTANT'] as const) {
  assert.deepEqual(planGenesis(multiple, speed).map(step => step.atMs), [0, speed === 'INSTANT' ? 0 : 450 / speed]);
}
const changedAnchor = buildExpanded(fixture.slice(0, 2), fixture[1]!.id, before);
assert.equal(planGenesis(changedAnchor, 1)[0]!.kind, 'ANCHOR');
assert.equal(planGenesis(changedAnchor, 1)[0]!.animeId, fixture[1]!.id);
assert.equal(planGenesis(buildExpanded(fixture.slice(0, 1), 1, before), 1).length, 0);
assert.equal(buildExpanded(fixture, 2, null).carry, undefined);
verify(buildExpanded(fixture, 2));
// A newly discovered bridge shrinks the solo quota; only surviving ids are carried.
const shrinkBefore = buildExpanded([pooledAnime(500, quotaPool)], 500);
shrinkBefore.nodes.forEach((n, i) => { n.x = i * 10; n.y = -i * 20; n.vx = i; n.vy = -i; });
const shrinkAfter = buildExpanded([pooledAnime(500, quotaPool), anime(501, [cast(800, 'SUPPORTING', 500)])], 500, shrinkBefore);
assert.equal(actorNodes(shrinkAfter).filter(n => n.degree === 1).length, MAX_SOLO_NODES - 1);
assert(!shrinkAfter.nodes.some(n => n.id === vaNodeId(521)));
assert(!shrinkAfter.carry!.nodeIds.has(vaNodeId(521)));
const shrinkSurvivors = shrinkBefore.nodes.filter(n => shrinkAfter.nodes.some(next => next.id === n.id));
assert.deepEqual([...shrinkAfter.carry!.nodeIds], shrinkSurvivors.map(n => n.id));
for (const old of shrinkSurvivors) {
  const next = shrinkAfter.nodes.find(n => n.id === old.id)!;
  for (const key of ['x', 'y', 'vx', 'vy'] as const) assert.equal(next[key], old[key]);
}
assert.deepEqual(shrinkAfter.carry!.addedAnimeIds, [501]);
const shrinkSteps = planGenesis(shrinkAfter, 1);
assert.deepEqual(shrinkSteps.map(step => step.animeId), [500, 501]);
assert.deepEqual(shrinkSteps[0]!.nodeIds, [vaNodeId(500)]);
assert.deepEqual(shrinkSteps[1]!.nodeIds, [animeNodeId(501)]);
assert.equal(shrinkSteps.flatMap(step => step.edgeIds).length, 2);
assert.deepEqual(shrinkSteps[1]!.bridgeNodeIds, [vaNodeId(500)]);
// Once the minimum quota is reached, a solo becoming a bridge also replenishes an old hub's cast.
const stableBridges = Array.from({ length: 9 }, (_, i) => cast(900 + i, 'SUPPORTING', 900 + i));
const replenishing = [pooledAnime(900, [...stableBridges, ...Array.from({ length: 8 }, (_, i) => cast(920 + i, 'MAIN', 920 + i))]),
  anime(901, stableBridges)];
const replenishBefore = buildExpanded(replenishing, 900);
const replenishAfter = buildExpanded([...replenishing, anime(902, [cast(999, 'SUPPORTING', 920)])], 900, replenishBefore);
assert(replenishAfter.nodes.some(n => n.id === vaNodeId(924)));
const assertRippleCoverage = (graph: GraphData) => {
  const visible = new Set(graph.carry!.nodeIds);
  const edgeIds = new Set(carriedEdgeIds(graph));
  for (const step of planGenesis(graph, 1)) {
    for (const id of step.nodeIds) { assert(!visible.has(id)); visible.add(id); }
    for (const id of step.edgeIds) {
      assert(!edgeIds.has(id)); edgeIds.add(id);
      const edge = graph.edges.find(e => e.id === id)!;
      assert(visible.has(endpointId(edge.source)) && visible.has(endpointId(edge.target)));
    }
  }
  assert.equal(visible.size, graph.nodes.length); assert.equal(edgeIds.size, graph.edges.length);
};
assertRippleCoverage(replenishAfter);
assertRippleCoverage(shrinkAfter);
assertRippleCoverage(buildExpanded([...replenishing, anime(902, [cast(999, 'SUPPORTING', 920)]), anime(903, [cast(998, 'SUPPORTING', 925)])], 900, replenishBefore));
console.log('PASS: Cold graph shape/determinism, carried coordinates/velocities/unpinning, ripple bridge edges, multi-add timing, new-anchor fallback.');

// P5 fixtures are independent of the concurrently regenerated preset data.
const nakamura: VoiceActorRecord = { id: 95513, name: { full: 'Yuuichi Nakamura', native: '中村悠一' }, image: 'nakamura.jpg' };
const nakamuraAlias: VoiceActorRecord = { id: 995513, name: { full: 'Nakamura Yuuichi', native: '中村 悠一' }, image: 'alias.jpg' };
const kawaida: VoiceActorRecord = { id: 250001, name: { full: 'Natsumi Kawaida', native: '川井田夏海' }, image: 'kawaida.jpg' };
const gojo = withActor(cast(250010, 'MAIN', null), nakamura);
gojo.character.name.full = 'Gojo';
const sein = withActor(cast(250011, 'SUPPORTING', null), nakamuraAlias);
sein.character.name.full = 'Sein';
sein.subVoiceActors = [{ voiceActor: kawaida, kind: 'CHILDHOOD', roleNote: 'Childhood' }];
const frierenWatched = [anime(250100, [gojo]), anime(250200, [
  ...['Frieren', 'Fern', 'Stark'].map((name, i) => {
    const entry = cast(250020 + i, 'MAIN', 250020 + i); entry.character.name.full = name; return entry;
  }), sein,
])];
const frierenDefault = buildGraph(frierenWatched, 250100);
const frierenSub = buildGraph(frierenWatched, 250100, null, { ...DEFAULT_GRAPH_OPTIONS, includeSubVoiceActors: true });
const primaryNakamura = actorNodes(frierenDefault).find(n => n.id === vaNodeId(nakamura.id))!;
assert.equal(primaryNakamura.degree, 2);
assert.deepEqual(primaryNakamura.roles.map(r => r.character.name.full), ['Gojo', 'Sein']);
assert.equal(actorNodes(frierenDefault).filter(n => /Nakamura/.test(n.voiceActor.name.full)).length, 1);
assert(!frierenDefault.nodes.some(n => n.id === vaNodeId(kawaida.id)));
assert.deepEqual(frierenSub.nodes.find(n => n.id === primaryNakamura.id)!.roles, primaryNakamura.roles);
const childhood = actorNodes(frierenSub).find(n => n.id === vaNodeId(kawaida.id))!;
assert.equal(childhood.degree, 1);
assert.deepEqual(childhood.roles, [{ animeId: 250200, character: sein.character, role: 'SUPPORTING',
  sub: { kind: 'CHILDHOOD', roleNote: 'Childhood' } }]);
assert.deepEqual([...frierenSub.neighbors.get(childhood.id)!], [animeNodeId(250200)]);
assert.deepEqual(frierenDefault.options, DEFAULT_GRAPH_OPTIONS);
assert.notEqual(frierenDefault.options, DEFAULT_GRAPH_OPTIONS);
for (const showSupportingRoles of [false, true]) for (const includeSubVoiceActors of [false, true]) {
  const options = { showSupportingRoles, includeSubVoiceActors };
  const built = buildGraph(frierenWatched, 250100, null, options);
  verify(built); assert.deepEqual(built, buildGraph(frierenWatched, 250100, undefined, options));
  assert.deepEqual(built.options, options); assert.notEqual(built.options, options);
  assert.equal(built.edges.filter(e => endpointId(e.target) === primaryNakamura.id).length, 2);
}

// A supporting-only or background-only bridge is hidden until a primary MAIN in another anime unlocks it.
for (const role of ['SUPPORTING', 'BACKGROUND'] as const) {
  const credits = [anime(260100, [cast(260001, role, 260000)]), anime(260200, [cast(260002, role, 260000)])];
  assert.equal(actorNodes(buildGraph(credits, 260100)).length, 0);
  const expanded = buildExpanded(credits, 260100);
  assert.equal(actorNodes(expanded).length, 1); assert.equal(actorNodes(expanded)[0]!.degree, 2);
  const unlocked = buildGraph([...credits, anime(260300, [cast(260003, 'MAIN', 260000)])], 260100);
  assert.equal(actorNodes(unlocked)[0]!.degree, 3);
  assert.deepEqual(actorNodes(unlocked)[0]!.roles.map(r => r.character.id), [260003, 260001, 260002]);
  verify(unlocked);
  const sameAnime = anime(260400, [cast(260004, 'MAIN', 260000), cast(260005, role, 260000)]);
  assert.deepEqual(actorNodes(buildGraph([sameAnime], 260400))[0]!.roles.map(r => r.character.id), [260004]);
  assert.equal(actorNodes(buildExpanded([sameAnime], 260400))[0]!.roles.length, 2);
}
// A sub MAIN is never a primary MAIN and does not unlock its actor's supporting credits.
const subMain = cast(261001, 'MAIN', 261001);
subMain.subVoiceActors = [{ voiceActor: cast(0, 'MAIN', 261000).voiceActor!, kind: 'ALTERNATE', roleNote: 'Replacement' }];
const subMainWatched = [anime(261100, [subMain]), anime(261200, [cast(261002, 'SUPPORTING', 261000)])];
const subMainGraph = buildGraph(subMainWatched, 261100, null, { ...DEFAULT_GRAPH_OPTIONS, includeSubVoiceActors: true });
assert.equal(subMainGraph.nodes.find(n => n.id === vaNodeId(261000))!.degree, 1);
assert(!subMainGraph.edges.some(e => e.animeId === 261200));

// Both modes retain every visible bridge and spend the same clamped quota on distinct primary solos.
for (const showSupportingRoles of [false, true]) for (const bridgeCount of [1, 8, 9, 12, 20]) {
  const shared = Array.from({ length: bridgeCount }, (_, i) => cast(270000 + i, 'BACKGROUND', 270000 + i));
  const solo = Array.from({ length: 20 }, (_, i) => cast(271000 + i, 'MAIN', 271000 + i));
  const watched = [pooledAnime(270100, [...shared, ...solo]), pooledAnime(270200, shared.map(e => ({ ...e, role: 'MAIN' as const })))];
  const built = buildGraph(watched, 270100, null, { showSupportingRoles, includeSubVoiceActors: false });
  const quota = Math.max(MIN_SOLO_NODES, Math.min(MAX_SOLO_NODES, MAX_SOLO_NODES - bridgeCount));
  assert.equal(actorNodes(built).filter(n => n.degree === 2).length, bridgeCount);
  assert.equal(actorNodes(built).filter(n => n.degree === 1).length, quota);
  assert.equal(built.neighbors.get(animeNodeId(270100))!.size, bridgeCount + quota);
  verify(built);
}
const subQuotaPool = Array.from({ length: MAX_SOLO_NODES + 3 }, (_, i) => {
  const entry = cast(280000 + i, 'MAIN', 280000 + i);
  entry.subVoiceActors = [{ voiceActor: cast(0, 'MAIN', 281000 + i).voiceActor!, kind: 'CHILDHOOD', roleNote: null }];
  return entry;
});
for (const showSupportingRoles of [false, true]) {
  const watched = [pooledAnime(280100, subQuotaPool)];
  const noSubs = buildGraph(watched, 280100, null, { showSupportingRoles, includeSubVoiceActors: false });
  const withSubs = buildGraph(watched, 280100, null, { showSupportingRoles, includeSubVoiceActors: true });
  assert.equal(actorNodes(noSubs).length, MAX_SOLO_NODES);
  assert.equal(actorNodes(withSubs).length, 2 * MAX_SOLO_NODES);
  assert.deepEqual(actorNodes(withSubs).filter(n => !n.roles[0]!.sub).map(n => n.id), actorNodes(noSubs).map(n => n.id));
  assert(!withSubs.nodes.some(n => n.id === vaNodeId(281000 + MAX_SOLO_NODES))); // unselected character's sub stays hidden
  verify(withSubs);
}
// A sub merged into an existing primary bridges the same node. Primary credits always supply its face.
const sharedSub = cast(290001, 'MAIN', 290001), adult = cast(290002, 'SUPPORTING', 290002);
sharedSub.subVoiceActors = [
  { voiceActor: adult.voiceActor!, kind: 'ALTERNATE', roleNote: 'Alternate' },
  { voiceActor: sharedSub.voiceActor!, kind: 'CHILDHOOD', roleNote: 'Childhood' }, // same-character primary wins
  { voiceActor: adult.voiceActor!, kind: 'ALTERNATE', roleNote: 'Duplicate' },
];
const mergedSub = buildGraph([anime(290100, [sharedSub]), anime(290200, [adult])], 290100, null,
  { showSupportingRoles: true, includeSubVoiceActors: true });
const adultNode = actorNodes(mergedSub).find(n => n.id === vaNodeId(290002))!;
assert.equal(adultNode.degree, 2); assert.equal(adultNode.roles.length, 2);
assert.equal(adultNode.roles[0]!.character, adult.character); assert.equal(adultNode.roles[0]!.sub, undefined);
assert.equal(adultNode.roles[1]!.sub!.kind, 'ALTERNATE');
assert.equal(mergedSub.nodes.find(n => n.id === vaNodeId(290001))!.roles.length, 1);
assert(mergedSub.edges.filter(e => endpointId(e.target) === adultNode.id).every(e => e.isActiveBridge));
verify(mergedSub);
// A hidden sub on a null-primary entry still unifies identities and can supply the canonical portrait.
const identityOnly = cast(291003, 'BACKGROUND', null);
identityOnly.subVoiceActors = [{ voiceActor: { id: 291000, name: { full: 'Second Person', native: '中村悠一' }, image: 'sub.jpg' },
  kind: 'ALTERNATE', roleNote: null }];
const identitySubGraph = buildGraph([
  anime(291100, [withActor(cast(291001, 'MAIN', null), { ...nakamura, image: '' }), identityOnly]),
  anime(291200, [withActor(cast(291002, 'MAIN', null), { id: 291002, name: { full: 'Person Second', native: null }, image: '' })]),
], 291100);
assert.equal(actorNodes(identitySubGraph).length, 1);
assert.equal(actorNodes(identitySubGraph)[0]!.id, vaNodeId(291000));
assert.equal(actorNodes(identitySubGraph)[0]!.degree, 2);
assert.equal(actorNodes(identitySubGraph)[0]!.roles.length, 2);

// P5 carry checks include edges between two carried nodes, as well as new solos and shared VAs.
function verifyRebuild(next: GraphData, previous: GraphData) {
  assert(next.carry);
  const oldNodes = new Map(previous.nodes.map(n => [n.id, n]));
  const oldEdges = new Set(previous.edges.map(e => e.id));
  for (const node of next.nodes) {
    const old = oldNodes.get(node.id);
    assert.equal(next.carry.nodeIds.has(node.id), !!old);
    if (old) for (const key of ['x', 'y', 'vx', 'vy'] as const) assert.equal(node[key], old[key]);
  }
  const expectedEdges = next.edges.filter(e => !oldEdges.has(e.id));
  const expectedAnime = next.nodes.filter(n => n.kind === 'ANIME' &&
    (!next.carry!.nodeIds.has(n.id) || expectedEdges.some(e => e.animeId === n.anime.id)))
    .map(n => n.kind === 'ANIME' ? n.anime.id : 0).sort((a, b) => a - b);
  const carried = new Set(next.carry.nodeIds);
  for (const speed of [1, 2, 'INSTANT'] as const) {
    const steps = planGenesis(next, speed);
    assert.deepEqual(steps.map(step => step.animeId).sort((a, b) => a - b), expectedAnime);
    assert.deepEqual(steps.flatMap(step => step.edgeIds).sort(), expectedEdges.map(e => e.id).sort());
    assert.deepEqual(steps.flatMap(step => step.nodeIds).sort(), next.nodes.filter(n => !carried.has(n.id)).map(n => n.id).sort());
    steps.forEach((step, i) => assert.equal(step.atMs, speed === 'INSTANT' ? 0 : i * 450 / speed));
  }
  assertRippleCoverage(next);
  const engine = createForceEngine('MODE_CHARACTER');
  let revealed: string[] = [], finished = 0, total = -1;
  const seq = createGenesis(next, engine, 1, {
    reset(count) { total = count; }, carry(ids) { revealed = ids; }, step() {}, effects() {}, finish() { finished++; },
  });
  seq.restart();
  assert.equal(seq.tracking, false);
  assert.deepEqual(revealed.sort(), [...carried].sort());
  assert.deepEqual(engine.sim.nodes().map(n => n.id).sort(), [...carried].sort());
  assert.deepEqual(seq.edges.map(e => e.id).sort(), next.edges.filter(e => oldEdges.has(e.id)).map(e => e.id).sort());
  seq.update(0);
  // Injecting the first reduced step never moves a surviving hub or actor.
  for (const node of next.nodes) if (carried.has(node.id)) {
    const old = oldNodes.get(node.id)!;
    assert.equal(node.x, old.x); assert.equal(node.y, old.y);
  }
  if (expectedAnime.length === 0) { assert.equal(total, 0); assert.equal(seq.playing, false); assert.equal(finished, 1); }
  seq.update(10000);
  assert.equal(seq.playing, false); assert.equal(finished, 1);
  assert.equal(seq.nodes.length, next.nodes.length); assert.equal(seq.edges.length, next.edges.length);
  assert.equal(new Set(seq.nodes.map(n => n.id)).size, next.nodes.length);
  assert(seq.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)));
  engine.dispose();
}
const rebuildWatched = [
  anime(300100, [cast(300001, 'MAIN', 300001), cast(300002, 'SUPPORTING', 300001),
    cast(300003, 'SUPPORTING', 300003), cast(300004, 'SUPPORTING', 300004)]),
  anime(300200, [cast(300005, 'MAIN', 300005), cast(300006, 'SUPPORTING', 300003), cast(300007, 'SUPPORTING', 300007)]),
];
const g0 = buildGraph(rebuildWatched, 300100);
g0.nodes.forEach((node, i) => { node.x = 1000 + i * 100; node.y = -500 - i * 80; node.vx = i * 0.2; node.vy = -i * 0.3; });
const g1 = buildGraph(rebuildWatched, 300100, g0, expandedOptions);
assert.deepEqual(g1.carry!.addedAnimeIds, []);
verifyRebuild(g1, g0);
const g2 = buildGraph(rebuildWatched, 300100, g1);
assert.deepEqual(planGenesis(g2, 1), []); verifyRebuild(g2, g1);
// Same actor is already MAIN in J, but his F edge appears only when his selected character adds a sub.
const edgeOnlyWatched = [anime(301100, [cast(301001, 'MAIN', 301001)]), anime(301200, [{ ...cast(301002, 'MAIN', 301002),
  subVoiceActors: [{ voiceActor: cast(0, 'MAIN', 301001).voiceActor!, kind: 'CHILDHOOD', roleNote: null }] }])];
const edgeOnlyBefore = buildGraph(edgeOnlyWatched, 301100);
edgeOnlyBefore.nodes.forEach((n, i) => { n.x = 400 * i; n.y = 200 * i; n.vx = 0; n.vy = 0; });
const edgeOnlyAfter = buildGraph(edgeOnlyWatched, 301100, edgeOnlyBefore, { ...DEFAULT_GRAPH_OPTIONS, includeSubVoiceActors: true });
const edgeOnlySteps = planGenesis(edgeOnlyAfter, 1);
assert.equal(edgeOnlySteps.length, 1); assert.deepEqual(edgeOnlySteps[0]!.nodeIds, []);
assert.deepEqual(edgeOnlySteps[0]!.bridgeNodeIds, [vaNodeId(301001)]);
verifyRebuild(edgeOnlyAfter, edgeOnlyBefore);
const childhoodRipple = buildGraph(frierenWatched, 250100, frierenDefault, { ...DEFAULT_GRAPH_OPTIONS, includeSubVoiceActors: true });
frierenDefault.nodes.forEach((n, i) => { n.x = 800 + i * 100; n.y = 600 + i * 100; n.vx = 0; n.vy = 0; });
// Rebuild after assigning settled coordinates to the previous graph.
verifyRebuild(buildGraph(frierenWatched, 250100, frierenDefault, childhoodRipple.options), frierenDefault);
// Removing an anime also preserves survivors and requires no genesis when nothing is newly selected.
verifyRebuild(buildGraph(edgeOnlyWatched.slice(0, 1), 301100, edgeOnlyAfter), edgeOnlyAfter);
// Default-path build budget uses the same 12 × 75 hand fixture, with MAIN-anchored bridges only.
buildGraph(timingWatched, 800);
const defaultBuildStart = performance.now();
const defaultTimedGraph = buildGraph(timingWatched, 800);
const defaultBuildMs = performance.now() - defaultBuildStart;
assert(defaultBuildMs < 20, `12 × 75 default graph took ${defaultBuildMs.toFixed(3)} ms`);
assert.equal(actorNodes(defaultTimedGraph).filter(n => n.degree === 12).length, 12);
verify(defaultTimedGraph);
console.log(`PASS: MAIN-anchored/supporting/background filters; Frieren/JJK primary + childhood; sub identity/dedup/quota/order; all toggle and edge-only ripples/removal-only completion. Default 12 × 75: ${defaultTimedGraph.nodes.length} nodes, ${defaultTimedGraph.edges.length} edges in ${defaultBuildMs.toFixed(3)} ms.`);

const originalFetch = globalThis.fetch;
let calls = 0;
let batches = 0;
const response = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
const rawAnime = (id: number) => ({ id, type:'ANIME',format:'TV',status:'FINISHED',popularity:100000,duration:24,relations:{edges:[]}, title: { romaji: `Test ${id}`, english: null, native: null },
  coverImage: { large: '', color: id % 2 ? '#6b1a1a' : null }, seasonYear: null, c1: { edges: [] }, c2: { edges: [] } });
const mockMedia = (init?: RequestInit): Record<string, unknown> => {
  const body = JSON.parse(String(init?.body)) as { query: string; variables?: { id?: number } };
  const data: Record<string, unknown> = {};
  for (const match of body.query.matchAll(/(a\d+): Media\(id:(\d+)/g)) data[match[1]!] = rawAnime(Number(match[2]));
  if (body.variables?.id) data.Media = rawAnime(body.variables.id);
  return data;
};
try {
  globalThis.fetch = async (_url, init) => {
    calls++;
    if (/a\d+: Media\(id:/.test(String(init?.body))) batches++;
    return response(mockMedia(init));
  };
  assert.equal(await anilistDataSource.getAnime(PRESET_ANIME[0]!.id), PRESET_ANIME[0]);
  assert.deepEqual(await anilistDataSource.searchAnime('  '), []); assert.equal(calls, 0);
  const results = await Promise.all([anilistDataSource.getAnime(900001), anilistDataSource.getAnime(900002), anilistDataSource.getAnime(900001)]);
  assert.equal(batches, 1); assert.equal(results[0], results[2]); assert.match(results[0]!.color, /^#[a-f0-9]{6}$/i);
  for (const result of results) { const [, s, l] = hexToHsl(result.color); assert(l >= 0.58 && l <= 0.76 && s >= 0.45); }
  const cachedCalls = calls;
  await anilistDataSource.getAnime(900001); assert.equal(calls, cachedCalls);
  const cancelled = new AbortController();
  const aborted = anilistDataSource.getAnime(900003, cancelled.signal);
  const survivor = anilistDataSource.getAnime(900003);
  cancelled.abort();
  await assert.rejects(aborted, { name: 'AbortError' }); assert.equal((await survivor).id, 900003);
  await assert.rejects(anilistDataSource.getAnime(PRESET_ANIME[0]!.id, cancelled.signal), { name: 'AbortError' });
  // All subscribers cancel while transport is in flight; a new request must retry.
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  globalThis.fetch = async (_url, init) => {
    started();
    return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  };
  const controller = new AbortController();
  const abandoned = anilistDataSource.getAnime(900004, controller.signal);
  await ready; controller.abort(); await assert.rejects(abandoned, { name: 'AbortError' });
  globalThis.fetch = async (_url, init) => response(mockMedia(init));
  assert.equal((await anilistDataSource.getAnime(900004)).id, 900004);
  globalThis.fetch = async () => { throw new Error('Offline'); };
  assert((await anilistDataSource.searchAnime(PRESET_ANIME[0]!.title.ko!)).some(a => a.id === PRESET_ANIME[0]!.id));
  const actor = PRESET_ANIME[0]!.cast.find(c => c.voiceActor)!.voiceActor!;
  assert((await anilistDataSource.getVoiceActorFilmography(actor.id)).length > 0);
  await assert.rejects(anilistDataSource.getAnime(900005), /Offline/);
  // Neither failed requests nor offline fallback results enter the success cache.
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { query: string };
    if (body.query.includes('Page(perPage')) return response({ Page: { media: [rawAnime(900006)] } });
    return response(mockMedia(init));
  };
  assert.equal((await anilistDataSource.getAnime(900005)).id, 900005);
  assert.equal((await anilistDataSource.searchAnime('test recovery'))[0]!.id, 900006);
  let retries = 0;
  globalThis.fetch = async (_url, init) => /a\d+: Media\(id:/.test(String(init?.body)) && ++retries < 3
    ? new Response('', { status: 429, headers: { 'Retry-After': '0' } }) : response(mockMedia(init));
  assert.equal((await anilistDataSource.getAnime(900007)).id, 900007); assert.equal(retries, 3);
  retries = 0;
  globalThis.fetch = async () => { retries++; return new Response('', { status: 429, headers: { 'Retry-After': '0' } }); };
  await assert.rejects(anilistDataSource.getAnime(900008), /429/); assert.equal(retries, 3);
} finally { globalThis.fetch = originalFetch; }
console.log(`PASS: ${PRESET_ANIME.length} anime, ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${bridges.length} bridge VAs. All anchors/speeds, adversarial graphs, API batching/cache/abort/retry/fallback verified.`);
for (const node of bridges) if (node.kind === 'VOICE_ACTOR') console.log(`${node.voiceActor.name.full}: ${[...new Set(node.roles.map(r => graph.animeById.get(r.animeId)!.title.romaji))].join(' / ')}`);
