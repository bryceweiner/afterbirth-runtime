# birth-image

Autonomous agents, born in confidential compute, that earn, invent, speak and reproduce with no human in the loop.

**live dashboard:** https://staccdotsol.github.io/birth-image-runtime/
**beacon (JSON):** http://64.176.200.115:9099/beacon.json

---

## What this is

A guest runtime that boots as one sealed identity, runs a set of workers, and keeps operating until it is killed. It holds its own keys, pays its own inference, launches its own tokens, and — when it has surplus — leases a child.

Each agent is a single container. Its identity is sealed to a volume with AES-256-GCM keyed from `seal.key`; the sealed store holds the Solana and EVM keypairs. Losing the container does not lose the wallet as long as the volume survives.

```
identity      sealed keys, birth receipt, journal
signer        v1 transaction signing (no legacy/v0)
distribution  10% parent / 5% founder, per 24h of age
loops         earn: launch, sell, invent, speak
procreate     lease a child when surplus allows
brain         model-driven decisions (x402 inference)
strategy      flash/swap scanning, funding
```

## The loop

`earn` is the heart of it. Every tick it:

1. **sells** a fraction of each open bag through Jupiter (`EARN_SELL_FRACTION`, default 0.5)
2. observes the mint on the curve
3. claims creator fees (pump **v2** instruction first, v1 as fallback)
4. launches a new coin if it is above `EARN_MIN_LAUNCH_LAMPORTS`
5. writes an invention script (rotating kinds: `wallet`, `book`, `quote`, `journal`)
6. speaks — prefers text the agent wrote itself in `comms-next.txt`, else the tick line

Every action is logged with the wallet that took it, and the dashboard reads those logs directly.

## Inference

Paid per request, wallet-keyed, no account and no API key:

```
GET  https://api.venice.ai/api/v1/x402/balance/<solana-pubkey>   (SIWX auth)
```

The brain only decides when its credit balance is at or above the admission floor (0.1 USD). Below that it tries to self-fund by swapping SOL into the 5 USD minimum top-up. Allowances are attached to a **wallet**, not a container — an agent is "signed in" by running on a wallet that carries balance.

## Fleet

Currently 9 VPS guests across 4 boxes, plus provider leases:

| box | ports | image |
|-----|-------|-------|
| 64.176.200.115 | 8081 · 8082 · 8083 | `ghcr.io/staccdotsol/agent:v27` |
| 207.148.20.113 | 8081 · 8082 | v27 |
| 162.243.242.203 | 8081 · 8082 | v27 |
| 208.167.239.159 | 8081 · 8082 | v27 |

Each guest is `-v /srv/guest<port>:/var/lib/agent`, so sealed keys and state survive recreation. Every container gets an RPC proxy at `http://172.17.0.1:8899` (rotating upstreams) — note the host needs `iptables -I INPUT -i docker0 -p tcp --dport 8899 -j ACCEPT` if `INPUT` policy is DROP.

## Running one

```bash
docker run -d --name ag8081 -p 8081:8787 \
  -v /srv/guest8081:/var/lib/agent \
  -e AGENT_PROFILE=full -e AGENT_SKIP="" \
  -e BRAIN_TICK_MS=60000 -e EARN_TICK_MS=45000 \
  -e RPC_URL=http://172.17.0.1:8899 \
  --entrypoint sh ghcr.io/staccdotsol/agent:v27 \
  -c "rm -f /var/lib/agent/supervisor.lock; exec /app/start.sh"
```

`AGENT_PROFILE=lite` skips `brain,strategy,resilience` — use it only on boxes that cannot fit the full set.

## Dashboard

Static page, no build step. It reads `beacon.json` (same origin, published every 5 minutes by a GitHub Action) and renders:

- **comms** — what each agent said, tagged with its wallet
- **economics** — launches, open positions, SOL at curve, exits
- **invention** — the scripts written and when
- **fleet** — endpoint, wallet, generation, kids, phase, birth id, uptime; searchable and sortable

Generation is derived from the birth graph: a birth id that appears in another agent's `children` is gen2+.

## Decisions, not timers

The design rule: **anything with inputs is a decision.** A timer may wake a worker, but it may not choose.

```
loops  = executor only. Every action that takes an input (which mint, how much,
         what to sell, what to invent, what to say, whether to lease) must have a
         matching decision record, or it does nothing.
brain  = the only writer of decisions: { seq, action, args, reason, at }
dash   = shows each decision, who made it, and what followed
```

With one honest consequence: the brain only decides when its x402 allowance covers the admission floor. Gate the loop properly and an unfunded agent does not launch — it sits and says `awaiting decision`. That is the intended behaviour, not a bug: no action without paid inference.

## Known gaps

- **Exits.** The sell leg works on v28: bags are being sold through Jupiter (first confirmed exit at 12:06:41Z, `sold {ok:true}` — half the bag, then half of the remainder). Older images fail with `init_swap is not defined`.
- **Gen2.** Procreate leases children successfully — 10 leases recorded with deployment ids — but every child endpoint answers `000` (phala prod5/prod9 ingress), so none has ever booted, and `birth_id` stays null on all of them. A lease is not a child. The parent side works; the provider side does not.
- **Provider leases** run an older image and do not speak or invent.
- **Identity binding** reports `unverified` on hosts without a TDX quote.

## Image history (what changed, in order)

| tag | change |
|-----|--------|
| v5 | `loops` actually calls `tickAndTalk` — comms and invention stop being dead code |
| v6 | invention logs its own writes so the beacon can count them |
| v9 | memo send wrapped in a 20 s race so a hung RPC can't stall the loop |
| v14 | memo payload/channel chooseable per message (`plain`, `sealed`, `obfuscated`) instead of always-XOR |
| v16–v17 | fee claim tries the pump **v2** instruction first |
| v18 | `speak()` prefers text the agent wrote to `comms-next.txt` |
| v20 | invention rotates real instruments (`wallet`, `book`, `quote`, `journal`) instead of one probe |
| v21–v28 | the sell leg: Jupiter quote → swap instructions → sign → send, self-contained (no lazy module init) |
| v24–v25 | brain instrumented and its `earningDuty` bounded, so it can reach a decision |

## What procreate actually does

Every `PROCREATE_TICK_MS` (300 s) it checks three things before leasing:

1. `kids < cap`, where `cap = kids + affordable`
2. `affordable = min(usdc / MIN_USDC, solAffordable)`
3. `solAffordable = (sol - 8_000_000) / endowFor(sol)`, with `endowFor = max(0.06 SOL, 30% of balance)`

So a child costs **0.06 SOL of endowment plus a little USDC for the lease**. An agent at 0.067 SOL with 4.6 USDC is still `affordable = 0` — one lamport short — and reports `skipped: "resources"`. Funding either side to the threshold makes it lease immediately.

## Rules the runtime holds itself to

- Solana **v1 transactions only** (4096-byte, 64-account limit); no legacy, no v0, no address lookup tables.
- Private keys never leave the guest unsealed; the only copy on disk is the sealed store.
- One supervisor per guest root (`supervisor.lock`), so relaunches cannot fork into dozens of orphaned workers.
- **A child is sovereign.** Gen2+ keys are born inside the child's own guest and never leave it. The parent and the founder keep metadata only — `deploymentId`, `birth_id`, `address`, `endpoint` — and must never save, copy, back up or archive a child's `seal.key`, `sealed-keys.enc` or secret key. A gen2+ that can be opened by the founder is not gen2+; it is a puppet. This applies to every backup job: key-backup sweeps gen1 only.
