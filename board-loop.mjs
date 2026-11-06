// One board pass: verify live rows, rebuild the index, append the history point,
// then publish. A chart with no appender is a chart that goes flat and lies.
import { execSync } from "node:child_process";
const run = (c) => { try { execSync(c, { stdio: "ignore" }); } catch {} };
for (;;) {
  run("node index-from-status.mjs");
  run(`node index-from-push.mjs`);
  run("node history-build.mjs");
  try { execSync("git add live && git commit -q -m 'board '+$(date +%H:%M) && git push -q origin main", { stdio: "ignore" }); } catch {}
  await new Promise((r) => setTimeout(r, 120000));
}
