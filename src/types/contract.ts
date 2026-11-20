/**
 * AniCastMap — SINGLE SOURCE OF TRUTH CONTRACT (owner: Opus 5.5)
 *
 * LOCKED (rev 2 — localisation, franchise consolidation, recommendations, preview modal).
 * `codex` reads this file; it never edits it. Need a change? Request it from the lead.
 *
 * Graph topology (identical in every ViewMode — modes only change visuals + physics):
 *   - ANIME nodes:        one per watched anime.            id = `anime:<aniListId>`
 *   - VOICE_ACTOR nodes:  one per distinct JP voice actor.   id = `va:<aniListId>`
 *     A VA node carries every character they voice inside the watched list (`roles`).
 *     MODE_CHARACTER renders roles[0] as the face with a stacked "+N roles" deck,
 *     MODE_VA flips to the VA portrait, MODE_DETAIL expands into a bento card.
 *   - Edges are bipartite: ANIME → VOICE_ACTOR, one per (anime, VA) pair.
 *   - ANIME nodes are FRANCHISE-CANONICAL: every season/sequel/prequel/movie of one series is merged
 *     into one AnimeRecord whose id is the franchise root (earliest broadcast entry). Any member id
 *     resolves to that record (see AnimeSummary.franchise).
 *   - RECOMMENDATION nodes are a temporary overlay (NOT part of GraphData): satellites orbiting a
 *     selected VA node, owned by `useGraphStore.recommendations`, synced into the engine via
 *     GraphEngineHandle.syncRecommendations().
 *
 * World coordinates: the anchor anime is pinned at world (0,0).
 * Screen = world * k + (x, y)  where CameraTransform = { x, y, k }.
 */
import type { ReactNode } from 'react';
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';

/* ------------------------------------------------------------------ */
/* View modes                                                          */
/* ------------------------------------------------------------------ */

export type ViewMode = 'MODE_CHARACTER' | 'MODE_VA' | 'MODE_DETAIL';

/** Ordered for the segmented switcher; index + 1 = keyboard hotkey. */
export const VIEW_MODES: readonly ViewMode[] = ['MODE_CHARACTER', 'MODE_VA', 'MODE_DETAIL'];

export type DisplayLocale = 'ko' | 'ja' | 'en';

/* ------------------------------------------------------------------ */
/* Domain records (shape of AniList data after normalisation)          */
/* ------------------------------------------------------------------ */

export type CharacterRole = 'MAIN' | 'SUPPORTING' | 'BACKGROUND';

export type AnimeFormat = 'TV' | 'TV_SHORT' | 'MOVIE' | 'SPECIAL' | 'OVA' | 'ONA' | 'MUSIC';

/** Formats that count as a mainline broadcast (TV_SHORT only when popular — see anilistClient). */
export const MAINLINE_FORMATS: readonly AnimeFormat[] = ['TV', 'MOVIE', 'ONA'];

/** A fully-resolved trilingual string. UI renders exactly ONE of the three, chosen by DisplayLocale. */
export interface LocalizedString {
  ko: string;
  ja: string;
  en: string;
}

export interface LocalizedName {
  /** Romanised / English full name (AniList `name.full`). Always present. */
  full: string;
  /** Japanese native name (AniList `name.native`). */
  native: string | null;
  /** Korean display name (curated dataset only; AniList has none). */
  ko?: string;
}

export interface AnimeTitle {
  romaji: string;
  english: string | null;
  native: string | null;
  ko?: string;
}

export interface CharacterRecord {
  id: number;
  name: LocalizedName;
  /** Portrait URL ('' when unknown — UI must render an initials fallback). */
  image: string;
}

export interface VoiceActorRecord {
  id: number;
  name: LocalizedName;
  /** Portrait URL ('' when unknown — UI must render an initials fallback). */
  image: string;
}

/** Why a secondary credit is not the character's main voice. */
export type SubVoiceKind = 'CHILDHOOD' | 'ALTERNATE';

