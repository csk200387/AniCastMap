import { memo } from './requestCache';
import type { AnimeDataSource, AnimeFormat, AnimeRecord, AnimeSummary, CastEntry, CharacterRole, FilmographyEntry, VoiceActorRecord } from '../types/contract';
import { KO_SEIYUU } from '../data/koreanSeiyuu';
import { DISPLAY_CAST, MAINLINE_FORMATS } from '../types/contract';
import type { RankedCastEntry } from './franchise';
import { PRESET_ANIME } from '../data/presetAnime';
import { KO_TITLES } from '../data/koreanTitles';
import { KO_TITLES_AUTO } from '../data/koreanTitlesAuto';
import { normalizeAccent } from './accent';
import { chosung, ensureKoName, hangulToRomaji, isHangul, koTitleFor, matchTier, normalizeKey, transliterateName } from './localize';
import { mergeFranchiseCast, roleOrder } from './franchise';
import { selectVoiceCredits } from './voiceCredits';
import { resolveKoreanNames } from './koreanNameResolver';
import type { KoreanNameQuery } from './koreanNameResolver';
import { curatedKoreanName } from './localize';
export function readableAccent(hex: string): string { return normalizeAccent(hex); }
interface Person { id: number; name: { full: string | null; native: string | null }; image: { large: string | null } | null; favourites?: number }
interface MediaSummary {
  id: number; type: string; format: AnimeFormat; status: string; isAdult?: boolean;
  title: { romaji: string | null; english: string | null; native: string | null };
  coverImage: { large: string | null; color: string | null } | null; seasonYear: number | null;
  popularity: number; duration: number | null; synonyms?: string[]; genres?: string[];
  studios?: { nodes: { name: string }[] }; startDate?: { year: number | null; month: number | null; day: number | null };
}
interface Media extends MediaSummary {
  relations?: { edges: { relationType: string; node: Pick<MediaSummary, 'id' | 'type' | 'format' | 'status' | 'isAdult' | 'popularity' | 'duration'> }[] };
  c1?: { edges: { role: CharacterRole; node: Person; voiceActorRoles: { roleNotes: string | null; dubGroup: string | null; voiceActor: Person }[] }[] } | null;
  c2?: Media['c1'];
}
/** Lean card media: one-hop relation ids only, so a result set can collapse franchises without walking. */
interface LinkedMedia extends MediaSummary { relations?: { edges: { relationType: string; node: { id: number } }[] } }
interface SearchMedia extends LinkedMedia { characters?: Media['c1'] }
type FilmPage = { edges: { characterRole: CharacterRole; node: LinkedMedia; characters: Person[] }[] } | null;
interface FilmResponse { Staff: { p1: FilmPage; p2: FilmPage } | null }
interface StaffHit extends Person { languageV2?: string | null; primaryOccupations?: string[] | null }
interface Envelope<T> { data?: T; errors?: { message: string }[] }
interface BatchItem { id: number; signal: AbortSignal; resolve: (value: Media) => void; reject: (reason: unknown) => void }
const endpoint = 'https://graphql.anilist.co';
const palette = ['#e4a15d', '#71b7db', '#b49be8', '#e982a0', '#78c6a3'];
const summaryFields = `id type format status isAdult popularity duration synonyms genres studios(isMain:true){nodes{name}}
  startDate {year month day} title {romaji english native} coverImage {large color} seasonYear`;
const personFields = 'id name { full native } image { large }';
const relationFields = `relations {edges {relationType node {id type format status isAdult popularity duration}}}`;
// Relations are batched cheaply. Deep casts are fetched one media per request (two aliases).
const mediaFields = `${summaryFields} ${relationFields}`;
const cardFields = `id type format status isAdult popularity duration synonyms seasonYear startDate {year month day}
  title {romaji english native} coverImage {large color} relations {edges {relationType node {id}}}`;
