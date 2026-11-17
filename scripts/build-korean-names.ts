/** Offline build input: Wikidata Korean labels + AniList names/occupations. No translation.
 * Responses are cached indefinitely; --refresh refetches, --offline only reads the cache.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { normalizeKoreanName } from '../src/services/localize';

// Worktrees may share a read-only node_modules symlink; allow a writable build cache there.
const cacheDir = process.env.ANICASTMAP_NAMES_CACHE
  ? pathToFileURL(process.env.ANICASTMAP_NAMES_CACHE.replace(/\/$/, '') + '/')
  : new URL('../node_modules/.cache/anicastmap/', import.meta.url);
const offline = process.argv.includes('--offline'), refresh = process.argv.includes('--refresh');
await mkdir(cacheDir, { recursive: true });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
let nextAniList = 0, nextWikidata = 0;
async function request<T>(service: 'anilist' | 'wikidata', query: string): Promise<T> {
  const file = new URL(`${service}-${createHash('sha256').update(query).digest('hex')}.json`, cacheDir);
  if (!refresh || offline) {
    try { return JSON.parse(await readFile(file, 'utf8')) as T; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  if (offline) throw new Error(`Missing offline cache: ${file.pathname}`);
  for (let attempt = 0; attempt < 6; attempt++) {
    await sleep((service === 'anilist' ? nextAniList : nextWikidata) - Date.now());
    if (service === 'anilist') nextAniList = Date.now() + 2100;
    else nextWikidata = Date.now() + 2100;
    const response = await fetch(service === 'anilist' ? 'https://graphql.anilist.co' :
      'https://query.wikidata.org/sparql?' + new URLSearchParams({ query, format: 'json' }), {
      ...(service === 'anilist' ? { method: 'POST', body: JSON.stringify({ query }) } : {}),
      headers: { 'Content-Type': 'application/json', Accept: service === 'anilist' ? 'application/json' : 'application/sparql-results+json',
        'User-Agent': 'AniCastMap/1.0 (offline Korean-name dictionary; Wikidata labels, no translation)' },
      signal: AbortSignal.timeout(120000),
    });
    if (response.status === 429 || response.status >= 500) {
      const reset = Number(response.headers.get('X-RateLimit-Reset')) * 1000;
      const retry = response.headers.get('Retry-After');
      const retryAt = retry ? (/^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : Date.parse(retry)) : 0;
      const until = Math.max(Date.now() + 5000 * (attempt + 1), reset || 0, retryAt || 0);
      if (service === 'anilist') nextAniList = Math.max(nextAniList, until);
      else nextWikidata = Math.max(nextWikidata, until);
      console.log(`${service} HTTP ${response.status}; retry after ${Math.ceil((until - Date.now()) / 1000)}s`);
      continue;
    }
    if (!response.ok) throw new Error(`${service} HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
    const data = await response.json() as T & { errors?: unknown };
    if (data.errors) throw new Error(`${service}: ${JSON.stringify(data.errors)}`);
    await writeFile(file, JSON.stringify(data) + '\n');
    return data;
  }
  throw new Error(`${service}: retry limit`);
}
interface Binding { item: { value: string }; id: { value: string }; ko: { value: string } }
async function labels(property: string): Promise<Map<number, string>> {
  const query = `SELECT DISTINCT ?item ?id ?ko WHERE { ?item wdt:${property} ?id; rdfs:label ?ko . FILTER(LANG(?ko) = "ko") }`;
  const data = await request<{ results: { bindings: Binding[] } }>('wikidata', query);
  const byId = new Map<number, Map<string, string>>();
  for (const row of data.results.bindings) {
    const id = Number(row.id.value);
    if (!Number.isSafeInteger(id) || id <= 0 || !/[가-힣]/.test(row.ko.value)) continue;
    const entries = byId.get(id) ?? new Map<string, string>();
    entries.set(row.item.value, row.ko.value); byId.set(id, entries);
  }
  const result = new Map([...byId].filter(([, entries]) => entries.size === 1).map(([id, entries]) => [id, [...entries.values()][0]!]));
  console.log(`${property}: ${result.size} Korean labels (${byId.size - result.size} ambiguous IDs excluded)`);
  return result;
}
interface Person { id: number; name: { full: string | null; native: string | null }; primaryOccupations?: string[] }
async function build(kind: 'staff' | 'characters', source: Map<number, string>): Promise<Record<number, string>> {
  const ids = [...source.keys()].sort((a, b) => a - b), result: Record<number, string> = {};
  let missing = 0, excluded = 0;
  for (let start = 0; start < ids.length; start += 50) {
    const batch = ids.slice(start, start + 50);
    const query = `{ Page(page:1,perPage:50) { ${kind}(id_in:[${batch.join(',')}]) { id name { full native } ${kind === 'staff' ? 'primaryOccupations' : ''} } } }`;
    const response = await request<{ data: { Page: { staff?: Person[]; characters?: Person[] } } }>('anilist', query);
    const people = response.data.Page[kind];
    if (!Array.isArray(people)) throw new Error(`Missing AniList ${kind} page`);
    missing += batch.length - people.length;
    for (const person of people) {
      if (!source.has(person.id) || !person.name.full) throw new Error(`Unexpected AniList person ${person.id}`);
      if (kind === 'staff' && !person.primaryOccupations?.some(job => /^voice actor$/i.test(job))) { excluded++; continue; }
      result[person.id] = normalizeKoreanName(source.get(person.id)!, { full: person.name.full, native: person.name.native });
    }
    console.log(`${kind}: ${Math.min(start + 50, ids.length)}/${ids.length}, kept ${Object.keys(result).length}`);
  }
  console.log(`${kind}: ${missing} deleted/missing IDs, ${excluded} non-voice-actors excluded`);
  return result;
}
const staff = await labels('P11227');
const characters = await labels('P11736');
const output = { voiceActors: await build('staff', staff), characters: await build('characters', characters) };
if (!Object.keys(output.voiceActors).length || !Object.keys(output.characters).length) throw new Error('Refusing to write an empty dictionary');
const text = '// Generated by scripts/build-korean-names.ts. Wikidata Korean labels (CC0), AniList names/occupations.\n'
  + '// Rebuild: npm run build:korean-names (cached responses under node_modules/.cache/anicastmap/).\n'
  + 'export const KOREAN_NAMES_BY_ID: { voiceActors: Record<number, string>; characters: Record<number, string> } = '
  + JSON.stringify(output, null, 2) + ';\n';
await writeFile(new URL('../src/data/koreanNamesById.ts', import.meta.url), text);
console.log(`Generated ${Object.keys(output.voiceActors).length} voice actors, ${Object.keys(output.characters).length} characters; ${Buffer.byteLength(text)} bytes, ${gzipSync(text).byteLength} gzip bytes`);
