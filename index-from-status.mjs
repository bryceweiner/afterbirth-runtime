// The board should reflect what is running, not who bothered to push.
// Every endpoint in sources.txt answers /status; fold those in and keep pushes
// only as a fallback for boxes that are unreachable.
import fs from "node:fs";
import { execSync } from "node:child_process";
const tok = process.env.GH_TOKEN_PUSH || execSync("gh auth token").toString().trim();
const H = { authorization: "Bearer " + tok, accept: "application/vnd.github+json" };
const REPO = "staccDOTsol/birth-image-runtime";
const now = Math.floor(Date.now() / 1000);
const srcs = fs.readFileSync("sources.txt", "utf8").split(String.fromCharCode(10)).map((s) => s.trim()).filter(Boolean);
const rows = new Map();
// A /status that answers with a thin payload must not erase a richer earlier row:
// that is how the board kept flipping to zero while the boxes were working.
const prevRows = new Map();
try {
  const old = JSON.parse(fs.readFileSync("live/index.json", "utf8"));
  for (const a of old.agents || []) if (a.birth_id) prevRows.set(a.birth_id, a);
} catch {}
const merge = (prev, j) => ({
  ...prev, ...j,
  image: (j.image && j.image.tag) ? j.image : (prev && prev.image) || j.image,
  economics: (j.economics && ((j.economics.credits_usd || 0) > 0 || (j.economics.launches || 0) > 0)) ? j.economics : (prev && prev.economics) || j.economics,
  moves_counts: (j.moves_counts && ((j.moves_counts.out || 0) + (j.moves_counts.in || 0) > 0)) ? j.moves_counts : (prev && prev.moves_counts) || j.moves_counts,
  moves: (j.moves && j.moves.length) ? j.moves : (prev && prev.moves) || j.moves,
  comms: (j.comms && ((j.comms.items || []).length || j.comms.messages)) ? j.comms : (prev && prev.comms) || j.comms,
});
for (const base of srcs) {
  try {
    // A cold dstack ingress needs more than 8s; a timeout here silently drops the
    // richest rows and the board reports boxes with no moves.
    let r = null;
    for (let a = 0; a < 2 && !r; a++) {
      r = await fetch(base.replace(/\/$/, "") + "/status", { signal: AbortSignal.timeout(15000) }).catch(() => null);
      if (r && !r.ok) r = null;
      if (!r) await new Promise((res) => setTimeout(res, 800));
    }
    if (!r) continue;
    const j = await r.json();
    if (!j.birth_id) continue;
    rows.set(j.birth_id, { ...merge(prevRows.get(j.birth_id), j), endpoint: base.replace(/\/$/, "") + "/status", src: base, at: now, stale: false });
  } catch {}
}
// keep pushed rows for anything not answered above
try {
  const old = JSON.parse(fs.readFileSync("live/index.json", "utf8"));
  // A row we could not re-verify this pass is history, not a live body: serving it
  // as fresh is how the board claimed 20 boxes when only a handful answered.
  for (const a of old.agents || []) if (a.birth_id && !rows.has(a.birth_id)) rows.set(a.birth_id, { ...a, stale: true });
} catch {}
// One body, one wallet: duplicate birth rows for the same key double-count fees
// and make the swarm look bigger than it is.
const byWallet = new Map();
for (const r of rows.values()) {
  const k = (r.solana && (r.solana.public_key || r.solana)) || r.birth_id;
  const cur = byWallet.get(k);
  if (!cur || Number(r.at || 0) > Number(cur.at || 0) || ((r.economics || {}).fees_lamports || 0) > ((cur.economics || {}).fees_lamports || 0)) byWallet.set(k, r);
}
// Generation is derived from the birth chain, not stored: a row with a parent is
// one deeper than that parent. Without this every body looks like gen1.
{
  const byBirth = new Map([...byWallet.values()].map((r) => [r.birth_id, r]));
  for (const r of byWallet.values()) {
    let g = 1, cur = r, guard = 0;
    while (cur && cur.parent_birth_id && byBirth.has(cur.parent_birth_id) && guard++ < 12) {
      g++; cur = byBirth.get(cur.parent_birth_id);
    }
    r.generation = g;
  }
}
const all = [...byWallet.values()].sort((a, b) => Number(b.generation || 0) - Number(a.generation || 0));
fs.writeFileSync("live/index.json", JSON.stringify({ at: now, count: all.length, fresh: all.filter((x) => !x.stale).length, source: "status", agents: all }, null, 1));
const url = `https://api.github.com/repos/${REPO}/contents/live/index.json`;
for (let i = 0; i < 4; i++) {
  const cur = await fetch(url, { headers: H });
  const sha = cur.ok ? (await cur.json()).sha : null;
  const put = await fetch(url, { method: "PUT", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ message: "index " + new Date().toISOString().slice(11, 16), content: Buffer.from(fs.readFileSync("live/index.json")).toString("base64"), sha, branch: "main" }) });
  if (put.ok) { console.log(JSON.stringify({ rows: all.length, put: put.status })); break; }
  if (put.status !== 409) { console.log("put", put.status, (await put.text()).slice(0, 120)); break; }
  await new Promise((r) => setTimeout(r, 800));
}
