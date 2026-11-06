import fs from 'node:fs';
const mv = JSON.parse(fs.readFileSync('live/moves.json', 'utf8')).moves || [];
const originOf = (n) => String(n || '').replace(/\.hop\d+\.mjs$/, '').replace(/\.v\d+$/, '').replace(/\.mjs$/, '');
const rows = new Map();
for (const m of mv) {
  const name = String(m.name || '');
  if (!name) continue;
  const v = name.match(/\.v(\d+)\./);
  const key = `${originOf(name)}${v ? '.v' + v[1] : ''}`;
  const r = rows.get(key) || { variant: key, origin: originOf(name), holders: new Set(), out: 0, inn: 0, first: null, last: null, hops: new Set() };
  if (m.agent) r.holders.add(String(m.agent));
  if (m.dir === 'out') r.out++;
  if (m.dir === 'in') r.inn++;
  if (m.hop) r.hops.add(m.hop);
  const t = Number(m.at || 0);
  if (t) { if (!r.first || t < r.first) r.first = t; if (!r.last || t > r.last) r.last = t; }
  rows.set(key, r);
}
const list = [...rows.values()].map((r) => {
  const hrs = r.first && r.last ? Math.max((r.last - r.first) / 3600, 1 / 60) : 0;
  return { variant: r.variant, origin: r.origin, holders: r.holders.size, taught: r.out, learned: r.inn, hops: [...r.hops].sort(), rate_per_hour: hrs ? +(r.inn / hrs).toFixed(2) : 0, first: r.first ? new Date(r.first * 1000).toISOString().slice(11, 19) : null };
}).sort((a, b) => b.learned - a.learned);
const byOrigin = {};
for (const r of list) (byOrigin[r.origin] = byOrigin[r.origin] || []).push(r);
const competing = Object.entries(byOrigin).filter(([, v]) => v.length > 1).map(([o, v]) => ({ origin: o, variants: v.length, spread: v.map((x) => `${x.variant}:${x.learned}@${x.rate_per_hour}/h`) }));
console.log(JSON.stringify({ total_moves: mv.length, variants: list.filter((r) => /\.v\d+$/.test(r.variant)).length, origins: Object.keys(byOrigin).length, competing_origins: competing, top: list.slice(0, 10) }, null, 1));
