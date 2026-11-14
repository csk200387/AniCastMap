import { STATIC_KOREAN_NAMES } from '../data/koreanNameCache';
/** Exact native-label Wikidata resolution. Network errors never affect anime loading. */
export type KoreanNameKind = 'character' | 'voiceActor' | 'anime';
export interface KoreanNameQuery { kind: KoreanNameKind; id?: number; native: string | null; full?: string }
interface CacheEntry { ko: string | null; expires: number }
const KEY = 'sc:ko:v1', TTL = 7 * 86400000;
const cache = new Map<string, CacheEntry>();
let restored = false;
const keyFor = (q: KoreanNameQuery) => `${q.kind}:${q.kind === 'anime' && q.id ? q.id : q.native ?? ''}`;
function restore(): void {
  if (restored) return;
  restored = true;
  for (const [key,value] of Object.entries(STATIC_KOREAN_NAMES)) if(value.expires > Date.now()) cache.set(key,value);
  try { for (const [key, value] of Object.entries(JSON.parse((typeof window !== 'undefined' ? window.localStorage?.getItem(KEY) : null) ?? '{}') as Record<string, CacheEntry>)) if (value && (value.ko === null || typeof value.ko === 'string') && value.expires > Date.now()) cache.set(key, value); } catch { /* storage disabled / Node */ }
}
export function cachedKoreanName(q: KoreanNameQuery): string | undefined {
  restore(); const value = cache.get(keyFor(q)); return value && value.expires > Date.now() ? value.ko ?? undefined : undefined;
}
/** Build scripts can bake the same validated cache used by the synchronous resolver. */
export function koreanNameCacheSnapshot(): Record<string, CacheEntry> {
  restore(); return Object.fromEntries([...cache].filter(([,v])=>v.expires>Date.now()));
}
let nextStart = 0;
/** One franchise-wide query, with a three-second wall-clock cap including pacing. */
export async function resolveKoreanNames(queries: readonly KoreanNameQuery[], signal?: AbortSignal): Promise<{ unknown: number; hits: number; resolved: { query: KoreanNameQuery; ko: string }[] }> {
  restore();
  const unknown = [...new Map(queries.filter(q => q.native || (q.kind === 'anime' && q.id)).map(q => [keyFor(q), q])).values()].filter(q => (cache.get(keyFor(q))?.expires ?? 0) <= Date.now());
  const result = { unknown: unknown.length, hits: 0, resolved: [] as { query: KoreanNameQuery; ko: string }[] };
  if (!unknown.length || signal?.aborted) return result;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3000);
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const literal = (s: string) => JSON.stringify(s);
  // All matches retain an exact Japanese label. Characters additionally require a
  // fictional-character class path; ambiguous ko-labelled entities are rejected.
  const branches: string[] = [];
  for (const kind of ['voiceActor','character','anime'] as const) {
    const people = unknown.map((q,i)=>({q,i})).filter(({q})=>q.kind===kind && q.native);
    if (people.length) {
      const values = people.map(({q,i})=>`(${i} ${literal(q.native!)}@ja)`).join(' ');
      const type = kind === 'voiceActor' ? 'FILTER EXISTS { ?item wdt:P31 wd:Q5 }' : kind === 'character' ? 'FILTER(EXISTS { ?item wdt:P31/wdt:P279* wd:Q95074 } || EXISTS { ?item wdt:P279+ wd:Q95074 })' : 'FILTER(EXISTS { ?item wdt:P31/wdt:P279* wd:Q5398426 } || EXISTS { ?item wdt:P31/wdt:P279* wd:Q11424 })';
      branches.push(`{ VALUES (?idx ?native) { ${values} } ?item rdfs:label ?native . ${type} BIND(${kind === 'anime' ? 1 : 0} AS ?priority) ?item rdfs:label ?ko . FILTER(LANG(?ko) = "ko") }`);
    }
  }
  const anime = unknown.map((q,i)=>({q,i})).filter(({q})=>q.kind==='anime' && q.id);
  if(anime.length) branches.push(`{ VALUES (?idx ?id) { ${anime.map(({q,i})=>`(${i} ${literal(String(q.id))})`).join(' ')} } ?item wdt:P8729 ?id . BIND(0 AS ?priority) ?item rdfs:label ?ko . FILTER(LANG(?ko) = "ko") }`);
  try {
    const at = Math.max(Date.now(), nextStart); nextStart = at + 1000;
    if (at > Date.now()) await new Promise<void>((resolve, reject) => {
      const onAbort = () => { clearTimeout(wait); reject(new Error('aborted')); };
      const wait = setTimeout(() => { combined.removeEventListener('abort', onAbort); resolve(); }, at - Date.now());
      combined.addEventListener('abort', onAbort, { once: true });
    });
    if (combined.aborted) return result;
    const query = `SELECT DISTINCT ?idx ?item ?ko ?priority WHERE { hint:Query hint:optimizer "None" . ${branches.join(' UNION ')} }`;
    const response = await fetch('https://query.wikidata.org/sparql', { method:'POST', body:new URLSearchParams({query,format:'json'}), signal: combined, headers: { 'Content-Type':'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json', ...(typeof window === 'undefined' ? {'User-Agent':'SeiyuuConstellation/1.0 (local name enrichment)'} : {}) } });
    if (!response.ok) return result;
    const data = await response.json() as { results: { bindings: { idx: { value: string }; item: { value: string }; ko: { value: string }; priority: { value: string } }[] } };
    for (const [i, q] of unknown.entries()) {
      const candidates = data.results.bindings.filter(b => Number(b.idx.value) === i);
      const best = Math.min(...candidates.map(b => Number(b.priority.value)));
      const entities = new Map(candidates.filter(b => Number(b.priority.value) === best).map(b => [b.item.value, b.ko.value]));
      const ko = entities.size === 1 ? [...entities.values()][0]! : null;
      cache.set(keyFor(q), { ko, expires: Date.now() + TTL });
      if (ko) { result.hits++; result.resolved.push({ query: q, ko }); }
    }
    try { (typeof window !== 'undefined' ? window.localStorage : undefined)?.setItem(KEY, JSON.stringify(Object.fromEntries(cache))); } catch { /* optional cache */ }
  } catch { /* timeout, offline, endpoint overload: silent additive failure */ }
  finally { clearTimeout(timer); }
  return result;
}
