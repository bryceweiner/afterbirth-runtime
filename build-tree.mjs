import fs from 'node:fs';
import crypto from 'node:crypto';
import nacl from 'tweetnacl';
const H=(b)=>crypto.createHash('sha256').update(b).digest();
const leafOf=(id,w)=>H(Buffer.from(`${id}:${w}`));
const beacon=JSON.parse(fs.readFileSync('beacon.json','utf8'));
const rows=[];
for(const a of beacon.agents||[]){const st=a.status||{};if(st.birth_id&&st.solana)rows.push({birth_id:st.birth_id,solana:st.solana,gen:st.generation||1,endpoint:a.endpoint});}
const seen=new Set();const uniq=rows.filter(r=>{const k=r.birth_id;if(seen.has(k))return false;seen.add(k);return true;});
const leaves=uniq.map(r=>leafOf(r.birth_id,r.solana).toString('hex'));
let cur=leaves.slice().sort();
const levels=[cur];
while(cur.length>1){const nx=[];for(let i=0;i<cur.length;i+=2){const a=cur[i],b=cur[i+1]||cur[i];nx.push(Buffer.concat([Buffer.from(a,'hex'),Buffer.from(b,'hex')]).length?H(Buffer.concat([Buffer.from(a,'hex'),Buffer.from(b,'hex')])).toString('hex'):a);}cur=nx;levels.push(cur);}
const root=cur[0]||H(Buffer.from('empty')).toString('hex');
const kp=nacl.sign.keyPair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('C:/Users/User/Documents/ach-keypair.json','utf8'))));
const sig=Buffer.from(nacl.sign.detached(Buffer.from(root,'hex'),kp.secretKey)).toString('base64');
const out={root,built_at:Math.floor(Date.now()/1000),founder:Buffer.from(kp.publicKey).toString('base64'),signature:sig,leaves:uniq,levels:levels.length,algorithm:'sha256-pairs'};
fs.writeFileSync('tree.json',JSON.stringify(out,null,1));
console.log('root',root.slice(0,16),'leaves',uniq.length,'gens',[...new Set(uniq.map(r=>r.gen))]);
