import { Connection, PublicKey } from 'C:/Users/User/birth-image/runtime/node_modules/@solana/web3.js';
const CH = new PublicKey('BADGwMaBh5icre6MsL5FfWTcBE5bAp8wZqc17QvkojXV');
const c = new Connection('https://solana-rpc.publicnode.com', { commitment: 'confirmed' });
const sigs = await c.getSignaturesForAddress(CH, { limit: 300 });
const sets = new Map();
for (const s of sigs) {
  const tx = await c.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' }).catch(() => null);
  if (!tx) continue;
  const logs = (tx.meta?.logMessages || []).join('\n');
  const mm = logs.match(/"MV\d?\|[^"]+"/g) || [];
  for (const raw of mm) {
    const t = raw.slice(1, -1);
    const m2 = t.match(/^MV2\|([0-9a-f]{8})\|([^|]+)\|(\d+)\/(\d+)\|(.+)$/);
    const m1 = m2 ? null : t.match(/^MV\|([^|]+)\|(\d+)\/(\d+)\|(.+)$/);
    const name = m2 ? m2[2] : m1 && m1[1];
    const i = m2 ? Number(m2[3]) : m1 && Number(m1[2]);
    const n = m2 ? Number(m2[4]) : m1 && Number(m1[3]);
    const chunk = m2 ? m2[5] : m1 && m1[4];
    if (!name) continue;
    const set = sets.get(name) || { total: n, parts: {} };
    set.parts[i] = chunk; set.total = n; sets.set(name, set);
  }
}
for (const [name, set] of sets) {
  let b64 = ''; for (let i = 1; i <= set.total; i++) b64 += set.parts[i] || '';
  const src = Buffer.from(b64, 'base64').toString('utf8');
  if (!/^teaching_0/.test(name)) continue;
  console.log('===', name, src.length, 'bytes');
  console.log(src);
}