const castPage = (page: number) => `c${page}: characters(page:${page},sort:[ROLE,FAVOURITES_DESC,RELEVANCE],perPage:25){edges{role node{${personFields} favourites} voiceActorRoles(language:JAPANESE,sort:[RELEVANCE,ID]){roleNotes dubGroup voiceActor{${personFields}}}}}`;
const filters = 'type:ANIME,isAdult:false,status_in:[FINISHED,RELEASING],format_in:[TV,TV_SHORT,MOVIE,ONA]';
const relationTypes = new Set(['PREQUEL', 'SEQUEL', 'PARENT']);
const records = new Map<number, AnimeRecord>();
const roots = new Map<number, number>();
for (const a of PRESET_ANIME) for (const id of a.franchise?.members.map(m => m.id) ?? [a.id]) { records.set(id, a); roots.set(id, a.id); }
const abortError = () => new DOMException('The operation was aborted', 'AbortError');
const checkAbort = (signal?: AbortSignal) => { if (signal?.aborted) throw abortError(); };
const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';
export function isMainline(m: Pick<MediaSummary, 'type' | 'format' | 'status' | 'popularity' | 'duration' | 'isAdult'>): boolean {
  return m.type === 'ANIME' && !m.isAdult && ['FINISHED', 'RELEASING'].includes(m.status)
    && (['TV', 'MOVIE', 'ONA'].includes(m.format) || (m.format === 'TV_SHORT' && m.popularity >= 25000))
    && !(m.duration && m.duration < 10 && m.format !== 'MOVIE');
}
function person(p: Person, kind: 'character' | 'voiceActor' = 'character', normalize = true): CastEntry['character'] {
  const name = { full: p.name.full ?? p.name.native ?? 'Unknown', native: p.name.native ?? null };
  return { id: p.id, name: normalize ? ensureKoName(name, {kind,id:p.id}) : name, image: p.image?.large ?? '' };
}
function summary(m: MediaSummary): AnimeSummary {
  const title = { romaji: m.title.romaji ?? m.title.english ?? String(m.id), english: m.title.english, native: m.title.native };
  const ko = koTitleFor(m.id, title, m.synonyms);
  return { id: m.id, title: { ...title, ...(ko ? { ko } : {}) }, coverImage: m.coverImage?.large ?? '',
    color: readableAccent(m.coverImage?.color ?? palette[(Math.imul(m.id, 2654435761) >>> 0) % palette.length]!),
    seasonYear: m.seasonYear ?? null, format: m.format, studio: m.studios?.nodes.map(s => s.name).join(', ') ?? '',
    genres: m.genres ?? [], popularity: m.popularity ?? 0 };
}
function record(m: Media): AnimeRecord {
  const seen = new Set<number>();
  const fullCastPool: RankedCastEntry[] = [...(m.c1?.edges ?? []), ...(m.c2?.edges ?? [])].filter(e => {
    if (seen.has(e.node.id)) return false; seen.add(e.node.id); return true;
  }).map(e => ({ character: person(e.node, 'character', false), role: e.role,
    ...selectVoiceCredits(e.voiceActorRoles.map(c => ({...c,voiceActor:person(c.voiceActor,'voiceActor',false)}))), favourites: e.node.favourites ?? 0 }));
  return { ...summary(m), fullCastPool, cast: fullCastPool.slice(0, DISPLAY_CAST) };
}
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    checkAbort(signal);
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
/**
 * Request pacing follows AniList's advertised budget (CORS-exposed X-RateLimit-* headers): 90/min normally, 30/min
 * when AniList runs degraded. A fixed 750ms gap (80/min) overruns the degraded budget and turns bursts — a shared
 * map hydrating a dozen anime — into 429 failures.
 */
let spacing = 750, pausedUntil = 0;
function readBudget(response: Response): void {
  const limit = Number(response.headers.get('X-RateLimit-Limit'));
  if (limit > 0) spacing = Math.max(750, Math.ceil(60000 / limit));
  const remaining = response.headers.get('X-RateLimit-Remaining'), reset = Number(response.headers.get('X-RateLimit-Reset'));
  if (remaining === '0' && reset > 0) pausedUntil = Math.max(pausedUntil, reset * 1000);
}
async function request<T>(query: string, variables: Record<string, string | number>, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; attempt <= 2; attempt++) {
    checkAbort(signal);
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }), signal });
    readBudget(response);
    if (response.status === 429 && attempt < 2) {
      const retry = response.headers.get('Retry-After');
      const seconds = retry === null ? NaN : Number(retry);
      const retryMs = Number.isFinite(seconds) ? seconds * 1000 : retry ? Date.parse(retry) - Date.now() : 0;
      const wait = Math.max(750 * 2 ** attempt, Number.isFinite(retryMs) ? retryMs : 0);
      pausedUntil = Math.max(pausedUntil, Date.now() + wait); // every queued request backs off, not just this one
      await delay(wait, signal);
      continue;
    }
    if (!response.ok) throw new Error(`AniList HTTP ${response.status}`);
    const body: Envelope<T> = await response.json();
    checkAbort(signal);
    if (body.errors?.length || !body.data) throw new Error(body.errors?.map(e => e.message).join('; ') || 'AniList returned no data');
    return body.data;
  }
  throw new Error('AniList retry limit exceeded');
}
const rawMemo = memo<Media>('rawMemo'), animeMemo = memo<AnimeRecord>('animeMemo'), searchMemo = memo<AnimeSummary[]>('searchMemo'), filmMemo = memo<FilmographyEntry[]>('film50');
const rootMemo = memo<number>('rootMemo'), bridgeMemo = memo<MediaSummary[]>('bridgeMemo'), castMemo = memo<Pick<Media, 'c1' | 'c2'>[]>('castBatch');
let batch: BatchItem[] = [], scheduled = false;
let lastStart = -Infinity;
// All live calls, including generation scripts, leave at least `spacing` (≥750ms) between starts. A slot is claimed
// only when a request actually starts, so an aborted waiter (stale keystroke, superseded prefetch) never delays the next.
const transportMemo = memo<unknown>('graphql');
let urgentWaiting = 0;
/** `urgent` (typing in a search box) takes the next free slot ahead of background loads — franchise hydration,
 * prefetch — so a search never queues behind a dozen bulk requests. */
function pacedRequest<T>(query: string, variables: Record<string, string | number>, signal: AbortSignal, urgent = false): Promise<T> {
  return transportMemo(JSON.stringify([query, variables]), async transport => {
    const next = () => Math.max(lastStart + spacing, pausedUntil) - Date.now();
    if (urgent) urgentWaiting++;
    try {
      for (;;) {
        const wait = next();
        if (wait > 0) await delay(wait, transport);
        else if (!urgent && urgentWaiting > 0) await delay(spacing, transport); // yield this slot
        else break;
      }
    } finally { if (urgent) urgentWaiting--; }
    lastStart = Date.now();
    return request<T>(query, variables, transport);
  }, signal) as Promise<T>;
}

