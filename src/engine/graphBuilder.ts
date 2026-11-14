import { animeNodeId, DEFAULT_GRAPH_OPTIONS, MAX_SOLO_NODES, MIN_SOLO_NODES, vaIdentityKeys, vaNodeId } from '../types/contract';
import type { AnimeNode, AnimeRecord, AnimeSummary, BuildGraph, CharacterRole, GraphOptions, RoleRef, SimulationEdge, SimulationNode, VoiceActorNode, VoiceActorRecord } from '../types/contract';
import type { EngineCarry } from './graphCarry';

const ROLE_ORDER: readonly CharacterRole[] = ['MAIN', 'SUPPORTING', 'BACKGROUND'];

/** Resolve identities over the entire pool before either bridge detection or visual selection. */
function selectCast(ordered: readonly AnimeRecord[], options: GraphOptions) {
  const parent: number[] = [], rank: number[] = [];
  const keyOwner = new Map<string, number>();
  const find = (id: number): number => {
    let root = id;
    while (parent[root] !== root) root = parent[root]!;
    while (id !== root) { const next = parent[id]!; parent[id] = root; id = next; }
    return root;
  };
  const union = (a: number, b: number) => {
    let left = find(a), right = find(b);
    if (left === right) return;
    if (rank[left]! < rank[right]!) [left, right] = [right, left];
    parent[right] = left;
    if (rank[left] === rank[right]) rank[left]!++;
  };
  const encountered: { va: VoiceActorRecord; identity: number }[] = [];
  const register = (va: VoiceActorRecord) => {
    const identity = parent.length;
    parent.push(identity); rank.push(0);
    for (const key of vaIdentityKeys(va)) {
      const owner = keyOwner.get(key);
      if (owner === undefined) keyOwner.set(key, identity);
      else union(identity, owner);
    }
    encountered.push({ va, identity });
    return identity;
  };
  // Subs participate in identity even when hidden, or attached to a null-primary entry.
  const pools = ordered.map(anime => ({ anime, entries: (anime.fullCastPool ?? anime.cast).map(entry => ({
    entry, identity: entry.voiceActor ? register(entry.voiceActor) : null,
    subs: (entry.subVoiceActors ?? []).map(sub => ({ sub, identity: register(sub.voiceActor) })),
  })) }));
  const people = new Map<number, { canonical: VoiceActorRecord }>();
  for (const { va, identity } of encountered) {
    const root = find(identity), person = people.get(root);
    if (!person) people.set(root, { canonical: va });
    else if (!person.canonical.image && va.image) person.canonical = va;
  }
  const mainAnime = new Map<number, Set<number>>();
  for (const { anime, entries } of pools) for (const item of entries) {
    if (item.identity !== null) item.identity = find(item.identity);
    for (const sub of item.subs) sub.identity = find(sub.identity);
    if (item.identity === null || item.entry.role !== 'MAIN') continue;
    const ids = mainAnime.get(item.identity) ?? new Set<number>();
    ids.add(anime.id); mainAnime.set(item.identity, ids);
  }
  // Pass A: only a primary MAIN credit in another anime can unlock a lower-role entry.
  const visible = pools.map(({ anime, entries }) => ({ anime, entries: entries.filter(
    (item): item is typeof item & { identity: number } => item.identity !== null &&
      (options.showSupportingRoles || item.entry.role === 'MAIN' ||
        [...(mainAnime.get(item.identity) ?? [])].some(id => id !== anime.id)),
  ) }));
  const visibleAnime = new Map<number, Set<number>>();
  for (const { anime, entries } of visible) for (const { identity } of entries) {
    const ids = visibleAnime.get(identity) ?? new Set<number>();
    ids.add(anime.id); visibleAnime.set(identity, ids);
  }
  // Pass 1: every appearance of every bridge is locked, regardless of rank or cast size.
  const bridges = new Set([...visibleAnime].filter(([, ids]) => ids.size >= 2).map(([id]) => id));
  const selected = visible.map(({ anime, entries }) => {
    const bridgeCount = new Set(entries.filter(item => bridges.has(item.identity)).map(item => item.identity)).size;
    const soloQuota = Math.max(MIN_SOLO_NODES, Math.min(MAX_SOLO_NODES, MAX_SOLO_NODES - bridgeCount));
    const solos = new Set<number>();
    // Pass 2: role priority, then original pool order, spending quota on people, not characters.
    for (const role of ROLE_ORDER) for (const item of entries) {
      if (solos.size === soloQuota) break;
      if (item.entry.role === role && !bridges.has(item.identity)) solos.add(item.identity);
    }
    return { anime, entries: entries.filter(item => bridges.has(item.identity) || solos.has(item.identity)) };
  });
  return { people, selected };
}

