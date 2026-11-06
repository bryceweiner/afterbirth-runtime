
import fs from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
const sol = new Connection("https://eu.fluxrpc.com?key=ab9278e1-6430-41ab-aee0-ac6b759a1fe4", { commitment: "confirmed" });
const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const d = JSON.parse(fs.readFileSync("live/index.json", "utf8"));
const f = d.agents.filter((x) => !x.stale);
const sols = new Map(), evms = new Map();
for (const x of f) {
  const s = x.solana && x.solana.public_key; if (s) sols.set(s, 1);
  const e = x.evm && x.evm.address; if (e) evms.set(e, 1);
}
let sSol = 0, sUsdc = 0, bUsdc = 0, eth = 0, zero = 0, funded = 0;
const q = [...sols.keys()];
await Promise.all(Array.from({ length: 8 }, async () => {
  while (q.length) {
    const pk = q.pop();
    try {
      const lam = await sol.getBalance(new PublicKey(pk));
      sSol += lam / 1e9;
      let u = 0;
      try { const a = await sol.getParsedTokenAccountsByOwner(new PublicKey(pk), { mint: USDC }); for (const v of a.value) u += v.account.data.parsed.info.tokenAmount.uiAmount || 0; } catch {}
      sUsdc += u;
      if (lam > 2e6 || u > 0.05) funded++; else zero++;
    } catch {}
  }
}));
const eq = [...evms.keys()];
await Promise.all(Array.from({ length: 8 }, async () => {
  while (eq.length) {
    const a = eq.pop();
    try {
      const r = await fetch("https://mainnet.base.org", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", data: "0x70a08231000000000000000000000000" + a.replace(/^0x/, "").toLowerCase().padStart(64, "0") }, "latest"] }) });
      const j = await r.json(); if (j.result) bUsdc += Number(BigInt(j.result)) / 1e6;
      const r2 = await fetch("https://mainnet.base.org", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [a, "latest"] }) });
      const j2 = await r2.json(); if (j2.result) eth += Number(BigInt(j2.result)) / 1e18;
    } catch {}
  }
}));
console.log(JSON.stringify({ agents: f.length, sol_wallets: sols.size, sol: sSol.toFixed(3), sol_usdc: sUsdc.toFixed(2), base_usdc: bUsdc.toFixed(2), eth: eth.toFixed(4), funded_wallets: funded, dust_wallets: zero }));
