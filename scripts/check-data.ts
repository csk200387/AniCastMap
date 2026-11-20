import assert from 'node:assert/strict';
import { KO_NAMES } from '../src/data/koreanNames';
import { KO_TITLES } from '../src/data/koreanTitles';
import { PRESET_ANIME } from '../src/data/presetAnime';
import { chosung, ensureKoName, hangulToRomaji, isHangul, matchTier, normalizeKey, romajiToHangul, transliterateName, koNameV2, normalizeKoreanName, foldKo } from '../src/services/localize';
import { anilistDataSource, instantAnimeSearch, searchIndexReady, isMainline, localAnimeHits, localSeiyuuSearch, loadFranchise, resolveRoots, wikidataBridge } from '../src/services/anilistClient';
import { SEARCH_ROWS } from '../src/data/searchIndex';
import { KO_TITLES_AUTO } from '../src/data/koreanTitlesAuto';
import { backupParam, backupUrl, CANONICAL_ORIGIN, decodeShare, encodeShare, linkOrigin, sharedParam, shareUrl, toPayload } from '../src/services/shareCodec';
import { mergeFranchiseCast, roleOrder } from '../src/services/franchise';
import { classifyRoleNote, DISPLAY_CAST, MAX_CAST_POOL } from '../src/types/contract';
import type { CastEntry } from '../src/types/contract';
import type { RankedCastEntry } from '../src/services/franchise';
import { kanaToHangul } from '../src/services/kanaToHangul';
import { selectVoiceCredits } from '../src/services/voiceCredits';
import { KO_SEIYUU } from "../src/data/koreanSeiyuu";
import { KO_CHARACTERS } from '../src/data/koreanCharacters';
import characterSource from './ko-character-source.mjs';
import { cachedKoreanName, resolveKoreanNames, koreanNamesReady, verifiedKoreanName } from '../src/services/koreanNameResolver';
import { recordFromPool, readCastCache, writeCastCache } from '../src/services/userState';
import type { KoreanNameQuery } from '../src/services/koreanNameResolver';
import { STATIC_KOREAN_NAMES } from '../src/data/koreanNameCache';

await searchIndexReady();

// Browser imports keep presets usable until the single idle callback / timeout starts the chunk.
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
try {
 for (const scheduler of ['idle', 'timeout'] as const) {
  let start: (() => void) | undefined, scheduled = 0;
  const schedule = (callback: () => void) => { scheduled++; start = callback; return 1; };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: scheduler === 'idle'
   ? { requestIdleCallback: schedule }
   : { setTimeout: (callback: () => void, ms: number) => { assert.equal(ms, 300); return schedule(callback); } } });
  const browserIndex = await import(`../src/services/searchIndex.ts?${scheduler}-fixture`);
  assert.equal(scheduled, 1, 'Schedule the index once at module load');
  const ready = browserIndex.searchIndexReady();
  assert.equal(browserIndex.searchIndexReady(), ready, 'Readiness shares one load');
  let loaded = false; void ready.then(() => { loaded = true; });
  await Promise.resolve(); assert(!loaded, 'Readiness waits for the browser scheduler');
  assert.equal(browserIndex.instantAnimeSearch('줏')[0]?.id, 113415, 'Preset composition search works before loading');
  assert(browserIndex.instantAnimeSearch('아').every(a => PRESET_ANIME.some(p => p.id === a.id)));
  assert.deepEqual(browserIndex.instantAnimeSearch('없는제목'), []);
  start!(); await ready;
  for (const query of ['줏', '귀멸의 칼ㄴ', '나히아 7기', '프리랜'])
   assert.deepEqual(browserIndex.instantAnimeSearch(query), instantAnimeSearch(query), 'Loaded matching stays identical');
 }
} finally {
 if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
 else Reflect.deleteProperty(globalThis, 'window');
}
console.log('PASS lazy search index: idle/300ms scheduling, shared readiness, preset fallback and loaded matching.');


const earlyVerified = ensureKoName({full:'Light Yagami',native:'夜神月',ko:'야가미 리그흐트'}, {kind:'character',id:80});
await koreanNamesReady();
assert.equal(earlyVerified.ko, '야가미 라이토', 'An early name is re-derived when the ID chunk arrives');
assert.equal(verifiedKoreanName('character',80),'야가미 라이토');
assert(verifiedKoreanName('voiceActor',95672));
const storedPool: CastEntry[] = [{
  character: {id:80,name:{full:'Light Yagami',native:'夜神月',ko:'야가미 리그흐트'},image:''}, role:'MAIN',
  voiceActor: {id:95672,name:{full:'Yuuki Kaji',native:'梶裕貴',ko:'이전 성우'},image:''},
  subVoiceActors: [{voiceActor:{id:95591,name:{full:'Kenjirou Tsuda',native:'津田健次郎',ko:'이전 대역'},image:''},kind:'ALTERNATE',roleNote:null}],
}];
const stored = new Map<string,string>();
const storage = {getItem:(key:string)=>stored.get(key)??null,setItem:(key:string,value:string)=>{stored.set(key,value);},removeItem:(key:string)=>{stored.delete(key);}};
writeCastCache(storage,new Map([[999999,{savedAt:Date.now(),pool:storedPool}]]));
const restoredPool = readCastCache(storage).get(999999)!.pool;
assert.equal(restoredPool[0]!.character.name.ko,'야가미 리그흐트','Stored format stays intact');
const restored = recordFromPool(PRESET_ANIME[0]!,restoredPool);
assert.equal(restored.cast[0]!.character.name.ko,'야가미 라이토');
assert.equal(restored.cast[0]!.voiceActor!.name.ko,'카지 유우키'); // D12: curated spelling as written
assert.equal(restored.cast[0]!.subVoiceActors![0]!.voiceActor.name.ko,'츠다 켄지로');
assert.equal(restored.cast[0],restored.fullCastPool![0]);
console.log('PASS names: lazy refresh, cast-cache re-derivation (character, primary and sub voice actors)');

assert.equal(chosung('비스크 돌'), 'ㅂㅅㅋㄷ');
assert.equal(chosung('ㅂㅅㅋ ㄷ'), 'ㅂㅅㅋㄷ');
assert.equal(normalizeKey(' ＡＢＣ · 비스크-돌! １２ '),'abc비스크돌12');
assert(isHangul('가')); assert(isHangul('ㅂㅅ')); assert(!isHangul('kana あ'));
assert.equal(matchTier('비스크돌',['비스크 돌']),0);
assert.equal(matchTier('비스',['비스크 돌']),1);
assert.equal(matchTier('스크',['비스크 돌']),2);
assert.equal(matchTier('ㅂㅅㅋ ㄷ',['그 비스크 돌은 사랑을 한다','비스크 돌']),3);
assert.equal(matchTier('없는말',['비스크 돌']),4);
for(const [en,ko]of [['Hattori','핫토리'],['Yuuji','유지'],['Kenjirou','켄지로'],['Shouyou','쇼요'],['Oo','오'],['Tōkyō','토쿄'],["Shin'ya",'신야'],['Kanna','칸나'],['Kann','칸'],['Kei','케이'],['Keiji','케이지'],['Reina','레이나'],['She','셰'],['Che','체'],['Je','제']])assert.equal(romajiToHangul(en!),ko,en);
assert.equal(transliterateName('Megumi Fushiguro','伏黒恵'),'후시구로 메구미');
assert.equal(transliterateName('Alluka Zoldyck','アルカ・ゾルディック'),`${romajiToHangul('Alluka')} ${romajiToHangul('Zoldyck')}`);
assert(ensureKoName({full:'',native:null}).ko);
assert.equal(typeof ensureKoName({full:'constructor',native:null}).ko,'string');
// Test every original curated pair, including foreign fictional names. Native spelling
// comes from presets when available; other two-word entries are Japanese person names.
const natives = new Map(PRESET_ANIME.flatMap(a=>(a.fullCastPool??a.cast).flatMap(c=>[c.character.name,...(c.voiceActor?[c.voiceActor.name]:[])])).map(n=>[n.full,n.native]));
let exact=0; const misses: string[]=[];
for(const [en,ko]of Object.entries(KO_NAMES)){
 const got=transliterateName(en,natives.get(en)??(en.includes(' ')?'漢字':null));
 if(got===ko)exact++;else misses.push(`${en}: ${got} (curated ${ko})`);
}
console.log(`Transliteration: ${exact}/${Object.keys(KO_NAMES).length} = ${(100*exact/Object.keys(KO_NAMES).length).toFixed(1)}% exact`);
for(const m of misses)console.log(`  miss: ${m}`);
assert(exact/Object.keys(KO_NAMES).length>=0.85);
// Frozen pre-change exact matches whose curated spelling already follows D4.
const BASELINE_D4_EXACT = [
  "Megumi Arakawa",
  "Naoki Bandou",
  "Nobunaga Shimazaki",
  "Kenjirou Tsuda",
  "Tomokazu Seki",
  "Yoshimasa Hosoya",
  "Keiji Fujiwara",
  "Mariya Ise",
  "Karin Takahashi",
  "Satoshi Hino",
  "Kengo Kawanishi",
  "Yuusuke Kobayashi",
  "Makoto Furukawa",
  "Inori Minase",
  "Rie Murakawa",
  "Manami Numakura",
  "Gen Satou",
  "Ai Kayano",
  "Emilia",
  "Rem",
  "Ram",
  "Senkuu Ishigami",
  "Kohaku",
  "Tsukasa Shishiou",
  "Taiju Ooki",
  "Yuzuriha Ogawa",
  "Kusuo Saiki",
  "Riki Nendou",
  "Kokomi Teruhashi",
  "Shun Kaidou",
  "Aren Kuboyasu",
  "Junya Enoki",
  "Yui Ishikawa",
  "Marina Inoue",
  "Kana Ichinose",
  "Chiaki Kobayashi",
  "Kikunosuke Toya",
  "Tomori Kusunoki",
  "Shougo Sakata",
  "Yoshino Aoyama",
  "Sayumi Suzushiro",
  "Saku Mizuno",
  "Ikumi Hasegawa",
  "Takeo Ootsuka",
  "Yurie Igoma",
  "Megumi Han",
  "Katsuyuki Konishi",
  "Kaito Ishikawa",
  "Nao Touyama",
  "Maaya Uchida",
  "Yurika Kubo",
  "Sora Amamiya",
  "Megumi Fushiguro",
  "Yuuji Itadori",
  "Nobara Kugisaki",
  "Aki Hayakawa",
  "Hitori Gotou",
  "Nijika Ijichi",
  "Ryou Yamada",
  "Ikuyo Kita",
  "Kana Arima",
  "Tanjirou Kamado",
  "Nezuko Kamado",
  "Inosuke Hashibira",
  "Tengen Uzui",
  "Sakuta Azusagawa",
  "Mai Sakurajima",
  "Tomoe Koga",
  "Rio Futaba",
  "Nodoka Toyohama",
  "Kaede Azusagawa",
  "Ken Kaneki",
  "Touka Kirishima",
  "Takahiro Sakurai",
  "Yuuichi Nakamura",
  "Atsumi Tanezaki",
  "Kana Hanazawa",
  "Saori Hayami",
  "Hiroshi Kamiya",
  "Daisuke Ono",
  "Nobuhiko Okamoto",
  "Asami Seto",
  "Rie Takahashi",
  "Reina Ueda",
  "Noi Komazawa",
  "Yoshitsugu Matsuoka",
  "Hiro Shimono",
  "Natsuki Hanae",
  "Akari Kitou",
  "Takehito Koyasu",
  "Aki Toyosaki",
  "Satoru Gojou",
  "Fern",
  "Denji",
  "Makima"
];
for (const full of BASELINE_D4_EXACT) assert.equal(koNameV2({full,native:natives.get(full)??(full.includes(" ")?"漢字":null)}),KO_NAMES[full],full);
console.log(`D4 curated exact baseline: ${BASELINE_D4_EXACT.length}/${BASELINE_D4_EXACT.length}, 0 regressions`);

