import type { AnimeTitle, LocalizedName } from '../types/contract';
import { KO_NAMES } from '../data/koreanNames';
import { KO_TITLES } from '../data/koreanTitles';
import { KO_TITLES_AUTO } from '../data/koreanTitlesAuto';
import { KO_CHARACTERS } from '../data/koreanCharacters';
import { KO_SEIYUU } from '../data/koreanSeiyuu';
import { isKanaName, kanaToHangul } from './kanaToHangul';
import { cachedKoreanName, verifiedKoreanName, koreanNamesReady } from './koreanNameResolver';
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
  return romajiSyllables(prepareRomaji(word));
}
// Keep the uncontracted engine available for D4's romaji-aligned long-vowel removal.
function prepareRomaji(word: string, splitN = true): string {
  const prepared = word.toLowerCase().replace(/[āâ]/g, 'aa').replace(/[īî]/g, 'ii').replace(/[ūû]/g, 'uu').replace(/[ēê]/g, 'ee').replace(/[ōô]/g, 'ou');
  return splitN ? prepared.replace(/(?<=[aeiou])n(?=ichi)/g, "n'").replace(/(?<=e)n(?=itsu|in$)/g, "n'") : prepared;
}
function dropRomajiLongVowels(word: string): string {
  return word.replace(/ou(?!e)/g, 'o').replace(/oo/g, 'o').replace(/uu(?!ra)/g, 'u');
}
function romajiSyllables(word: string, contract = true): string {
  let input = (contract ? dropRomajiLongVowels(word) : word)
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
// Hangul → romaji for Japanese names typed the way Korean fans spell them (카지 유우키 → kaji yuuki).
// Index order: 19 initials, 21 medials. ㅈ is j at a word start / before i·y·u, z otherwise (노자와 → nozawa).
const CHO = ['g','k','n','d','t','r','m','b','p','s','s','','j','ts','ch','k','t','p','h'];
const JUNG = ['a','e','ya','ye','o','e','yo','ye','o','wa','we','we','yo','u','wo','we','wi','yu','u','i','i'];
export function hangulToRomaji(text: string): string {
  const chars = [...text];
  const out = chars.map((ch, i) => {
    const n = ch.charCodeAt(0) - 0xac00;
    if (n < 0 || n >= 11172) return ch.toLowerCase();
    const cho = Math.floor(n / 588), jung = Math.floor((n % 588) / 28), jong = n % 28;
    const start = i === 0 || !/[가-힣]/.test(chars[i - 1]!);
    let c = CHO[cho]!, v = JUNG[jung]!;
    if (jung === 18 && (cho === 10 || cho === 13 || cho === 14)) c = 'ts'; // 쓰·쯔·츠 → tsu
    if (cho === 12 && !start && !/^[iyu]/.test(v)) c = 'z';
    if (jung === 18 && cho === 12) c = 'z'; // 즈 → zu
    if (c === 's' && (v === 'i' || v[0] === 'y')) c = 'sh';
    if (c === 'h' && v === 'u') c = 'f';
    if (/^(sh|ch|j)$/.test(c)) v = v.replace(/^y/, '');
    // ㄴ·ㅁ·ㅇ finals → n; ㄱ·ㅂ·ㅅ·ㅆ finals double the next consonant (캇페이 → kappei).
    return c + v + (jong === 4 || jong === 16 || jong === 21 ? 'n' : [1, 17, 19, 20].includes(jong) ? 'Q' : '');
  }).join('');
  return out.replace(/Q([a-z])/g, '$1$1').replace(/Q/g, '');
}
export function transliterateName(full: string, native: string | null): string {
  const words = full.trim().split(/\s+/);
  if (words.length === 2 && native && /[\p{Script=Han}\p{Script=Hiragana}]/u.test(native) && !native.includes('・')) words.reverse();
  return words.map(romajiToHangul).join(' ');
}
const kata = (s: string) => s.normalize('NFKC').replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

/* kana → Hepburn, only to test whether the kana spells the romaji name (→ a Japanese name, not a loanword) */
const H: Record<string, string> = {};
const fill = (k: string, r: string) => [...k].forEach((c, i) => { H[c] = r.split(' ')[i]!; });
fill('アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲ', 'a i u e o ka ki ku ke ko sa shi su se so ta chi tsu te to na ni nu ne no ha hi fu he ho ma mi mu me mo ya yu yo ra ri ru re ro wa o');
fill('ガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポ', 'ga gi gu ge go za ji zu ze zo da ji zu de do ba bi bu be bo pa pi pu pe po');
function kanaToRomaji(word: string): string {
  let out = '', double = false;
  const w = [...kata(word)];
  for (let i = 0; i < w.length; i++) {
    const k = w[i]!, next = w[i + 1];
    if (k === 'ー') continue;
    if (k === 'ッ') { double = true; continue; }
    if (k === 'ン') { out += next && 'アイウエオヤユヨ'.includes(next) ? "n'" : 'n'; continue; }
    let r = H[k] ?? '?';
    if (next && 'ャュョ'.includes(next)) { r = r.replace(/i$/, '') + (/^(sh|ch|j)$/.test(r.replace(/i$/, '')) ? '' : 'y') + { ャ: 'a', ュ: 'u', ョ: 'o' }[next]!; i++; }
    out += double ? r[0] + r : r; double = false;
  }
  return out;
}
const foldRomaji = (s: string) => s.toLowerCase().replace(/[āâ]/g, 'a').replace(/[ūû]/g, 'u').replace(/[ōô]/g, 'o').replace(/[^a-z]/g, '').replace(/ou|oo|oh(?![aeiou])/g, 'o').replace(/uu/g, 'u').replace(/aa/g, 'a').replace(/ii/g, 'i').replace(/ee|ei/g, 'e').replace(/nn/g, 'n').replace(/m(?=[bpm])/g, 'n').replace(/l/g, 'r');
const spellsRomaji = (native: string, full: string) => {
  const romanized = native.split(/[・\s]+/).map(kanaToRomaji).join('');
  const a = foldRomaji(romanized), words = full.trim().split(/\s+/);
  return !romanized.includes('?') && (a === foldRomaji(words.join('')) || a === foldRomaji([...words].reverse().join('')));
};
function japaneseKanaName(full: string, native: string): string {
  const romanized = native.split(/[・\s]+/).map(kanaToRomaji).join('');
  const words = full.trim().split(/\s+/);
  if (foldRomaji(words.join('')) !== foldRomaji(romanized)) words.reverse();
  const joined = words.join('');
  // Align the explicit ン/ん boundaries to romaji, including when AniList omits the apostrophe.
  const boundaries = new Set([...romanized.matchAll(/n'/g)].map(match => foldRomaji(romanized.slice(0, match.index + 1))));
  let offset = 0;
  return words.map(word => {
    const marked = word.replace(/n(?=[aeiouy])/gi, (n, index: number) =>
      boundaries.has(foldRomaji(joined.slice(0, offset + index + 1))) ? n + "'" : n);
    offset += word.length;
    return romajiSyllables(prepareRomaji(marked, false));
  }).join(' ');
}

/** Japanese kana spellings use Japanese syllables; foreign kana use the loanword engine. */
export function koNameV2(name: { full: string; native: string | null }): string {
  const native = name.native?.trim() || null;
  if (native && /^[\p{Script=Hangul}\s·]+$/u.test(native)) return native;
  if (native && isKanaName(native)) return spellsRomaji(native, name.full)
    ? japaneseKanaName(name.full, native)
    : kanaToHangul(native);
  return transliterateName(name.full, native);
}
/**
 * Spelling-convention fold for COMPARISON only: fan style (카·타·츠, 쵸, 유우) and the NIKL standard used by
 * Wikidata (가·다·쓰, 초, 유) collapse to one key, so "same reading, different convention" can be told from "different reading".
 */
export function foldKo(s: string): string {
  const out: string[] = [];
  let prevJung = -1, prevJong = -1;
  for (const ch of s.replace(/[\s·・]/g, '')) {
    const n = ch.charCodeAt(0) - 0xac00;
    if (n < 0 || n >= 11172) { out.push(ch); prevJung = -1; continue; }
    let cho = Math.floor(n / 588), jung = Math.floor((n % 588) / 28);
    const jong = n % 28;
    if (cho === 10 && jung === 18) cho = 12;                       // 쓰 → 즈 (tsu, NIKL)
    cho = ({ 15: 0, 16: 3, 17: 7, 14: 12, 1: 0, 4: 3, 8: 7, 13: 12 } as Record<number, number>)[cho] ?? cho; // ㅋ→ㄱ ㅌ→ㄷ ㅍ→ㅂ ㅊ→ㅈ (+ tense)
    if (cho === 12) jung = ({ 12: 8, 17: 13, 2: 0 } as Record<number, number>)[jung] ?? jung;                 // 죠→조 쥬→주 쟈→자
    // long vowels: 오+우, 우+우, 오+오 collapse
    if (cho === 11 && jong === 0 && prevJong === 0 && ((jung === 13 && [8, 12, 13, 17].includes(prevJung)) || (jung === 8 && (prevJung === 8 || prevJung === 12)))) continue;
    out.push(String.fromCharCode(0xac00 + cho * 588 + jung * 28 + jong));
    prevJung = jung; prevJong = jong;
  }
  return out.join('');
}

const normalizeNameSeparators = (s: string) => s.replace(/\s*[=＝・·]+\s*/g, ' ').replace(/(?<=\p{L})-(?=\p{L})/gu, '');

/** D4: Wikidata's same reading → rule spelling; curated labels retain their spelling.
 * Only remove a source vowel when its word aligns with a long vowel in the romaji.
 * This protects morpheme boundaries (Inoue / Matsuura) and unrelated Korean names.
 */
export function normalizeKoreanName(label: string, name: { full: string; native: string | null }, curated = false): string {
  label = normalizeNameSeparators(label);
  const rule = normalizeNameSeparators(koNameV2(name));
  if (!curated && foldKo(label) === foldKo(rule)) return rule;
  const words = name.full.trim().split(/\s+/).map(word => {
    const prepared = prepareRomaji(word);
    return { expanded: romajiSyllables(prepared, false), short: romajiSyllables(prepared) };
  }).filter(word => word.expanded !== word.short);
  return label.split(/([\s·・]+)/).map(word => {
    for (const candidate of words) {
      if (foldKo(word) !== foldKo(candidate.expanded)) continue;
      // Delete only the extra vowel syllables, preserving this source word's consonant convention.
      const chars = [...word];
      for (let i = chars.length - 1; i > 0; i--) {
        const shorter = chars.filter((_, j) => j !== i).join('');
        if ('우오'.includes(chars[i]!) && foldKo(shorter) === foldKo(candidate.short)) chars.splice(i, 1);
      }
      return chars.join('');
    }
    return word;
  }).join('');
}
const SEIYUU_KO = new Map(KO_SEIYUU.map(s => [s.id, s.ko]));
export function curatedKoreanName(name: LocalizedName, context?: { kind: KoreanNameKind; id?: number }): string | undefined {
  return (context?.kind === 'character' && context.id ? KO_CHARACTERS[context.id] : undefined)
    || (context?.kind === 'voiceActor' && context.id ? SEIYUU_KO.get(context.id) : undefined)
    || (context?.kind !== 'character' && Object.hasOwn(KO_NAMES, name.full) ? KO_NAMES[name.full] : undefined);
}
// Names are weakly held so early records can be refreshed once the lazy ID table arrives.
const earlyNames = new Set<WeakRef<LocalizedName>>();
let namesLoaded = false;
void koreanNamesReady().then(() => {
  namesLoaded = true;
  for (const ref of earlyNames) {
    const name = ref.deref();
    if (name) name.ko = deriveKoName(name, earlyContexts.get(name));
  }
  earlyNames.clear();
}).catch(() => { namesLoaded = true; earlyNames.clear(); });
const earlyContexts = new WeakMap<LocalizedName, { kind: KoreanNameKind; id?: number }>();
function deriveKoName(name: LocalizedName, context?: { kind: KoreanNameKind; id?: number }): string {
  const curated = curatedKoreanName(name, context);
  const source = curated
    || verifiedKoreanName(context?.kind ?? 'voiceActor', context?.id)
    || cachedKoreanName({ kind: context?.kind ?? 'voiceActor', id: context?.id, native: name.native });
  return normalizeNameSeparators((source ? normalizeKoreanName(source, name, Boolean(curated)) : koNameV2(name)) || name.native || '이름 미상');
}
export function ensureKoName(name: LocalizedName, context?: { kind: KoreanNameKind; id?: number }): LocalizedName {
  const result = { ...name, ko: deriveKoName(name, context) };
  if (!namesLoaded) {
    earlyNames.add(new WeakRef(result));
    if (context) earlyContexts.set(result, context);
  }
  return result;
}
// Curated entries first: a generated title never overrides a hand-checked one.
const KO_TITLE_BY_ID = new Map([...KO_TITLES_AUTO, ...KO_TITLES].map(t => [t.id, t.ko]));
export function koTitleFor(id: number, _title: AnimeTitle, synonyms: string[] = []): string | undefined {
  return _title.ko?.trim() || KO_TITLE_BY_ID.get(id) || synonyms.find(isHangul) || cachedKoreanName({kind:'anime',id,native:_title.native});
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
