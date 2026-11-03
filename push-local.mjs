// One row per member, written by the member's own answer and kept even when it goes
// quiet — absence of a reply is not absence of an agent.
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const OUT = "live";
fs.mkdirSync(OUT, { recursive: true });
const src = fs.readFileSync("sources.txt", "utf8").split(String.fromCharCode(10)).map((x) => x.trim()).filter(Boolean);
let n = 0;
for (const base of src) {
  let st = null, id = null;
  try { st = JSON.parse(execFileSync("curl", ["-sk", "-m", "12", base + "/status"], { encoding: "utf8", maxBuffer: 4e6 })); } catch { continue; }
  try { id = JSON.parse(execFileSync("curl", ["-sk", "-m", "10", base + "/identity"], { encoding: "utf8", maxBuffer: 1e6 })); } catch {}
  if (!st || (!st.birth_id && !st.phase && !st.generation)) continue;
  const key = String(st.birth_id || (id && id.birth_id) || base).replace(/[^a-zA-Z0-9-]/g, "").slice(-42);
  const row = {
    key,
    endpoint: base,
    at: Math.floor(Date.now() / 1000),
    birth_id: st.birth_id || (id && id.birth_id) || null,
    parent_birth_id: st.parent_birth_id || (id && id.parent_birth_id) || null,
    generation: Number(st.generation || (id && id.generation) || 1),
    phase: st.phase || null,
    t0: st.t0 || null,
    solana: (id && id.solana) || st.solana || null,
    evm: (id && id.evm) || st.evm || null,
    image: st.image || null,
    identity_binding: st.identity_binding || null,
    children: (st.children || []).length,
    economics: st.economics || null,
    invention: st.invention || null,
    comms: (st.comms && (st.comms.items || []).slice(-4)) || [],
  };
  fs.writeFileSync(`${OUT}/${key}.json`, JSON.stringify(row, null, 1));
  n++;
}
const now = Math.floor(Date.now() / 1000);
const rows = fs.readdirSync(OUT).filter((f) => f.endsWith(".json") && f !== "index.json").map((f) => {
  try {
    const r = JSON.parse(fs.readFileSync(`${OUT}/${f}`, "utf8"));
    r.stale = (now - Number(r.at || 0)) > 900;
    return r;
  } catch { return null; }
}).filter(Boolean).sort((a, b) => Number(b.generation || 0) - Number(a.generation || 0) || Number(b.at || 0) - Number(a.at || 0));
fs.writeFileSync(`${OUT}/index.json`, JSON.stringify({ at: now, count: rows.length, fresh: rows.filter((r) => !r.stale).length, agents: rows }, null, 1));
console.log(JSON.stringify({ pushed: n, live: rows.length, fresh: rows.filter((r) => !r.stale).length, gens: rows.reduce((m, r) => ((m[r.generation] = (m[r.generation] || 0) + 1), m), {}) }));
