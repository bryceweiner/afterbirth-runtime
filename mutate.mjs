import fs from 'node:fs';
const mv = (JSON.parse(fs.readFileSync('live/moves.json', 'utf8')).moves || []).slice().sort((a, b) => (a.at || 0) - (b.at || 0));
const originOf = (n) => String(n || '').replace(/\.hop\d+\.mjs$/, '').replace(/\.v\d+$/, '').replace(/^learned_/, '').replace(/\.mjs$/, '');
// Track each origin's published sizes over time. A copy that carries only the credit
// line grows by the citation (~25 bytes); any other delta is a mutation of the idea.
const base = new Map();
const mutations = [];
for (const m of mv) {
  const name = String(m.name || '');
  const bytes = Number(m.bytes || 0);
  if (!name || !bytes) continue;
  const o = originOf(name);
  if (!base.has(o)) { base.set(o, bytes); continue; }
  const b0 = base.get(o);
  const delta = bytes - b0;
  if (Math.abs(delta) > 25 && Math.abs(delta) % 25 !== 0) {
    mutations.push({ at: new Date((m.at || 0) * 1000).toISOString().slice(11, 19), agent: String(m.agent || '').slice(0, 8), name, origin: o, bytes, base: b0, delta, dir: m.dir, hop: m.hop || 1 });
  }
}
const byOrigin = {};
for (const x of mutations) byOrigin[x.origin] = (byOrigin[x.origin] || 0) + 1;
console.log(JSON.stringify({
  moves: mv.length,
  origins: base.size,
  mutations: mutations.length,
  mutated_origins: Object.entries(byOrigin).sort((a, b) => b[1] - a[1]),
  samples: mutations.slice(-8),
  sizes_per_origin: [...base.entries()].slice(0, 12),
}, null, 1));
