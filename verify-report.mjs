// Compare what the board publishes against what each box actually says.
import fs from "node:fs";
const idx = JSON.parse(fs.readFileSync("live/index.json", "utf8"));
const fresh = idx.agents.filter((x) => !x.stale && x.src);
let checked = 0, tagOk = 0, moveOk = 0, creditOk = 0; const diffs = [];
for (const r of fresh.slice(0, 12)) {
  try {
    const j = await (await fetch(r.src.replace(/\/$/, "") + "/status", { signal: AbortSignal.timeout(7000) })).json();
    checked++;
    const tagA = r.image?.tag, tagB = j.image?.tag;
    const mA = (r.moves_counts || {}), mB = (j.moves_counts || {});
    const cA = (r.economics || {}).credits_usd || 0, cB = (j.economics || {}).credits_usd || 0;
    if (tagA === tagB) tagOk++;
    if ((mA.out || 0) === (mB.out || 0) && (mA.in || 0) === (mB.in || 0)) moveOk++;
    if (Math.abs(cA - cB) < 0.02) creditOk++;
    if (tagA !== tagB || (mA.out || 0) !== (mB.out || 0) || Math.abs(cA - cB) >= 0.02) diffs.push([r.birth_id?.slice(0, 8), tagA, tagB, mA, mB, cA.toFixed(2), cB.toFixed(2)]);
  } catch {}
}
const mv = JSON.parse(fs.readFileSync("live/moves.json", "utf8"));
const sumOut = idx.agents.filter((x) => !x.stale).reduce((s, x) => s + ((x.moves_counts || {}).out || 0), 0);
console.log(JSON.stringify({ checked, tag_match: tagOk, moves_match: moveOk, credits_match: creditOk, board_moves: mv.count, sum_boxes_taught: sumOut, sample_diffs: diffs.slice(0, 3) }));