/** A childhood / flashback / replacement voice for a character (AniList `voiceActorRoles.roleNotes`). */
export interface SubVoiceActor {
  voiceActor: VoiceActorRecord;
  kind: SubVoiceKind;
  /** Raw AniList note, e.g. "Childhood". */
  roleNote: string | null;
}

const CHILD_NOTE = /\b(young|child(hood)?|kid|baby|infant|boy|girl|past|flashback)\b|幼少|少年|少女|子供|赤ん坊|過去|幼年/i;
/** 'CHILDHOOD' when the note says young / child / flashback…; null otherwise (caller decides ALTERNATE). */
export const classifyRoleNote = (note: string | null | undefined): 'CHILDHOOD' | null =>
  note && CHILD_NOTE.test(note) ? 'CHILDHOOD' : null;

export interface CastEntry {
  character: CharacterRecord;
  role: CharacterRole;
  /**
   * PRIMARY Japanese VA — the first adult credit with empty/null roleNotes (else the first non-child
   * credit). null when AniList lists none (such entries never become graph nodes).
   */
  voiceActor: VoiceActorRecord | null;
  /** Childhood / flashback / alternate credits. Never overwrite `voiceActor`. Absent when none. */
  subVoiceActors?: SubVoiceActor[];
}

/** Anime without its cast — what search results and pills need. */
export interface AnimeSummary {
  id: number;
  title: AnimeTitle;
  /** Cover image URL ('' when unknown). */
  coverImage: string;
  /** Accent hex, e.g. '#e4a15d'. Drives edge colour, anime pills, badges. Always a valid #rrggbb. */
  color: string;
  seasonYear: number | null;
  format?: AnimeFormat;
  /** Main animation studio (preview modal). */
  studio?: string;
  genres?: string[];
  popularity?: number;
  /** Present when this entry consolidates 2+ AniList media (seasons / sequels / canon movies). */
  franchise?: FranchiseGroup;
}

export interface FranchiseMember {
  id: number;
  title: AnimeTitle;
  format: AnimeFormat;
  seasonYear: number | null;
}

/**
 * Seasons / cours / sequel movies merged into ONE canonical entry. Built by following
 * PREQUEL / SEQUEL / PARENT relations (mainline formats only, capped at 12 members).
 * `AnimeSummary.id === rootId`; `members` is in release order and always includes the root.
 */
export interface FranchiseGroup {
  rootId: number;
  members: FranchiseMember[];
}

/** Every AniList id that resolves to this canonical entry (root + all merged members). */
export const franchiseMemberIds = (anime: AnimeSummary): number[] =>
  anime.franchise ? anime.franchise.members.map((m) => m.id) : [anime.id];

/** Deep cast pool size per (franchise-merged) anime. Pool ⊇ display cast. */
export const MAX_CAST_POOL = 75;
/** Display cast (`AnimeRecord.cast`) — the preview modal / lists; NOT what the graph is built from. */
export const DISPLAY_CAST = 16;
/** Per-anime visual cap for graph nodes: bridge VAs are always kept, solo VAs fill the rest. */
export const MAX_SOLO_NODES = 12;
/** Every anime keeps at least this many solo (non-bridge) VA nodes so its protagonists stay visible. */
export const MIN_SOLO_NODES = 4;

export interface AnimeRecord extends AnimeSummary {
  /**
   * DISPLAY cast = `fullCastPool.slice(0, DISPLAY_CAST)` (same entries, same order). Used by lists and
   * the preview modal only. Entries without a JP voice actor are kept (they never become graph nodes).
   */
  cast: CastEntry[];
  /**
   * DEEP cast pool: one entry per character (primary VA + optional sub VAs), up to MAX_CAST_POOL, ordered by
   * role (MAIN > SUPPORTING > BACKGROUND), then popularity (AniList favourites desc). Franchise merge
   * unions the members' pools (dedupe by character.id, highest role wins) — it NEVER cuts below
   * MAX_CAST_POOL. The graph builder reads this (falls back to `cast` when absent) so a shared voice
   * actor is detected even when their role is a low-ranked SUPPORTING one.
   */
  fullCastPool?: CastEntry[];
}

