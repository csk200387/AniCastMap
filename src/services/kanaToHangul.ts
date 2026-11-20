/** Kana first: never infer a Japanese reading from English spelling. */
export const isKanaName = (s: string): boolean => /^[\p{Script=Hiragana}\p{Script=Katakana}ー・\s]+$/u.test(s.normalize('NFKC'));
const table: Record<string, string> = {};
const add = (kana: string, hangul: string) => [...kana].forEach((k, i) => { table[k] = hangul.split(' ')[i]!; });
add('アイウエオ', '아 이 우 에 오');
add('カキクケコガギグゲゴ', '카 키 크 케 코 가 기 그 게 고');
add('サシスセソザジズゼゾ', '사 시 스 세 소 자 지 즈 제 조');
add('タチツテトダヂヅデド', '타 치 츠 테 트 다 지 즈 데 드');
add('ナニヌネノハヒフヘホ', '나 니 누 네 노 하 히 프 헤 호');
add('バビブベボパピプペポ', '바 비 브 베 보 파 피 프 페 포');
add('マミムメモヤユヨラリルレロワヰヱヲヴ', '마 미 므 메 모 야 유 요 라 리 르 레 로 와 이 에 오 브');
add('ァィゥェォヮヵヶャュョ', '아 이 우 에 오 와 카 케 야 유 요');
const combos: Record<string, string> = {};
for (const [base, row] of Object.entries({キ:'캬 큐 쿄',ギ:'갸 규 교',シ:'샤 슈 쇼',ジ:'자 주 조',チ:'차 추 초',ヂ:'자 주 조',ニ:'냐 뉴 뇨',ヒ:'햐 휴 효',ビ:'뱌 뷰 뵤',ピ:'퍄 퓨 표',ミ:'먀 뮤 묘',リ:'랴 류 료'})) {
  [...'ャュョ'].forEach((k, i) => { combos[base + k] = row.split(' ')[i]!; });
}
// ター uses the conventional borrowed-name ending 터 (Heiter → 하이터).
Object.assign(combos, {ター:'터',ティ:'티',ディ:'디',トゥ:'투',ドゥ:'두',ファ:'파',フィ:'피',フェ:'페',フォ:'포',フュ:'퓨',ウィ:'위',ウェ:'웨',ウォ:'워',シェ:'셰',ジェ:'제',チェ:'체',ツァ:'차',ツィ:'치',ツェ:'체',ツォ:'초',ヴァ:'바',ヴィ:'비',ヴェ:'베',ヴォ:'보',ヴュ:'뷰',イェ:'예',キェ:'켸',ギェ:'계',クァ:'콰',クィ:'퀴',クェ:'퀘',クォ:'쿼',グァ:'과',グィ:'귀',グェ:'궤',グォ:'궈',スィ:'시',ズィ:'지'});
function final(s: string, n: number): string {
  const code = s.charCodeAt(s.length - 1) - 0xac00;
  return code >= 0 && code < 11172 && code % 28 === 0 ? s.slice(0, -1) + String.fromCharCode(0xac00 + code + n) : s + ({4:'ㄴ',8:'ㄹ',19:'ㅅ'}[n] ?? '');
}
const vowel: Record<string, string> = {};
for (const row of ['アイウエオ','カキクケコ','ガギグゲゴ','サシスセソ','ザジズゼゾ','タチツテト','ダヂヅデド','ナニヌネノ','ハヒフヘホ','バビブベボ','パピプペポ','マミムメモ','ラリルレロ']) [...row].forEach((k,i)=>{vowel[k] = 'アイウエオ'[i]!;});
/** Low-level kana syllables for foreign names. */
function kanaSyllables(native: string): string {
  const input = native.normalize('NFKC').replace(/[\u3041-\u3096]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));
  return input.split(/[・\s]+/).filter(Boolean).map(word => {
    let out = '', previousVowel = '';
    for (let i = 0; i < word.length; i++) {
      const k = word[i]!;
      if (k === 'ー') continue;
      if (k === 'ッ' || k === 'ン') { out = final(out, k === 'ッ' ? 19 : 4); previousVowel = ''; continue; }
      // Drop repeated vowels and ou; ei retains both syllables.
      if ('アイウエオ'.includes(k) && (k === previousVowel || (previousVowel === 'オ' && k === 'ウ'))) continue;
      if (k === 'ル' && i === word.length - 1) { out = final(out, 8); previousVowel = ''; continue; }
      if (k === 'ム' && i === word.length - 1 && out) { out = final(out, 16); previousVowel = ''; continue; }
      const pair = word.slice(i, i + 2), combined = combos[pair];
      out += combined ?? table[k] ?? k;
      previousVowel = combined ? ({ャ:'ア',ュ:'ウ',ョ:'オ',ァ:'ア',ィ:'イ',ゥ:'ウ',ェ:'エ',ォ:'オ'}[word[++i]!] ?? '') : vowel[k] ?? '';
    }
    return out;
  }).join(' ');
}

/** Loanword endings and nasal assimilation; Japanese names take the romaji path. */
export function kanaToHangul(native: string): string {
  return native.normalize('NFKC').replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60)).split(/[・\s]+/).filter(Boolean).map((w) => {
    let tail = '';
    const er = /([カガサザタダナハバパマヤラワ])ー$/.exec(w); // -er endings: パワー, イェーガー, フーバー, ライナー
    if (er && w.length > 2) { tail = ({ カ: '커', ガ: '거', サ: '서', ザ: '저', タ: '터', ダ: '더', ナ: '너', ハ: '허', バ: '버', パ: '퍼', マ: '머', ヤ: '어', ラ: '러', ワ: '워' } as Record<string, string>)[er[1]!]!; w = w.slice(0, -2); }
    const jer = /([ジチシ])ャー$/.exec(w); // フォージャー → 포저
    if (!tail && jer && w.length > 3) { tail = { ジ: '저', チ: '처', シ: '셔' }[jer[1]!]!; w = w.slice(0, -3); }
    const stop = /ッ([クトプ])$/.exec(w); // 받침 endings: エルリック, ヴァイオレット
    if (stop) w = w.slice(0, -2);
    let out = kanaSyllables(w);
    if (stop) out = addFinal(out, { ク: 1, ト: 19, プ: 17 }[stop[1]!]!);
    // ン → ㅇ before k/g, ㅁ before m/b/p (the engine always writes ㄴ)
    out = [...out].map((ch, i, all) => {
      const code = ch.charCodeAt(0) - 0xac00, nextCode = (all[i + 1] ?? tail[0] ?? '').charCodeAt(0) - 0xac00;
      if (code < 0 || code >= 11172 || code % 28 !== 4 || !(nextCode >= 0 && nextCode < 11172)) return ch;
      const cho = Math.floor(nextCode / 588);
      return [0, 1, 15].includes(cho) ? String.fromCharCode(ch.charCodeAt(0) + 17) : [6, 7, 8, 17].includes(cho) ? String.fromCharCode(ch.charCodeAt(0) + 12) : ch;
    }).join('');
    return out + tail;
  }).join(' ');
}
function addFinal(s: string, jong: number): string {
  const code = s.charCodeAt(s.length - 1) - 0xac00;
  return code >= 0 && code < 11172 && code % 28 === 0 ? s.slice(0, -1) + String.fromCharCode(0xac00 + code + jong) : s;
}

