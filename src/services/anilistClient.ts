import type { AnimeDataSource, AnimeFormat, AnimeRecord, AnimeSummary, CastEntry, CharacterRole, FilmographyEntry } from '../types/contract';
import { DISPLAY_CAST } from '../types/contract';
import type { RankedCastEntry } from './franchise';
import { PRESET_ANIME } from '../data/presetAnime';
import { KO_TITLES } from '../data/koreanTitles';
import { normalizeAccent } from './accent';
import { chosung, ensureKoName, isHangul, koTitleFor, matchTier, normalizeKey } from './localize';
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
interface FilmResponse { Staff: { characterMedia: { edges: { characterRole: CharacterRole; node: Media; characters: Person[] }[] } | null } | null }
interface Envelope<T> { data?: T; errors?: { message: string }[] }
interface Pending<T> { promise: Promise<T>; controller: AbortController; users: number }
interface BatchItem { id: number; signal: AbortSignal; resolve: (value: Media) => void; reject: (reason: unknown) => void }
const endpoint = 'https://graphql.anilist.co';
const palette = ['#e4a15d', '#71b7db', '#b49be8', '#e982a0', '#78c6a3'];
const summaryFields = `id type format status isAdult popularity duration synonyms genres studios(isMain:true){nodes{name}}
  startDate {year month day} title {romaji english native} coverImage {large color} seasonYear`;
