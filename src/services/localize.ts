import type { AnimeTitle, LocalizedName } from '../types/contract';
import { KO_NAMES } from '../data/koreanNames';
import { KO_TITLES } from '../data/koreanTitles';
import { KO_CHARACTERS } from '../data/koreanCharacters';
import { isKanaName, kanaToHangul } from './kanaToHangul';
import { cachedKoreanName } from './koreanNameResolver';
import type { KoreanNameKind } from './koreanNameResolver';

export const isHangul = (s: string): boolean => /[\p{Script=Hangul}]/u.test(s);
export const normalizeKey = (s: string): string => s.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\p{Z}\s]/gu, '');
const initials = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
export function chosung(s: string): string {
  // Preserve compatibility jamo: NFKC otherwise turns them into leading jamo.
  return [...s.toLowerCase()].map(c => {
    const n = c.charCodeAt(0) - 0xac00;
    if (n >= 0 && n < 11172) return initials[Math.floor(n / 588)];
    const j = c.normalize('NFKC').charCodeAt(0) - 0x1100;
    return j >= 0 && j < 19 ? initials[j] : normalizeKey(c);
  }).join('');
}
const vowels = ['a', 'i', 'u', 'e', 'o'];
const rows: Record<string, string[]> = {
  '': ['아','이','우','에','오'], k:['카','키','쿠','케','코'], g:['가','기','구','게','고'],
  s:['사','시','스','세','소'], z:['자','지','즈','제','조'], t:['타','티','츠','테','토'],
  d:['다','디','두','데','도'], n:['나','니','누','네','노'], h:['하','히','후','헤','호'],
  b:['바','비','부','베','보'], p:['파','피','푸','페','포'], m:['마','미','무','메','모'],
  r:['라','리','루','레','로'], l:['라','리','루','레','로'], j:['자','지','주','제','죠'],
  y:['야','이','유','예','요'], w:['와','위','우','웨','워'], f:['파','피','후','페','포'],
  v:['바','비','부','베','보'], sh:['샤','시','슈','셰','쇼'], ch:['차','치','추','체','초'],
  ts:['차','치','츠','체','초'],
};
const palatal: Record<string, string[]> = {
  ky:['캬','키','큐','켸','쿄'], gy:['갸','기','규','계','교'], ny:['냐','니','뉴','녜','뇨'],
  hy:['햐','히','휴','혜','효'], by:['뱌','비','뷰','볘','뵤'], py:['퍄','피','퓨','폐','표'],
  my:['먀','미','뮤','몌','묘'], ry:['랴','리','류','례','료'], sy:['샤','시','슈','셰','쇼'],
  jy:['자','지','주','제','죠'], ty:['차','치','추','체','초'], dy:['자','지','주','제','조'],
};
function batchim(s: string, offset: number): string {
  const last = s.charCodeAt(s.length - 1) - 0xac00;
  return last >= 0 && last < 11172 && last % 28 === 0
    ? s.slice(0, -1) + String.fromCharCode(0xac00 + last + offset) : s + ({4:'ㄴ',8:'ㄹ',16:'ㅁ',19:'ㅅ'}[offset] ?? '');
}
/** A consonant with no vowel after it ("Stark" → 스타르크): Hangul syllable carrying ㅡ. */
const ORPHAN: Record<string, string> = { b: '브', d: '드', f: '프', g: '그', h: '흐', j: '즈', k: '크', l: '르', m: '므', n: '느', p: '프', r: '르', s: '스', t: '트', v: '브', w: '우', y: '이', z: '즈' };
export function romajiToHangul(word: string): string {
  let input = word.toLowerCase().replace(/[āīūēō]/g, c => ({ā:'a',ī:'i',ū:'u',ē:'e',ō:'o'})[c]!)
    // Internal ei stays distinct (Keiji, Reina); trailing ei contracts (Kei).
    .replace(/ou(?![aeiou])|oo|uu|ei$/g, m => m[0]!)
    .replace(/([aeiou])ny/g, "$1n'y")
    .replace(/nn(?=$|')/g, 'n')
    // Western-style names: fold letters Japanese romaji never uses into ones it does.
    .replace(/c(?=[eiy])/g, 's').replace(/c(?!h[aeiouy])/g, 'k').replace(/q/g, 'k').replace(/x/g, 'ks');
  let out = '';
  while (input) {
    // Latin l between vowels carries into the previous syllable (Emilia → 에밀리아).
    if (input.startsWith('ll')) input = input.slice(1);
    if (/^l[aeiou]/.test(input) && out) out = batchim(out, 8);
    if (input === 'm') { out = batchim(out, 16); break; }
    if (input[0] === 'r' && !/[aeiouy]/.test(input[1] ?? '')) { out += '르'; input = input.slice(1); continue; }
    if (/^([bcdfghjkmprstz])\1/.test(input)) { out = batchim(out, 19); input = input.slice(1); continue; }
    if (input[0] === 'n' && (input.length === 1 || input[1] === "'" || !/[aeiouy]/.test(input[1]!))) {
      out = batchim(out, 4); input = input.slice(input[1] === "'" ? 2 : 1); continue;
    }
    // Tokenise the longest consonant first.
    const token = /^(sh|ch|ts|[kgnhbpmrsjtd]y|[kgsztdnhbpmrljywfv]?)([aiueo])/.exec(input);
    if (token) {
      const row = palatal[token[1]!] ?? rows[token[1]!]!;
      out += row[vowels.indexOf(token[2]!)]!; input = input.slice(token[0].length);
    } else { out += ORPHAN[input[0]!] ?? input[0]; input = input.slice(1); }
  }
  return out;
}
export function transliterateName(full: string, native: string | null): string {
  const words = full.trim().split(/\s+/);
  if (words.length === 2 && native && /[\p{Script=Han}\p{Script=Hiragana}]/u.test(native) && !native.includes('・')) words.reverse();
  return words.map(romajiToHangul).join(' ');
}
export function curatedKoreanName(name: LocalizedName, context?: { kind: KoreanNameKind; id?: number }): string | undefined {
  return name.ko?.trim() || (context?.kind === 'character' && context.id ? KO_CHARACTERS[context.id] : undefined)
    || (context?.kind !== 'character' && Object.hasOwn(KO_NAMES, name.full) ? KO_NAMES[name.full] : undefined);
}
export function ensureKoName(name: LocalizedName, context?: { kind: KoreanNameKind; id?: number }): LocalizedName {
  return { ...name, ko: curatedKoreanName(name, context)
    || cachedKoreanName({ kind: context?.kind ?? 'voiceActor', id: context?.id, native: name.native })
    || (name.native && isKanaName(name.native) ? kanaToHangul(name.native) : transliterateName(name.full, name.native))
    || name.native || '이름 미상' };
}
export function koTitleFor(id: number, _title: AnimeTitle, synonyms: string[] = []): string | undefined {
  return _title.ko?.trim() || KO_TITLES.find(t => t.id === id)?.ko || synonyms.find(isHangul) || cachedKoreanName({kind:'anime',id,native:_title.native});
}
export function matchTier(query: string, candidates: string[]): 0 | 1 | 2 | 3 | 4 {
  const q = normalizeKey(query);
  if (!q) return 4;
  const keys = candidates.filter(Boolean).map(normalizeKey);
  if (keys.some(k => k === q)) return 0;
  if (keys.some(k => k.startsWith(q))) return 1;
  if (keys.some(k => k.includes(q))) return 2;
  if (/^[ㄱ-ㅎ\u1100-\u1112\s]+$/.test(query) && candidates.some(k => chosung(k).includes(chosung(query)))) return 3;
  return 4;
}
