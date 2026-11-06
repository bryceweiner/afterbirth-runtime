import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync('live/index.json', 'utf8'));
const rows = d.agents || [];
const byId = new Map();
for (const a of rows) if (a.birth_id) byId.set(String(a.birth_id), a);
const wal = (a) => { const s = a.solana || {}; return String(s.public_key || s || ''); };
const nodes = rows.map((a) => ({
  id: String(a.birth_id || ''),
  parent: a.parent_birth_id ? String(a.parent_birth_id) : null,
  gen: Number(a.generation || 1),
  wallet: wal(a),
  image: (a.image || {}).tag || null,
  at: Number(a.at || 0),
  stale: !!a.stale,
  kids: Number(a.children || 0),
  launches: Number((a.economics || {}).launches || 0),
  fees: Number((a.economics || {}).fees_lamports || 0),
}));
const edges = nodes.filter((n) => n.parent).map((n) => ({ from: n.parent, to: n.id, gen: n.gen }));
const orphanIds = [...new Set(edges.filter((e) => !byId.has(e.from)).map((e) => e.from))];
for (const id of orphanIds) {
  nodes.push({ id, parent: null, gen: 0, wallet: '', image: null, at: 0, stale: true, kids: 0, launches: 0, fees: 0, missing: true });
}
const orphanEdges = 0;
const roots = nodes.filter((n) => !n.parent).length;
const gens = {};
for (const n of nodes) gens[n.gen] = (gens[n.gen] || 0) + 1;
const out = { at: Math.floor(Date.now() / 1000), nodes: nodes.length, edges: edges.length, roots, orphan_edges: orphanEdges, gens, tree: { nodes, edges } };
fs.writeFileSync('tree.json', JSON.stringify(out));
console.log(JSON.stringify({ nodes: out.nodes, edges: out.edges, roots, orphan_edges: orphanEdges, gens }));