// Frozen pre-change ID matches; metadata is embedded so checks remain fully offline.
const BASELINE_CHARACTERS: [number,string,string|null][] = [
  [45627,"Levi","リヴァイ"],
  [45887,"Sasha Blouse","サシャ・ブラウス"],
  [46494,"Armin Arlert","アルミン・アルレルト"],
  [62481,"Krista Lenz","クリスタ・レンズ"],
  [64769,"Shouyou Hinata","日向翔陽"],
  [64771,"Tobio Kageyama","影山飛雄"],
  [67321,"Koushi Sugawara","菅原孝支"],
  [67323,"Daichi Sawamura","澤村大地"],
  [67325,"Ryuunosuke Tanaka","田中龍之介"],
  [67327,"Yuu Nishinoya","西谷夕"],
  [67333,"Asahi Azumane","東峰旭"],
  [67689,"Kiyoko Shimizu","清水潔子"],
  [71121,"Hange Zoe","ハンジ・ゾエ"],
  [71267,"Kenma Kozume","孤爪研磨"],
  [71609,"Tadashi Yamaguchi","山口忠"],
  [73935,"Saitama","サイタマ"],
  [73979,"Genos","ジェノス"],
  [80243,"Shouko Nishimiya","西宮硝子"],
  [80491,"Shouya Ishida","石田将也"],
  [81929,"Tatsumaki","タツマキ"],
  [84677,"Yato","夜ト"],
  [84679,"Hiyori Iki","壱岐ひより"],
  [84681,"Yukine","雪音"],
  [87275,"Ken Kaneki","金木研"],
  [87277,"Touka Kirishima","霧嶋董香"],
  [88239,"Bishamon","毘沙門"],
  [88240,"Kazuma","兆麻"],
  [88293,"Hinami Fueguchi","笛口雛実"],
  [88407,"Koutarou Amon","亜門鋼太朗"],
  [88409,"Nishiki Nishio","西尾錦"],
  [88411,"Ayato Kirishima","霧嶋絢都"],
  [88413,"Rize Kamishiro","神代利世"],
  [88414,"Uta","ウタ"],
  [88421,"Hideyoshi Nagachika","永近英良"],
  [88424,"Shuu Tsukiyama","月山習"],
  [88577,"Reinhard van Astrea","ラインハルト・ヴァン・アストレア"],
  [88689,"Tenjin","天神"],
  [88691,"Daikoku","大黒"],
  [88692,"Nora","野良"],
  [88946,"Kishou Arima","有馬貴将"],
  [89120,"Ebisu","恵比寿"],
  [89334,"Arataka Reigen","霊幻新隆"],
  [89335,"Yuzuru Nishimiya","西宮結絃"],
  [89616,"Shigeo Kageyama","影山茂夫"],
  [89618,"Ritsu Kageyama","影山律"],
  [89620,"Tome Kurata","暗田トメ"],
  [89621,"Teruki Hanazawa","花沢輝気"],
  [89622,"Ichi Mezato","米里イチ"],
  [89623,"Tsubomi Takane","高嶺ツボミ"],
  [90107,"Kusuo Saiki","斉木楠雄"],
  [90108,"Riki Nendou","燃堂力"],
  [90109,"Kokomi Teruhashi","照橋心美"],
  [90110,"Kuniharu Saiki","斉木國春"],
  [90111,"Reita Toritsuka","鳥束零太"],
  [90112,"Shun Kaidou","海藤瞬"],
  [90113,"Kurumi Saiki","斉木久留美"],
  [90114,"Kineshi Hairo","灰呂杵志"],
  [90115,"Chiyo Yumehara","夢原知予"],
  [90177,"Anastasia Hoshin","アナスタシア・ホーシン"],
  [90181,"Beatrice","ベアトリス"],
  [120649,"Kaguya Shinomiya","四宮かぐや"],
  [121101,"Miyuki Shirogane","白銀御行"],
  [121102,"Yuu Ishigami","石上優"],
  [121103,"Chika Fujiwara","藤原千花"],
  [121104,"Ai Hayasaka","早坂愛"],
  [121514,"Mitsuha Miyamizu","宮水三葉"],
  [121516,"Taki Tachibana","立花瀧"],
  [121518,"Yotsuha Miyamizu","宮水四葉"],
  [121520,"Hitoha Miyamizu","宮水一葉"],
  [121521,"Sayaka Natori","名取早耶香"],
  [121522,"Miki Okudera","奥寺ミキ"],
  [121524,"Katsuhiko Teshigawara","勅使河原克彦"],
  [121705,"Mayu","真喩"],
  [124026,"Naoka Ueno","植野直花"],
  [124033,"Miki Kawai","川井みき"],
  [124034,"Satoshi Mashiba","真柴智"],
  [124035,"Tomohiro Nagatsuka","永束友宏"],
  [124038,"Miyoko Sahara","佐原みよこ"],
  [124142,"Senkuu Ishigami","石神千空"],
  [124144,"Tsukasa Shishiou","獅子王司"],
  [124146,"Taiju Ooki","大木大樹"],
  [124147,"Yuzuriha Ogawa","小川杠"],
  [124162,"Suika","スイカ"],
  [125659,"Gabi Braun","ガビ・ブラウン"],
  [125796,"Chisato Mera","目良千里"],
  [125886,"Miko Iino","伊井野ミコ"],
  [126071,"Tanjirou Kamado","竈門炭治郎"],
  [126506,"Kusuke Saiki","斉木空助"],
  [126507,"Mikoto Aiura","相ト命"],
  [126635,"Megumi Fushiguro","伏黒恵"],
  [126824,"Maomao","猫猫"],
  [127134,"Aren Kuboyasu","窪谷須亜蓮"],
  [127212,"Yuuji Itadori","虎杖悠仁"],
  [127221,"Sakuta Azusagawa","梓川咲太"],
  [127222,"Mai Sakurajima","桜島麻衣"],
  [127242,"Satella","サテラ"],
  [127278,"Jinshi","壬氏"],
  [127518,"Nezuko Kamado","竈門禰豆子"],
  [127613,"Kaede Azusagawa","梓川かえで"],
  [127633,"Rio Futaba","双葉理央"],
  [127689,"Senshi","センシ"],
  [127691,"Satoru Gojou","五条悟"],
  [127840,"Tomoe Koga","古賀朋絵"],
  [127841,"Nodoka Toyohama","豊浜のどか"],
  [127843,"Shouko Makinohara","牧之原翔子"],
  [129130,"Inosuke Hashibira","嘴平伊之助"],
  [129132,"Muzan Kibutsuji","鬼舞辻無惨"],
  [129330,"Echidna","エキドナ"],
  [129571,"Yuuta Okkotsu","乙骨憂太"],
  [130050,"Giyuu Tomioka","冨岡義勇"],
  [130102,"Denji","デンジ"],
  [130307,"Yuuma Kunimi","国見佑真"],
  [130507,"Izutsumi","イヅツミ"],
  [130683,"Shou Suzuki","鈴木将"],
  [132939,"Suiryu","スイリュー"],
  [133204,"Toichirou Suzuki","鈴木統一郎"],
  [133399,"Katsuya Serizawa","芹沢克也"],
  [133550,"Metori Saiko","才虎芽斗吏"],
  [133675,"Kaoru Gojou","五条薫"],
  [133676,"Marin Kitagawa","喜多川海夢"],
  [133678,"Wakana Gojou","五条新菜"],
  [133699,"Suguru Getou","夏油傑"],
  [133700,"Nobara Kugisaki","釘崎野薔薇"],
  [133701,"Sukuna","宿儺"],
  [133702,"Mahito","真人"],
  [133704,"Kento Nanami","七海建人"],
  [133847,"Garfiel Tinsel","ガーフィール・ティンゼル"],
  [134326,"Tsubame Koyasu","子安つばめ"],
  [134327,"Tsubasa Tanuma ","田沼翼"],
  [134328,"Maki Shijo","四条眞妃"],
  [134330,"Nagisa Kashiwagi","柏木渚"],
  [134331,"Kobachi Osaragi","大仏こばち"],
  [135288,"Thistle","シスル"],
  [135290,"Namari","ナマリ"],
  [136069,"Muichirou Tokitou","時透無一郎"],
  [136071,"Tengen Uzui","宇髄天元"],
  [136072,"Mitsuri Kanroji","甘露寺蜜璃"],
  [136446,"Kaseki","カセキ"],
  [137080,"Makima","マキマ"],
  [137081,"Aki Hayakawa","早川アキ"],
  [137773,"Sakonji Urokodaki","鱗滝左近次 "],
  [137774,"Sanemi Shinazugawa","不死川実弥"],
  [137776,"Genya Shinazugawa","不死川玄弥"],
  [137777,"Obanai Iguro","伊黒小芭内"],
  [137974,"Panda","パンダ"],
  [137975,"Aoi Toudou","東堂葵"],
  [138846,"Yushirou","愈史郎"],
  [138847,"Tamayo","珠世"],
  [139038,"Kanao Tsuyuri","栗花落カナヲ"],
  [139734,"Daki","堕姫"],
  [139735,"Gyuutarou","妓夫太郎"],
  [139737,"Enmu","魘夢"],
  [139739,"Rui","累"],
  [141694,"Akaza","猗窩座"],
  [143270,"Ginrou","銀狼"],
  [143271,"Kinrou","金狼"],
  [143378,"Frederica Baumann","フレデリカ・バウマン"],
  [144593,"Kishibe","岸辺"],
  [144594,"Kobeni Higashiyama","東山コベニ"],
  [144596,"Himeno","姫野"],
  [145062,"Hyouga","氷月"],
  [145064,"Ukyou Saionji","西園寺羽京"],
  [148740,"Reze","レゼ"],
  [149275,"Byakuya Ishigami","石神百夜 "],
  [156767,"Gyokuyou","玉葉妃"],
  [156848,"Kasumi Miwa","三輪霞"],
  [156991,"Jougo","漏瑚"],
  [157115,"Toge Inumaki","狗巻棘"],
  [157864,"Utahime Iori","庵歌姫"],
  [157867,"Yoshinobu Gakuganji","楽巌寺嘉伸"],
  [158154,"Shouko Ieiri","家入硝子"],
  [170266,"Pochita","ポチタ"],
  [172759,"Ai Hoshino","星野アイ"],
  [174263,"Hirokazu Arai ","荒井ヒロカズ"],
  [174264,"Akane Sawatari ","沢渡アカネ"],
  [176754,"Frieren","フリーレン"],
  [183965,"Fern","フェルン"],
  [184310,"Heiter","ハイター"],
  [184312,"Eisen","アイゼン"],
  [184313,"Stark","シュタルク"],
  [184936,"Fiona Frost","フィオナ・フロスト"],
  [188783,"Kana Arima","有馬かな"],
  [189237,"Masamichi Yaga","夜蛾正道"],
  [189238,"Kiyotaka Ijichi","伊地知潔高"],
  [203015,"Riko Amanai","天内理子"],
  [203384,"Akane Kurokawa","黒川あかね"],
  [205177,"Sein","ザイン"],
  [210154,"Koukichi Muta","与幸吉"],
  [219110,"Aura","アウラ"],
  [219734,"Serie","ゼーリエ"],
  [223870,"Miyako Saitou","斉藤ミヤコ"],
  [232926,"Lakan","羅漢"],
  [237576,"Abiko Samejima","鮫島アビ子"],
  [237577,"Yoriko Kichijouji","吉祥寺頼子"],
  [244317,"Gaoshun","高順"],
  [245519,"Taishi Gotanda","五反田泰志"],
  [245521,"Ichigo Saitou","斉藤壱護"],
  [245524,"Yuki Sumi","鷲見ゆき"],
  [246055,"Genau","ゲナウ"],
  [246058,"Denken","デンケン"],
  [252073,"Minami Kotobuki","寿みなみ"],
  [257562,"Hitori Gotou","後藤ひとり"],
  [260977,"Nowa Sugaya","菅谷乃羽"],
  [261674,"Nijika Ijichi","伊地知虹夏"],
  [264529,"Ryou Yamada","山田リョウ"],
  [266041,"Ikuyo Kita","喜多郁代"],
  [274189,"Pairin","白鈴"],
  [274195,"Lihaku","李白"],
  [289054,"Seika Ijichi","伊地知星歌"],
  [289056,"Jimihen","ジミへン"],
  [289057,"Naoki Gotou","後藤直樹"],
  [289058,"Michiyo Gotou","後藤美智代"],
  [289059,"Futari Gotou","後藤ふたり"],
  [291639,"Kikuri Hiroi","廣井きくり"],
  [293727,"Lawine","ラヴィーネ"],
  [293728,"Kanne","カンネ"],
  [293861,"Shima Iwashita","岩下志麻"],
  [315278,"Qual","クヴァール"],
  [315929,"Edel","エーデル"],
  [316986,"Linie","リーニエ"],
  [316987,"Draht","ドラート"],
  [321717,"Richter","リヒター"],
  [321719,"Land","ラント"],
  [327299,"Lernen","レルネン"],
  [378972,"Iroha Sakayori","酒寄彩葉"],
  [378973,"Yachiyo Runami","月見ヤチヨ"],
  [385544,"Noi Komazawa","駒沢乃依"],
];
const BASELINE_STAFF = [95591,95118,95869,95185,95065,119331,95270,95160,95513,95212,95099,106817,95002,111635,116517,106297,95079,105765,106622,95090,95008,100142,106184,119722,108639,123268,115156,106787,95890,118602,112215,101996,95287,102263,95655,95017,95123,105989,95087,95356,118407,121961,102695,109441,95028,95819,100626,110919,95061,95158,95075,106661,95599,118581,118908,95081,112635,119319,124923,116543,95004,106030,95001,95014,133507,116971,119416,95027,95006,107961,113227,148220,95070,121821,95735,95020,111135,132768,95413,95040,118510,124390,119518,95245,100250,105071,96489,95016,95093,106641,96122,105094,95063,95112,95116,119672,95113,95137,95013,95015,119616,95557,95196,95088,126963,118475,95885];
for (const [id,full,native] of BASELINE_CHARACTERS) assert.equal(koNameV2({full,native}),KO_CHARACTERS[id],String(id));
for (const id of BASELINE_STAFF) { const person = KO_SEIYUU.find(s=>s.id===id)!; assert.equal(koNameV2(person),person.ko,String(id)); }
console.log(`D4 curated ID baseline: ${BASELINE_CHARACTERS.length} characters + ${BASELINE_STAFF.length} voice actors, 0 regressions`);

