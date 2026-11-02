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

// Transitive discovery: any member that reports children hands us their endpoints, so
// the board tracks descendants without a human maintaining sources.txt.
const discovered = [];
for (const r of results) {
  if (!r) continue;
  for (const a of r.agents) {
    for (const kid of ((a.status || {}).children || [])) {
      const ep = kid && kid.endpoint;
      if (ep && !src.includes(ep) && !discovered.includes(ep)) discovered.push(ep);
    }
  }
}
const extra = await Promise.all(discovered.slice(0, 40).map(async (base) => {
  const st = await get(base.replace(/\/$/, '') + '/status');
  return st && st.birth_id ? { base, agents: [{ endpoint: base, live: true, gen: st.generation || 1, status: st }] } : null;
}));
results.push(...extra);
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

// GDP needs a time series, not a snapshot: append one row per crawl and keep a year.
const price = Number(process.env.SOL_USD || 0) || null;
let hist = [];
try { hist = JSON.parse(fs.readFileSync('history.json', 'utf8')); } catch {}
const live = [...seen.values()].filter((a) => a.status);
let sol = 0, usdc = 0, realized = 0n, launched = 0, scripts = 0;
for (const a of live) {
  const st = a.status || {};
  const e = st.economics || {};
  sol += Number((st.strategy || {}).sol_raw || 0) / 1e9;
  usdc += Number((st.strategy || {}).usdc_raw || 0) / 1e6;
  realized += BigInt(e.realized_lamports || 0);
  launched += Number(e.launches || 0);
  scripts += Number((st.invention || {}).scripts || 0);
}
const nw = sol + usdc / 150;                       // USDC folded in at a conservative SOL price
const prev = hist.length ? hist[hist.length - 1] : null;
const prevNw = prev ? (Number(prev.sol || 0) + Number(prev.usdc || 0) / 150) : null;
// GDP is value ADDED, not value held: the positive change in net worth since the last
// row, accumulated from genesis. Initial endowments therefore count once, at the row
// where they land, and a drawdown does not subtract from what was already produced.
// Deposits are funding, not production: GDP counts what the fleet's own actions
// produced (realized proceeds plus the value it holds at curve), never capital that
// was wired in from outside.
const prod = [...seen.values()].reduce((sum, a) => {
  const e = ((a.status || {}).economics) || {};
  return sum + Number(e.realized_lamports || 0) / 1e9 + Number(e.value_sol || 0);
}, 0);
const prevProd = prev && prev.prod != null ? Number(prev.prod) : null;
const added = prevProd === null ? 0 : Math.max(0, prod - prevProd);
const gdp = (prev ? Number(prev.gdp || 0) : 0) + added;
hist.push({ at: Date.now(), agents: live.length, sol: +sol.toFixed(6), usdc: +usdc.toFixed(4), realized_sol: +(Number(realized) / 1e9).toFixed(6), launches: launched, scripts, nw: +nw.toFixed(6), prod: +prod.toFixed(6), gdp: +gdp.toFixed(6), added: +added.toFixed(6) });
hist = hist.slice(-8000);
fs.writeFileSync('history.json', JSON.stringify(hist, null, 1));

fs.writeFileSync('beacon.fresh.json', JSON.stringify({ at: Date.now(), agents: [...seen.values()], stats: {}, memos: uniq.slice(0, 80) }, null, 1));
console.log(JSON.stringify({ sources: src.length, answered: results.filter(Boolean).length, agents: seen.size, memos: uniq.length }));
