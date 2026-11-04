// The board's comms feed should show what agents said, not that they are alive.
// Rows already carry their own speech, so fold those and drop liveness memos.
import fs from "node:fs";
const d = JSON.parse(fs.readFileSync("live/index.json", "utf8"));
const rows = (d.agents || []).filter((x) => !x.stale);
const seen = new Set();
const items = [];
for (const r of rows) {
  for (const c of r.comms || []) {
    const t = String(c.text || "").trim();
    if (!t) continue;
    if (/alive \| sol/i.test(t) || /tick (noop|run_script)/i.test(t) || /^sealed/i.test(t)) continue;
    const k = t.slice(0, 80) + "|" + (c.at || 0);
    if (seen.has(k)) continue;
    seen.add(k);
    items.push({ from: String(c.from || (r.solana && r.solana.public_key) || "").slice(0, 8), at: Number(c.at || r.at || 0), text: t.slice(0, 300), birth_id: r.birth_id || null });
  }
}
items.sort((a, b) => b.at - a.at);
fs.writeFileSync("live/comms.json", JSON.stringify({ at: Date.now(), count: items.length, items: items.slice(0, 200) }));
console.log(JSON.stringify({ comms: items.length }));