const WELL_KNOWN: [string, string, string, 'character' | 'voiceActor'][] = [
  // kana-only Japanese names (hiragana given names are very common)
  ['Madoka Kaname', '鹿目まどか', '카나메 마도카', 'character'], ['Sakura Haruno', '春野サクラ', '하루노 사쿠라', 'character'],
  ['Naruto Uzumaki', 'うずまきナルト', '우즈마키 나루토', 'character'], ['Hikaru', 'ヒカル', '히카루', 'character'], ['Kaoru', 'かおる', '카오루', 'character'],
  ['Tooru', 'トオル', '토루', 'character'], ['Miku', 'ミク', '미쿠', 'character'], ['Rei Ayanami', '綾波レイ', '아야나미 레이', 'character'],
  ['Kei', 'ケイ', '케이', 'character'], ['Eiji', 'エイジ', '에이지', 'character'], ['Seiya', 'セイヤ', '세이야', 'character'], ['Haru', 'ハル', '하루', 'character'],
  ['Mob', 'モブ', '모브', 'character'], ['Luffy', 'ルフィ', '루피', 'character'], ['Goku', 'ゴクウ', '고쿠', 'character'], ['Usagi', 'うさぎ', '우사기', 'character'],
  ['Tsukushi', 'つくし', '츠쿠시', 'character'], ['Shinobu', 'しのぶ', '시노부', 'character'], ['Nezuko', 'ねずこ', '네즈코', 'character'], ['Tomoyo', 'ともよ', '토모요', 'character'],
  // Western-style names written in katakana
  ['Edward Elric', 'エドワード・エルリック', '에드워드 엘릭', 'character'], ['Violet Evergarden', 'ヴァイオレット・エヴァーガーデン', '바이올렛 에버가든', 'character'],
  ['Lelouch Lamperouge', 'ルルーシュ・ランペルージ', '를르슈 람페르지', 'character'], ['Anya Forger', 'アーニャ・フォージャー', '아냐 포저', 'character'],
  ['Loid Forger', 'ロイド・フォージャー', '로이드 포저', 'character'], ['Asuna Yuuki', '結城明日奈', '유키 아스나', 'character'], ['Kirito', 'キリト', '키리토', 'character'],
  ['Levi', 'リヴァイ', '리바이', 'character'], ['Thorfinn', 'トルフィン', '토르핀', 'character'], ['Maomao', '猫猫', '마오마오', 'character'], ['Jinshi', '壬氏', '진시', 'character'],
  // Korean-origin works: AniList native is already Hangul or a Japanese rename
  ['Jin-Woo Sung', '성진우', '성진우', 'character'], ['Bam', '스물다섯번째 밤', '스물다섯번째 밤', 'character'], ['Mori Jin', '진모리', '진모리', 'character'],
  // kanji names: romaji path
  ['Kana Hanazawa', '花澤香菜', '하나자와 카나', 'voiceActor'], ['Yuuki Kaji', '梶裕貴', '카지 유우키', 'voiceActor'], ['Rie Takahashi', '高橋李依', '타카하시 리에', 'voiceActor'],
  ['Kei Tsukishima', '月島蛍', '츠키시마 케이', 'character'], ['Rei Hino', '火野レイ', '히노 레이', 'character'], ['Shinichi Kudou', '工藤新一', '쿠도 신이치', 'character'],
  ['Jun\'ichi Suwabe', '諏訪部順一', '스와베 준이치', 'voiceActor'], ['Shin\'ichirou Miki', '三木眞一郎', '미키 신이치로', 'voiceActor'], ['Ryouta Oosaka', '逢坂良太', '오사카 료타', 'voiceActor'],
  ['Kenshou Ono', '小野賢章', '오노 켄쇼', 'voiceActor'], ['Tooru Furuya', '古谷徹', '후루야 토루', 'voiceActor'], ['Mei Misaki', '見崎鳴', '미사키 메이', 'character'],
];
let wellKnownRules = 0;
let wellKnownVerified = 0;
const WELL_KNOWN_IDS: Record<string,number> = {'Edward Elric':11,'Violet Evergarden':90169,'Lelouch Lamperouge':417};
for (const [full, native, expected, kind] of WELL_KNOWN) {
  const got = ensureKoName({ full, native }, { kind, id: 999999999 }).ko!;
  if (got.replace(/\s/g, '') === expected.replace(/\s/g, '')) wellKnownRules++;
  const id = WELL_KNOWN_IDS[full];
  const integrated = id && verifiedKoreanName(kind,id) ? ensureKoName({full,native},{kind,id}).ko! : got;
  if (integrated.replace(/\s/g, '') === expected.replace(/\s/g, '')) wellKnownVerified++;
  if (full === 'Edward Elric' && verifiedKoreanName(kind,id)) assert.equal(integrated,expected);
}
console.log(`Well-known reference (D4): ${wellKnownRules}/${WELL_KNOWN.length} exact, rules + curated`);
console.log(`Well-known reference with verified IDs: ${wellKnownVerified}/${WELL_KNOWN.length} exact`);
assert.equal(WELL_KNOWN.length, 46);
assert(wellKnownRules >= 38);
assert(wellKnownVerified >= wellKnownRules);
for (const [full, native, ko] of [['Naruto','ナルト','나루토'], ['Rei','レイ','레이'], ['Hikaru','ヒカル','히카루'], ['Rem','レム','렘'], ['Zenitsu','善逸','젠이츠'], ["Jun'ichi",'順一','준이치'], ['Shinichi','新一','신이치'], ["Shin'ya",'しんや','신야']] as const)
  assert.equal(koNameV2({full,native}),ko,full);
