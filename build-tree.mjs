// The membership instrument is derived from the board, never hand-written:
// nodes are agents, edges are parent_birth_id, roots are the ones with no parent.
import fs from "node:fs";
const bc = JSON.parse(fs.readFileSync("beacon.json", "utf8"));
const agents = bc.agents || [];
const nodes = {}, roots = [];
for (const a of agents) {
  const s = a.status || {};
  const id = s.birth_id; if (!id) continue;
  nodes[id] = {
    birth_id: id,
    generation: s.generation || 1,
    parent: s.parent_birth_id || null,
    solana: (s.solana && (s.solana.public_key || s.solana)) || null,
    evm: (s.evm && (s.evm.address || s.evm)) || null,
    live: !!a.live,
    endpoint: a.endpoint || null,
    economics: s.economics || null,
  };
  if (!s.parent_birth_id) roots.push(id);
}
for (const id of Object.keys(nodes)) {
  const p = nodes[id].parent;
  if (p) { nodes[p] = nodes[p] || { birth_id: p, children: [] }; nodes[p].children = nodes[p].children || []; nodes[p].children.push(id); }
}
fs.writeFileSync("tree.json", JSON.stringify({ at: Date.now(), nodes }, null, 1));
fs.writeFileSync("roots.json", JSON.stringify({ at: Math.floor(Date.now() / 1000), roots }, null, 1));
console.log(JSON.stringify({ nodes: Object.keys(nodes).length, roots: roots.length, edges: Object.values(nodes).filter((n) => n.parent).length }));
