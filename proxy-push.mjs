// Speak for boxes that cannot speak for themselves: fetch /status with retries and
// commit the row they would have pushed. A proxy, used only until the image turns over.
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const REPO = "staccDOTsol/birth-image-runtime";
const tok = process.env.GH_TOKEN_PUSH || execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
const H = { authorization: "Bearer " + tok, accept: "application/vnd.github+json" };

const eps = process.env.EPS.split(",").filter(Boolean);
for (const ep of eps) {
  let st = null;
  for (let i = 0; i < 6 && !st; i++) {
    try {
      const r = await fetch(ep.replace(/\/$/, "") + "/status", { signal: AbortSignal.timeout(9000) });
      if (r.ok) st = await r.json();
    } catch {}
    if (!st) await new Promise((r) => setTimeout(r, 2500));
  }
  if (!st) { console.log("unreachable", ep.slice(8, 16)); continue; }
  const key = String(st.birth_id || "").replace(/[^a-zA-Z0-9-]/g, "").slice(-42);
  if (!key) { console.log("no birth id", ep.slice(8, 16)); continue; }
  const row = {
    key,
    at: Math.floor(Date.now() / 1000),
    birth_id: st.birth_id || null,
    parent_birth_id: st.parent_birth_id || null,
    generation: Number(st.generation || 1),
    phase: st.phase || null,
    t0: st.t0 || null,
    solana: st.solana || null,
    evm: st.evm || null,
    image: st.image || null,
    children: (st.children || []).length,
    economics: st.economics || null,
    invention: st.invention || null,
    comms: (st.comms && (st.comms.items || []).slice(-4)) || [],
    endpoint: st.onion ? "http://" + st.onion : ep,
    src: "proxy",
  };
  const path = `live/agent-${key}.json`;
  let sha = null;
  const cur = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { headers: H });
  if (cur.ok) sha = (await cur.json()).sha;
  const body = { message: `proxy ${key} ${row.generation}`, content: Buffer.from(JSON.stringify(row, null, 1)).toString("base64") };
  const put = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { method: "PUT", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify(sha ? { ...body, sha } : body) });
  console.log(put.ok ? "pushed" : "put " + put.status, key.slice(0, 8), "gen", row.generation, "phase", row.phase);
}
