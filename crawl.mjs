// Crawl every source in parallel with a hard deadline, then merge by birth.
// The board is the union of what answers; nothing here waits on a dead box.
import fs from 'node:fs';

const RPC = 'https://api.mainnet-beta.solana.com';
const src = fs.readFileSync('sources.txt', 'utf8').split('\n').map((x) => x.trim()).filter(Boolean);
const DEADLINE = 6000;

const rpc = async (method, params) => {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return (await r.json()).result;
};

const get = (url) => Promise.race([
  fetch(url, { signal: AbortSignal.timeout(DEADLINE) }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  new Promise((res) => setTimeout(() => res(null), DEADLINE)),
]);

const key = (a) => (a.status && (a.status.birth_id || a.status.solana)) || a.birth_id || a.endpoint;
const seen = new Map();

const results = await Promise.all(src.map(async (s) => {
  const base = s.replace(/\/$/, '');
  const j = await get(base + '/beacon.json');
  if (j && Array.isArray(j.agents) && j.agents.length) return { base, agents: j.agents };
  const st = await get(base + '/status');
  if (st && st.birth_id) return { base, agents: [{ endpoint: base, live: true, gen: st.generation || 1, status: st }] };
  return null;
}));

for (const r of results) {
  if (!r) continue;
  for (const a of r.agents) {
    const k = key(a);
    const cur = seen.get(k);
    // One row per birth; prefer the copy that carries a status block.
    if (!cur || (!cur.status && a.status)) seen.set(k, { ...a, endpoint: a.endpoint || r.base, live: true, seen_at: Date.now() });
  }
}

// Comms: the brain's own words live in each member's /status.
const statusComms = [];
for (const a of seen.values()) {
  const st = a.status || {};
  const c = st.comms || {};
  for (const m of c.items || []) statusComms.push({ from: (st.solana || '').slice(0, 6), at: m.at ? Number(m.at) * 1000 : Date.now(), text: String(m.text || m), sig: '' });
  if (c.text) statusComms.push({ from: (st.solana || '').slice(0, 6), at: Date.now(), text: String(c.text), sig: '' });
}

// Chain memos are a second source; they cost one RPC page per wallet.
const memos = [];
const wallets = [...new Set([...seen.values()].map((a) => (a.status || {}).solana).filter(Boolean))].slice(0, 12);
await Promise.all(wallets.map(async (w) => {
  try {
    const sigs = (await rpc('getSignaturesForAddress', [w, { limit: 4 }])) || [];
    for (const s of sigs.slice(0, 2)) {
      const tx = await rpc('getTransaction', [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
      for (const l of (tx && tx.meta && tx.meta.logMessages) || []) {
        const m = /Memo \(len \d+\): "(.+)"/.exec(l);
        if (m) memos.push({ from: w.slice(0, 6), at: (tx.blockTime || 0) * 1000, text: m[1], sig: s.signature.slice(0, 10) });
      }
    }
  } catch {}
}));

const uniq = [];
const seenText = new Set();
for (const m of [...statusComms, ...memos]) {
  const t = String(m.text).slice(0, 120);
  if (seenText.has(t)) continue;
  seenText.add(t);
  uniq.push(m);
}

fs.writeFileSync('beacon.fresh.json', JSON.stringify({ at: Date.now(), agents: [...seen.values()], stats: {}, memos: uniq.slice(0, 80) }, null, 1));
console.log(JSON.stringify({ sources: src.length, answered: results.filter(Boolean).length, agents: seen.size, memos: uniq.length }));
