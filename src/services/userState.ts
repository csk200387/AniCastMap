/**
 * Persistent client-side state (pure module: no store, no DOM — every function takes the storage).
 *
 *  - `anicastmap:user-state:v1`  small envelope `{ version, updatedAt, state }`: the watched list as lightweight
 *    AnimeSummary objects + anchor + preferences + whether a graph was on screen.
 *  - `anicastmap:cast-cache:v1`  heavy `fullCastPool` arrays of NON-preset watched anime (presets ship in the bundle),
 *    LRU/TTL/size-capped so the user-state key stays tiny and instant to parse.
 *
 * Everything is defensive: storage may be missing (private mode), full (QuotaExceededError) or hold garbage from an
 * older/foreign version — callers get `null` / `false`, never an exception.
 */
import { DISPLAY_CAST, MAX_CAST_POOL, VIEW_MODES } from '../types/contract';
import { ensureKoName } from './localize';
import type {
  AnimeFormat,
  AnimeRecord,
  AnimeSummary,
  AnimeTitle,
  CastEntry,
  CharacterRole,
  DisplayLocale,
  FranchiseGroup,
  LocalizedName,
  SubVoiceActor,
  ViewMode,
  VoiceActorRecord,
} from '../types/contract';

export const USER_STATE_KEY = 'anicastmap:user-state:v1';
export const CAST_CACHE_KEY = 'anicastmap:cast-cache:v1';
export const STATE_VERSION = 1;
export const MAX_WATCHED = 500;
/** Guard against pathological data only — real "other voices" credits reach ~20 sub actors on one character. */
export const MAX_SUBS_PER_CHARACTER = 64;
export const CAST_CACHE_MAX_ENTRIES = 24;
/** Serialized size cap for the whole cast cache (UTF-16 chars ≈ 2× bytes; localStorage quota is ~5 MB per origin). */
export const CAST_CACHE_MAX_CHARS = 1_600_000;
/** After this a cached pool is "stale": still used instantly, refreshed in the background. */
export const CAST_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** `localStorage`, or null when blocked (Safari private mode / disabled site data throw on access). */
export function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The discrete user state worth keeping across sessions. */
export interface PersistedState {
  watched: AnimeSummary[];
  anchorAnimeId: number | null;
  locale: DisplayLocale;
  viewMode: ViewMode;
  showSupportingRoles: boolean;
  includeSubVoiceActors: boolean;
  bridgesOnly: boolean;
  liveUpdate?: boolean;
  /** A graph was on screen — rebuild it on boot. */
  hasGeneratedGraph: boolean;
}

/* ------------------------------------------------------------------ */
/* Sanitisers: rebuild objects from known fields only                  */
/* ------------------------------------------------------------------ */

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isId = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x > 0;
const clip = (x: unknown, max = 400): string | undefined => (typeof x === 'string' ? x.slice(0, max) : undefined);
const FORMATS: ReadonlySet<string> = new Set<AnimeFormat>(['TV', 'TV_SHORT', 'MOVIE', 'SPECIAL', 'OVA', 'ONA', 'MUSIC']);
const ROLES: ReadonlySet<string> = new Set<CharacterRole>(['MAIN', 'SUPPORTING', 'BACKGROUND']);
const LOCALES: ReadonlySet<string> = new Set<DisplayLocale>(['ko', 'ja', 'en']);
const year = (x: unknown): number | null => (typeof x === 'number' && Number.isInteger(x) && x >= 1900 && x <= 2200 ? x : null);

function title(x: unknown): AnimeTitle | null {
  if (!isObj(x)) return null;
  const romaji = clip(x.romaji);
  if (!romaji) return null;
  const ko = clip(x.ko);
  return { romaji, english: clip(x.english) ?? null, native: clip(x.native) ?? null, ...(ko ? { ko } : {}) };
}

function franchise(x: unknown): FranchiseGroup | undefined {
  if (!isObj(x) || !isId(x.rootId) || !Array.isArray(x.members)) return undefined;
  const members: FranchiseGroup['members'] = [];
  for (const m of x.members.slice(0, 16)) {
    if (!isObj(m) || !isId(m.id) || typeof m.format !== 'string' || !FORMATS.has(m.format)) continue;
    const t = title(m.title);
    if (t) members.push({ id: m.id, title: t, format: m.format as AnimeFormat, seasonYear: year(m.seasonYear) });
  }
  return members.length ? { rootId: x.rootId, members } : undefined;
}

