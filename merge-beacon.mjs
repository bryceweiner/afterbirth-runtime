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
  by.set(k, { ...prev, ...a, first_seen: prev.first_seen || a.first_seen || a.seen_at || Date.now(), live: a.live !== false });
}
const agents = [...by.values()].sort((x, y) => (y.live ? 1 : 0) - (x.live ? 1 : 0) || (y.gen || 0) - (x.gen || 0));
const out = { ...fresh, agents, crawled: true, merged_at: Date.now(), total_seen: agents.length, live: agents.filter((a) => a.live).length };
fs.writeFileSync('beacon.json', JSON.stringify(out, null, 2));
fs.writeFileSync('tree.json', JSON.stringify(out.tree || fresh.tree || {}, null, 2));
console.log(JSON.stringify({ live: out.live, total: out.total_seen }));
