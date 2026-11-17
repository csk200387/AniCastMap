// Regenerates src/data/koreanTitlesAuto.ts: top-N AniList anime → Korean title from Wikidata (ko label, ko aliases,
// ko.wikipedia title) or a Hangul AniList synonym. No machine translation: no source → no entry.
// Run: npx tsx scripts/build-ko-titles.ts [N=1500]
import { writeFileSync } from 'node:fs';
import { KO_TITLES } from '../src/data/koreanTitles';

const N = Number(process.argv[2] ?? 1500);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const hangul = (s: string) => /\p{Script=Hangul}/u.test(s);
const clean = (s: string) => s.replace(/\s*\((?:애니메이션|애니|만화|TV 애니메이션|소설|라이트 노벨|영화|\d{4}년 애니메이션)[^)]*\)\s*$/u, '').trim();

async function post(url: string, init: RequestInit & { headers?: Record<string, string> }, tries = 8): Promise<any> {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) }).catch(() => null);
    if (!r) { await sleep(1500 * (i + 1)); continue; }
    if (r.ok) return r.json();
    if (r.status !== 429 && r.status < 500) throw new Error(`${url} HTTP ${r.status}`);
    await sleep(Math.max(2000, Number(r.headers.get('Retry-After') ?? 0) * 1000) + 2000 * i);
  }
  throw new Error(`${url} gave up`);
}

interface Media { id: number; synonyms: string[]; title: { native: string | null } }
const media: Media[] = [];
for (let page = 1; media.length < N; page++) {
  const q = `{Page(page:${page},perPage:50){media(type:ANIME,format_in:[TV,TV_SHORT,MOVIE,ONA],isAdult:false,sort:POPULARITY_DESC){id synonyms title{native}}}}`;
  const d = await post('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) });
  media.push(...d.data.Page.media);
  await sleep(800);
}
media.length = N;

const wd = new Map<number, { ko?: string; wp?: string; alts: string[] }>();
for (let i = 0; i < media.length; i += 80) {
  const ids = media.slice(i, i + 80).map(m => `"${m.id}"`).join(' ');
  const query = `SELECT ?id ?ko ?wp (GROUP_CONCAT(DISTINCT ?alt;separator="|") AS ?alts) WHERE { VALUES ?id { ${ids} } ?item wdt:P8729 ?id .
    OPTIONAL { ?item rdfs:label ?ko FILTER(LANG(?ko)="ko") }
    OPTIONAL { ?art schema:about ?item; schema:isPartOf <https://ko.wikipedia.org/>; schema:name ?wp }
    OPTIONAL { ?item skos:altLabel ?alt FILTER(LANG(?alt)="ko") } } GROUP BY ?id ?ko ?wp`;
  const d = await post('https://query.wikidata.org/sparql', { method: 'POST', body: new URLSearchParams({ query, format: 'json' }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json', 'User-Agent': 'ko-title-builder/1.0' } });
  for (const b of d.results.bindings) {
    const id = Number(b.id.value), prev = wd.get(id) ?? { alts: [] };
    wd.set(id, { ko: b.ko?.value ?? prev.ko, wp: b.wp?.value ?? prev.wp, alts: [...new Set([...prev.alts, ...(b.alts?.value ? b.alts.value.split('|') : [])])] });
  }
  await sleep(1200);
}

const curated = new Set(KO_TITLES.map(t => t.id));
// Fallback: ko.wikipedia full-text search on the Japanese title. A hit counts only when its intro contains that exact
// native title (so a song/album/other work that merely mentions it is rejected).
const SEASON = /\s*(第\s*\d+\s*(期|シーズン|クール)|Season\s*\d+|\d+(st|nd|rd|th)\s+Season|(Part|パート)\s*\d+|(Final|Final Season)).*$/i;
const squash = (s: string) => s.normalize('NFKC').replace(/[\s・･\-―ー~〜!！?？。、,.:：]/g, '');
const wp = new Map<number, string>();
const todo = media.filter(m => !curated.has(m.id) && !wd.get(m.id)?.ko && !wd.get(m.id)?.wp && !m.synonyms.some(hangul) && m.title.native && !SEASON.test(m.title.native));
async function lookup(m: Media): Promise<void> {
  const native = m.title.native!;
  const u = `https://ko.wikipedia.org/w/api.php?${new URLSearchParams({ action: 'query', generator: 'search', gsrsearch: `"${native}"`, gsrlimit: '4', prop: 'extracts', exintro: '1', explaintext: '1', exlimit: '4', exchars: '400', format: 'json', origin: '*' })}`;
  const d = await post(u, { headers: { 'User-Agent': 'ko-title-builder/1.0' } });
  const pages = Object.values(d.query?.pages ?? {}) as { title: string; index: number; extract?: string }[];
  const hit = pages.sort((a, b) => a.index - b.index).find(p =>
    squash(p.extract ?? '').includes(squash(native)) && /애니메이션|만화|라이트 노벨|웹툰|소설|게임/.test(p.extract ?? '') && !/\((?:노래|음반|앨범|싱글|영화|배우|성우)/.test(p.title));
  if (hit) wp.set(m.id, clean(hit.title));
}
// One request at a time, ~1/s: Wikimedia answers 429 (Retry-After 40s) to anything faster.
for (const [i, m] of todo.entries()) {
  await lookup(m).catch(() => {}); await sleep(1000);
  if (i % 50 === 0) console.log(`wikipedia ${i}/${todo.length}, ${wp.size} found`);
}

const out: { id: number; ko: string; aliases: string[] }[] = [];
for (const m of media) {
  if (curated.has(m.id)) continue;
  const w = wd.get(m.id);
  const cands = [w?.ko, w?.wp && clean(w.wp), wp.get(m.id), ...(w?.alts ?? []), ...m.synonyms].filter((s): s is string => !!s && hangul(s));
  const ko = cands[0];
  if (ko) out.push({ id: m.id, ko, aliases: [...new Set(cands.slice(1))].filter(a => a !== ko) });
}
const q = (s: string) => JSON.stringify(s).replace(/'/g, "\\'").replace(/^"|"$/g, "'");
writeFileSync(new URL('../src/data/koreanTitlesAuto.ts', import.meta.url),
  `// Generated by scripts/build-ko-titles.ts (Wikidata ko label/aliases, ko.wikipedia title, Hangul AniList synonyms). Do not edit.\n` +
  `export const KO_TITLES_AUTO: { id: number; ko: string; aliases: string[] }[] = [\n` +
  out.map(t => `  {id:${t.id},ko:${q(t.ko)},aliases:[${t.aliases.map(q).join(',')}]},`).join('\n') + `\n];\n`);
console.log(`top ${N}: ${out.length} new Korean titles (+${curated.size} curated); ${N - out.length - [...curated].filter(id => media.some(m => m.id === id)).length} without a Korean source`);