/**
 * Identity keys for a voice actor. Two records are the SAME person when they share ANY key:
 * AniList id, normalised native name (松岡禎丞, ≥3 chars, spaces/dots stripped), or the token-sorted
 * lower-case romaji ("matsuoka yoshitsugu" ≡ "yoshitsugu matsuoka", ≥2 tokens). Lets preset and live
 * records — or duplicate AniList staff pages — unify into one graph node.
 */
export function vaIdentityKeys(va: VoiceActorRecord): string[] {
  const keys = [`id:${va.id}`];
  const native = va.name.native?.normalize('NFKC').replace(/[\s\u3000・･·.,'’\-]+/g, '').toLowerCase() ?? '';
  if (native.length >= 3) keys.push(`jp:${native}`);
  const tokens = va.name.full.normalize('NFKC').toLowerCase().split(/[\s,・]+/).filter(Boolean);
  if (tokens.length >= 2) keys.push(`en:${[...tokens].sort().join(' ')}`);
  return keys;
}

export interface FilmographyEntry {
  anime: AnimeSummary;
  character: CharacterRecord;
  role: CharacterRole;
}

/* ------------------------------------------------------------------ */
/* Data service (implemented by codex in src/services, injected by App) */
/* ------------------------------------------------------------------ */

export interface AnimeDataSource {
  /** Offline curated dataset — usable synchronously, no network. Franchise-consolidated. */
  readonly presets: readonly AnimeRecord[];
  /**
   * Korean-aware search. Layers: local Korean alias/chosung index → AniList (mainline formats only,
   * aired/airing only, matched against titles + synonyms) → Wikidata Korean→EN/JA bridge for
   * Hangul queries the index cannot resolve. Results are franchise-collapsed (one row per series),
   * ranked match-quality first then popularity, and fall back to presets offline. Cached.
   * `onPartial` receives the fast AniList rows while a slower layer (Wikidata bridge) is still running.
   */
  searchAnime(query: string, signal?: AbortSignal, onPartial?: (rows: AnimeSummary[]) => void): Promise<AnimeSummary[]>;
  /** Synchronous cache read: the full record if loaded, else a search-preview record (≤6 MAIN cast). No network. */
  peekAnime?(id: number): AnimeRecord | undefined;
  /** Synchronous cache read of a filmography (warm from hover/idle prefetch). No network. */
  peekVoiceActorFilmography?(voiceActorId: number): FilmographyEntry[] | undefined;
  /** Fast first frame for many ids at once (shared links): requested id → single-media record, batched. */
  /** `urgent`: the visitor is waiting on it (an add) — take the next request slot ahead of background loads. */
  getAnimeShallow?(ids: readonly number[], signal?: AbortSignal, opts?: { urgent?: boolean }): Promise<Map<number, AnimeRecord>>;
  /** 성우 검색: Korean-aware voice actor lookup (local dictionary → AniList / Wikidata). Cached. */
  searchVoiceActors?(query: string, signal?: AbortSignal): Promise<VoiceActorRecord[]>;
  /** Background Korean-label pass over filmography entries (patched in place). true when any label changed. */
  refineFilmographyNames?(entries: readonly FilmographyEntry[], signal?: AbortSignal): Promise<boolean>;
  /**
   * Full CANONICAL record incl. merged cast. ANY franchise member id resolves to the franchise
   * root's record. Presets resolve instantly. Cached.
   */
  getAnime(id: number, signal?: AbortSignal): Promise<AnimeRecord>;
  /**
   * VA's broader filmography (AniList), mainline formats only, franchise-collapsed (one entry per
   * series+character), falls back to roles found in presets. Cached.
   */
  getVoiceActorFilmography(voiceActorId: number, signal?: AbortSignal): Promise<FilmographyEntry[]>;
  /**
   * Recommendation seeds for a VA: top 3–5 anime where they voice a MAIN role, excluding every id in
   * `excludeAnimeIds` (pass the merged member ids of the whole watched list), one entry per franchise
   * (canonical root summary), most popular first. Cached per VA (exclusion applied after cache).
   */
  getRecommendations(
    voiceActorId: number,
    excludeAnimeIds: readonly number[],
    signal?: AbortSignal,
  ): Promise<FilmographyEntry[]>;
}

/* ------------------------------------------------------------------ */
/* Graph model                                                         */
/* ------------------------------------------------------------------ */

export type NodeKind = 'ANIME' | 'VOICE_ACTOR' | 'RECOMMENDATION';

export interface RoleRef {
  animeId: number;
  character: CharacterRecord;
  role: CharacterRole;
  /** Set when this VA voices the character as a childhood / alternate (sub) voice. Primary credits omit it. */
  sub?: { kind: SubVoiceKind; roleNote: string | null };
}

interface BaseNode extends SimulationNodeDatum {
  id: string;
  kind: NodeKind;
  /**
   * BFS depth over the bipartite graph, rooted at the anchor anime:
   * 0 = anchor anime, 1 = anchor cast VAs, 2 = anime reached through those VAs,
   * 3 = their newly introduced VAs, ... Disconnected anime continue after the max depth.
   */
  waveIndex: number;
  /** ANIME: number of VA neighbours. VOICE_ACTOR: number of distinct watched anime they appear in. */
  degree: number;
  isAnchor: boolean;
}

export interface AnimeNode extends BaseNode {
  kind: 'ANIME';
  anime: AnimeSummary;
  roles: [];
}

export interface VoiceActorNode extends BaseNode {
  kind: 'VOICE_ACTOR';
  voiceActor: VoiceActorRecord;
  /** All roles inside the watched list. roles[0] = primary face (MAIN before SUPPORTING, anchor anime first). */
  roles: RoleRef[];
}

/** Nodes that live in GraphData (the watched-list graph). */
export type SimulationNode = AnimeNode | VoiceActorNode;

/**
 * A recommended (not yet watched) anime, shown as a satellite of the selected VA node.
 * Temporary: lives in `RecommendationSet`, never in GraphData.
 */
export interface RecommendationNode extends BaseNode {
  kind: 'RECOMMENDATION';
  /** Canonical (franchise-root) summary of the recommended anime. */
  anime: AnimeSummary;
  /** The character the VA plays there (portrait shown on the node). */
  character: CharacterRecord;
  role: CharacterRole;
  /** id of the VA node this satellite orbits. */
  viaNodeId: string;
  roles: [];
}

/** Everything the force simulation / node layer can hold. */
export type StageNode = SimulationNode | RecommendationNode;

export const recNodeId = (aniListId: number): string => `rec:${aniListId}`;

export interface SimulationEdge extends SimulationLinkDatum<StageNode> {
  /** `${sourceId}->${targetId}` */
  id: string;
  /**
   * Before d3 init: node id strings. After forceLink init: node objects.
   * Source is the ANIME node (cast edges) or the VA node (recommendation edges).
   */
  source: string | StageNode;
  target: string | StageNode;
  /** The anime this edge belongs to (colour = that anime's `color`). */
  animeId: number;
  /** OTHER watched anime the VA endpoint also appears in (excludes animeId). */
  sharedAnimeIds: number[];
  /** sharedAnimeIds.length > 0 — the VA endpoint bridges 2+ watched anime. */
  isActiveBridge: boolean;
  /**
   * Recommendation edge (VA → RecommendationNode). Rendered DASHED + luminous, drawn by the canvas
   * from `color` (the recommended anime is not in GraphData.animeById). Never part of GraphData.edges.
   */
  isRecommendation?: boolean;
  color?: string;
}

/** The temporary recommendation overlay for one selected VA node. */
export interface RecommendationSet {
  viaNodeId: string;
  voiceActorId: number;
  /** 'ready' sets carry nodes/edges; the engine only reacts to 'ready'. */
  status: 'loading' | 'ready' | 'empty' | 'error';
  nodes: RecommendationNode[];
  edges: SimulationEdge[];
  /** True during the ~320ms retract animation before the set is removed from the store. */
  retracting: boolean;
  error?: string;
}

/** Graph filters (HUD toggles). Changing one rebuilds the graph with `carry` so existing nodes keep position. */
export interface GraphOptions {
  /**
   * false (default) — MAIN-anchored: only MAIN characters, plus SUPPORTING/BACKGROUND characters voiced by a
   * voice actor who voices a MAIN character in ANOTHER watched anime (cross-role bridge).
   * true — also SUPPORTING ⇄ SUPPORTING bridges across watched anime and the major supporting cast.
   */
  showSupportingRoles: boolean;
  /** false (default) — primary voice actors only. true — childhood / alternate credits become nodes/edges too (badged). */
  includeSubVoiceActors: boolean;
  /**
   * "브릿지만": true — only voice actors who appear in 2+ watched anime (bridges) are drawn; single-anime cast is left
   * out and anime hubs sit closer together. A local view preference: persisted, not carried in share links.
   */
  bridgesOnly: boolean;
}
export const DEFAULT_GRAPH_OPTIONS: GraphOptions = { showSupportingRoles: false, includeSubVoiceActors: false, bridgesOnly: false };

export interface GraphData {
  /** The options this graph was built with. */
  options: GraphOptions;
  nodes: SimulationNode[];
  edges: SimulationEdge[];
  /** Undirected 1-hop adjacency by node id (drives ego-network spotlight). */
  neighbors: ReadonlyMap<string, ReadonlySet<string>>;
  animeById: ReadonlyMap<number, AnimeSummary>;
  anchorAnimeId: number;
  /**
   * Present when this graph EXTENDS the previously displayed one (incremental "ripple pass" after a
   * recommended anime is added). Carried nodes inherit x/y/vx/vy from the previous graph's nodes and
   * must appear instantly; only `addedAnimeIds` play genesis steps.
   */
  carry?: { nodeIds: ReadonlySet<string>; addedAnimeIds: number[] };
}

export const animeNodeId = (aniListId: number): string => `anime:${aniListId}`;
export const vaNodeId = (aniListId: number): string => `va:${aniListId}`;

/* ------------------------------------------------------------------ */
/* Node footprint — shared by agy (visual size) and codex (collision)  */
/* ------------------------------------------------------------------ */

export interface NodeFootprint {
  /** Rendered box size in world px (visual must match). */
  width: number;
  height: number;
  /** forceCollide radius in world px. */
  collideRadius: number;
}

export const DETAIL_CARD = { width: 220, height: 110 } as const;

/**
 * MODE_CHARACTER multi-role card deck, opening ABOVE its VA node (agy renders it, codex keeps nodes out of it).
 * Width = card + (roles - 1) * step; drawn at `scale = clamp(0.9, 1 / camera.k, 5)` from its bottom edge.
 */
export const ROLE_DECK = { card: 64, step: 48, height: 126, gap: 14 } as const;

/** Recommendation satellites are deliberately smaller than graph nodes. */
export const REC_TILE = 72;
export const REC_DETAIL = { width: 176, height: 84 } as const;

export function getNodeFootprint(node: StageNode, mode: ViewMode): NodeFootprint {
  if (node.kind === 'RECOMMENDATION') {
    return mode === 'MODE_DETAIL'
      ? { ...REC_DETAIL, collideRadius: 100 }
      : { width: REC_TILE, height: REC_TILE, collideRadius: REC_TILE / 2 + 12 };
  }
  if (mode === 'MODE_DETAIL') {
    return { ...DETAIL_CARD, collideRadius: 130 };
  }
  if (node.kind === 'ANIME') {
    const size = node.isAnchor ? 112 : 88;
    return { width: size, height: size, collideRadius: size / 2 + 14 };
  }
  // VOICE_ACTOR
  const size = mode === 'MODE_VA' ? 56 + node.degree * 16 /* radius = 28 + degree*8 */ : 64;
  return { width: size, height: size, collideRadius: size / 2 + 10 };
}

export function pickName(name: LocalizedName, locale: DisplayLocale): string {
  if (locale === 'ko') return name.ko ?? name.full;
  if (locale === 'ja') return name.native ?? name.full;
  return name.full;
}

export function pickTitle(title: AnimeTitle, locale: DisplayLocale): string {
  if (locale === 'ko') return title.ko ?? title.english ?? title.romaji;
  if (locale === 'ja') return title.native ?? title.romaji;
  return title.english ?? title.romaji;
}

/** All three locales resolved (with the same fallbacks as pickName). For search indexes / modals. */
export const localizeName = (name: LocalizedName): LocalizedString => ({
  ko: pickName(name, 'ko'),
  ja: pickName(name, 'ja'),
  en: pickName(name, 'en'),
});
export const localizeTitle = (title: AnimeTitle): LocalizedString => ({
  ko: pickTitle(title, 'ko'),
  ja: pickTitle(title, 'ja'),
  en: pickTitle(title, 'en'),
});

/* ------------------------------------------------------------------ */
/* Engine ⇄ UI                                                          */
/* ------------------------------------------------------------------ */

export interface CameraTransform {
  x: number;
  y: number;
  k: number;
}

export type GenesisSpeed = 1 | 2 | 'INSTANT';

export type GenesisStatus = 'idle' | 'playing' | 'done';

export interface GenesisState {
  status: GenesisStatus;
  /** Steps fired so far / total steps (step 0 = anchor drop). Updated per step, never per frame. */
  step: number;
  totalSteps: number;
}

/**
 * Imperative engine API. The engine registers it via `useGraphStore.getState().registerEngine(handle)`
 * on mount and `registerEngine(null)` on unmount. UI never calls it directly — UI calls the
 * store actions, which update state and forward to the handle.
 */
export interface GraphEngineHandle {
  replayGenesis(): void;
  setViewMode(mode: ViewMode): void;
  setPhysicsPaused(paused: boolean): void;
  setGenesisSpeed(speed: GenesisSpeed): void;
  /** Smoothly fly the camera to a node (an anime id frames its whole cluster). */
  focusNode(nodeId: string): void;
  fitView(): void;
  /**
   * Reconcile the recommendation overlay: add/remove RecommendationNodes + dashed edges in the live
   * simulation (spawn near `viaNodeId`, orbit it). Called with the store's current set (or null).
   * Only a 'ready' set adds nodes; null / a different viaNodeId / retracting removes them.
   * Must NOT re-run genesis or reheat above alpha 0.25.
   */
  syncRecommendations(set: RecommendationSet | null): void;
}

/** Spotlight state of one node, derived from hovered ?? selected. */
export type SpotlightState = 'idle' | 'focus' | 'linked' | 'dimmed';

/* ------------------------------------------------------------------ */
/* Component prop contracts (cross-agent boundaries)                    */
/* ------------------------------------------------------------------ */

/** codex: src/components/canvas/GraphStage.tsx — default-less named export `GraphStage`. */
export interface GraphStageProps {
  /** Rendered inside the engine-positioned wrapper (wrapper is centred on node.x/node.y). */
  renderNode: (node: StageNode) => ReactNode;
}

/** agy: src/components/nodes/GraphNodeItem.tsx — named export `GraphNodeItem`. Reads the rest from the store. */
export interface GraphNodeItemProps {
  node: StageNode;
}

/** agy: src/components/drawers/WatchedListDrawer.tsx — named export `WatchedListDrawer`. */
export interface WatchedListDrawerProps {
  dataSource: AnimeDataSource;
  /** Called when the user presses "Generate Seiyuu Map" (only enabled with >=3 anime + anchor). */
  onGenerate: () => void;
}

export interface InspectorDrawerProps {
  dataSource: AnimeDataSource;
}

export interface AnimePreviewModalProps {
  dataSource: AnimeDataSource;
}

/**
 * src/engine/graphBuilder.ts — named export `buildGraph`. Pure, deterministic.
 * With `previous`, nodes whose id exists in it inherit x/y/vx/vy and the result carries `carry`.
 */
export type BuildGraph = (
  watched: readonly AnimeRecord[],
  anchorAnimeId: number,
  previous?: GraphData | null,
  options?: GraphOptions,
  focusedNodeId?: string | null,
) => GraphData;
