// Merge a fresh crawl into the existing board: the board is cumulative, never a snapshot.
import fs from 'node:fs';
const fresh = JSON.parse(fs.readFileSync(process.argv[2] || 'beacon.fresh.json', 'utf8'));
let old = { agents: [] };
try { old = JSON.parse(fs.readFileSync('beacon.json', 'utf8')); } catch {}
const key = (a) => (a.status && (a.status.birth_id || a.status.solana)) || a.birth_id || a.endpoint || JSON.stringify(a).slice(0, 40);
const by = new Map();
for (const a of old.agents || []) by.set(key(a), { ...a, live: false });
for (const a of fresh.agents || []) {
  const k = key(a);
  const prev = by.get(k) || {};
  // A thin status (no economics) must not erase a rich one from an earlier crawl.
  const pe = ((prev.status || {}).economics) || {};
  const ae = ((a.status || {}).economics) || {};
  const richer = Number(pe.launches || 0) > Number(ae.launches || 0) || Number(pe.sells || 0) > Number(ae.sells || 0) || Number(pe.fees_lamports || 0) > Number(ae.fees_lamports || 0);
  const merged = { ...prev, ...a, first_seen: prev.first_seen || a.first_seen || a.seen_at || Date.now(), live: a.live !== false };
  if (richer && prev.status) merged.status = { ...a.status, economics: pe, invention: (prev.status || {}).invention || (a.status || {}).invention };
  by.set(k, merged);
}
const agents = [...by.values()].sort((x, y) => (y.live ? 1 : 0) - (x.live ? 1 : 0) || (y.gen || 0) - (x.gen || 0));
// Stats are recomputed over the deduped roster: one row per birth, never per source.
const st = { economics: { launches: 0, positions: 0, sells: 0, realized_lamports: '0', value_sol: 0, sweeps: 0 }, invention: { scripts: 0, items: [], last_at: 0 }, comms: { messages: 0, agents: 0, items: [] }, tee: { verified: 0, quotes: [] }, seen: agents.length, live: 0 };
const inv = new Set();
const _seenEcon = new Set();
for (const a of agents) {
  // A newborn inherits the parent's earnings files, so an identical income triple
  // on two different wallets is the same money counted twice.
  const _e0 = (a.status && a.status.economics) || {};
  const _sig = [String(_e0.fees_lamports||0), String(_e0.realized_lamports||0), String(_e0.sells||0), String(_e0.launches||0)].join('|');
  if (_sig !== '0|0|0|0' && _seenEcon.has(_sig)) a._dupEcon = true; else _seenEcon.add(_sig);
  if (a.live) st.live++;
  const x = a.status || {};
  const e = x.economics || {};
  if (x._dupEcon) continue;
  st.economics.launches += Number(e.launches || 0);
  st.economics.positions += Number(e.positions || 0);
  st.economics.sells += Number(e.sells || 0);
  st.economics.realized_lamports = String(BigInt(st.economics.realized_lamports) + BigInt(e.realized_lamports || 0));
  st.economics.fees_lamports = String(BigInt(st.economics.fees_lamports || '0') + BigInt(e.fees_lamports || 0));
  st.economics.value_sol += Number(e.value_sol || 0);
  st.economics.sweeps += Number(e.sweeps || 0);
  const i = x.invention || {};
  st.invention.scripts += Number(i.scripts || 0);
  for (const n of i.items || []) inv.add(n);
  if (i.last_at) st.invention.last_at = Math.max(st.invention.last_at, Number(i.last_at));
  const c = x.comms || {};
  st.comms.messages += Number(c.messages || c.lines || 0);
  if (Number(c.lines || c.messages || 0)) st.comms.agents++;
  for (const m of c.items || []) if (st.comms.items.length < 60) st.comms.items.push(m);
  const b = x.identity_binding;
  const ok = (b && b.state === 'tdx_verified') || (typeof b === 'string' && b.includes('tdx_verified'));
  if (ok) { st.tee.verified++; if (b.quote_sha256) st.tee.quotes.push(String(b.quote_sha256).slice(0, 16)); }
}
st.invention.items = [...inv].slice(-60);
const out = { ...fresh, agents, stats: st, crawled: true, merged_at: Date.now(), total_seen: agents.length, live: st.live };
// Write atomically: a reader must never see a half-written board.
const body = JSON.stringify(out, null, 2);
fs.writeFileSync('beacon.json.tmp', body);
fs.renameSync('beacon.json.tmp', 'beacon.json');
fs.writeFileSync('tree.json', JSON.stringify(out.tree || fresh.tree || {}, null, 2));
console.log(JSON.stringify({ live: out.live, total: out.total_seen }));