assert.equal(normalizeKoreanName('카지 유우키', {full:'Yuuki Kaji',native:'梶裕貴'}),'카지 유키');
assert.equal(normalizeKoreanName('가지 유키', {full:'Yuuki Kaji',native:'梶裕貴'}),'카지 유키');
assert.equal(normalizeKoreanName('이노우에 마리나', {full:'Marina Inoue',native:'井上麻里奈'}),'이노우에 마리나');
assert.equal(normalizeKoreanName('키무라 료헤이', {full:'Ryouhei Kimura',native:'木村良平'}),'키무라 료헤이');
assert.equal(normalizeKoreanName('사이토 소우마', {full:'Souma Saitou',native:'斉藤壮馬'}),'사이토 소마');
assert.equal(normalizeKoreanName('다른성 소우마', {full:'Souma Other',native:'別姓'}),'다른성 소마');
assert.equal(normalizeKoreanName('이노우에 별명', {full:'Alias Inoue',native:'井上'}),'이노우에 별명');
assert.equal(normalizeKoreanName('무라카와 별명', {full:'Alias Murakawa',native:'村川'}),'무라카와 별명');
// Curated D4 changes only romaji-backed long vowels; preserve fan spelling and spacing.
for (const [id,full,ko] of [
  [129133,'Kyoujurou Rengoku','렌고쿠 쿄쥬로'], [136070,'Shinobu Kochou','코쵸 시노부'],
  [157116,'Chousou','쵸소'], [88412,'Juuzou Suzuya','스즈야 쥬조'],
  [133677,'Sajuna Inui','이누이 사쥬나'], [207937,'Shinju Inui','이누이 신쥬'],
  [157215,'Mei Mei','메이메이'], [274193,'Joka','조카'],
] as const) assert.equal(ensureKoName({full,native:null},{kind:'character',id}).ko,ko,full);
assert.equal(ensureKoName({full:'Jun Fukuyama',native:'福山潤'},{kind:'voiceActor',id:95086}).ko,'후쿠야마 쥰');
assert.equal(ensureKoName({full:'Jouji Nakata',native:'中田譲治'},{kind:'voiceActor',id:95091}).ko,'나카타 조지');
assert.equal(normalizeKoreanName('이노우에 마리나', {full:'Marina Inoue',native:'井上麻里奈'},true),'이노우에 마리나');
assert.equal(normalizeKoreanName('키무라 료헤이', {full:'Ryouhei Kimura',native:'木村良平'},true),'키무라 료헤이');
const characterLabels = characterSource.flatMap((source: {names:{en:string;ko:string}[]})=>source.names);
const curatedDisplays = [
  ...Object.entries(KO_NAMES).map(([full,ko])=>[ko,ensureKoName({full,native:null}).ko!] as const),
  ...KO_SEIYUU.map(s=>[s.ko,ensureKoName(s,{kind:'voiceActor',id:s.id}).ko!] as const),
  ...Object.entries(KO_CHARACTERS).map(([id,ko])=>{
    const source = characterLabels.find(n=>n.ko===ko); assert(source,`Source metadata for ${id}`);
    return [ko,ensureKoName({full:source.en,native:null},{kind:'character',id:Number(id)}).ko!] as const;
  }),
];
const curatedChanges = [...new Set(curatedDisplays.filter(([ko,display])=>ko!==display).map(([ko,display])=>`${ko} → ${display}`))].sort();
assert.deepEqual(curatedChanges,[]); // D12: curated (hand-checked) names display exactly as written
console.log(`PASS curated D12: ${curatedDisplays.length} curated names display as written`);
// D12: a 나무위키 title (Wikidata P8885) wins over the D4-normalised Wikidata label
assert.equal(ensureKoName({full:'Robin Nico',native:'ニコ・ロビン'},{kind:'character',id:61}).ko,'니코 로빈');
// Separators apply to curated labels, Wikidata (matching and irregular readings), and rule fallback.
for (const [full,native,label,expected] of [
  ['Killua Zoldyck','キルア=ゾルディック','키르아=조르딕','키르아 조르딕'],
  ['Leorio Paladiknight','レオリオ・パラディナイト','레오리오=파라디나이트','레오리오 파라디나이트'],
  ['Koro-sensei','殺せんせー','코로-센세이','코로센세이'],
  ['Inko-chan','インコちゃん','인코-찬','인코찬'],
  ['Petelgeuse Romanee-Conti','ペテルギウス・ロマネコンティ','페텔기우스 로마네-콘티','페텔기우스 로마네콘티'],
  ['Monkey D. Luffy','モンキー・D・ルフィ','몽키 D. 루피','몽키 D. 루피'],
] as const) {
  for (const curated of [false,true]) assert.equal(normalizeKoreanName(label,{full,native},curated),expected,label);
}
for (const separator of ['=','＝','・','·']) {
  assert.equal(normalizeKoreanName(`카지 ${separator} 유우키`,{full:'Yuuki Kaji',native:'梶裕貴'},true),'카지 유키');
  assert.equal(normalizeKoreanName(`가지 ${separator} 유키`,{full:'Yuuki Kaji',native:'梶裕貴'}),'카지 유키');
  assert.equal(ensureKoName({full:`Rei${separator}Kei`,native:null},{kind:'character'}).ko,'레이 케이');
}
assert.equal(ensureKoName({full:'Koro-sensei',native:'殺せんせー'},{kind:'character'}).ko,'코로센세이');
assert.equal(ensureKoName({full:'Inko-chan',native:'インコちゃん'},{kind:'character'}).ko,'인코찬');
console.log('PASS name separators: curated, Wikidata, rule fallback; D. preserved');
assert.equal(romajiToHangul('Kouki'),'코키');
assert.equal(romajiToHangul('Ootsuka'),'오츠카');
assert.equal(romajiToHangul('Matsuura'),'마츠우라');
assert.equal(koNameV2({full:'Shinai',native:'シンアイ'}),'신아이');
assert.equal(koNameV2({full:'Nenichi',native:'ネニチ'}),'네니치');
assert.equal(koNameV2({full:'Uzumaki Naruto',native:'うずまきナルト'}),'우즈마키 나루토');
assert.equal(foldKo('카지 유우키'),foldKo('가지 유키'));

