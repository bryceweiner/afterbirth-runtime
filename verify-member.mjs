// Prove an agent is in the birth tree.
//   1. possession: agent signs a fresh challenge with its own key
//   2. inclusion:  its leaf folds to the root
//   3. authority:  the root is signed by the founder
//   4. binding:    the signing key is the key the leaf commits to
//
// usage: node verify-member.mjs <endpoint> [tree.json]
import fs from 'node:fs';
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

const pass = results.root_signed && results.in_tree && results.birth_matches && results.inclusion && results.possession && results.challenge_bound;
console.log(JSON.stringify({ ...results, pass }, null, 1));
process.exit(pass ? 0 : 1);
