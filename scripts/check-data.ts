import assert from 'node:assert/strict';
import { KO_NAMES } from '../src/data/koreanNames';
import { KO_TITLES } from '../src/data/koreanTitles';
import { PRESET_ANIME } from '../src/data/presetAnime';
import { chosung, ensureKoName, hangulToRomaji, isHangul, matchTier, normalizeKey, romajiToHangul, transliterateName } from '../src/services/localize';
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
import { KO_CHARACTERS } from '../src/data/koreanCharacters';
import characterSource from './ko-character-source.mjs';
import { cachedKoreanName, resolveKoreanNames } from '../src/services/koreanNameResolver';
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

assert.equal(chosung('비스크 돌'), 'ㅂㅅㅋㄷ');
assert.equal(chosung('ㅂㅅㅋ ㄷ'), 'ㅂㅅㅋㄷ');
assert.equal(normalizeKey(' ＡＢＣ · 비스크-돌! １２ '),'abc비스크돌12');
assert(isHangul('가')); assert(isHangul('ㅂㅅ')); assert(!isHangul('kana あ'));
assert.equal(matchTier('비스크돌',['비스크 돌']),0);
assert.equal(matchTier('비스',['비스크 돌']),1);
assert.equal(matchTier('스크',['비스크 돌']),2);
assert.equal(matchTier('ㅂㅅㅋ ㄷ',['그 비스크 돌은 사랑을 한다','비스크 돌']),3);
assert.equal(matchTier('없는말',['비스크 돌']),4);
for(const [en,ko]of [['Hattori','핫토리'],['Yuuji','유지'],['Kenjirou','켄지로'],['Shouyou','쇼요'],['Oo','오'],['Tōkyō','토쿄'],["Shin'ya",'신야'],['Kanna','칸나'],['Kann','칸'],['Kei','케'],['Keiji','케이지'],['Reina','레이나'],['She','셰'],['Che','체'],['Je','제']])assert.equal(romajiToHangul(en!),ko,en);
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
for(const [kana,ko] of Object.entries({'ザイン':'자인','フェルン':'페른','シュタルク':'슈타르크','ゼーリエ':'제리에','アウラ':'아우라','フリーレン':'프리렌','ドラート':'드라트','ハイター':'하이터','アイゼン':'아이젠','フランメ':'프란메','ベル':'벨','ユーベル':'유벨','ティファニー':'티파니','ヴァイオレット':'바이오렛트','ふりーれん':'프리렌','キット':'킷트'}))assert.equal(kanaToHangul(kana),ko,kana);
assert.equal(ensureKoName({full:'Sein',native:'ザイン'}).ko,'자인');
assert.equal(ensureKoName({full:'Sein',native:'ザイン',ko:'기존 이름'},{kind:'character',id:205177}).ko,'기존 이름');
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
  assert.equal(ensureKoName({full:'',native:query.native},query).ko,value.ko,key);
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
