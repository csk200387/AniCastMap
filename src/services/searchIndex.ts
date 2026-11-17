import { KO_TITLES } from '../data/koreanTitles';
import { KO_TITLES_AUTO } from '../data/koreanTitlesAuto';
import { PRESET_ANIME } from '../data/presetAnime';
import type { AnimeSummary } from '../types/contract';
import { normalizeAccent } from './accent';

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅗㅏ', 'ㅗㅐ', 'ㅗㅣ', 'ㅛ', 'ㅜ', 'ㅜㅓ', 'ㅜㅔ', 'ㅜㅣ', 'ㅠ', 'ㅡ', 'ㅡㅣ', 'ㅣ'];
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄱㅅ', 'ㄴ', 'ㄴㅈ', 'ㄴㅎ', 'ㄷ', 'ㄹ', 'ㄹㄱ', 'ㄹㅁ', 'ㄹㅂ', 'ㄹㅅ', 'ㄹㅌ', 'ㄹㅍ', 'ㄹㅎ', 'ㅁ', 'ㅂ', 'ㅂㅅ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const clean = (value: string) => value.normalize('NFKC').toLowerCase()
  .replace(/[ᄀ-ᄒ]/g, c => CHO[c.charCodeAt(0) - 0x1100]!)
  .replace(/[ᅡ-ᅵ]/g, c => JUNG[c.charCodeAt(0) - 0x1161]!)
  .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/[\p{P}\p{S}\p{Z}\s]/gu, '');
function syllable(c: string, full: boolean): string {
  const n = c.charCodeAt(0) - 0xac00;
  return n < 0 || n >= 11172 ? c : full
    ? CHO[Math.floor(n / 588)]! + JUNG[Math.floor((n % 588) / 28)]! + JONG[n % 28]!
    : CHO[Math.floor(n / 588)]!;
}
/** Keyboard-order jamo keep an unfinished IME syllable a prefix (줏 → 주술). */
const jamo = (value: string) => [...clean(value)].map(c => syllable(c, true)).join('');
const initials = (value: string) => [...clean(value)].map(c => syllable(c, false)).join('');
const SEASON = /\s*(제?\s*\d+\s*(기|쿨|부|편|화)|시즌\s*\d+|season\s*\d+|part\s*\d+|파이널\s*시즌|파이널|더\s*파이널|신?극장판|완결편|\d+(st|nd|rd|th)\s*season)\s*/gi;
const palette = ['#e4a15d', '#71b7db', '#b49be8', '#e982a0', '#78c6a3'];
const korean = new Map<number, string[]>();
for (const t of [...KO_TITLES_AUTO, ...KO_TITLES]) korean.set(t.id, [...new Set([t.ko, ...t.aliases, ...(korean.get(t.id) ?? [])])]);
const presets = new Map(PRESET_ANIME.map(a => [a.id, a]));
const franchiseRoots = new Map<number, number>();
// Presets stay synchronous while the full dictionary chunk is loading (or unavailable).
let index = PRESET_ANIME.map(({ cast: _cast, fullCastPool: _pool, ...anime }) => {
  const members = [anime.id, ...(anime.franchise?.members.map(m => m.id) ?? [])];
  for (const member of members) franchiseRoots.set(member, anime.id);
  const keys = [...Object.values(anime.title), ...members.flatMap(id => korean.get(id) ?? [])]
    .filter((s): s is string => Boolean(s));
  return { anime, popularity: anime.popularity ?? 0,
    j: [...new Set(keys.map(jamo))], c: [...new Set(keys.map(initials))] };
}).sort((a, b) => b.popularity - a.popularity || a.anime.id - b.anime.id);
let summaries = new Map(index.map(entry => [entry.anime.id, entry.anime]));
const ready = new Promise<void>(resolve => {
  if (typeof window === 'undefined') resolve();
  else if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => resolve(), { timeout: 1000 });
  else window.setTimeout(resolve, 300);
}).then(() => import('../data/searchIndex')).then(({ SEARCH_FORMATS, SEARCH_ROWS }) => {
  index = SEARCH_ROWS.map(([id, otherMembers, romaji, packedEnglish, native, year, format, popularity, cover]) => {
    const members = [id, ...otherMembers], english = packedEnglish === '' ? romaji : packedEnglish;
    for (const member of members) franchiseRoots.set(member, id);
    const koKeys = [...(korean.get(id) ?? []), ...members.flatMap(member => korean.get(member) ?? [])];
    const preset = presets.get(id);
    const anime: AnimeSummary = preset ? (() => { const { cast: _cast, fullCastPool: _pool, ...summary } = preset; return { ...summary, popularity }; })() : {
      id, title: { romaji, english, native, ...(koKeys[0] ? { ko: koKeys[0] } : {}) },
      coverImage: cover ? 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/' + cover : '',
      color: normalizeAccent(palette[(Math.imul(id, 2654435761) >>> 0) % palette.length]!), seasonYear: year, format: SEARCH_FORMATS[format]!, popularity,
    };
    const keys = [...new Set([...koKeys, romaji, english, native, ...Object.values(preset?.title ?? {})].filter((s): s is string => Boolean(s)))];
    return { anime, popularity, j: [...new Set(keys.map(jamo))], c: [...new Set(keys.map(initials))] };
  }).sort((a, b) => b.popularity - a.popularity || a.anime.id - b.anime.id);
  summaries = new Map(index.map(entry => [entry.anime.id, entry.anime]));
});
// A failed background load leaves preset search usable; explicit awaiters still see the failure.
void ready.catch(() => {});
export function searchIndexReady(): Promise<void> { return ready; }