export const buildGraph: BuildGraph = (watched, anchorAnimeId, previous, options = DEFAULT_GRAPH_OPTIONS) => {
  const records = new Map(watched.map(anime => [anime.id, anime]));
  if (!records.has(anchorAnimeId)) throw new Error(`Anchor anime ${anchorAnimeId} is not in the watched list`);
  const nodes: SimulationNode[] = [];
  const byId = new Map<string, SimulationNode>();
  const neighbors = new Map<string, Set<string>>();
  const animeById = new Map<number, AnimeSummary>();
  const actors = new Map<number, VoiceActorNode>();
  const buckets = new Map<number, Record<CharacterRole, RoleRef[]>>();
  const subBuckets = new Map<number, Record<CharacterRole, RoleRef[]>>();
  const edges: SimulationEdge[] = [];
  const addNode = (node: SimulationNode) => {
    nodes.push(node); byId.set(node.id, node); neighbors.set(node.id, new Set());
  };
  for (const anime of records.values()) {
    const { cast: _cast, fullCastPool: _pool, ...summary } = anime;
    animeById.set(anime.id, summary);
    const node: AnimeNode = { id: animeNodeId(anime.id), kind: 'ANIME', anime: summary,
      roles: [], degree: 0, isAnchor: anime.id === anchorAnimeId, waveIndex: -1 };
    addNode(node);
  }
  // Anchor first within each stable role bucket; remaining records retain watched order.
  const ordered = [records.get(anchorAnimeId)!, ...[...records.values()].filter(a => a.id !== anchorAnimeId)];
  const { people, selected } = selectCast(ordered, options);
  const credit = (anime: AnimeRecord, identity: number, role: RoleRef) => {
    const source = animeNodeId(anime.id);
    const va = people.get(identity)!.canonical;
    let actor = actors.get(identity);
    if (!actor) {
      actor = { id: vaNodeId(va.id), kind: 'VOICE_ACTOR', voiceActor: va, roles: [],
        degree: 0, isAnchor: false, waveIndex: -1 };
      actors.set(identity, actor); addNode(actor);
      buckets.set(identity, { MAIN: [], SUPPORTING: [], BACKGROUND: [] });
      subBuckets.set(identity, { MAIN: [], SUPPORTING: [], BACKGROUND: [] });
    }
    (role.sub ? subBuckets : buckets).get(identity)![role.role].push(role);
    if (neighbors.get(source)!.has(actor.id)) return;
    neighbors.get(source)!.add(actor.id); neighbors.get(actor.id)!.add(source);
    edges.push({ id: `${source}->${actor.id}`, source, target: actor.id, animeId: anime.id,
      sharedAnimeIds: [], isActiveBridge: false });
  };
  const primaryCredits = new Set<string>();
  const creditKey = (identity: number, animeId: number, characterId: number) => `${identity}:${animeId}:${characterId}`;
  for (const { anime, entries } of selected) for (const { entry, identity } of entries) {
    primaryCredits.add(creditKey(identity, anime.id, entry.character.id));
    credit(anime, identity, { animeId: anime.id, character: entry.character, role: entry.role });
  }
  // Pass 3: subs ride selected characters, without affecting visibility, bridge locking or quota.
  const seenSubs = new Set<string>();
  if (options.includeSubVoiceActors) for (const { anime, entries } of selected) for (const { entry, subs } of entries) {
    for (const { sub, identity } of subs) {
      const key = creditKey(identity, anime.id, entry.character.id);
      if (primaryCredits.has(key) || seenSubs.has(key)) continue;
      seenSubs.add(key);
      credit(anime, identity, { animeId: anime.id, character: entry.character, role: entry.role,
        sub: { kind: sub.kind, roleNote: sub.roleNote } });
    }
  }
  for (const [id, actor] of actors) {
    const b = buckets.get(id)!;
    const s = subBuckets.get(id)!;
    actor.roles = [...b.MAIN, ...b.SUPPORTING, ...b.BACKGROUND, ...s.MAIN, ...s.SUPPORTING, ...s.BACKGROUND];
  }
  for (const node of nodes) node.degree = neighbors.get(node.id)!.size;
  const actorAnime = new Map<string, number[]>();
  for (const edge of edges) {
    const key = edge.target as string;
    const ids = actorAnime.get(key) ?? []; ids.push(edge.animeId); actorAnime.set(key, ids);
  }
  // Linear in topology + materialised sharedAnimeIds output (which can itself be quadratic).
  for (const edge of edges) {
    edge.sharedAnimeIds = actorAnime.get(edge.target as string)!.filter(id => id !== edge.animeId);
    edge.isActiveBridge = edge.sharedAnimeIds.length > 0;
  }
  let maxDepth = -1;
  for (const anime of ordered) {
    const root = byId.get(animeNodeId(anime.id))!;
    if (root.waveIndex !== -1) continue;
    root.waveIndex = maxDepth + 1;
    const queue = [root];
    for (let i = 0; i < queue.length; i++) {
      const node = queue[i]!;
      maxDepth = Math.max(maxDepth, node.waveIndex);
      for (const id of neighbors.get(node.id)!) {
        const next = byId.get(id)!;
        if (next.waveIndex !== -1) continue;
        next.waveIndex = node.waveIndex + 1; queue.push(next);
      }
    }
  }
  const result = { options: { ...options }, nodes, edges, neighbors, animeById, anchorAnimeId };
  if (!previous) return result;
  const prior = new Map(previous.nodes.map(node => [node.id, node]));
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    const old = prior.get(node.id);
    if (!old) continue;
    nodeIds.add(node.id);
    node.x = old.x; node.y = old.y; node.vx = old.vx; node.vy = old.vy;
    node.fx = node.fy = null;
  }
  const previousEdges = new Set(previous.edges.map(edge => edge.id));
  const carry: EngineCarry = { nodeIds,
    addedAnimeIds: [...animeById.keys()].filter(id => !previous.animeById.has(id)),
    edgeIds: new Set(edges.filter(edge => previousEdges.has(edge.id)).map(edge => edge.id)) };
  return { ...result, carry };
};