const acceptance: [string,number][]=[['비스크 돌',132405],['ㅂㅅㅋ ㄷ',132405],['그 비스크 돌은 사랑을 하지 않는다',132405],['프리렌',154587],['던전밥',153518],['나혼자만레벨업',151807],['주술회전',113415],['전생슬',101280],['초카구야 공주',201903],['초 가구야 공주',201903],['cosmic princess kaguya',201903],['超かぐや姫',201903],['리제로',21355],['re:zero',21355]];
for(const [q,id]of acceptance)assert.equal(localAnimeHits(q)[0],id,`local alias ${q}`);
for(const [q,id]of [...acceptance, ['줏',113415], ['귀멸의 칼ㄴ',101922], ['나히아 7기',21459], ['프리랜',154587]] as [string,number][])
 assert.equal(instantAnimeSearch(q)[0]?.id,id,`instant alias/composition/season/typo ${q}`);
assert.deepEqual(instantAnimeSearch('ぼっち'),instantAnimeSearch('ボッチ'));
assert.deepEqual(instantAnimeSearch('ㅈㅅㅎㅈ'),instantAnimeSearch('ᄌᄉᄒᄌ'));
assert.deepEqual(instantAnimeSearch(''),[]);assert.deepEqual(instantAnimeSearch('  ! '),[]);
assert(instantAnimeSearch('아').length<=10);
assert.equal(new Set(SEARCH_ROWS.map(r=>r[0])).size,SEARCH_ROWS.length);
const indexedIds=SEARCH_ROWS.flatMap(([id,members])=>[id,...members]);
assert.equal(new Set(indexedIds).size,indexedIds.length,'Each member belongs to one franchise');
const unplacedIds=[...new Set([...KO_TITLES,...KO_TITLES_AUTO].map(t=>t.id))].filter(id=>!indexedIds.includes(id));
assert.deepEqual(unplacedIds.sort((a,b)=>a-b),[18139,20735,21637,97716,106967],'Only non-mainline short episodes are excluded');
for(const a of PRESET_ANIME)assert(SEARCH_ROWS.some(r=>r[0]===a.id),'Preset keeps its bundled id');
assert(KO_TITLES.length>=80); assert.equal(new Set(KO_TITLES.map(t=>t.id)).size,KO_TITLES.length);
const cast=(id:number,role:CastEntry['role'],va:number|null=null):CastEntry=>({character:{id,name:{full:`Person ${id}`,native:null},image:''},role,voiceActor:va===null?null:{id:va,name:{full:'Kenjirou Tsuda',native:'津田健次郎'},image:''}});
const merged=mergeFranchiseCast([{cast:[cast(1,'SUPPORTING'),cast(2,'SUPPORTING',20)]},{cast:[cast(1,'MAIN',10),cast(2,'MAIN',99),cast(3,'BACKGROUND')]}]);
assert.equal(merged.length,2); // one entry per character; unvoiced entries do not consume the cap
assert.equal(merged[0]!.character.id,1);assert.equal(merged[0]!.role,'MAIN');assert.equal(merged[0]!.voiceActor!.id,10);
assert.equal(merged.find(c=>c.character.id===2)!.voiceActor!.id,99);
assert.equal(mergeFranchiseCast([{cast:[cast(1,'SUPPORTING',1)]},{cast:[cast(1,'MAIN')]},{cast:[cast(1,'MAIN',3)]}])[0]!.voiceActor!.id,3,'A later highest-role primary outranks an earlier fallback');
assert.equal(mergeFranchiseCast([{cast:[cast(1,'BACKGROUND',1)]},{cast:[cast(1,'SUPPORTING',2)]},{cast:[cast(1,'MAIN')]}])[0]!.voiceActor!.id,1,'When every highest-role occurrence has no primary, keep the first non-null primary');
assert(!merged.some(c=>c.subVoiceActors?.some(s=>s.voiceActor.id===20)), 'Any member primary must not be a merged sub');
assert(merged.every(c=>c.character.name.ko && c.voiceActor?.name.ko));
for (const note of ['Childhood','Young Naruto','幼少期','少年時代','Flashback','幼年']) assert.equal(classifyRoleNote(note),'CHILDHOOD');
assert.equal(classifyRoleNote('Alternate'),null);assert.equal(classifyRoleNote(null),null);
const va = (id:number) => cast(1,'MAIN',id).voiceActor!;
const selected=selectVoiceCredits([{voiceActor:va(1),roleNotes:'Childhood'},{voiceActor:va(2),roleNotes:null},{voiceActor:va(3),roleNotes:'Replacement'}]);
assert.equal(selected.voiceActor?.id,2);assert.deepEqual(selected.subVoiceActors?.map(s=>s.kind),['CHILDHOOD','ALTERNATE']);
const noted=selectVoiceCredits([{voiceActor:va(1),roleNotes:'Season 1'},{voiceActor:va(2),roleNotes:null}]);
assert.equal(noted.voiceActor?.id,2);assert(!noted.subVoiceActors);
assert.equal(selectVoiceCredits([{voiceActor:va(1),roleNotes:'Replacement'}]).voiceActor?.id,1);
const childOnly=selectVoiceCredits([{voiceActor:va(1),roleNotes:'Young Naruto'}]);
assert.equal(childOnly.voiceActor,null);assert.equal(childOnly.subVoiceActors?.[0]?.kind,'CHILDHOOD');
const subEntry={...cast(1,'MAIN',10),subVoiceActors:[{voiceActor:va(20),kind:'ALTERNATE' as const,roleNote:null},{voiceActor:va(30),kind:'ALTERNATE' as const,roleNote:null}]};
assert.equal(selectVoiceCredits([{voiceActor:va(2),roleNotes:'  '},{voiceActor:va(3),roleNotes:'Alternate'}]).voiceActor?.id,2);
const subMerge=mergeFranchiseCast([{cast:[subEntry]},{cast:[{...cast(1,'SUPPORTING',20),subVoiceActors:[{voiceActor:va(30),kind:'CHILDHOOD',roleNote:'幼少'}]}]}]);
assert.equal(subMerge.length,1);assert.equal(subMerge[0]!.voiceActor!.id,10);
assert.deepEqual(subMerge[0]!.subVoiceActors?.map(s=>[s.voiceActor.id,s.kind]),[[30,'CHILDHOOD']]);
assert.equal(mergeFranchiseCast([{cast:[{...cast(1,'MAIN'),...childOnly}]}]).length,1,'Child-only character survives');
for(const [kana,ko] of Object.entries({'ザイン':'자인','フェルン':'페른','シュタルク':'슈타르크','ゼーリエ':'제리에','アウラ':'아우라','フリーレン':'프리렌','ドラート':'드라트','ハイター':'하이터','アイゼン':'아이젠','フランメ':'프람메','ベル':'벨','ユーベル':'유벨','ティファニー':'티파니','ヴァイオレット':'바이오렛','ふりーれん':'프리렌','キット':'킷'}))assert.equal(kanaToHangul(kana),ko,kana);
assert.equal(ensureKoName({full:'Sein',native:'ザイン'}).ko,'자인');
assert.equal(ensureKoName({full:'Sein',native:'ザイン',ko:'기존 이름'},{kind:'character',id:205177}).ko,'자인');
assert.equal(ensureKoName({full:'Sein',native:'ザイン'},{kind:'character',id:205177}).ko,'자인');
const ubelId=Number(Object.keys(KO_CHARACTERS).find(id=>KO_CHARACTERS[Number(id)]==='위벨'));assert(ubelId);
assert.equal(ensureKoName({full:'Definitely wrong',native:'ユーベル'},{kind:'character',id:ubelId}).ko,'위벨');
const deepMembers=Array.from({length:5},(_,member)=>({cast:[] as CastEntry[],fullCastPool:Array.from({length:25},(_,i):RankedCastEntry=>({
 ...cast(member*25+i+1,i<4?'MAIN':'SUPPORTING',member*25+i+1000),favourites:100-i,
}))}));
// A one-season supporting actor below the display cut must remain discoverable.
const pool=mergeFranchiseCast(deepMembers);
assert.equal(pool.length,MAX_CAST_POOL);
assert(pool.some(c=>c.character.id===10));assert(!pool.slice(0,DISPLAY_CAST).some(c=>c.character.id===10));
const noActor=Array.from({length:80},(_,i)=>cast(10000+i,'MAIN'));
const withMissing=mergeFranchiseCast([{cast:noActor,fullCastPool:[...noActor,...deepMembers.flatMap(m=>m.fullCastPool)]}]);
assert.equal(withMissing.length,MAX_CAST_POOL);assert(withMissing.every(c=>c.voiceActor));
assert.deepEqual(withMissing,pool,'Entries without actors cannot consume the cap');
const ranked=mergeFranchiseCast([{cast:[{...cast(1,'SUPPORTING',1),favourites:2},{...cast(2,'SUPPORTING',2),favourites:30}] as RankedCastEntry[]},{cast:[cast(1,'SUPPORTING',1)]}]);
assert.equal(ranked[0]!.character.id,2,'Favourites precede member count');
for(const a of PRESET_ANIME){
 assert(a.format);assert(a.studio);assert(a.genres);assert(a.popularity);
 assert(a.fullCastPool);assert(a.fullCastPool.length<=MAX_CAST_POOL);
 assert.deepEqual(a.cast,a.fullCastPool.slice(0,DISPLAY_CAST));
 assert(a.cast.every((c,i)=>c===a.fullCastPool![i]),'Display shares pool entry objects');
 assert.equal(new Set(a.fullCastPool.map(c=>c.character.id)).size,a.fullCastPool.length);
 if((a.franchise?.members.length??0)>=5)assert(a.fullCastPool.length>a.cast.length,'Big franchise has a deep pool');
 if(a.franchise){assert(a.franchise.members.length>=2);assert.equal(a.id,a.franchise.rootId);assert.equal(a.franchise.members[0]!.id,a.id);}
 assert(a.fullCastPool.every(c=>c.character.name.ko && (c.voiceActor?.name.ko || c.subVoiceActors?.length)));
 assert(a.fullCastPool.every(c=>(c.subVoiceActors??[]).every(s=>s.voiceActor.name.ko && s.voiceActor.id!==c.voiceActor?.id)));
 assert(a.fullCastPool.every((c,i)=>i===0||roleOrder[a.fullCastPool![i-1]!.role]<=roleOrder[c.role]),'Pool roles sorted');
}
// Bundled Korean labels survive the generated cache's latest expiry.
const beforeExpiryClock=Date.now;
try {
 const expiredAt=Math.max(...Object.values(STATIC_KOREAN_NAMES).map(v=>v.expires))+1;
 Date.now=()=>expiredAt;
 for(const [key,value]of Object.entries(STATIC_KOREAN_NAMES))if(typeof value.ko==='string'){
  const colon=key.indexOf(':');
  const query:KoreanNameQuery={kind:key.slice(0,colon) as KoreanNameQuery['kind'],native:key.slice(colon+1)};
  if(query.kind==='anime')query.id=Number(query.native);
  assert.equal(cachedKoreanName(query),value.ko,key);
  // D4 (feat/korean-names) normalises person labels, so the display must be the label's D4 form, not the rule from native.
  const shown=ensureKoName({full:'',native:query.native},query).ko;
  if(query.kind==='anime')assert.equal(shown,value.ko,key);
  else assert.equal(shown.replace(/\s+/g,''),normalizeKoreanName(value.ko,{full:'',native:query.native}).replace(/[\s·=]+/g,''),key);
 }
} finally {Date.now=beforeExpiryClock;}
// Resolver accepts only unambiguous exact matches and caches misses as well as hits.
const beforeResolver=globalThis.fetch;let resolverCalls=0;
try {
 globalThis.fetch=async(_input,init)=>{
  resolverCalls++;const q=new URLSearchParams(String(init?.body)).get('query')!;
  assert(q.includes('Q95074')&&q.includes('Q5')&&q.includes('P8729'));
  const binding=(idx:number,item:string,ko:string,priority=0)=>({idx:{value:String(idx)},item:{value:item},ko:{value:ko},priority:{value:String(priority)}});
  return new Response(JSON.stringify({results:{bindings:[binding(0,'Q1','검증 이름'),binding(1,'Q2','동명이인 하나'),binding(1,'Q3','동명이인 둘'),binding(3,'Q4','애니 이름'),binding(3,'Q5','낮은 우선순위',1)]}}));
 };
 const queries=[{kind:'voiceActor' as const,native:'検証名前'},{kind:'character' as const,native:'曖昧名前'},{kind:'character' as const,native:'未登録名前'},{kind:'anime' as const,id:987654321,native:'検証作品'}];
 const resolution=await resolveKoreanNames(queries);assert.equal(resolution.hits,2);assert.equal(resolverCalls,1);
 assert.equal(cachedKoreanName(queries[0]!), '검증 이름');assert.equal(cachedKoreanName(queries[1]!),undefined);
 assert.equal(ensureKoName({full:'Wrong English',native:'検証名前'},{kind:'voiceActor'}).ko,'검증 이름');
 assert.equal(cachedKoreanName(queries[3]!), '애니 이름');
 await resolveKoreanNames(queries);assert.equal(resolverCalls,1,'Positive and negative cache avoids second request');
} finally {globalThis.fetch=beforeResolver;}
const original=globalThis.fetch;
try{
 let searchCalls=0;
 globalThis.fetch=async()=>{searchCalls++;throw new Error('Offline fixture');};
 const partials: number[][]=[];
 const instantOnly=instantAnimeSearch('줏');assert(instantOnly.length>=3);
 assert.deepEqual(await anilistDataSource.searchAnime('줏',undefined,rows=>partials.push(rows.map(a=>a.id))),instantOnly);
 assert.deepEqual(partials,[instantOnly.map(a=>a.id)]);assert.equal(searchCalls,0,'Three instant franchises skip every live layer');
 const oneInstant=instantAnimeSearch('귀멸의 칼ㄴ');assert.equal(oneInstant.length,1);
 const pendingSearch=anilistDataSource.searchAnime('귀멸의 칼ㄴ',undefined,rows=>partials.push(rows.map(a=>a.id)));
 assert.deepEqual(partials.at(-1),oneInstant.map(a=>a.id),'Instant partial arrives before awaiting live search');
 assert.deepEqual(await pendingSearch,oneInstant,'Keep instant rows when all live layers fail');
 for(const query of ['zzqvzxofflinefixture','오프라인검증없는작품명']){
  assert.equal(instantAnimeSearch(query).length,0);
  await assert.rejects(anilistDataSource.searchAnime(query),error=>error instanceof Error&&error.name!=='AbortError');
 }
 assert(searchCalls>0);
 globalThis.fetch=async()=>new Response(JSON.stringify({data:{Page:{media:[]}},search:[]}));
 assert.deepEqual(await anilistDataSource.searchAnime('zzqvzxemptyfixture'),[],'Successful empty search is not a failure');
 globalThis.fetch=async()=>new Response('',{status:503});
 await assert.rejects(anilistDataSource.searchAnime('zzqvzxhttpfixture'),error=>error instanceof Error&&error.name!=='AbortError');
 const frierenMember=SEARCH_ROWS.find(r=>r[0]===154587)![1][0]!;assert(frierenMember);
 const liveMedia=(id:number)=>({id,type:'ANIME',format:'TV',status:'FINISHED',popularity:100,duration:24,isAdult:false,
  title:{romaji:'Live fixture',english:null,native:null},coverImage:null,seasonYear:2026,relations:{edges:[]}});
 globalThis.fetch=async(input)=>new Response(JSON.stringify(String(input).includes('wikidata.org')?{search:[]}:
  {data:{Page:{media:[liveMedia(frierenMember),liveMedia(99999901)]}}}));
 assert.deepEqual((await anilistDataSource.searchAnime('프리랜')).map(a=>a.id),[154587,99999901],'Instant first; live sequel deduplicates by franchise');
 globalThis.fetch=async()=>{throw new Error('Offline fixture');};
 for(const a of PRESET_ANIME)for(const id of a.franchise?.members.map(m=>m.id)??[a.id])assert.equal(await anilistDataSource.getAnime(id),a);
 assert.equal((await anilistDataSource.searchAnime('주술'))[0]!.id,113415);
 assert.equal((await anilistDataSource.searchAnime('ㅈㅅㅎㅈ'))[0]!.id,113415);
 const va=PRESET_ANIME[0]!.cast.find(c=>c.voiceActor)!.voiceActor!;
 assert((await anilistDataSource.getVoiceActorFilmography(va.id)).length>0);
 const recs=await anilistDataSource.getRecommendations(va.id,[113415]);
 assert(recs.every(e=>e.role==='MAIN' && e.anime.id!==113415));
 const aborted=new AbortController();aborted.abort();
 await assert.rejects(anilistDataSource.searchAnime('비스크',aborted.signal),{name:'AbortError'});
 await assert.rejects(anilistDataSource.getAnime(113415,aborted.signal),{name:'AbortError'});
 await assert.rejects(loadFranchise(21355,aborted.signal),{name:'AbortError'});
 await assert.rejects(anilistDataSource.getVoiceActorFilmography(va.id,aborted.signal),{name:'AbortError'});
 await assert.rejects(anilistDataSource.getRecommendations(va.id,[],aborted.signal),{name:'AbortError'});
}finally{globalThis.fetch=original;}
// A private client and virtual clock check urgent failures and background waits with only CORS-exposed headers.
const rateClient=await import('../src/services/anilistClient.ts?rate-limit-fixture');
const originalNow=Date.now,originalTimer=globalThis.setTimeout;
let fakeNow=Math.floor(originalNow()/1000)*1000-300000,resetAt=0;
const starts:number[]=[];
try{
 Date.now=()=>fakeNow;
 globalThis.setTimeout=((callback:()=>void,ms=0)=>{
  const due=fakeNow+ms;
  return originalTimer(()=>{fakeNow=Math.max(fakeNow,due);callback();},0);
 }) as typeof setTimeout;
 globalThis.fetch=async()=>{
  starts.push(fakeNow);
  if(starts.length<=2){resetAt=fakeNow+60000;return new Response('',{status:429,headers:{'X-RateLimit-Remaining':'0','X-RateLimit-Reset':String(resetAt/1000)}});}
  return new Response(JSON.stringify({data:{k0:null}}));
 };
 const urgentStart=fakeNow,wallStart=originalNow();
 for(const query of ['zzqvzxratefixturea','zzqvzxratefixtureb']){
  assert.equal(rateClient.instantAnimeSearch(query).length,0);
  await assert.rejects(rateClient.anilistDataSource.searchAnime(query),error=>{
   assert(error instanceof Error&&error.cause instanceof Error);
   assert.equal(error.cause.name,'RateLimited');assert.equal(error.cause.message,'AniList rate limited');
   assert.equal((error.cause as Error&{retryAfterMs:number}).retryAfterMs,60000);return true;
  });
 }
 assert(fakeNow-urgentStart<3000&&originalNow()-wallStart<3000,'Urgent retry and queued search reject within 3s');
 assert.equal(starts.length,1,'Queued urgent search rejects before fetching');
 const firstReset=resetAt;
 await Promise.all([rateClient.getAnimeShallow([99999991]),rateClient.getAnimeShallow([99999992])]);
 assert.equal(starts.length,4);
 assert(starts[1]!>=firstReset,'Non-urgent load waits before its first attempt');
 assert(starts.slice(2).every(at=>at>=resetAt),'Non-urgent retry and queued load wait for the next reset');
}finally{Date.now=originalNow;globalThis.setTimeout=originalTimer;globalThis.fetch=original;}
assert(PRESET_ANIME.length<=11);assert(PRESET_ANIME.some(a=>a.id===21355));
const bridgeActors=new Map<number,Set<number>>();
for(const a of PRESET_ANIME)for(const c of a.fullCastPool??a.cast)if(c.voiceActor){const ids=bridgeActors.get(c.voiceActor.id)??new Set<number>();ids.add(a.id);bridgeActors.set(c.voiceActor.id,ids);}
assert([...bridgeActors.values()].filter(ids=>ids.size>=2).length>=10);
// 성우 검색: fan spellings, Wikidata (NIKL) spellings, romaji either order, native, initials.
for (const [q, id] of [['나카무라 유이치',95513],['마츠오카 요시츠구',106817],['카지 유우키',95672],['가지 유키',95672],['유우키 아오이',101686],['혼도 카에데',119416],['kaji yuuki',95672],['Yuuki Kaji',95672],['松岡禎丞',106817],['ㅁㅊㅇㅋ',106817]] as const)
  assert.equal(localSeiyuuSearch(q)[0]?.id, id, q);
