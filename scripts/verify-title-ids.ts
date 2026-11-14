import assert from 'node:assert/strict';
import { KO_TITLES } from '../src/data/koreanTitles';
for (let i=0;i<KO_TITLES.length;i+=8) {
  const batch=KO_TITLES.slice(i,i+8);
  const query=`{${batch.map((t,j)=>`a${j}:Media(id:${t.id},type:ANIME){id type format title{romaji native}}`).join(' ')}}`;
  let body;
  for(let attempt=0;attempt<3;attempt++){
    const r=await fetch('https://graphql.anilist.co',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query})});
    if(r.status===429&&attempt<2){await new Promise(r2=>setTimeout(r2,Math.max(1000,Number(r.headers.get('Retry-After')??60)*1000)));continue;}
    assert(r.ok,`HTTP ${r.status}`);body=await r.json();assert(!body.errors,JSON.stringify(body.errors));break;
  }
  for(const [j,t]of batch.entries()){const m=body.data[`a${j}`];assert.equal(m?.id,t.id);assert.equal(m.type,'ANIME');assert(['TV','TV_SHORT','MOVIE','ONA'].includes(m.format));console.log(`${t.id}: ${t.ko} → ${m.title.romaji}`);}
  await new Promise(r=>setTimeout(r,750));
}
console.log(`PASS ${KO_TITLES.length} Korean title ids verified.`);