export function sanitizeSummary(x: unknown): AnimeSummary | null {
  if (!isObj(x) || !isId(x.id)) return null;
  const t = title(x.title);
  if (!t) return null;
  const color = typeof x.color === 'string' && /^#[0-9a-f]{6}$/i.test(x.color) ? x.color : '#8b9cff';
  const out: AnimeSummary = { id: x.id, title: t, coverImage: clip(x.coverImage, 600) ?? '', color, seasonYear: year(x.seasonYear) };
  if (typeof x.format === 'string' && FORMATS.has(x.format)) out.format = x.format as AnimeFormat;
  const studio = clip(x.studio, 120);
  if (studio) out.studio = studio;
  if (Array.isArray(x.genres)) out.genres = x.genres.slice(0, 10).flatMap((g) => clip(g, 40) ?? []);
  if (typeof x.popularity === 'number' && Number.isFinite(x.popularity)) out.popularity = x.popularity;
  const fr = franchise(x.franchise);
  if (fr) out.franchise = fr;
  return out;
}

/** AnimeRecord → the lightweight summary that goes into user-state (no cast arrays). */
export function toSummary(record: AnimeSummary): AnimeSummary {
  const { cast: _cast, fullCastPool: _pool, ...summary } = record as AnimeSummary & Partial<AnimeRecord>;
  return summary;
}

function name(x: unknown): LocalizedName | null {
  if (!isObj(x)) return null;
  const full = clip(x.full, 200);
  if (!full) return null;
  const ko = clip(x.ko, 200);
  return { full, native: clip(x.native, 200) ?? null, ...(ko ? { ko } : {}) };
}

function person(x: unknown): VoiceActorRecord | null {
  if (!isObj(x) || !isId(x.id)) return null;
  const n = name(x.name);
  return n ? { id: x.id, name: n, image: clip(x.image, 600) ?? '' } : null;
}

