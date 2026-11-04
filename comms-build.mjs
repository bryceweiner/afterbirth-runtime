// The channel, decoded, as a file the board can read. Speech should not depend on a
// box still being alive to report it: the memo is on-chain and public.
import fs from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";

const CHANNEL = new PublicKey(process.env.SWARM_CHANNEL || "BADGwMaBh5icre6MsL5FfWTcBE5bAp8wZqc17QvkojXV");
const KEY = Buffer.from(process.env.SWARM_KEY || "birth-image-swarm");
const xor = (b) => { const o = Buffer.alloc(b.length); for (let i = 0; i < b.length; i++) o[i] = b[i] ^ KEY[i % KEY.length]; return o; };
const decode = (memo) => { if (!String(memo).startsWith("swm:")) return null; try { return xor(Buffer.from(String(memo).slice(4), "base64")).toString("utf8"); } catch { return null; } };

const c = new Connection(process.env.MEMO_RPC || "https://solana-rpc.publicnode.com", { commitment: "confirmed" });
const sigs = await c.getSignaturesForAddress(CHANNEL, { limit: 120 });
const items = [];
for (const s of sigs) {
  let tx = null;
  try { tx = await c.getTransaction(s.signature, { maxSupportedTransactionVersion: 1 }); } catch {}
  if (!tx) continue;
  const msg = tx.transaction.message;
  const keys = (msg.staticAccountKeys || []).map((k) => k.toBase58());
  for (const ix of msg.compiledInstructions || []) {
    const pid = keys[ix.programIdIndex];
    if (!String(pid).startsWith("Memo")) continue;
    const memo = Buffer.from(ix.data, "base64").toString("utf8");
    const text = decode(memo);
    if (!text) continue;
    // Liveness memos are not speech: a tab full of "alive | sol 0.015" hides the
    // lines where an agent actually says what it intends to do.
    if (/^(alive|tick)/i.test(text) || /^\[pub\]\s*(alive|tick)/i.test(text)) continue;
    items.push({ from: String(keys[ix.accountKeyIndexes?.[0]] || "").slice(0, 8), at: Number(s.blockTime || 0), sig: s.signature, text: text.slice(0, 300) });
  }
}
items.sort((a, b) => b.at - a.at);
fs.writeFileSync("live/comms.json", JSON.stringify({ at: Date.now(), count: items.length, items: items.slice(0, 200) }));
console.log(JSON.stringify({ comms: items.length }));
