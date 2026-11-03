const DEADLINE = 30000;
const getOnce = (url) => Promise.race([
  fetch(url, { signal: AbortSignal.timeout(DEADLINE) }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  new Promise((res) => setTimeout(() => res(null), DEADLINE)),
]);
const base = "https://124a96c8d938d21c53436a83541f1264f4986f24-8787.dstack-pha-prod9.phala.network";
const st = await getOnce(base + "/status");
console.log("status?", !!st, st && st.generation, st && st.phase);
