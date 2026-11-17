import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { KO_TITLES } from '../src/data/koreanTitles';
import { KO_TITLES_AUTO } from '../src/data/koreanTitlesAuto';
import { PRESET_ANIME } from '../src/data/presetAnime';
import type { AnimeFormat } from '../src/types/contract';
import type { SearchRow } from '../src/data/searchIndex';

interface Media {
  id: number; type: string; format: AnimeFormat; status: string; isAdult: boolean; popularity: number; duration: number | null;
  title: { romaji: string | null; english: string | null; native: string | null }; synonyms?: string[];
  seasonYear: number | null; startDate: { year: number | null; month: number | null; day: number | null };
  coverImage: { medium: string | null };
  relations: { edges: { relationType: string; node: Pick<Media, 'id' | 'type' | 'format' | 'status' | 'isAdult' | 'popularity' | 'duration'> }[] };
}
// Mirror anilistClient.isMainline: importing the client would depend on this script's generated output.
function isMainline(m: Pick<Media, 'type' | 'format' | 'status' | 'popularity' | 'duration' | 'isAdult'>): boolean {
  return m.type === 'ANIME' && !m.isAdult && ['FINISHED', 'RELEASING'].includes(m.status)
    && (['TV', 'MOVIE', 'ONA'].includes(m.format) || (m.format === 'TV_SHORT' && m.popularity >= 25000))
    && !(m.duration && m.duration < 10 && m.format !== 'MOVIE');
}
const formats: AnimeFormat[] = ['TV', 'TV_SHORT', 'MOVIE', 'ONA'];
const cache = fileURLToPath(new URL('../node_modules/.cache/anicastmap/search/', import.meta.url));
mkdirSync(cache, { recursive: true });
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
let lastStart = -Infinity, pausedUntil = 0;
const FIELDS = 'id type format status isAdult popularity duration title{romaji english native} synonyms seasonYear';
const fetchBatch = (ids: number[]) => request(`{Page(perPage:50){media(id_in:[${ids.join(',')}],type:ANIME){${FIELDS} startDate{year month day} coverImage{medium} relations{edges{relationType node{id type format status isAdult popularity duration}}}}}}`);
async function request(query: string): Promise<Media[]> {
  const path = cache + createHash('sha256').update(query).digest('hex') + '.json';
  try { return JSON.parse(readFileSync(path, 'utf8')) as Media[]; } catch { /* Cache miss. */ }
  for (let attempt = 0; attempt < 5; attempt++) {
    await pause(Math.max(0, lastStart + 2100 - Date.now(), pausedUntil - Date.now()));
    lastStart = Date.now();
    const response = await fetch('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
    const reset = Number(response.headers.get('X-RateLimit-Reset')) * 1000;
    if (response.headers.get('X-RateLimit-Remaining') === '0' && reset > 0) pausedUntil = Math.max(pausedUntil, reset);
    if (response.status === 429) {
      const retry = response.headers.get('Retry-After');
      const retryMs = retry === null ? 0 : Number.isFinite(Number(retry)) ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
      pausedUntil = Math.max(pausedUntil, reset || 0, Date.now() + (Number.isFinite(retryMs) && retryMs > 0 ? retryMs : reset > Date.now() ? 0 : 60000));
      console.log(`429: waiting until ${new Date(pausedUntil).toISOString()}`);
      continue;
    }
    if (!response.ok) throw new Error(`AniList HTTP ${response.status}: ${await response.text()}`);
    const body = await response.json() as { data?: { Page: { media: Media[] } }; errors?: unknown };
    if (body.errors || !body.data) throw new Error(JSON.stringify(body.errors ?? 'Missing data'));
    writeFileSync(path, JSON.stringify(body.data.Page.media));
    return body.data.Page.media;
  }
  throw new Error('AniList rate limit retry budget exceeded');
}
const dictionaryIds = [...new Set([...KO_TITLES, ...KO_TITLES_AUTO].map(t => t.id))].sort((a, b) => a - b);
// Option A (D13): also AniList's most popular mainline anime, so a Korean query for a show outside the curated
// dictionaries still resolves locally. Korean titles for them come only from human-written sources (below).
const POPULAR = Number(process.env.POPULAR ?? 2200), popularIds: number[] = [];
for (let page = 1; popularIds.length < POPULAR; page++) {
  const rows = await request(`{Page(page:${page},perPage:50){media(type:ANIME,isAdult:false,status_in:[FINISHED,RELEASING],format_in:[TV,TV_SHORT,MOVIE,ONA],sort:POPULARITY_DESC){id type format status isAdult popularity duration}}}`);
  if (!rows.length) break;
  popularIds.push(...rows.filter(isMainline).map(m => m.id));
}
popularIds.splice(POPULAR);
const seedIds = new Set([...dictionaryIds, ...popularIds]);
const media = new Map<number, Media>(), requested = new Set<number>();
const links = new Set(['PREQUEL', 'SEQUEL', 'PARENT']);
let frontier = [...seedIds].sort((a, b) => a - b);
while (frontier.length) {
  const next = new Set<number>();
  for (let i = 0; i < frontier.length; i += 50) {
    const ids = frontier.slice(i, i + 50);
    ids.forEach(id => requested.add(id));
    for (const m of await fetchBatch(ids)) {
      media.set(m.id, m);
      for (const e of m.relations.edges) if (links.has(e.relationType) && isMainline(e.node) && !requested.has(e.node.id)) next.add(e.node.id);
    }
    console.log(`Fetched ${requested.size} ids; ${media.size} media; relation frontier ${next.size}`);
  }
  frontier = [...next].filter(id => !requested.has(id)).sort((a, b) => a - b);
}
const parent = new Map([...media.keys()].map(id => [id, id]));
const find = (id: number): number => {
  const p = parent.get(id)!;
  if (p !== id) parent.set(id, find(p));
  return parent.get(id)!;
};
for (const m of media.values()) for (const e of m.relations.edges) {
  if (links.has(e.relationType) && media.has(e.node.id) && isMainline(e.node)) parent.set(find(m.id), find(e.node.id));
}
// Presets are authoritative for both row identity and bundled-record reuse.
for (const a of PRESET_ANIME) for (const m of a.franchise?.members ?? []) {
  if (media.has(a.id) && media.has(m.id)) parent.set(find(m.id), find(a.id));
}
const groups = new Map<number, Media[]>();
for (const m of media.values()) { const key = find(m.id); groups.set(key, [...(groups.get(key) ?? []), m]); }
const release = (m: Media) => (m.startDate.year ?? m.seasonYear ?? 9999) * 10000 + (m.startDate.month ?? 12) * 100 + (m.startDate.day ?? 31);
// AniList's `medium` field currently returns /small/ URLs too; only the filename is stored.
const coverPath = /^https:\/\/s4\.anilist\.co\/file\/anilistcdn\/media\/anime\/cover\/(?:small|medium|large)\//;
// Extra Korean titles (option A), all human-written: Wikidata Korean labels by AniList ID (P8729, CC0), Korean synonyms
// in manami-project/anime-offline-database (ODbL 1.0), and AniList synonyms that contain Hangul.
const hangul = (t: string) => /[가-힣]/.test(t);
const extraKo = new Map<number, Set<string>>();
const addKo = (id: number, title: string) => { const t = title.trim(); if (t && hangul(t)) extraKo.set(id, (extraKo.get(id) ?? new Set()).add(t)); };
const sources = { wikidata: 0, offlineDatabase: 0, anilistSynonyms: 0 };
const wdPath = cache + 'wikidata-p8729-ko.json';
let wd: { results: { bindings: { id: { value: string }; ko: { value: string } }[] } };
try { wd = JSON.parse(readFileSync(wdPath, 'utf8')); } catch {
  const q = 'SELECT ?id ?ko WHERE { ?item wdt:P8729 ?id; rdfs:label ?ko . FILTER(LANG(?ko) = "ko") }';
  const r = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), { headers: { 'User-Agent': 'AniCastMap search-index build (https://anicastmap.vercel.app)' } });
  if (!r.ok) throw new Error(`Wikidata HTTP ${r.status}`);
  wd = await r.json() as typeof wd; writeFileSync(wdPath, JSON.stringify(wd));
}
for (const b of wd.results.bindings) { const id = Number(b.id.value); if (media.has(id)) { addKo(id, b.ko.value); sources.wikidata++; } }
const aodPath = cache + 'anime-offline-database-ko.json';
let aod: [number, string[]][];
try { aod = JSON.parse(readFileSync(aodPath, 'utf8')); } catch {
  const r = await fetch('https://github.com/manami-project/anime-offline-database/releases/latest/download/anime-offline-database-minified.json');
  if (!r.ok) throw new Error(`anime-offline-database HTTP ${r.status}`);
  const db = await r.json() as { data: { sources: string[]; synonyms: string[] }[] };
  aod = db.data.flatMap(e => { const id = e.sources.map(u => /^https:\/\/anilist\.co\/anime\/(\d+)$/.exec(u)?.[1]).find(Boolean); const ko = e.synonyms.filter(hangul); return id && ko.length ? [[Number(id), ko] as [number, string[]]] : []; });
  writeFileSync(aodPath, JSON.stringify(aod));
}
for (const [id, titles] of aod) if (media.has(id)) for (const t of titles) { addKo(id, t); sources.offlineDatabase++; }
for (const m of media.values()) for (const t of m.synonyms ?? []) if (hangul(t)) { addKo(m.id, t); sources.anilistSynonyms++; }
const dictionaryKo = new Set([...KO_TITLES, ...KO_TITLES_AUTO].map(t => t.ko));
const rows: SearchRow[] = [], placed = new Set<number>();
for (const group of groups.values()) {
  if (!group.some(m => seedIds.has(m.id))) continue;
  const preset = PRESET_ANIME.find(a => group.some(m => m.id === a.id));
  const root = preset ? media.get(preset.id)! : group.filter(isMainline).sort((a, b) => release(a) - release(b) || a.id - b.id)[0];
  if (!root) continue;
  const cover = root.coverImage.medium ?? '';
  if (cover && !coverPath.test(cover)) throw new Error(`Unexpected cover URL for ${root.id}: ${cover}`);
  const members = group.map(m => m.id).sort((a, b) => a - b);
  members.forEach(id => placed.add(id));
  rows.push([root.id, members.filter(id => id !== root.id), root.title.romaji ?? root.title.english ?? String(root.id),
    root.title.english === root.title.romaji ? '' : root.title.english, root.title.native,
    root.startDate.year ?? root.seasonYear, formats.indexOf(root.format), Math.max(...group.map(m => m.popularity)), cover.replace(coverPath, ''),
    [...new Set(group.flatMap(m => [...(extraKo.get(m.id) ?? [])]))].filter(t => !dictionaryKo.has(t))]);
}
rows.sort((a, b) => b[7] - a[7] || a[0] - b[0]);
const source = `/** Generated by scripts/build-search-index.ts. Curated Korean keys stay in koreanTitles / koreanTitlesAuto; "ko" holds
 * extra Korean titles from Wikidata (CC0), anime-offline-database (ODbL 1.0) and AniList synonyms.
 * Members omit the root id; empty English means identical to romaji. */\nimport type { AnimeFormat } from '../types/contract';\nexport const SEARCH_FORMATS: readonly AnimeFormat[] = ${JSON.stringify(formats)};\nexport type SearchRow = [id: number, members: number[], romaji: string, english: string | null, native: string | null, year: number | null, format: number, popularity: number, cover: string, ko: string[]];\nexport const SEARCH_ROWS: SearchRow[] = [\n${rows.map(row => JSON.stringify(row)).join(',\n')}\n];\n`;
if (gzipSync(source).length > 150000) throw new Error(`Search index exceeds 150 KB gzip: ${gzipSync(source).length} bytes`);
writeFileSync(fileURLToPath(new URL('../src/data/searchIndex.ts', import.meta.url)), source);
const unplaced = dictionaryIds.filter(id => !placed.has(id)).map(id => ({ id, reason: !media.has(id) ? 'AniList returned no anime for this id' : 'No aired mainline member in its PREQUEL / SEQUEL / PARENT component' }));
console.log(JSON.stringify({ dictionaryIds: dictionaryIds.length, popularIds: popularIds.length, koreanTitleSources: sources, rowsWithExtraKorean: rows.filter(r => r[9].length).length, rows: rows.length, rawBytes: Buffer.byteLength(source), gzipBytes: gzipSync(source).length, unplaced }, null, 2));
