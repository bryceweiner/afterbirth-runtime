// Membership proofs for the birth tree.
//
// A leaf is a birth: sha256("<birth_id>:<solana_pubkey>").
// The root is signed by the founder (ed25519 over the root hex).
// An agent proves membership by presenting { root, proof, leaf } and then signs a
// challenge nonce with the same key the leaf commits to. Verify = root signature
// valid, proof folds to root, challenge signature valid for the leaf's wallet.
import crypto from 'node:crypto';
import fs from 'node:fs';
import nacl from 'tweetnacl';

const H = (b) => crypto.createHash('sha256').update(b).digest();
export const leafOf = (birthId, wallet) => H(Buffer.from(`${birthId}:${wallet}`));

export function buildTree(leaves) {
  const rows = [leaves.slice()];
  let cur = leaves.slice();
  while (cur.length > 1) {
    const next = [];
    for (let i = 0; i < cur.length; i += 2) {
      const l = cur[i];
      const r = cur[i + 1] || cur[i]; // odd node is promoted
      next.push(H(Buffer.concat([l, r])));
    }
    rows.push(next);
    cur = next;
  }
  return { root: cur[0] || Buffer.alloc(32), rows };
}

export function proofFor({ rows }, index) {
  const proof = [];
  let i = index;
  for (let level = 0; level < rows.length - 1; level++) {
    const row = rows[level];
    const sib = i % 2 === 0 ? (i + 1 < row.length ? row[i + 1] : row[i]) : row[i - 1];
    proof.push({ hash: sib.toString('hex'), left: i % 2 === 1 });
    i = Math.floor(i / 2);
  }
  return proof;
}

export function verifyProof(leafHex, proof, rootHex) {
  let acc = Buffer.from(leafHex, 'hex');
  for (const step of proof) {
    const sib = Buffer.from(step.hash, 'hex');
    acc = step.left ? H(Buffer.concat([sib, acc])) : H(Buffer.concat([acc, sib]));
  }
  return acc.toString('hex') === rootHex;
}

export const signRoot = (rootHex, secretKey) => Buffer.from(nacl.sign.detached(Buffer.from(rootHex), secretKey)).toString('base64');
export const verifyRoot = (rootHex, sigB64, publicKeyB58) => {
  const pk = Buffer.from(bs58decode(publicKeyB58));
  return nacl.sign.detached.verify(Buffer.from(rootHex), Buffer.from(sigB64, 'base64'), pk);
};

// minimal base58 (no dependency at verify time)
const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function bs58decode(s) {
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(ALPHA.indexOf(c));
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of s) { if (c === '1') bytes.unshift(0); else break; }
  return Uint8Array.from(bytes);
}

export function buildFromRoster(agents) {
  const leaves = agents
    .map((a) => ({ birth_id: (a.status || {}).birth_id || null, wallet: (a.status || {}).solana?.public_key || (a.status || {}).solana || null, endpoint: a.endpoint, gen: a.gen || 1 }))
    .filter((l) => l.birth_id && l.wallet)
    .sort((x, y) => (x.birth_id < y.birth_id ? -1 : 1));
  const hashes = leaves.map((l) => leafOf(l.birth_id, l.wallet));
  const tree = buildTree(hashes);
  const proofs = {};
  leaves.forEach((l, i) => { proofs[l.wallet] = proofFor(tree, i); });
  return { root: tree.root.toString('hex'), leaves, proofs };
}

// CLI: node merkle.mjs build <beacon.json> <founder-keypair.json> <out.json>
if (process.argv[1] && process.argv[1].endsWith('merkle.mjs')) {
  const [, , cmd, beaconPath, keyPath, outPath] = process.argv;
  if (cmd === 'build') {
    const bc = JSON.parse(fs.readFileSync(beaconPath, 'utf8'));
    const { root, leaves, proofs } = buildFromRoster(bc.agents || []);
    const kp = nacl.sign.keyPair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, 'utf8')).slice(-64)));
    const sig = signRoot(root, kp.secretKey);
    const out = { root, root_sig: sig, signer: bs58encode(kp.publicKey), built_at: Math.floor(Date.now() / 1000), leaves, proofs };
    fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
    console.log('root', root.slice(0, 16) + '…', 'leaves', leaves.length, '→', outPath);
  }
}
export function bs58encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = '';
  while (n > 0n) { s = ALPHA[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b === 0) s = '1' + s; else break; }
  return s;
}
