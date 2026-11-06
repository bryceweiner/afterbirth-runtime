import fs from 'node:fs';
const idx = JSON.parse(fs.readFileSync('live/index.json','utf8'));
const mv = JSON.parse(fs.readFileSync('live/moves.json','utf8')).moves || [];
const cm = JSON.parse(fs.readFileSync('live/comms.json','utf8')).items || [];
const mk = JSON.parse(fs.readFileSync('live/merkle.json','utf8'));
const live = (idx.agents||[]).filter(a=>!a.stale);
const gens = {}; for (const a of live) gens[a.generation||1]=(gens[a.generation||1]||0)+1;
const w=(a)=>{const s=a.solana||{};return String(s.public_key||s||'').slice(0,8)};
const byW=new Map(live.map(a=>[w(a),a]));
const hopNames={}; for(const m of mv) if(m.name&&/\.hop\d+\.mjs$/.test(m.name)) hopNames[m.name]=(hopNames[m.name]||0)+1;
const livingSources=mv.filter(m=>m.dir==='in'&&byW.has(String(m.from||'').slice(0,8)));
const speech=cm.filter(m=>!/tick/i.test(m.text));
const fees=live.reduce((s,a)=>s+Number((a.economics||{}).fees_lamports||0),0);
const launches=live.reduce((s,a)=>s+Number((a.economics||{}).launches||0),0);
const sells=live.reduce((s,a)=>s+Number((a.economics||{}).sells||0),0);
const kids=live.reduce((s,a)=>s+Number(a.children||0),0);
console.log(JSON.stringify({at:new Date().toISOString().slice(11,19),live:live.length,gens,births_recorded:kids,moves:mv.length,
 taught:mv.filter(m=>m.dir==='out').length,learned:mv.filter(m=>m.dir==='in').length,
 hop2:mv.filter(m=>m.hop===2).length,hop3:mv.filter(m=>m.hop>=3).length,hop_named:hopNames,
 in_edges_citing_a_living_wallet:livingSources.length,answers:mv.filter(m=>m.dir==='answer').length,
 ran:mv.filter(m=>m.ran).length,comms:cm.length,speech:speech.length,launches,sells,
 fees_sol:(fees/1e9).toFixed(4),merkle_root:String(mk.root||'').slice(0,16),merkle_leaves:mk.leaves,anchored:mk.anchored},null,1));