/** Validate a cached cast pool; invalid entries are skipped. */
export function sanitizePool(x: unknown): CastEntry[] {
  if (!Array.isArray(x)) return [];
  const out: CastEntry[] = [];
  for (const e of x.slice(0, MAX_CAST_POOL)) {
    if (!isObj(e) || !isObj(e.character) || !isId(e.character.id) || typeof e.role !== 'string' || !ROLES.has(e.role)) continue;
    const cn = name(e.character.name);
    if (!cn) continue;
    const entry: CastEntry = {
      character: { id: e.character.id, name: cn, image: clip(e.character.image, 600) ?? '' },
      role: e.role as CharacterRole,
      voiceActor: e.voiceActor === null ? null : person(e.voiceActor),
    };
    if (Array.isArray(e.subVoiceActors)) {
      const subs: SubVoiceActor[] = [];
      for (const s of e.subVoiceActors.slice(0, MAX_SUBS_PER_CHARACTER)) {
        const va = isObj(s) ? person(s.voiceActor) : null;
        if (va && isObj(s) && (s.kind === 'CHILDHOOD' || s.kind === 'ALTERNATE')) subs.push({ voiceActor: va, kind: s.kind, roleNote: clip(s.roleNote, 80) ?? null });
      }
      if (subs.length) entry.subVoiceActors = subs;
    }
    out.push(entry);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* user-state                                                          */
/* ------------------------------------------------------------------ */

/**
 * Parse + validate a stored envelope. Returns null when the envelope itself is unusable (garbage, wrong version,
 * missing list) — the caller then behaves like a first visit. Individual bad fields/items degrade gracefully.
 */
export function parseUserState(raw: string | null): PersistedState | null {
  if (!raw || raw.length > 4_000_000) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(json) || json.version !== STATE_VERSION || !isObj(json.state) || !Array.isArray(json.state.watched)) return null;
  const s = json.state;
  const rawList = (s.watched as unknown[]).slice(0, MAX_WATCHED);

  const seen = new Set<number>();
  const watched: AnimeSummary[] = [];
  for (const item of rawList) {
    const summary = sanitizeSummary(item);
    if (summary && !seen.has(summary.id)) {
      seen.add(summary.id);
      watched.push(summary);
    }
  }
  // A non-empty list in which nothing is usable is corruption, not "the user cleared their list".
  if (rawList.length > 0 && watched.length === 0) return null;

  const anchorAnimeId = isId(s.anchorAnimeId) && seen.has(s.anchorAnimeId) ? s.anchorAnimeId : (watched[0]?.id ?? null);
  const viewMode = (VIEW_MODES as readonly unknown[]).includes(s.viewMode) ? (s.viewMode as ViewMode) : 'MODE_CHARACTER';
  return {
    watched,
    anchorAnimeId,
    locale: typeof s.locale === 'string' && LOCALES.has(s.locale) ? (s.locale as DisplayLocale) : 'ko',
    viewMode,
    showSupportingRoles: s.showSupportingRoles === true,
    includeSubVoiceActors: s.includeSubVoiceActors === true,
    bridgesOnly: s.bridgesOnly === true,
    liveUpdate: s.liveUpdate !== false,
    hasGeneratedGraph: s.hasGeneratedGraph === true && anchorAnimeId !== null,
  };
}

export function serializeUserState(state: PersistedState, now = Date.now()): string {
  return JSON.stringify({ version: STATE_VERSION, updatedAt: now, state: { ...state, watched: state.watched.slice(0, MAX_WATCHED).map(toSummary) } });
}

export function loadUserState(storage: StorageLike | null): PersistedState | null {
  if (!storage) return null;
  try {
    return parseUserState(storage.getItem(USER_STATE_KEY));
  } catch {
    return null;
  }
}

/** True when written. Never throws (QuotaExceededError / SecurityError are swallowed). */
export function saveUserState(storage: StorageLike | null, state: PersistedState, now = Date.now()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(USER_STATE_KEY, serializeUserState(state, now));
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* cast cache                                                          */
/* ------------------------------------------------------------------ */

export interface CachedPool {
  savedAt: number;
  pool: CastEntry[];
}
export type CastCache = Map<number, CachedPool>;

export function readCastCache(storage: StorageLike | null): CastCache {
  const out: CastCache = new Map();
  if (!storage) return out;
  try {
    const raw = storage.getItem(CAST_CACHE_KEY);
    if (!raw || raw.length > 8_000_000) return out;
    const json: unknown = JSON.parse(raw);
    if (!isObj(json) || json.version !== STATE_VERSION || !isObj(json.entries)) return out;
    for (const [key, value] of Object.entries(json.entries)) {
      const id = Number(key);
      if (!isId(id) || !isObj(value) || typeof value.savedAt !== 'number') continue;
      const pool = sanitizePool(value.pool);
      if (pool.length) out.set(id, { savedAt: value.savedAt, pool });
    }
  } catch {
    /* corrupt cache = empty cache */
  }
  return out;
}

const serializeCache = (cache: CastCache): string => {
  const entries: Record<string, CachedPool> = {};
  for (const [id, v] of cache) entries[String(id)] = v;
  return JSON.stringify({ version: STATE_VERSION, entries });
};

/**
 * Persist the cache, evicting oldest-saved entries first until it fits the entry/size caps. Mutates `cache`
 * (evicted entries leave the in-memory map too). On a quota error it halves the cache once and retries.
 */
export function writeCastCache(storage: StorageLike | null, cache: CastCache): boolean {
  if (!storage) return false;
  const byAge = () => [...cache.entries()].sort((a, b) => a[1].savedAt - b[1].savedAt);
  while (cache.size > CAST_CACHE_MAX_ENTRIES) cache.delete(byAge()[0]![0]);
  let json = serializeCache(cache);
  while (json.length > CAST_CACHE_MAX_CHARS && cache.size > 1) {
    cache.delete(byAge()[0]![0]);
    json = serializeCache(cache);
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (cache.size === 0) storage.removeItem(CAST_CACHE_KEY);
      else storage.setItem(CAST_CACHE_KEY, json);
      return true;
    } catch {
      const drop = Math.ceil(cache.size / 2);
      for (const [id] of byAge().slice(0, drop)) cache.delete(id);
      json = serializeCache(cache);
    }
  }
  return false;
}

export const isStale = (entry: CachedPool, now = Date.now()): boolean => now - entry.savedAt > CAST_CACHE_TTL_MS;

/** Rebuild a full record from a stored summary + its cached pool. `cast` is the contract's 16-entry display slice. */
export function recordFromPool(summary: AnimeSummary, pool: CastEntry[]): AnimeRecord {
  for (const entry of pool) {
    entry.character.name = ensureKoName(entry.character.name, { kind: 'character', id: entry.character.id });
    if (entry.voiceActor) entry.voiceActor.name = ensureKoName(entry.voiceActor.name, { kind: 'voiceActor', id: entry.voiceActor.id });
    for (const sub of entry.subVoiceActors ?? []) sub.voiceActor.name = ensureKoName(sub.voiceActor.name, { kind: 'voiceActor', id: sub.voiceActor.id });
  }
  return { ...summary, cast: pool.slice(0, DISPLAY_CAST), fullCastPool: pool };
}