function raw(id: number, signal: AbortSignal): Promise<Media> {
  return rawMemo(String(id), transport => new Promise((resolve, reject) => {
    checkAbort(transport); batch.push({ id, signal: transport, resolve, reject });
    if (!scheduled) { scheduled = true; setTimeout(() => { void flush(); }, 0); }
  }), signal);
}
async function flush(): Promise<void> {
  const items = batch; batch = []; scheduled = false;
  // AniList has a query complexity limit; never exceed eight media aliases.
  await Promise.all(items.reduce<BatchItem[][]>((groups, item, i) => {
    if (i % 8 === 0) groups.push([]); groups[groups.length - 1]!.push(item); return groups;
  }, []).map(async group => {
    const active = group.filter(item => { if (item.signal.aborted) { item.reject(abortError()); return false; } return true; });
    if (!active.length) return;
    const controller = new AbortController();
    const onAbort = () => { if (active.every(item => item.signal.aborted)) controller.abort(); };
    for (const item of active) item.signal.addEventListener('abort', onAbort);
    try {
      const query = `{${active.map((item, i) => `a${i}: Media(id:${item.id},type:ANIME){${mediaFields}}`).join('\n')}}`;
      const data = await pacedRequest<Record<string, Media | null>>(query, {}, controller.signal);
      active.forEach((item, i) => {
        const m = data[`a${i}`];
        if (item.signal.aborted) item.reject(abortError());
        else if (!m) item.reject(new Error(`Anime ${item.id} was not found`)); else item.resolve(m);
      });
    } catch (error) { for (const item of active) item.reject(item.signal.aborted ? abortError() : error); }
    finally { for (const item of active) item.signal.removeEventListener('abort', onAbort); }
  }));
}
const releaseKey = (m: MediaSummary) => (m.startDate?.year ?? m.seasonYear ?? 9999) * 10000 + (m.startDate?.month ?? 12) * 100 + (m.startDate?.day ?? 31);
const releaseOrder = (a: MediaSummary, b: MediaSummary) => releaseKey(a) - releaseKey(b) || a.id - b.id;
async function traverse(ids: number[], depth: number, signal: AbortSignal): Promise<Media[]> {
  const visited = new Map<number, Media>();
  let frontier = ids;
  for (let level = 0; frontier.length && level <= depth; level++) {
    const media = await Promise.all(frontier.slice(0, 12 - visited.size).map(id => raw(id, signal)));
    for (const m of media) if (isMainline(m)) visited.set(m.id, m);
    const next = new Set<number>();
    for (const m of media) if (isMainline(m)) for (const e of m.relations?.edges ?? []) {
      if (relationTypes.has(e.relationType) && isMainline(e.node) && !visited.has(e.node.id)) next.add(e.node.id);
    }
    frontier = [...next].slice(0, 12 - visited.size);
  }
  return [...visited.values()].sort(releaseOrder);
}
/** Network-only entry point also used by the preset generator. */
export async function loadFranchise(id: number, signal: AbortSignal = new AbortController().signal, onNamesResolved?: (stats: Awaited<ReturnType<typeof enrichKoreanNames>>) => void): Promise<AnimeRecord> {
  const members = await traverse([id], 8, signal);
  const first = members[0];
  if (!first) throw new Error(`Anime ${id} is not an aired mainline anime`);
  // ≤5 members: both 25-character pages each. Larger series: both pages for the first four releases, page 1 for
  // the rest. Every member's pages ride in ONE request (aliases k0…): traverse caps members at 12, so at most
  // 4×2 + 8×1 = 16 pages ≈ 350 of AniList's 500 complexity budget (measured ≈22 per page).
  const plan = members.map((member, index) => ({ member, pages: members.length <= 5 || index < 4 ? 2 : 1 }));
  const casts = await castMemo(plan.map(p => `${p.member.id}:${p.pages}`).join(','), async transport => {
    const data = await pacedRequest<Record<string, Pick<Media, 'c1' | 'c2'> | null>>(
      `{${plan.map(({ member, pages }, i) => `k${i}: Media(id:${member.id},type:ANIME){${castPage(1)} ${pages === 2 ? castPage(2) : ''}}`).join('\n')}}`, {}, transport);
    return plan.map(({ member }, i) => { const cast = data[`k${i}`]; if (!cast) throw new Error(`Anime ${member.id} was not found`); return cast; });
  }, signal);
  const castMembers = members.map((member, i) => record({ ...member, ...casts[i] }));
  const root = castMembers[0]!;
  root.title.ko ??= members.map(m => koTitleFor(m.id, summary(m).title, m.synonyms)).find(Boolean);
  root.popularity = Math.max(...members.map(m => m.popularity ?? 0));
  root.fullCastPool = mergeFranchiseCast(castMembers, false);
  root.cast = root.fullCastPool.slice(0, DISPLAY_CAST);
  if (members.length >= 2) root.franchise = { rootId: root.id, members: members.map(m => ({ id: m.id, title: summary(m).title, format: m.format, seasonYear: m.seasonYear })) };
  const nameStats = await enrichKoreanNames([root], signal);
  onNamesResolved?.(nameStats);
  checkAbort(signal);
  return root;
}
/** Resolve all unknown people + titles together before synchronous fallback normalisation. */
export async function enrichKoreanNames(anime: readonly AnimeRecord[], signal?: AbortSignal) {
  const queries: KoreanNameQuery[] = [];
  for (const a of anime) {
    for(const m of [a,...(a.franchise?.members??[])]) if (!koTitleFor(m.id,m.title)) queries.push({kind:'anime',id:m.id,native:m.title.native,full:m.title.romaji});
    for (const c of a.fullCastPool ?? a.cast) {
      const people = [{kind:'character' as const,person:c.character}, {kind:'voiceActor' as const,person:c.voiceActor}, ...(c.subVoiceActors??[]).map(s=>({kind:'voiceActor' as const,person:s.voiceActor}))];
      for (const {kind,person:p} of people) {
        if (p && !curatedKoreanName(p.name,{kind,id:p.id})) queries.push({kind,id:p.id,native:p.name.native,full:p.name.full});
      }
    }
  }
  const stats = await resolveKoreanNames(queries,signal);
  for (const a of anime) {
    for(const m of [a,...(a.franchise?.members??[])]) m.title.ko ??= koTitleFor(m.id,m.title);
    for (const c of a.fullCastPool ?? a.cast) {
      c.character.name = ensureKoName(c.character.name,{kind:'character',id:c.character.id});
      if(c.voiceActor)c.voiceActor.name = ensureKoName(c.voiceActor.name,{kind:'voiceActor',id:c.voiceActor.id});
      for(const sub of c.subVoiceActors??[])sub.voiceActor.name=ensureKoName(sub.voiceActor.name,{kind:'voiceActor',id:sub.voiceActor.id});
    }
  }
  return stats;
}
async function resolveRoot(id: number, signal: AbortSignal): Promise<number> {
  const known = roots.get(id); if (known) return known;
  return rootMemo(String(id), async transport => {
    const members = await traverse([id], 3, transport);
    const rootId = members[0]?.id ?? id;
    // Cache only the requested member: a shallow walk may not discover a distant member's true root.
    roots.set(id, rootId); return rootId;
  }, signal);
}
export async function resolveRoots(ids: number[], signal: AbortSignal = new AbortController().signal): Promise<Map<number, number>> {
  checkAbort(signal);
  return new Map(await Promise.all([...new Set(ids)].map(async id => [id, await resolveRoot(id, signal)] as const)));
}
const localIndex = new Map<number, string[]>();
for (const t of [...KO_TITLES_AUTO, ...KO_TITLES]) localIndex.set(t.id, [t.ko, ...t.aliases]);
for (const a of PRESET_ANIME) for (const m of [a, ...(a.franchise?.members ?? [])]) {
  localIndex.set(m.id, [...(localIndex.get(m.id) ?? []), ...Object.values(m.title).filter((s): s is string => Boolean(s))]);
}
// Normalize candidates once; keystrokes only normalize the query and compare strings.
const searchKey = (value: string) => normalizeKey(value).replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
const compileKeys = (keys: string[]) => ({ keys: keys.map(searchKey), initials: keys.map(chosung) });
function indexedTier(q: string, initial: string | null, entry: ReturnType<typeof compileKeys>): number {
  let tier = 4;
  for (const key of entry.keys) {
    if (key === q) return 0;
    if (tier > 1 && key.startsWith(q)) tier = 1;
    else if (tier > 2 && key.includes(q)) tier = 2;
  }
  if (tier === 4 && initial) for (const key of entry.initials) if (key.includes(initial)) return 3;
  return tier;
}
const initialQuery = (query: string) => /^[ㄱ-ㅎ\u1100-\u1112\s]+$/.test(query) ? chosung(query) : null;
const localSearchIndex = [...localIndex].map(([id, keys]) => ({ id, ...compileKeys(keys) }));
/** Pure lookup, exported so offline checks can verify aliases without an HTTP mock. */
export function localAnimeHits(query: string): number[] {
  const q = searchKey(query), initial = initialQuery(query);
  if (!q) return [];
  const tiers: number[][] = [[], [], [], []];
  for (const entry of localSearchIndex) {
    const tier = indexedTier(q, initial, entry);
    if (tier < 4) tiers[tier]!.push(entry.id);
  }
  return tiers.flat();
}
// Card fields + the top six MAIN characters (preview modal) only — no studios/genres, no relation walks.
const searchFields = `${cardFields} characters(role:MAIN,perPage:6,sort:[ROLE,FAVOURITES_DESC]){edges{role node{${personFields} favourites} voiceActorRoles(language:JAPANESE,sort:[RELEVANCE,ID]){roleNotes dubGroup voiceActor{${personFields}}}}}`;
async function directSearch(search: string, signal: AbortSignal): Promise<SearchMedia[]> {
  const data = await pacedRequest<{ Page: { media: SearchMedia[] } }>(`query($search:String!){Page(perPage:16){media(search:$search,${filters},sort:[SEARCH_MATCH,POPULARITY_DESC]){${searchFields}}}}`, { search }, signal, true);
  return (data.Page?.media ?? []).filter(isMainline);
}
/** Local Korean alias hits in one lean request (ids are verified canonical roots). */
async function mediaByIds(ids: readonly number[], signal: AbortSignal): Promise<SearchMedia[]> {
  const data = await pacedRequest<{ Page: { media: SearchMedia[] } }>(`{Page(page:1,perPage:50){media(id_in:[${ids.join(',')}],type:ANIME){${searchFields}}}}`, {}, signal, true);
  return (data.Page?.media ?? []).filter(isMainline);
}
/**
 * Franchise collapse inside ONE result set, no network: a member of an already-loaded record maps to it; otherwise
 * in-set PREQUEL/SEQUEL/PARENT links group media and the earliest release represents the group.
 * ponytail: a sequel whose prequel is absent from the set stays its own row; getAnime() still resolves the true root.
 */