const personFields = 'id name { full native } image { large }';
const relationFields = `relations {edges {relationType node {id type format status isAdult popularity duration}}}`;
// Relations are batched cheaply. Deep casts are fetched one media per request (two aliases).
const mediaFields = `${summaryFields} ${relationFields}`;
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
async function request<T>(query: string, variables: Record<string, string | number>, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; attempt <= 2; attempt++) {
    checkAbort(signal);
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }), signal });
    if (response.status === 429 && attempt < 2) {
      const retry = response.headers.get('Retry-After');
      const seconds = retry === null ? NaN : Number(retry);
      const retryMs = Number.isFinite(seconds) ? seconds * 1000 : retry ? Date.parse(retry) - Date.now() : 0;
      await delay(Math.max(750 * 2 ** attempt, Number.isFinite(retryMs) ? retryMs : 0), signal);
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
// Each subscriber cancels independently. Transport is cancelled only when nobody remains.
function memo<T>() {
  const cache = new Map<string, T>();
  const pending = new Map<string, Pending<T>>();
  return (key: string, load: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (signal?.aborted) return Promise.reject(abortError());
    if (cache.has(key)) return Promise.resolve(cache.get(key)!);
    let task = pending.get(key);
    if (!task || task.controller.signal.aborted) {
      const controller = new AbortController();
      const created: Pending<T> = { controller, users: 0, promise: Promise.resolve().then(() => load(controller.signal)) };
      created.promise = created.promise.then(value => { checkAbort(controller.signal); cache.set(key, value); return value; }).finally(() => {
        if (pending.get(key) === created) pending.delete(key);
      });
      pending.set(key, created); task = created;
    }
    const shared = task;
    shared.users++;
    return new Promise<T>((resolve, reject) => {
      let done = false;
      const finish = () => {
        if (done) return false;
        done = true; signal?.removeEventListener('abort', onAbort);
        if (--shared.users === 0) shared.controller.abort();
        return true;
      };
      const onAbort = () => { if (finish()) reject(abortError()); };
      signal?.addEventListener('abort', onAbort, { once: true });
      shared.promise.then(value => { if (finish()) resolve(value); }, error => { if (finish()) reject(error); });
    });
  };
}
const rawMemo = memo<Media>(), animeMemo = memo<AnimeRecord>(), searchMemo = memo<AnimeSummary[]>(), filmMemo = memo<FilmographyEntry[]>();
const rootMemo = memo<number>(), bridgeMemo = memo<MediaSummary[]>(), castMemo = memo<Pick<Media, 'c1' | 'c2'>>();
let batch: BatchItem[] = [], scheduled = false;
let nextRequest = 0;
// All live calls, including generation scripts, leave at least 750ms between starts.
async function pacedRequest<T>(query: string, variables: Record<string, string | number>, signal: AbortSignal): Promise<T> {
  const at = Math.max(Date.now(), nextRequest); nextRequest = at + 750;
  if (at > Date.now()) await delay(at - Date.now(), signal);
  return request<T>(query, variables, signal);
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
  // ≤5 members: both 25-character pages each. Larger series: both pages for the
  // first four releases, page 1 for the rest. Never batch deep casts across media.
  const castMembers: AnimeRecord[] = [];
  for (const [index, member] of members.entries()) {
    const pages = members.length <= 5 || index < 4 ? 2 : 1;
    const cast = await castMemo(`${member.id}:${pages}`, async transport => {
      const data = await pacedRequest<{ Media: Pick<Media, 'c1' | 'c2'> | null }>(`query($id:Int!){Media(id:$id,type:ANIME){${castPage(1)} ${pages === 2 ? castPage(2) : ''}}}`, { id: member.id }, transport);
      if (!data.Media) throw new Error(`Anime ${member.id} was not found`);
      return data.Media;
    }, signal);
    castMembers.push(record({ ...member, ...cast }));
  }
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
for (const t of KO_TITLES) localIndex.set(t.id, [t.ko, ...t.aliases]);
for (const a of PRESET_ANIME) for (const m of [a, ...(a.franchise?.members ?? [])]) {
  localIndex.set(m.id, [...(localIndex.get(m.id) ?? []), ...Object.values(m.title).filter((s): s is string => Boolean(s))]);
}
const localSearchIndex = [...localIndex].map(([id, keys]) => ({ id, keys: keys.map(normalizeKey), initials: keys.map(chosung) }));
/** Pure lookup, exported so offline checks can verify aliases without an HTTP mock. */
export function localAnimeHits(query: string): number[] {
  const q = normalizeKey(query), initial = chosung(query);
  if (!q) return [];
  const onlyInitials = /^[ㄱ-ㅎ\u1100-\u1112\s]+$/.test(query);
  return localSearchIndex.map(entry => ({ id: entry.id, tier: entry.keys.some(k=>k===q) ? 0
    : entry.keys.some(k=>k.startsWith(q)) ? 1 : entry.keys.some(k=>k.includes(q)) ? 2
    : onlyInitials && entry.initials.some(k=>k.includes(initial)) ? 3 : 4 }))
    .filter(e=>e.tier<=3).sort((a,b)=>a.tier-b.tier).map(e=>e.id);
}
async function directSearch(search: string, signal: AbortSignal): Promise<MediaSummary[]> {
  const data = await pacedRequest<{ Page: { media: MediaSummary[] } }>(`query($search:String!){Page(perPage:16){media(search:$search,${filters},sort:[SEARCH_MATCH,POPULARITY_DESC]){${summaryFields}}}}`, { search }, signal);
  return (data.Page?.media ?? []).filter(isMainline);
}
interface WikiEntity { labels?: Record<string, { value: string }>; claims?: Record<string, { mainsnak: { datavalue?: { value: unknown } } }[]> }
async function wiki(params: Record<string,string>, signal: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ ...params, format:'json', origin:'*' })}`, { signal });
  if (!response.ok) throw new Error(`Wikidata HTTP ${response.status}`);
  return response.json();
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
      const result: MediaSummary[] = [];
      for (const e of Object.values(data.entities as Record<string,WikiEntity>)) {
        const id = Number(e.claims?.P8729?.[0]?.mainsnak.datavalue?.value);
        if (Number.isSafeInteger(id) && id > 0) { const m = await raw(id, combined); if (isMainline(m)) result.push(m); }
        else {
          const label = e.labels?.en?.value ?? e.labels?.ja?.value;
          if (label) result.push(...await directSearch(label, combined));
        }
      }
      return result;
    } catch (error) { checkAbort(transport); if (isAbort(error) && !timeout.signal.aborted) throw error; return []; }
    finally { clearTimeout(timer); }
  }, signal);
}
function summaryFromPreset({ cast: _cast, fullCastPool: _pool, ...anime }: AnimeRecord): AnimeSummary { return anime; }
const offlineSearch = (query: string) => PRESET_ANIME.filter(a => matchTier(query, [
  ...Object.values(a.title).filter((s): s is string => Boolean(s)),
  ...[a.id, ...(a.franchise?.members.map(m => m.id) ?? [])].flatMap(id => localIndex.get(id) ?? []),
]) <= 3).sort((a,b) => matchTier(query,Object.values(a.title).filter((s):s is string=>Boolean(s))) - matchTier(query,Object.values(b.title).filter((s):s is string=>Boolean(s))) || (b.popularity??0)-(a.popularity??0)).slice(0,10).map(summaryFromPreset);
function fallbackFilm(vaId: number): FilmographyEntry[] {
  return PRESET_ANIME.flatMap(a => (a.fullCastPool ?? a.cast).filter(c => c.voiceActor?.id === vaId).map(c => ({ anime:summaryFromPreset(a), character:c.character, role:c.role })));
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
  async searchAnime(query, signal) {
    checkAbort(signal); const search = query.trim(); if (!normalizeKey(search)) return [];
    try {
      return await searchMemo(search, async transport => {
        // Kana/kanji/Latin queries deliberately use AniList directly; the local layer is Korean only.
        const localIds = isHangul(search) ? localAnimeHits(search).slice(0,10) : [];
        const safe = async (job: Promise<MediaSummary[]>) => { try { return await job; } catch(error) { if(isAbort(error)) throw error; return []; } };
        const [local,direct] = await Promise.all([safe(Promise.all(localIds.map(id=>raw(id,transport))).then(ms=>ms.filter(isMainline))),safe(directSearch(search,transport))]);
        const all = new Map([...local,...direct].map(m=>[m.id,m]));
        if (isHangul(search) && all.size < 3) for (const m of await wikidataBridge(search,transport)) all.set(m.id,m);
        if (!all.size) throw new Error('No live search results');
        const rootMap = await resolveRoots([...all.keys()],transport);
        const rootIds = [...new Set(rootMap.values())];
        const summaries = await Promise.all(rootIds.map(async id => records.has(id) ? summaryFromPreset(records.get(id)!) : summary(await raw(id,transport))));
        const rank = (a: AnimeSummary): [number,number,number] => {
          const members = [...all.values()].filter(m=>rootMap.get(m.id)===a.id);
          const keys = [...Object.values(a.title).filter((s):s is string=>Boolean(s)),...members.flatMap(m=>[...Object.values(m.title).filter((s):s is string=>Boolean(s)),...(m.synonyms??[]),...(localIndex.get(m.id)??[])])];
          return [matchTier(search,keys), members.some(m=>localIds.includes(m.id)) ? 0 : 1,-Math.max(a.popularity??0,...members.map(m=>m.popularity??0))];
        };
        return summaries.sort((a,b)=>{const x=rank(a),y=rank(b);return x[0]-y[0]||x[1]-y[1]||x[2]-y[2];}).slice(0,10);
      }, signal);
    } catch (error) { checkAbort(signal); if(isAbort(error)) throw error; return offlineSearch(search); }
  },
  async getVoiceActorFilmography(voiceActorId, signal) {
    checkAbort(signal);
    try {
      return await filmMemo(String(voiceActorId), async transport => {
        const data = await pacedRequest<FilmResponse>(`query($id:Int!){Staff(id:$id){characterMedia(sort:[POPULARITY_DESC],perPage:50){edges{characterRole node{${summaryFields} ${relationFields}} characters{${personFields}}}}}}`,{id:voiceActorId},transport);
        const edges = (data.Staff?.characterMedia?.edges ?? []).filter(e=>isMainline(e.node));
        const rootMap = await resolveRoots(edges.map(e=>e.node.id),transport);
        const summaries = new Map(await Promise.all([...new Set(rootMap.values())].map(async id => [id,records.has(id)?summaryFromPreset(records.get(id)!):summary(await raw(id,transport))] as const)));
        const merged = new Map<string,FilmographyEntry>();
        for(const e of edges) for(const c of e.characters) {
          const id=rootMap.get(e.node.id)!; const key=`${id}:${c.id}`; const old=merged.get(key);
          const anime=summaries.get(id)!;
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
    for(const e of film.filter(e=>e.role==='MAIN').sort((a,b)=>(b.anime.popularity??0)-(a.anime.popularity??0))) {
      const ids=e.anime.franchise?.members.map(m=>m.id)??[e.anime.id];
      if(!excluded.has(e.anime.id)&&!ids.some(id=>excluded.has(id))&&!selected.has(e.anime.id))selected.set(e.anime.id,e);
    }
    return [...selected.values()].slice(0,5);
  },
};
