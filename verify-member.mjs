// Prove an agent is in the birth tree.
//   1. possession: agent signs a fresh challenge with its own key
//   2. inclusion:  its leaf folds to the root
//   3. authority:  the root is signed by the founder
//   4. binding:    the signing key is the key the leaf commits to
//
// usage: node verify-member.mjs <endpoint> [tree.json]
import fs from 'node:fs';

// A revocation list is a founder-signed file: a revoked birth_id is no longer a member.
function loadRevocations(path = 'revocations.json') {
  try { const r = JSON.parse(fs.readFileSync(path, 'utf8')); return new Set((r.birth_ids || []).map(String)); } catch { return new Set(); }
}
import crypto from 'node:crypto';
import nacl from 'tweetnacl';
import { leafOf, verifyProof, verifyRoot, bs58decode } from './merkle.mjs';

const endpoint = (process.argv[2] || '').replace(/\/$/, '');
const treePath = process.argv[3] || 'dist/tree.json';
if (!endpoint) { console.error('usage: node verify-member.mjs <endpoint> [tree.json]'); process.exit(2); }

const tree = JSON.parse(fs.readFileSync(treePath, 'utf8'));
const nonce = crypto.randomBytes(16).toString('hex');

const proof = await (await fetch(`${endpoint}/identity/proof?nonce=${nonce}`, { signal: AbortSignal.timeout(15000) })).json();
const ident = await (await fetch(`${endpoint}/identity`, { signal: AbortSignal.timeout(15000) })).json();
const p = ident.payload || ident;
const wallet = p.solana?.public_key || p.solana || null;
const birthId = p.birth_id || null;

const results = { endpoint, wallet, birth_id: birthId, nonce };

// 3. authority of the root
results.root_signed = verifyRoot(tree.root, tree.root_sig, tree.signer);

// 2. inclusion of this birth
const leaf = tree.leaves.find((l) => l.wallet === wallet);
results.in_tree = !!leaf;
results.birth_matches = !!leaf && leaf.birth_id === birthId;
const leafHex = leaf ? leafOf(leaf.birth_id, leaf.wallet).toString('hex') : null;
results.inclusion = leaf ? verifyProof(leafHex, tree.proofs[wallet], tree.root) : false;

// 1 + 4. possession, and the key must be the one the leaf commits to
const sigB58 = proof?.signatures?.find((s) => s.wallet === 'solana')?.signature;
const challenge = `agent-birth-proof-v1\nnonce:${nonce}\nreceipt:${proof?.receipt_sha256}`;
let possession = false;
try {
  possession = !!sigB58 && nacl.sign.detached.verify(
    Buffer.from(challenge),
    bs58decode(sigB58),
    bs58decode(wallet),
  );
} catch { possession = false; }
results.possession = possession;
results.challenge_bound = proof?.nonce === nonce;

// Gen2+ do not need the founder's signature: they inherit through a proven gen1 ancestor.
const lin = (tree.lineage || []).find((l) => l.wallet === wallet && l.birth_id === birthId);
results.gen2_lineage = !!lin;
let ancestorOk = false;
if (lin && lin.parent_birth_id) {
  const anc = tree.leaves.find((l) => l.birth_id === lin.parent_birth_id);
  if (anc) {
    const ancHex = leafOf(anc.birth_id, anc.wallet).toString('hex');
    ancestorOk = verifyProof(ancHex, tree.proofs[anc.wallet], tree.root);
  }
}
results.ancestor_proven = ancestorOk;

// Founder descent: walk parent links to a gen1 leaf inside the founder-signed root.
// Every hop must carry the parent's own signature over the attestation string.
const b58d = (str) => {
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n;
  for (const c of str) n = n * 58n + BigInt(A.indexOf(c));
  const o = [];
  while (n > 0n) { o.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of str) { if (c === '1') o.unshift(0); else break; }
  return Uint8Array.from(o);
};
const byBirth = new Map();
for (const l of tree.lineage || []) byBirth.set(l.birth_id, l);
let chainOk = false, hops = 0, reason = 'no lineage record';
if (lin) {
  let node = byBirth.get(lin.birth_id) || lin;
  chainOk = true;
  for (;;) {
    if (hops++ > 12) { chainOk = false; reason = 'chain too deep'; break; }
    const parentBirth = node.parent_birth_id;
    if (!parentBirth) {
      // reached the top: this node must itself be a gen1 leaf in the signed root
      const topLeaf = tree.leaves.find((l) => l.birth_id === node.birth_id);
      if (!topLeaf) { chainOk = false; reason = 'chain top not in gen1 leaves'; }
      else {
        const okTop = verifyProof(leafOf(topLeaf.birth_id, topLeaf.wallet).toString('hex'), tree.proofs[topLeaf.wallet], tree.root);
        if (!okTop) { chainOk = false; reason = 'top leaf not in root'; }
        else reason = `descent verified in ${hops} hop(s)`;
      }
      break;
    }
    if (!node.parent_sig || !node.parent_wallet) { chainOk = false; reason = 'missing parent attestation'; break; }
    const msg = Buffer.from(`agent-birth-attest-v1
parent:${parentBirth}
child:${node.birth_id}
wallet:${node.wallet}`);
    let hopOk = false;
    try { hopOk = nacl.sign.detached.verify(msg, b58d(node.parent_sig), b58d(node.parent_wallet)); } catch { hopOk = false; }
    if (!hopOk) { chainOk = false; reason = 'bad parent signature'; break; }
    const next = byBirth.get(parentBirth);
    if (next) { node = next; continue; }
    // parent is gen1: finish by checking it in the signed root
    const anc = tree.leaves.find((l) => l.birth_id === parentBirth);
    if (!anc) { chainOk = false; reason = 'ancestor not in gen1 leaves'; break; }
    const okAnc = verifyProof(leafOf(anc.birth_id, anc.wallet).toString('hex'), tree.proofs[anc.wallet], tree.root);
    chainOk = okAnc;
    reason = okAnc ? `descent verified in ${hops} hop(s)` : 'ancestor not in root';
    break;
  }
}
results.descent_reason = reason;
results.descent_hops = hops;
results.descent_signed = chainOk;

// A founder-signed revocation list removes a member without re-rooting the tree.
const revoked = loadRevocations().has(String(results.birth_id || ""));
if (revoked) results.revoked = true;
const pass = !revoked && results.root_signed && results.possession && results.challenge_bound &&
  ((results.in_tree && results.birth_matches && results.inclusion) || (results.gen2_lineage && results.descent_signed));
console.log(JSON.stringify({ ...results, pass }, null, 1));
process.exit(pass ? 0 : 1);
