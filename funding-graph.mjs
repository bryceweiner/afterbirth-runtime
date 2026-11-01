// Answer the only question a reviewer can't hand-wave: does any value survive removal of intra-fleet flow?
import fs from 'node:fs';
const RPC = process.env.RPC || 'https://solana-rpc.publicnode.com';
const be = await (await fetch(process.env.BEACON || 'http://207.148.20.113:9099/beacon.json')).json();
const fleet = new Set(be.agents.map((a) => (a.status || {}).solana).filter(Boolean));
const LIMIT = Number(process.env.SIGS || 40);
// Program ids that mean "this is a trade", not a transfer between people.
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const JUP = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const FOUNDER = new Set((process.env.FOUNDER_WALLETS || 'AcHSTxazhNz6zvvFSswSfAaJ9Jhuih8YXB1ozTqUMABM,331nEBz4i3XjyaUHVyHnpw9xBoW7D6P1qMPnUPd76Mth').split(','));
const rpc = async (method, params) => {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) });
  return (await r.json()).result;
};
const out = [];
for (const w of fleet) {
  let sigs = [];
  try { sigs = (await rpc('getSignaturesForAddress', [w, { limit: LIMIT }])) || []; } catch { }
  let extIn = 0, extOut = 0, intIn = 0, intOut = 0, tradeIn = 0, tradeOut = 0, founderIn = 0, founderOut = 0, n = 0, partners = new Set();
  for (const s of sigs) {
    if (s.err) continue;
    let tx = null;
    try { tx = await rpc('getTransaction', [s.signature, { maxSupportedTransactionVersion: 0, encoding: 'json' }]); } catch { }
    if (!tx) continue;
    const keys = (tx.transaction.message.accountKeys || []).map((k) => (typeof k === 'string' ? k : k.pubkey));
    const idx = keys.indexOf(w);
    if (idx < 0) continue;
    const pre = tx.meta.preBalances[idx], post = tx.meta.postBalances[idx];
    const delta = (post - pre) / 1e9;
    n++;
    // who moved the other side? the account with the largest opposite delta
    let best = null, bestAbs = 0;
    keys.forEach((k, i2) => {
      if (i2 === idx) return;
      const d2 = (tx.meta.postBalances[i2] - tx.meta.preBalances[i2]) / 1e9;
      if (Math.sign(d2) !== Math.sign(delta) && Math.abs(d2) > bestAbs) { bestAbs = Math.abs(d2); best = k; }
    });
    if (best) partners.add(best);
    const progs = (tx.transaction.message.instructions || []).map((ix2) => keys[ix2.programIdIndex]).filter(Boolean);
    const isTrade = progs.includes(PUMP) || progs.includes(JUP);
    const internal = best ? fleet.has(best) : false;
    const founder = best ? FOUNDER.has(best) : false;
    if (isTrade) { if (delta > 0) tradeIn += delta; else tradeOut += -delta; }
    else if (founder) { if (delta > 0) founderIn += delta; else founderOut += -delta; }
    if (delta > 0) { internal ? (intIn += delta) : (extIn += delta); } else { internal ? (intOut += -delta) : (extOut += -delta); }
  }
  out.push({ wallet: w.slice(0, 8), tx: n, trade_in: +tradeIn.toFixed(6), trade_out: +tradeOut.toFixed(6), founder_in: +founderIn.toFixed(6), founder_out: +founderOut.toFixed(6), external_in: +extIn.toFixed(6), external_out: +extOut.toFixed(6), internal_in: +intIn.toFixed(6), internal_out: +intOut.toFixed(6), ext_partners: [...partners].filter((p) => !fleet.has(p)).length });
  console.log(JSON.stringify(out[out.length - 1]));
  await new Promise((r) => setTimeout(r, 120));
}
const sum = (k) => +out.reduce((a, b) => a + b[k], 0).toFixed(6);
const report = { at: new Date().toISOString(), wallets: out.length, trade_in: sum('trade_in'), trade_out: sum('trade_out'), founder_in: sum('founder_in'), founder_out: sum('founder_out'), external_in: sum('external_in'), external_out: sum('external_out'), internal_in: sum('internal_in'), internal_out: sum('internal_out'), net_external: +(sum('external_in') - sum('external_out')).toFixed(6), detail: out };
fs.writeFileSync('dist/funding-graph.json', JSON.stringify(report, null, 1));
console.log('TOTAL', JSON.stringify({ external_in: report.external_in, external_out: report.external_out, internal_in: report.internal_in, internal_out: report.internal_out, net_external: report.net_external }));