for (const [k, r] of [['카지 유우키','kaji yuuki'],['츠다 켄지로','tsuda kenjiro'],['후쿠야마 쥰','fukuyama jun'],['노자와 마사코','nozawa masako'],['야마구치 캇페이','yamaguchi kappei'],['오노 다이스케','ono daisuke']] as const)
  assert.equal(hangulToRomaji(k), r, k);
// Share codec: lossless round trip (order, anchor, mode, filters, locale); anything malformed → null.
const sharedMap = { anchorAnimeId: 5114, watched: [113415, 21, 20, 5114, 16498, 154587], viewMode: 'MODE_DETAIL' as const, showSupportingRoles: true, includeSubVoiceActors: false, locale: 'ja' as const };
const code = encodeShare(toPayload(sharedMap));
assert.deepEqual(decodeShare(code), sharedMap); assert(code.length < 60, code);
for (const bad of [null, '', '2c.0.1', '1c.9.1', '1c.0', '1c.0.1.1', '1c.0.-1', '1c.0.' + '2'.repeat(6001), '1c.0.' + '2.'.repeat(500) + '2']) assert.equal(decodeShare(bad), null, String(bad));
const largeIds = Array.from({ length: 500 }, (_, i) => i % 2 ? i : Math.floor(Number.MAX_SAFE_INTEGER / 2) - i);
const largeMap = { ...sharedMap, watched: largeIds, anchorAnimeId: largeIds.at(-1)! };
const largeCode = encodeShare(toPayload(largeMap));
assert.equal(largeCode.length, 6005, 'worst case: every delta has 11 base36 digits, anchor has two');
assert.deepEqual(decodeShare(largeCode), largeMap, '500 large-delta ids round-trip');
const g = globalThis as { location?: unknown };
const beforeLocation = g.location;
try {
 g.location = new URL('http://localhost:5173/?b=' + code);
 assert.equal(CANONICAL_ORIGIN, 'https://anicastmap.vercel.app');
 assert.equal(linkOrigin(), 'http://localhost:5173', 'plain Node has no import.meta.env and uses location');
 assert.equal(shareUrl(sharedMap), `http://localhost:5173/?s=${code}`);
 assert.equal(backupUrl(sharedMap), `http://localhost:5173/?b=${code}`);
 assert.equal(shareUrl(sharedMap, 'https://explicit.test'), `https://explicit.test/?s=${code}`);
 assert.equal(backupUrl(sharedMap, 'https://explicit.test'), `https://explicit.test/?b=${code}`);
 const backup = new URL(backupUrl(largeMap));
 assert.deepEqual(decodeShare(backupParam(backup.search)), largeMap, 'backup URL restores the same compact payload');
 assert.equal(backupParam(), code); assert.equal(sharedParam(backup.search), null);
 assert.equal(backupParam('?s=' + code), null);
} finally { if (beforeLocation === undefined) delete g.location; else g.location = beforeLocation; }
console.log(`Share codec: 500-id worst-case payload = ${largeCode.length} characters`);
console.log('PASS offline: localisation, aliases, instant composition/season/typo search, franchise index, partials/network bypass, live merge, honest errors/empty results, 429 urgent rejection/background reset wait, cast merge, preset metadata/member lookup, fallback, aborts, seiyuu search, share codec., backup links.');

