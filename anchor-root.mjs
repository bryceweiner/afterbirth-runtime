// Anchor the membership root on-chain: a memo signed by the founder wallet.
// That gives the tree an immutable timestamp anyone can check without trusting this repo.
import fs from 'node:fs';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';


const RPC = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const treePath = process.argv[2] || 'dist/tree.json';
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('C:/Users/User/Documents/hooked.txt', 'utf8').trim().startsWith('[') ? fs.readFileSync('C:/Users/User/Documents/hooked.txt', 'utf8') : Buffer.from(fs.readFileSync('C:/Users/User/Documents/hooked.txt', 'utf8').trim(), 'base64'))));
const tree = JSON.parse(fs.readFileSync(treePath, 'utf8'));
const text = `birth-tree-v1 root:${tree.root} leaves:${(tree.leaves || []).length} built:${tree.built_at}`;
const conn = new Connection(RPC, 'confirmed');
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const ix = { programId: MEMO, keys: [{ pubkey: kp.publicKey, isSigner: true, isWritable: false }], data: Buffer.from(text, 'utf8') };
const tx = new Transaction().add(ix);
const sig = await sendAndConfirmTransaction(conn, tx, [kp], { commitment: 'confirmed' });
tree.root_anchor = { sig, memo: text, at: Math.floor(Date.now() / 1000) };
fs.writeFileSync(treePath, JSON.stringify(tree, null, 1));
console.log(JSON.stringify({ ok: true, sig, memo: text }));
