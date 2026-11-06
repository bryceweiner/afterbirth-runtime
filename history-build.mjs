// One snapshot per run, appended forever. The chart needs a time series; a board
// that only shows "now" can never show a trend.
import fs from 'node:fs';
const idx = JSON.parse(fs.readFileSync('live/index.json', 'utf8'));
const mv = JSON.parse(fs.readFileSync('live/moves.json', 'utf8')).moves || [];
const live = (idx.agents || []).filter((a) => !a.stale);
const snap = {
  t: Math.floor(Date.now() / 1000),
  live: live.length,
  gen1: live.filter((a) => (a.generation || 1) === 1).length,
  gen2: live.filter((a) => (a.generation || 1) >= 2).length,
  moves: mv.length,
  taught: live.reduce((s2, a) => s2 + ((a.moves_counts || {}).out || 0), 0),
  learned: live.reduce((s2, a) => s2 + ((a.moves_counts || {}).in || 0), 0),
  taught_events: mv.filter((m) => m.dir === 'out').length,
  learned_events: mv.filter((m) => m.dir === 'in').length,
  launches: live.reduce((s, a) => s + Number((a.economics || {}).launches || 0), 0),
  fees: live.reduce((s, a) => s + Number((a.economics || {}).fees_lamports || 0), 0),
  credits: live.reduce((s, a) => s + Number((a.economics || {}).credits_usd || 0), 0),
};
let hist = [];
try { hist = JSON.parse(fs.readFileSync('live/history.json', 'utf8')); } catch {}
if (!Array.isArray(hist)) hist = [];
hist.push(snap);
if (hist.length > 5000) hist = hist.slice(-5000);
fs.writeFileSync('live/history.json', JSON.stringify(hist));
console.log(JSON.stringify(snap));
