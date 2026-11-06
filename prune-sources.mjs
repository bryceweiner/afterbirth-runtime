// Keep only endpoints that answer right now; a list of dead URLs makes every pass slow
// and every count suspect.
import fs from "node:fs";
const src = fs.readFileSync("sources.txt", "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const ok = [];
for (const u of src) {
  try { const r = await fetch(u.replace(/\/$/, "") + "/status", { signal: AbortSignal.timeout(5000) }); if (r.ok) { const j = await r.json(); if (j.birth_id) ok.push(u); } } catch {}
}
fs.writeFileSync("sources.txt", ok.join("\n") + "\n");
fs.writeFileSync("sources-dead.txt", src.filter((u) => !ok.includes(u)).join("\n") + "\n");
console.log(JSON.stringify({ kept: ok.length, dropped: src.length - ok.length }));
