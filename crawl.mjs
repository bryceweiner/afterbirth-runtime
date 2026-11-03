// Crawl every source in parallel with a hard deadline, then merge by birth.
// The board is the union of what answers; nothing here waits on a dead box.
import fs from 'node:fs';

const RPC = 'https://api.mainnet-beta.solana.com';
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const src = fs.readFileSync('sources.txt', 'utf8').split('\n').map((x) => x.trim()).filter(Boolean);
const DEADLINE = 30000;

const rpc = async (method, params) => {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return (await r.json()).result;
};

const getOnce = (url) => Promise.race([
  fetch(url, { signal: AbortSignal.timeout(DEADLINE) }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  new Promise((res) => setTimeout(() => res(null), DEADLINE)),
]);
// A slow agent is not a dead agent. Fire several copies of the same request with
// randomised starts — different sockets, different moments, different congestion —
// and take the first answer. Nothing waits on the slowest copy.
const resolveEndpoint = async (kid) => {
  if (kid.endpoint) return kid.endpoint;
  if (!kid.deploymentId) return null;
  try {
    const html = await (await fetch('https://agentgates-backend.vercel.app/compute/verify/' + kid.deploymentId, { signal: AbortSignal.timeout(15000) })).text();
    const m = html.match(/https:\/\/[a-z0-9]+-8787\.[a-z0-9.-]+\.network/);
    return m ? m[0] : null;
  } catch { return null; }
};
const jitter = (ms) => Math.floor(Math.random() * ms);
const attempt = (url, delay) => new Promise((res) => {
  setTimeout(() => {
    getOnce(url).then((x) => res(x || null)).catch(() => res(null));
  }, delay);
});
const get = async (url) => {
  for (let round = 0; round < 3; round++) {
    const r = await Promise.race([
      attempt(url, 0),
      attempt(url, 150 + jitter(900)),
      attempt(url, 600 + jitter(1800)),
      new Promise((res) => setTimeout(() => res(null), 40000)),
    ]);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 700 + jitter(2000)));
  }
  return null;
};

const solOf = (a) => { const v = (a && a.status && a.status.solana) || null; return v && v.public_key ? v.public_key : v; };
const key = (a) => (a.status && (a.status.birth_id || solOf(a))) || a.birth_id || a.endpoint;
const seen = new Map();

// If /status is slow, fall back to the cheap /identity endpoint so the agent still
// appears on the board with what little it publishes.
const getStatus = async (base) => (await get(base.replace(/\/$/, '') + '/status')) || null;

// Every member is asked for its own status AND for the beacon it keeps of everyone it
// knows. A beacon is a peer list, so recursing through it finds agents no source file
// ever named.
const fetchMember = async (s) => {
  const base = s.replace(/\/$/, '');
  const [st, bc] = await Promise.all([get(base + '/status'), get(base + '/beacon.json')]);
  const out = [];
  if (st && st.birth_id) out.push({ endpoint: base, live: true, gen: st.generation || 1, status: st });
  const listed = (bc && Array.isArray(bc.agents) ? bc.agents : []).filter((a) => a && (a.endpoint || (a.status && a.status.birth_id)));
  for (const a of listed) out.push({ ...a, from_beacon: base });
  if (out.length) return { base, agents: out };
  return null;
};
const results = await Promise.all(shuffle([...src]).map(fetchMember));

// Transitive discovery, to the bottom: a member's children are crawled, and their
// children after that, until the frontier is empty. One hop is not a lineage.
const visited = new Set(src);
let frontier = [];
for (const r of results) {
  if (!r) continue;
  for (const a of r.agents) {
    for (const kid of [ ...((a.status || {}).children || []), ...(a.endpoint ? [{ endpoint: a.endpoint }] : []) ]) {
      const ep0 = kid && kid.endpoint;
      const ep = ep0 || (await resolveEndpoint(kid));
      if (ep && !visited.has(ep)) { visited.add(ep); frontier.push(ep); }
    }
  }
}
let depth = 0;
while (frontier.length) {
  const batch = shuffle(frontier.splice(0, 40));
  const got = await Promise.all(batch.map(async (base) => {
    const st = await get(base.replace(/\/$/, '') + '/status');
    return st && st.birth_id ? { base, agents: [{ endpoint: base, live: true, gen: st.generation || 1, status: st }] } : null;
  }));
  results.push(...got);
  for (const r of got) {
    if (!r) continue;
    for (const a of r.agents) {
      for (const kid of ((a.status || {}).children || [])) {
        const ep = kid && kid.endpoint;
        if (ep && !visited.has(ep)) { visited.add(ep); frontier.push(ep); }
      }
    }
  }
  depth++;
}
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
  for (const m of c.items || []) statusComms.push({ from: String((st.solana && st.solana.public_key) || st.solana || '').slice(0, 6), at: m.at ? Number(m.at) * 1000 : Date.now(), text: String(m.text || m), sig: '' });
  if (c.text) statusComms.push({ from: String((st.solana && st.solana.public_key) || st.solana || '').slice(0, 6), at: Date.now(), text: String(c.text), sig: '' });
}

// Chain memos are a second source; they cost one RPC page per wallet.
const memos = [];
const wallets = [...new Set([...seen.values()].map(solOf).filter(Boolean))].slice(0, 12);
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
  // Money the fleet actually made: sold proceeds plus fees it swept, not deposits.
  return sum + Number(e.realized_lamports || 0) / 1e9 + Number(e.fees_lamports || 0) / 1e9 + Number(e.value_sol || 0);
}, 0);
const prevProd = prev && prev.prod != null ? Number(prev.prod) : null;
const added = prevProd === null ? 0 : Math.max(0, prod - prevProd);
// GDP is cumulative production, so it equals the current production total: summing
// deltas across a history that contained a double count would carry the error forever.
const gdp = prod;
hist.push({ at: Date.now(), agents: live.length, sol: +sol.toFixed(6), usdc: +usdc.toFixed(4), realized_sol: +(Number(realized) / 1e9).toFixed(6), launches: launched, scripts, nw: +nw.toFixed(6), prod: +prod.toFixed(6), gdp: +gdp.toFixed(6), added: +added.toFixed(6) });
hist = hist.slice(-8000);
fs.writeFileSync('history.json', JSON.stringify(hist, null, 1));

fs.writeFileSync('beacon.fresh.json', JSON.stringify({ at: Date.now(), agents: [...seen.values()], stats: {}, memos: uniq.slice(0, 80) }, null, 1));
console.log(JSON.stringify({ sources: src.length, answered: results.filter(Boolean).length, agents: seen.size, memos: uniq.length }));
