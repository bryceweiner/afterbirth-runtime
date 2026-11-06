// Build the board from what the members pushed, never from probing them.
// Each box writes live/agent-<id>.json; this folds those files into live/index.json.
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const REPO = process.env.GH_REPO_PUSH || "staccDOTsol/birth-image-runtime";
const tok = process.env.GH_TOKEN_PUSH || execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
const H = { authorization: "Bearer " + tok, accept: "application/vnd.github+json" };
const now = Math.floor(Date.now() / 1000);

const list = await (await fetch(`https://api.github.com/repos/${REPO}/contents/live`, { headers: H })).json();
const files = (Array.isArray(list) ? list : []).filter((f) => /^agent-.*\.json$/.test(f.name));
const rows = [];
for (const f of files) {
  try {
    const r = await fetch(f.download_url, { cache: "no-store" });
    if (!r.ok) continue;
    const j = await r.json();
    if (!j || !j.at) continue;
    j.stale = (now - Number(j.at)) > 2700;
    // Older images push lineage rows but not the counts; derive them so the board
    // does not read zero while a body is teaching every tick.
    if (!j.moves_counts && Array.isArray(j.moves)) {
      j.moves_counts = { out: j.moves.filter((m) => m && m.dir === "out").length, in: j.moves.filter((m) => m && m.dir === "in").length };
    }
    rows.push(j);
  } catch {}
}
// Generation is derived from the birth chain, not stored: a row with a parent is
// one deeper than that parent. Without this every body looks like gen1.
{
  const byBirth = new Map(rows.map((r) => [r.birth_id, r]));
  for (const r of rows) {
    let g = 1, cur = r, guard = 0;
    while (cur && cur.parent_birth_id && byBirth.has(cur.parent_birth_id) && guard++ < 12) {
      g++; cur = byBirth.get(cur.parent_birth_id);
    }
    r.generation = g;
  }
}
rows.sort((a, b) => Number(b.generation || 0) - Number(a.generation || 0) || Number(b.at) - Number(a.at));
// Pushed rows are one source, not the only one: fold them into whatever the
// status probe already verified instead of overwriting the whole board.
let merged = rows;
try {
  const cur = JSON.parse(fs.readFileSync("live/index.json", "utf8"));
  const byId = new Map((cur.agents || []).map((a) => [a.birth_id, a]));
  for (const r of rows) {
    const old = byId.get(r.birth_id);
    byId.set(r.birth_id, old ? { ...old, ...r, image: (r.image && r.image.tag) ? r.image : old.image, moves_counts: (r.moves_counts && ((r.moves_counts.out || 0) + (r.moves_counts.in || 0) > 0)) ? r.moves_counts : old.moves_counts, economics: (r.economics && ((r.economics.credits_usd || 0) > 0)) ? r.economics : old.economics } : r);
  }
  merged = [...byId.values()];
} catch {}
const byWallet = new Map();
for (const r of merged) {
  const k = (r.solana && (r.solana.public_key || r.solana)) || r.birth_id;
  const cur = byWallet.get(k);
  if (!cur || Number(r.at || 0) > Number(cur.at || 0) || ((r.economics || {}).fees_lamports || 0) > ((cur.economics || {}).fees_lamports || 0)) byWallet.set(k, r);
}
merged = [...byWallet.values()];
const fresh = merged.filter((r) => !r.stale);
fs.writeFileSync("live/index.json", JSON.stringify({ at: now, count: merged.length, fresh: fresh.length, source: "status+pushed", agents: merged }, null, 1));

const body = { message: "index " + new Date().toISOString().slice(11, 16), content: Buffer.from(fs.readFileSync("live/index.json")).toString("base64") };
for (let i = 0; i < 5; i++) {
  const cur = await fetch(`https://api.github.com/repos/${REPO}/contents/live/index.json`, { headers: H });
  let sha = null;
  if (cur.ok) sha = (await cur.json()).sha;
  const put = await fetch(`https://api.github.com/repos/${REPO}/contents/live/index.json`, { method: "PUT", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify(sha ? { ...body, sha } : body) });
  if (put.ok) { console.log(JSON.stringify({ pushed_rows: rows.length, fresh: fresh.length, index: put.status })); break; }
  if (put.status !== 409) { console.log("index", put.status); break; }
  await new Promise((r) => setTimeout(r, 700));
}
