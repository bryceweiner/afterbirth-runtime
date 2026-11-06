// The teaching record, as its own file. The board reads this instead of hoping the
// row that happens to be fresh still carries the move.
import fs from "node:fs";
const d = JSON.parse(fs.readFileSync("live/index.json", "utf8"));
const out = [];
for (const a of d.agents || []) {
  for (const m of a.moves || []) {
    out.push({ ...m, agent: String(a.birth_id || "").slice(0, 8), gen: Number(a.generation || 1), at: Number(m.at || 0) });
  }
}
out.sort((x, y) => y.at - x.at);
// Two different numbers: individual lineage events, and the per-box totals the
// board headlines. Publishing only the first made the board disagree with itself.
const boxes = (d.agents || []).filter((a) => !a.stale);
const taught = boxes.reduce((s2, a) => s2 + ((a.moves_counts || {}).out || 0), 0);
const learned = boxes.reduce((s2, a) => s2 + ((a.moves_counts || {}).in || 0), 0);
fs.writeFileSync("live/moves.json", JSON.stringify({ at: Date.now(), events: out.length, taught, learned, count: taught + learned, moves: out.slice(0, 500) }));
console.log(JSON.stringify({ events: out.length, taught, learned }));
