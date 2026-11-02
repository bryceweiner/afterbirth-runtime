// Crawl every source in sources.txt, then ship memos too. The browser cannot read
// on-chain memos (CORS, rate limits), so this runs server-side and writes the board.
import fs from 'node:fs';

const RPC = 'https://api.mainnet-beta.solana.com';
const src = fs.readFileSync('sources.txt', 'utf8').split('\n').map((x) => x.trim()).filter(Boolean);

const rpc = async (method, params) => {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return (await r.json()).result;
};

const key = (a) => (a.status && (a.status.birth_id || a.status.solana)) || a.birth_id || a.endpoint;
const by = new Map();

for (const s of src) {
  const base = s.replace(/\/$/, '');
  let j = null;
  try { j = await (await fetch(base + '/beacon.json', { signal: AbortSignal.timeout(12000) })).json(); } catch {}
  if (j && Array.isArray(j.agents)) {
    for (const a of j.agents) by.set(key(a), { ...(by.get(key(a)) || {}), ...a, live: true, seen_at: Date.now() });
  }
  if (!j || !Array.isArray(j.agents) || !j.agents.length) {
    try {
      const st = await (await fetch(base + '/status', { signal: AbortSignal.timeout(10000) })).json();
      if (st && st.birth_id) by.set(key({ status: st }), { endpoint: base, live: true, gen: st.generation || 1, status: st, seen_at: Date.now() });
    } catch {}
  }
}

// Comms live in each member's /status (the brain's own words). Chain memos are a
// second source: read both, prefer the status text when present.
const statusComms = [];
for (const a of by.values()) {
  const c = (a.status || {}).comms || {};
  for (const m of c.items || []) statusComms.push({ from: ((a.status || {}).solana || '').slice(0, 6), at: m.at ? Number(m.at) * 1000 : Date.now(), text: String(m.text || m), sig: '' });
  if (c.last && c.text) statusComms.push({ from: ((a.status || {}).solana || '').slice(0, 6), at: Date.now(), text: String(c.text), sig: '' });
}

// Memos: one page of signatures per wallet, memo instruction text from the logs.
const memos = [];
const wallets = [...new Set([...by.values()].map((a) => (a.status || {}).solana).filter(Boolean))].slice(0, 14);
for (const w of wallets) {
  try {
    const sigs = (await rpc('getSignaturesForAddress', [w, { limit: 6 }])) || [];
    for (const s of sigs.slice(0, 3)) {
      const tx = await rpc('getTransaction', [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
      const logs = (tx && tx.meta && tx.meta.logMessages) || [];
      for (const l of logs) {
        const m = /Memo \(len \d+\): "(.+)"/.exec(l);
        if (m) memos.push({ from: w.slice(0, 6), at: (tx.blockTime || 0) * 1000, text: m[1], sig: s.signature.slice(0, 10) });
      }
    }
  } catch {}
}

const allMemos = [...statusComms, ...memos].slice(0, 80);
fs.writeFileSync('beacon.fresh.json', JSON.stringify({ at: Date.now(), agents: [...by.values()], stats: {}, memos: allMemos }, null, 1));
console.log('crawled', by.size, 'of', src.length, 'memos', memos.length, 'statusComms', statusComms.length);
