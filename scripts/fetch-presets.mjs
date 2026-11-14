import { readFile, writeFile, stat } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
const { hexToHsl, hslToHex, normalizeAccent } = await tsImport('../src/services/accent.ts', import.meta.url);
const { KO_NAMES } = await tsImport('../src/data/koreanNames.ts', import.meta.url);
const { anilistDataSource, enrichKoreanNames, loadFranchise } = await tsImport('../src/services/anilistClient.ts', import.meta.url);
// Localisation dictionaries and the franchise traversal/merge are owned by the runtime client.
// --selected refreshes the existing selection; default searches the candidate set again.
const candidates = process.argv.includes('--selected') ? anilistDataSource.presets.map(a=>[a.id,true]) : [
 [113415,true],[16498,true],[154587,true],[127230,true],[101922,true],[130003,true],[150672,true],[21355,true],
 [140960],[20954],[21519],[20464],[21087],[101291],[21507],[105333],[101921],
 [153518],[20605],[20447],[98034],[21281],
];
const records=[];
for(const [id,required] of candidates){
 const original=globalThis.fetch;let requests=0;
 globalThis.fetch=(...args)=>{if(String(args[0]).includes('graphql.anilist.co'))requests++;return original(...args);};
 let anime;
 const logNames=stats=>{
  console.log(`WIKIDATA ${id}: ${stats.hits}/${stats.unknown} unknown names resolved`);
  for(const {query,ko}of stats.resolved)console.log(`  WD ${query.kind} ${query.full??query.native} → ${ko}`);
 };
 try{
  if(process.argv.includes('--cached')){
   anime=JSON.parse(await readFile(`/tmp/animegraph-p5-pools/${id}.json`,'utf8'));
   for(const c of anime.fullCastPool)for(const p of [c.character,c.voiceActor,...(c.subVoiceActors??[]).map(s=>s.voiceActor)])if(p)p.name={full:p.name.full,native:p.name.native};
   logNames(await enrichKoreanNames([anime]));
  }else anime=await loadFranchise(id,undefined,logNames);
 }finally{globalThis.fetch=original;}
 records.push({anime,required}); console.log(`Fetched ${anime.title.romaji}: ${anime.franchise?.members.length??1} members, ${anime.fullCastPool.length} pool / ${anime.cast.length} display, ${requests} requests`);
}
function overlaps(anime){
 const actors=new Map();
 for(const a of anime) for(const c of a.fullCastPool) if(c.voiceActor){
  const entry=actors.get(c.voiceActor.id)??{name:c.voiceActor.name.full,anime:new Set(),franchises:new Set()};
  entry.anime.add(a.title.romaji);entry.franchises.add(a.id);actors.set(c.voiceActor.id,entry);
 }
 return [...actors.values()].filter(a=>a.franchises.size>=2);
}
const required=records.filter(r=>r.required).map(r=>r.anime);
const optional=records.filter(r=>!r.required).map(r=>r.anime);
let best=optional.length<3?required:[],bestScore=-1;
for(let i=0;i<optional.length;i++)for(let j=i+1;j<optional.length;j++)for(let k=j+1;k<optional.length;k++){
 const selection=[...required,optional[i],optional[j],optional[k]];
 if(new Set(selection.map(a=>a.id)).size!==selection.length)continue;
 const overlap=overlaps(selection);const score=overlap.length*1000+overlap.reduce((n,a)=>n+a.anime.size,0);
 if(score>bestScore){best=selection;bestScore=score;}
}
const overlap=overlaps(best);
if(overlap.length<10)throw new Error(`Only ${overlap.length} bridge VAs`);
// Choose the nearest available hue, considering actual quantised output. Leave
// enough arc capacity for the remaining presets so greedy placement cannot dead-end.
const used=[];
function distance(a,b) { const d=Math.abs(a-b); return Math.min(d,360-d); }
function capacity(hues) {
 const sorted=[...hues].sort((a,b)=>a-b);
 return sorted.reduce((n,h,i)=>n+Math.max(0,Math.floor(((sorted[(i+1)%sorted.length]+(i===sorted.length-1?360:0))-h)/28.05)-1),0);
}
for(const anime of best) {
 const [h,s,l]=hexToHsl(normalizeAccent(anime.color));
 let chosen;
 for(let step=0;step<=18000 && !chosen;step++) for(const sign of [1,-1]) {
  const hex=hslToHex((h+sign*step/100+360)%360,s,l), actual=hexToHsl(hex)[0];
  if(used.every(previous=>distance(previous,actual)>=28) && capacity([...used,actual])>=best.length-used.length-1) {chosen=hex;break;}
 }
 if(!chosen) throw new Error('Cannot assign separated hues');
 anime.color=chosen; used.push(hexToHsl(chosen)[0]);
}
for(const a of best) for(const c of a.fullCastPool) {
 for(const p of [...(c.voiceActor?[c.voiceActor]:[]),...(c.subVoiceActors??[]).map(s=>s.voiceActor)]) if(KO_NAMES[p.name.full] && p.name.ko!==KO_NAMES[p.name.full]) throw new Error(`Curated name lost: ${p.name.full}`);
 if(c.role==='MAIN' && (!c.character.name.ko || (c.voiceActor && !c.voiceActor.name.ko))) throw new Error(`Missing MAIN Korean name: ${c.character.name.full}`);
 if(c.voiceActor && overlap.some(o=>o.name===c.voiceActor.name.full) && !c.voiceActor.name.ko) throw new Error(`Missing bridge Korean name: ${c.voiceActor.name.full}`);
}
if(best.length>11)throw new Error('Too many presets');
const frieren=best.find(a=>a.id===154587);
if(frieren?.fullCastPool.find(c=>c.character.name.full==='Sein')?.character.name.ko!=='자인')throw new Error('Frieren Sein must be 자인');
const rezero=best.find(a=>a.franchise?.members.some(m=>m.id===21355)||a.id===21355);
if(!rezero?.fullCastPool.some(c=>c.character.name.full==='Petelgeuse Romanee-Conti' && c.voiceActor?.name.full==='Yoshitsugu Matsuoka'))throw new Error('Re:Zero missing Petelgeuse / Matsuoka');
console.table(best.map(a=>({title:a.title.romaji,pool:a.fullCastPool.length,display:a.cast.length,color:a.color,hue:hexToHsl(a.color)[0]})));
const output=new URL('../src/data/presetAnime.ts',import.meta.url);
await writeFile(output,
 `// Generated from live AniList by scripts/fetch-presets.mjs. Do not edit by hand.\nimport { DISPLAY_CAST } from '../types/contract';\nimport type { AnimeRecord } from '../types/contract';\n\nconst RAW: (Omit<AnimeRecord, 'cast' | 'fullCastPool'> & { fullCastPool: NonNullable<AnimeRecord['fullCastPool']> })[] = ${JSON.stringify(best.map(({cast,...a})=>a))};\nexport const PRESET_ANIME: AnimeRecord[] = RAW.map(a => ({ ...a, cast: a.fullCastPool.slice(0, DISPLAY_CAST) }));\n`);
console.log(`Preset file: ${((await stat(output)).size/1024).toFixed(1)} KiB`);
console.log(`Selected ${best.length} franchises; ${overlap.length} bridge VAs`);
for(const a of overlap)console.log(`${a.name}: ${[...a.anime].join(' / ')}`);