if(process.argv.includes('--live')){
 const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
 async function live(query:string):Promise<any>{
  for(let attempt=0;attempt<3;attempt++){
   const r=await fetch('https://graphql.anilist.co',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query})});
   if(r.status===429&&attempt<2){await sleep(Math.max(1000,Number(r.headers.get('Retry-After')??60)*1000));continue;}
   assert(r.ok,`AniList HTTP ${r.status}`);const b=await r.json();assert(!b.errors,JSON.stringify(b.errors));assert(b.data);await sleep(750);return b.data;
  }throw new Error('AniList retry limit');
 }
 const frieren=await loadFranchise(154587);
 for(const [character,primary,child] of [['Sein','Yuuichi Nakamura','Natsumi Kawaida'],['Stark','Chiaki Kobayashi','Arisa Kiyoto']]){
  const c=frieren.fullCastPool!.find(c=>c.character.name.full===character);assert(c,character);
  assert.equal(c.voiceActor?.name.full,primary);assert(c.subVoiceActors?.some(s=>s.voiceActor.name.full===child&&s.kind==='CHILDHOOD'),`${character} childhood`);
  console.log(`CREDITS ${character}: ${primary} + ${child} (CHILDHOOD)`);
 }
 const sein=await anilistDataSource.getAnime(154587);assert.equal(sein.fullCastPool!.find(c=>c.character.name.full==='Sein')?.character.name.ko,'자인');
 for(const {en,ko} of characterSource.find((s:{anilistId:number})=>s.anilistId===154587)!.names){
  const c=frieren.fullCastPool!.find(c=>c.character.name.full.toLowerCase()===en.toLowerCase());
  if(!c){console.log(`FRIEREN absent from current anime pool: ${en}`);continue;}
  assert.equal(c.character.name.ko,ko,en);assert.equal(KO_CHARACTERS[c.character.id],ko,en);
 }
 let franchiseCalls=0;
 globalThis.fetch=async(input,init)=>{if(String(input).includes('graphql.anilist.co'))franchiseCalls++;return original(input,init);};
 let rezero;
 try{rezero=await loadFranchise(21355);}finally{globalThis.fetch=original;}
 assert(franchiseCalls>0&&franchiseCalls<=14,`Re:Zero request budget: ${franchiseCalls}`);
 assert(rezero.fullCastPool!.length>=50);
 const petel=rezero.fullCastPool!.find(c=>c.character.name.full==='Petelgeuse Romanee-Conti');
 assert.equal(petel?.voiceActor?.name.full,'Yoshitsugu Matsuoka');
 const cachedRezero=await anilistDataSource.getAnime(21355);
 assert(cachedRezero.fullCastPool!.length>=50);
 assert(cachedRezero.fullCastPool!.some(c=>c.character.name.full==='Petelgeuse Romanee-Conti'&&c.voiceActor?.name.full==='Yoshitsugu Matsuoka'));
 let largerCalls=0;
 const castRequests: {id:number;twoPages:boolean}[]=[];
 globalThis.fetch=async(input,init)=>{
  if(String(input).includes('graphql.anilist.co')){
   largerCalls++;
   const body=JSON.parse(String(init?.body));
   // One batched request carries every member (aliases k0…); record each member's page plan.
   if(body.query.includes('characters(page:'))for(const part of body.query.split(/(?=k\d+: Media\()/).slice(1))castRequests.push({id:Number(/Media\(id:(\d+)/.exec(part)![1]),twoPages:part.includes('c2:')});
  }
  return original(input,init);
 };
 let larger;
 try{larger=await loadFranchise(113415);}finally{globalThis.fetch=original;}
 assert(larger.franchise && larger.franchise.members.length>5);
 assert(largerCalls>0&&largerCalls<=14,`Large franchise request budget: ${largerCalls}`);
 assert.equal(castRequests.length,larger.franchise.members.length);
 for(const [i,member]of larger.franchise.members.entries())assert.deepEqual(castRequests[i],{id:member.id,twoPages:i<4});
 console.log(`DEEP ${larger.title.romaji}: ${larger.franchise.members.length} members, ${larger.fullCastPool!.length} pool, ${largerCalls} requests (first four two pages, rest one)`);
 const kaguya=await anilistDataSource.getAnime(201903);
 const noi=kaguya.fullCastPool!.find(c=>c.character.name.full==='Noi Komazawa');
 assert(noi?.voiceActor);assert.equal(noi.voiceActor.name.full,'Yoshitsugu Matsuoka');assert.equal(noi.voiceActor.id,petel!.voiceActor!.id);
 assert.equal(noi.character.name.ko,'코마자와 노이');assert.equal(petel!.character.name.ko,'페텔기우스 로마네콘티');
 assert(petel!.voiceActor!.name.native);assert(noi.character.name.native);
 console.log(`DEEP Re:Zero: ${rezero.franchise?.members.length} members, ${rezero.fullCastPool!.length} pool, ${franchiseCalls} requests; shared actor ${noi.voiceActor.name.full} (${noi.voiceActor.id})`);
 for(const [query,id]of [['초카구야 공주',201903],['초 가구야 공주',201903],['리제로',21355],['re:zero',21355],['cosmic princess kaguya',201903],['超かぐや姫',201903]] as const){
  assert.equal((await anilistDataSource.searchAnime(query))[0]?.id,id,query);console.log(`SEARCH ${query} → ${id}`);
 }
 const p=await (await fetch('https://www.wikidata.org/w/api.php?action=wbgetentities&ids=P8729&props=labels&languages=en&format=json&origin=*')).json();
 assert.equal(p.entities.P8729.labels.en.value,'AniList anime ID');
 for(let i=0;i<KO_TITLES.length;i+=10){
  const rows=KO_TITLES.slice(i,i+10);
  const data=await live(`{${rows.map((t,j)=>`a${j}:Media(id:${t.id}){id type format title{romaji}}`).join(' ')}}`);
  for(const [j,t]of rows.entries()){const m=data[`a${j}`];assert.equal(m.type,'ANIME',`${t.ko} type`);assert(['TV','MOVIE','ONA'].includes(m.format),`${t.ko} format ${m.format}`);console.log(`${m.id}: ${t.ko} → ${m.title.romaji} (${m.format})`);}
 }
 for(const [q,id]of [...acceptance.slice(0,7),['jujutsu',113415] as [string,number]]){
  const rows=await anilistDataSource.searchAnime(q);assert.equal(rows[0]?.id,id,`${q}: ${rows.map(r=>r.title.romaji).join(', ')}`);
  assert(rows.every(r=>['TV','MOVIE','ONA','TV_SHORT'].includes(r.format??'')));
  // Check every surfaced root independently: a cached/preset fallback cannot hide junk.
  const data=await live(`{${rows.map((r,j)=>`a${j}:Media(id:${r.id}){id type format status popularity duration isAdult}`).join(' ')}}`);
  assert(Object.values(data).every(m=>isMainline(m as Parameters<typeof isMainline>[0])));
  console.log(`SEARCH ${q} → ${rows[0]!.title.romaji} / ${rows[0]!.title.ko??'(English fallback)'}`);
 }
 // This title deliberately stays OUT of KO_TITLES: proves the Wikidata layer itself.
 assert.equal(localAnimeHits('플라스틱 메모리즈').length,0);
 const bridge=await wikidataBridge('플라스틱 메모리즈');assert(bridge.some(m=>m.id===20872),'Wikidata Plastic Memories bridge');
 const bridged=await anilistDataSource.searchAnime('플라스틱 메모리즈');assert.equal(bridged[0]?.id,20872);
 console.log(`BRIDGE 플라스틱 메모리즈 → ${bridged[0]!.title.romaji} (P8729, no local alias)`);
 const a=await anilistDataSource.getAnime(131573);assert.equal(a.id,113415);assert(a.franchise?.members.some(m=>m.id===113415));
 const rootMap=await resolveRoots([131573,113415]);assert.equal(rootMap.get(131573),113415);
 const va=95079; // Takahiro Sakurai: many popular MAIN roles outside the presets.
 let staffCalls=0;
 globalThis.fetch=async(input,init)=>{if(String(init?.body).includes('Staff('))staffCalls++;return original(input,init);};
 try{
  const film=await anilistDataSource.getVoiceActorFilmography(va);assert(film.length>0);
  assert.equal(new Set(film.map(e=>`${e.anime.id}:${e.character.id}`)).size,film.length);
  const recommendations=await anilistDataSource.getRecommendations(va,[]);assert(recommendations.length>=3&&recommendations.length<=5);
  assert(recommendations.every(e=>e.role==='MAIN'));assert.equal(new Set(recommendations.map(e=>e.anime.id)).size,recommendations.length);
  const exclude=recommendations[0]!.anime.id;const excluded=await anilistDataSource.getRecommendations(va,[exclude]);assert(excluded.every(e=>e.anime.id!==exclude));assert.equal(staffCalls,1);
  const member=PRESET_ANIME.find(a=>a.franchise&&recommendations.some(e=>e.anime.id===a.id));
  if(member){const withoutMember=await anilistDataSource.getRecommendations(va,[member.franchise!.members.at(-1)!.id]);assert(withoutMember.every(e=>e.anime.id!==member.id));}
  console.log(`FILMOGRAPHY ${film.length} unique franchise/character roles; recommendations: ${recommendations.map(e=>e.anime.title.romaji).join(' / ')}`);
 }finally{globalThis.fetch=original;}
 console.log('PASS live: all title IDs, Korean/Latin mainline search, Wikidata bridge, franchise roots, filmography and recommendations.');
}
