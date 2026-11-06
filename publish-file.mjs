// Publish dash files through the API. Agents commit to the same repo every few seconds,
// so a local git push is a race you lose; a single-file API commit is not.
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const REPO = process.env.GH_REPO_PUSH || "staccDOTsol/birth-image-runtime";
const tok = process.env.GH_TOKEN_PUSH || execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
const files = process.argv.slice(2);
for (const f of files) {
  const body = Buffer.from(fs.readFileSync(f)).toString("base64");
  let done = false;
  for (let i = 0; i < 5 && !done; i++) {
    const cur = await fetch(`https://api.github.com/repos/${REPO}/contents/${f}`, { headers: { authorization: "Bearer " + tok, accept: "application/vnd.github+json" } });
    let sha = null;
    if (cur.ok) { const j = await cur.json(); sha = j.sha; }
    const payload = { message: `dash: ${f}`, content: body };
    if (sha) payload.sha = sha;
    const put = await fetch(`https://api.github.com/repos/${REPO}/contents/${f}`, { method: "PUT", headers: { authorization: "Bearer " + tok, accept: "application/vnd.github+json", "content-type": "application/json" }, body: JSON.stringify(payload) });
    if (put.ok) { console.log(f, "published"); done = true; }
    else if (put.status === 409) await new Promise((r) => setTimeout(r, 700));
    else { console.log(f, put.status, (await put.text()).slice(0, 120)); break; }
  }
}