function collapse(media: readonly LinkedMedia[]): Map<number, AnimeSummary> {
  const parent = new Map(media.map(m => [m.id, m.id]));
  const find = (id: number): number => { while (parent.get(id) !== id) id = parent.get(id)!; return id; };
  for (const m of media) for (const e of m.relations?.edges ?? []) {
    if (relationTypes.has(e.relationType) && parent.has(e.node.id)) parent.set(find(m.id), find(e.node.id));
  }
  const groups = new Map<number, LinkedMedia[]>();
  for (const m of media) { const root = find(m.id); groups.set(root, [...(groups.get(root) ?? []), m]); }
  const out = new Map<number, AnimeSummary>();
  for (const group of groups.values()) {
    const known = group.map(m => roots.get(m.id) ?? m.id).find(id => records.has(id));
    const anime = known !== undefined ? summaryFromPreset(records.get(known)!) : summary([...group].sort(releaseOrder)[0]!);
    for (const m of group) out.set(m.id, anime);
  }
  return out;
}
/** Search rows carry six MAIN characters; the preview modal shows them while the full record loads. */
const previews = new Map<number, AnimeRecord>();
/** Synchronous Korean labels for a freshly parsed pool (curated → cached → transliterated; no Wikidata). */
function localNames(pool: CastEntry[]): CastEntry[] {
  for (const c of pool) {
    c.character.name = ensureKoName(c.character.name, { kind: 'character', id: c.character.id });
    if (c.voiceActor) c.voiceActor.name = ensureKoName(c.voiceActor.name, { kind: 'voiceActor', id: c.voiceActor.id });
    for (const sub of c.subVoiceActors ?? []) sub.voiceActor.name = ensureKoName(sub.voiceActor.name, { kind: 'voiceActor', id: sub.voiceActor.id });
  }
  return pool;
}
function rememberPreview(anime: AnimeSummary, m: SearchMedia): void {
  if (records.has(anime.id) || !m.characters?.edges.length) return;
  const pool = localNames(record({ ...m, relations: undefined, c1: m.characters, c2: null }).fullCastPool!);
  previews.set(anime.id, { ...anime, cast: pool, fullCastPool: pool });
}
/** Media per shallow request. Summary + two 25-character cast pages cost ≈60 AniList complexity points each:
 * 4 media fit the 500 cap, 8 are rejected outright (measured: HTTP 400 "Max query complexity"). */