/** Known dictionary franchises can also canonicalise live sequel rows without a relation request. */
export const searchFranchiseRoot = (id: number): number => franchiseRoots.get(id) ?? id;
export const searchFranchiseSummary = (id: number): AnimeSummary | undefined => summaries.get(searchFranchiseRoot(id));

// Reuse two bounded rows for every candidate in a query; no per-key edit-distance allocations.
function editWithin(a: string, b: string, max: number, first: Int32Array, second: Int32Array): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = first, cur = second;
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    const start = Math.max(1, i - max), end = Math.min(b.length, i + max);
    let best = start === 1 ? i : max + 1;
    if (start > 1) cur[start - 1] = max + 1;
    for (let j = start; j <= end; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]!);
    }
    if (best > max) return false;
    if (end < b.length) cur[end + 1] = max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[b.length]! <= max;
}
/** Pure, synchronous search over the existing Korean dictionary, collapsed to at most ten franchises. */
export function instantAnimeSearch(query: string): AnimeSummary[] {
  const run = (q: string): AnimeSummary[][] => {
    const tiers: AnimeSummary[][] = [[], [], [], [], []];
    const qj = jamo(q), qc = /^[ㄱ-ㅎᄀ-ᄒ\s]+$/.test(q) ? clean(q) : null;
    if (!qj) return tiers;
    const fuzz = qj.length >= 6 ? Math.max(1, Math.floor(qj.length / 7)) : 0;
    const first = new Int32Array(qj.length + fuzz + 1), second = new Int32Array(first.length);
    for (const entry of index) {
      let tier = 5;
      for (const key of entry.j) {
        if (key === qj) { tier = 0; break; }
        if (tier > 1 && key.startsWith(qj)) tier = 1;
        else if (tier > 2 && qj.length >= 2 && key.includes(qj)) tier = 2;
      }
      if (tier === 5 && qc && qc.length >= 2) for (const key of entry.c) {
        if (key.startsWith(qc) || (qc.length >= 3 && key.includes(qc))) { tier = 3; break; }
      }
      if (tier === 5 && fuzz) for (const key of entry.j) {
        const candidate = key.length > qj.length + fuzz ? key.slice(0, qj.length) : key;
        if (editWithin(qj, candidate, fuzz, first, second)) { tier = 4; break; }
      }
      if (tier < 5) tiers[tier]!.push(entry.anime);
    }
    return tiers;
  };
  let tiers = run(query);
  const stripped = query.replace(SEASON, ' ').trim();
  if (stripped && stripped !== query.trim() && !tiers[0]!.length && !tiers[1]!.length && !tiers[2]!.length) {
    const alternative = run(stripped);
    tiers = tiers.map((tier, i) => [...alternative[i]!, ...tier].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0)));
  }
  const seen = new Set<number>();
  return tiers.flat().filter(anime => !seen.has(anime.id) && seen.add(anime.id)).slice(0, 10);
}