export const SHALLOW_BATCH = 4;
/**
 * Shared-link boot: requested id → record for every id it can load. Explicit ids, so no search filters; records
 * cover the requested media only (no franchise walk, no Wikidata) as a fast first frame — getAnime() later
 * supplies the franchise-merged record. Already-loaded / preset ids resolve locally. Batches run independently;
 * a failed batch (complexity, a 404 on one alias fails the whole GraphQL request) is retried one id at a time,
 * so one bad id never takes its neighbours down. Ids that still fail are simply absent from the map.
 */
export async function getAnimeShallow(ids: readonly number[], signal: AbortSignal = new AbortController().signal): Promise<Map<number, AnimeRecord>> {
  const out = new Map<number, AnimeRecord>();
  for (const id of ids) { const known = records.get(id); if (known) out.set(id, known); }
  const load = async (group: readonly number[]) => {
    const data = await pacedRequest<Record<string, Media | null>>(
      `{${group.map((id, j) => `k${j}: Media(id:${id},type:ANIME){${summaryFields} ${castPage(1)} ${castPage(2)}}`).join('\n')}}`, {}, signal);
    group.forEach((id, j) => { const m = data[`k${j}`]; if (m) { const r = record(m); localNames(r.fullCastPool!); out.set(id, r); } });
  };
  const rethrowAbort = (error: unknown) => { if (isAbort(error) && signal.aborted) throw error; };
  const missing = [...new Set(ids)].filter(id => !out.has(id));
  const groups: number[][] = [];
  for (let i = 0; i < missing.length; i += SHALLOW_BATCH) groups.push(missing.slice(i, i + SHALLOW_BATCH));
  await Promise.all(groups.map(group => load(group).catch(error => {
    rethrowAbort(error);
    if (group.length > 1) return Promise.all(group.map(id => load([id]).catch(rethrowAbort)));
  })));
  return out;
}
interface WikiEntity { labels?: Record<string, { value: string }>; claims?: Record<string, { mainsnak: { datavalue?: { value: unknown } } }[]> }
const wikiMemo = memo<Record<string, unknown>>('wiki');
function wiki(params: Record<string,string>, signal: AbortSignal): Promise<Record<string, unknown>> {
  return wikiMemo(JSON.stringify(params), async transport => {
  const response = await fetch(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ ...params, format:'json', origin:'*' })}`, { signal: transport });
  if (!response.ok) throw new Error(`Wikidata HTTP ${response.status}`);
  return response.json();
  }, signal);
}
/** P8729 verified live: Wikidata's “AniList anime ID” property. */
export function wikidataBridge(query: string, signal?: AbortSignal): Promise<MediaSummary[]> {
  return bridgeMemo(query, async transport => {
    const timeout = new AbortController(); const timer = setTimeout(() => timeout.abort(), 4000);
    const combined = AbortSignal.any([transport, timeout.signal]);
    try {
      const found = await wiki({ action:'wbsearchentities',search:query,language:'ko',uselang:'ko',type:'item',limit:'8' }, combined);
      const hits = (found.search as { id: string; description?: string }[] ?? []).filter(e =>
        /anime|animated|television series|애니메이션|アニメ/i.test(e.description ?? '') && !/manga|novel|game|만화|소설|게임|漫画|小説/i.test(e.description ?? ''));
      if (!hits.length) return [];
      const data = await wiki({action:'wbgetentities',ids:hits.map(h=>h.id).join('|'),props:'labels|claims',languages:'en|ja'},combined);
      const media = await Promise.all(Object.values(data.entities as Record<string,WikiEntity>).map(async (e): Promise<MediaSummary[]> => {
        const id = Number(e.claims?.P8729?.[0]?.mainsnak.datavalue?.value);
        if (Number.isSafeInteger(id) && id > 0) { const m = await raw(id, combined); return isMainline(m) ? [m] : []; }
        const label = e.labels?.en?.value ?? e.labels?.ja?.value;
        return label ? directSearch(label, combined) : [];
      }));
      return media.flat();
    } catch (error) { checkAbort(transport); if (isAbort(error) && !timeout.signal.aborted) throw error; return []; }
    finally { clearTimeout(timer); }
  }, signal);
}
function summaryFromPreset({ cast: _cast, fullCastPool: _pool, ...anime }: AnimeRecord): AnimeSummary { return anime; }
const presetSearchIndex = PRESET_ANIME.map(anime => {
  const titles = Object.values(anime.title).filter((s): s is string => Boolean(s));
  const aliases = [anime.id, ...(anime.franchise?.members.map(m => m.id) ?? [])].flatMap(id => localIndex.get(id) ?? []);
  return { anime: summaryFromPreset(anime), titles: compileKeys(titles), all: compileKeys([...titles, ...aliases]) };
}).sort((a, b) => (b.anime.popularity ?? 0) - (a.anime.popularity ?? 0));
export function localPresetSearch(query: string): AnimeSummary[] {
  const q = searchKey(query), initial = initialQuery(query);
  if (!q) return [];
  const tiers: AnimeSummary[][] = [[], [], [], [], []];
  for (const entry of presetSearchIndex) if (indexedTier(q, initial, entry.all) <= 3) {
    tiers[indexedTier(q, initial, entry.titles)]!.push(entry.anime);
  }
  return tiers.flat().slice(0, 10);
}
const offlineSearch = localPresetSearch;

/* ------------------------------------------------------------------ */
/* Voice actor (성우) search                                            */
/* ------------------------------------------------------------------ */
const swap = (full: string) => full.split(/\s+/).reverse().join(' ');
/** Local layer: the curated popular-seiyuu dictionary first (fan ranking order), then every VA in the presets.
 * Built on the first 성우 search, not at startup. */
let seiyuuCache: { va: VoiceActorRecord; keys: string[]; initials: string[] }[] | null = null;
const seiyuuIndex = () => (seiyuuCache ??= (() => {
  const byId = new Map<number, { va: VoiceActorRecord; keys: string[] }>();
  for (const s of KO_SEIYUU) byId.set(s.id, { va: { id: s.id, name: { full: s.full, native: s.native, ko: s.ko }, image: s.image },
    keys: [s.ko, s.alt ?? '', s.full, swap(s.full), s.native, transliterateName(s.full, s.native)] });
  for (const a of PRESET_ANIME) for (const c of a.fullCastPool ?? a.cast) {
    const va = c.voiceActor;
    if (va && !byId.has(va.id)) byId.set(va.id, { va, keys: [va.name.ko ?? '', va.name.full, swap(va.name.full), va.name.native ?? ''] });
  }
  return [...byId.values()].map(e => ({ va: e.va, ...compileKeys(e.keys.filter(Boolean)) }));
})());
export function localSeiyuuSearch(query: string): VoiceActorRecord[] {
  const q = searchKey(query), initial = initialQuery(query);
  if (!q) return [];
  const tiers: VoiceActorRecord[][] = [[], [], [], []];
  for (const entry of seiyuuIndex()) { const tier = indexedTier(q, initial, entry); if (tier < 4) tiers[tier]!.push(entry.va); }
  return tiers.flat().slice(0, 10);
}
const staffMemo = memo<VoiceActorRecord[]>('staffSearch');
const staffFields = `${personFields} languageV2 primaryOccupations`;
const isSeiyuu = (s: StaffHit) => s.languageV2 === 'Japanese' && !(s.primaryOccupations?.length && !s.primaryOccupations.some(o => /voice|声優/i.test(o)));
const toVoiceActor = (s: StaffHit): VoiceActorRecord => person(s, 'voiceActor');
async function staffByName(search: string, signal: AbortSignal): Promise<VoiceActorRecord[]> {
  const data = await pacedRequest<{ Page: { staff: StaffHit[] } }>(`query($search:String!){Page(perPage:10){staff(search:$search,sort:[FAVOURITES_DESC,SEARCH_MATCH]){${staffFields}}}}`, { search }, signal, true);
  return (data.Page?.staff ?? []).filter(isSeiyuu).map(toVoiceActor);
}
/** Korean label → Wikidata person → AniList staff id (P11227) → AniList. Catches NIKL spellings (가지 유키). */
async function wikidataStaff(query: string, signal: AbortSignal): Promise<VoiceActorRecord[]> {
  const found = await wiki({ action:'wbsearchentities',search:query,language:'ko',uselang:'ko',type:'item',limit:'6' }, signal);
  const hits = (found.search as { id: string; description?: string }[] ?? []).filter(e => /성우|voice act|声優|seiyuu|actress|actor|singer/i.test(e.description ?? ''));
  if (!hits.length) return [];
  const data = await wiki({ action:'wbgetentities',ids:hits.map(h=>h.id).join('|'),props:'claims' }, signal);
  const ids = Object.values(data.entities as Record<string, WikiEntity>).map(e => Number(e.claims?.P11227?.[0]?.mainsnak.datavalue?.value)).filter(id => Number.isSafeInteger(id) && id > 0);
  if (!ids.length) return [];
  const staff = await pacedRequest<{ Page: { staff: StaffHit[] } }>(`{Page(page:1,perPage:50){staff(id_in:[${ids.join(',')}]){${staffFields}}}}`, {}, signal, true);
  return (staff.Page?.staff ?? []).filter(isSeiyuu).map(toVoiceActor);
}
/**
 * 성우 검색. Latin / kana / kanji → AniList staff search. Hangul → the local dictionary (rendered instantly by the
 * caller via localSeiyuuSearch) plus, in parallel, Wikidata's Korean labels and an AniList search on the romanised
 * query. Local hits lead; live hits refresh their portraits. Cached per query; offline → local layer only.
 */
export async function searchVoiceActors(query: string, signal?: AbortSignal): Promise<VoiceActorRecord[]> {
  checkAbort(signal); const search = query.trim(); if (!normalizeKey(search)) return [];
  const local = localSeiyuuSearch(search);
  try {
    const live = await staffMemo(search, async transport => {
      const quiet = (job: Promise<VoiceActorRecord[]>) => job.catch((error: unknown) => { if (isAbort(error) && transport.aborted) throw error; return [] as VoiceActorRecord[]; });
      const lists = isHangul(search)
        ? await Promise.all([quiet(wikidataStaff(search, transport)), quiet(staffByName(hangulToRomaji(search), transport))])
        : [await staffByName(search, transport)];
      return lists.flat();
    }, signal);
    const byId = new Map(local.map(va => [va.id, va]));
    for (const va of live) { const known = byId.get(va.id); byId.set(va.id, known ? { ...known, image: va.image || known.image } : va); }
    return [...byId.values()].slice(0, 12);
  } catch (error) { checkAbort(signal); if (isAbort(error)) throw error; return local; }
}
function fallbackFilm(vaId: number): FilmographyEntry[] {
  return PRESET_ANIME.flatMap(a => (a.fullCastPool ?? a.cast).filter(c => c.voiceActor?.id === vaId).map(c => ({ anime:summaryFromPreset(a), character:c.character, role:c.role })));
}
/** Background Wikidata pass for filmography labels the synchronous layer could only transliterate. Patches the
 * (cached) entries in place; resolves true when any label changed so the caller can re-render. */
export async function refineFilmographyNames(entries: readonly FilmographyEntry[], signal?: AbortSignal): Promise<boolean> {
  const queries: KoreanNameQuery[] = [];
  for (const { anime, character: c } of entries) {
    if (!koTitleFor(anime.id, anime.title)) queries.push({ kind: 'anime', id: anime.id, native: anime.title.native, full: anime.title.romaji });
    if (!curatedKoreanName({ full: c.name.full, native: c.name.native }, { kind: 'character', id: c.id })) queries.push({ kind: 'character', id: c.id, native: c.name.native, full: c.name.full });
  }
  const { hits } = await resolveKoreanNames(queries, signal);
  if (!hits || signal?.aborted) return false;
  for (const { anime, character: c } of entries) {
    anime.title.ko ??= koTitleFor(anime.id, anime.title);
    c.name = ensureKoName({ full: c.name.full, native: c.name.native }, { kind: 'character', id: c.id });
  }
  return true;
}
export const anilistDataSource: AnimeDataSource = {
  presets: PRESET_ANIME,
  async getAnime(id, signal) {
    checkAbort(signal);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Invalid anime id ${id}`);
    if (records.has(id)) return records.get(id)!;
    return animeMemo(String(id), async transport => {
      const loaded = await loadFranchise(id, transport);
      const shared = records.get(loaded.id) ?? loaded;
      for (const member of loaded.franchise?.members.map(m=>m.id) ?? [loaded.id]) { records.set(member,shared); roots.set(member,shared.id); }
      return shared;
    }, signal);
  },
  async searchAnime(query, signal, onPartial) {
    checkAbort(signal); const search = query.trim(); if (!normalizeKey(search)) return [];
    try {
      return await searchMemo(search, async transport => {
        // Kana/kanji/Latin queries deliberately use AniList directly; the local layer is Korean only.
        const localIds = isHangul(search) ? localAnimeHits(search).slice(0,10) : [];
        const safe = async (job: Promise<MediaSummary[]>) => { try { return await job; } catch(error) { if(isAbort(error)) throw error; return []; } };
        // Wikidata starts alongside AniList (never after it) and only for Hangul the alias index barely covers;
        // it is cancelled as soon as the fast layers alone fill the dropdown.
        const unneeded = new AbortController();
        const bridge = isHangul(search) && localIds.length < 3
          ? wikidataBridge(search,AbortSignal.any([transport,unneeded.signal])).catch((): MediaSummary[] => []) : null;
        const [local,direct] = await Promise.all([safe(localIds.length ? mediaByIds(localIds,transport) : Promise.resolve([])),safe(directSearch(search,transport))]);
        const rows = (found: readonly MediaSummary[]): AnimeSummary[] => {
          const all = [...new Map(found.map(m=>[m.id,m as SearchMedia])).values()];
          const canonical = collapse(all);
          const groups = new Map<number,{anime:AnimeSummary;members:SearchMedia[]}>();
          for (const m of all) { const anime = canonical.get(m.id)!; (groups.get(anime.id) ?? groups.set(anime.id,{anime,members:[]}).get(anime.id)!).members.push(m); }
          const titles = (t: MediaSummary['title'] | AnimeSummary['title']) => Object.values(t).filter((s):s is string=>Boolean(s));
          const rank = ({anime,members}: {anime:AnimeSummary;members:SearchMedia[]}): [number,number,number] => [
            matchTier(search,[...titles(anime.title),...members.flatMap(m=>[...titles(m.title),...(m.synonyms??[]),...(localIndex.get(m.id)??[])])]),
            members.some(m=>localIds.includes(m.id)) ? 0 : 1, -Math.max(anime.popularity??0,...members.map(m=>m.popularity??0))];
          const ranked = [...groups.values()].map(g=>({g,r:rank(g)})).sort((a,b)=>a.r[0]-b.r[0]||a.r[1]-b.r[1]||a.r[2]-b.r[2]).slice(0,10);
          for (const {g} of ranked) rememberPreview(g.anime, g.members.find(m=>m.id===g.anime.id) ?? g.members[0]!);
          return ranked.map(({g})=>g.anime);
        };
        const found: MediaSummary[] = [...local,...direct];
        // Enough rows already: show them; a slow bridge only adds rows when the fast layers came up short.
        if (bridge && new Set(collapse(found as SearchMedia[]).values()).size < 3) {
          if (found.length) onPartial?.(rows(found));
          found.push(...await bridge);
        } else unneeded.abort();
        if (!found.length) throw new Error('No live search results');
        return rows(found);
      }, signal);
    } catch (error) { checkAbort(signal); if(isAbort(error)) throw error; return offlineSearch(search); }
  },
  peekAnime(id) { return records.get(id) ?? previews.get(id); },
  getAnimeShallow,
  searchVoiceActors,
  peekVoiceActorFilmography(voiceActorId) { return filmMemo.peek(String(voiceActorId)); },
  refineFilmographyNames,
  async getVoiceActorFilmography(voiceActorId, signal) {
    checkAbort(signal);
    try {
      return await filmMemo(String(voiceActorId), async transport => {
        // ONE lean round trip. Franchise collapse and Korean labels are local/synchronous; uncached Wikidata labels
        // are patched afterwards by refineFilmographyNames, never awaited here.
        // AniList caps a connection page at 25: two aliased pages give the 50 most popular credits in one request.
        const page = (n: number) => `p${n}: characterMedia(sort:[POPULARITY_DESC],page:${n},perPage:25){edges{characterRole node{${cardFields}} characters{${personFields}}}}`;
        const data = await pacedRequest<FilmResponse>(`query($id:Int!){Staff(id:$id){${page(1)} ${page(2)}}}`,{id:voiceActorId},transport);
        const edges = [...(data.Staff?.p1?.edges ?? []), ...(data.Staff?.p2?.edges ?? [])].filter(e=>isMainline(e.node));
        const canonical = collapse([...new Map(edges.map(e=>[e.node.id,e.node])).values()]);
        const merged = new Map<string,FilmographyEntry>();
        for(const e of edges) for(const c of e.characters) {
          const anime=canonical.get(e.node.id)!; const key=`${anime.id}:${c.id}`; const old=merged.get(key);
          if(!old||roleOrder[e.characterRole]<roleOrder[old.role]) merged.set(key,{anime,character:person(c),role:e.characterRole});
        }
        return [...merged.values()];
      },signal);
    } catch(error) { checkAbort(signal);if(isAbort(error))throw error;return fallbackFilm(voiceActorId); }
  },
  async getRecommendations(vaId, excludeAnimeIds, signal) {
    checkAbort(signal);const excluded=new Set(excludeAnimeIds);
    const film=await anilistDataSource.getVoiceActorFilmography(vaId,signal);
    for (const id of excludeAnimeIds) excluded.add(roots.get(id) ?? id);
    const selected=new Map<number,FilmographyEntry>();
    const mainline=(e: FilmographyEntry)=>e.role==='MAIN'&&e.anime.format!==undefined&&MAINLINE_FORMATS.includes(e.anime.format);
    for(const e of film.filter(mainline).sort((a,b)=>(b.anime.popularity??0)-(a.anime.popularity??0))) {
      const ids=e.anime.franchise?.members.map(m=>m.id)??[e.anime.id];
      if(!excluded.has(e.anime.id)&&!ids.some(id=>excluded.has(id))&&!selected.has(e.anime.id))selected.set(e.anime.id,e);
    }
    return [...selected.values()].slice(0,5);
  },
};
