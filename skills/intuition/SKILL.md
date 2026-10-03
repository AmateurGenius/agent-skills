---
name: intuition
description: Use this skill when interacting with the Intuition Protocol on-chain, and whenever a wallet REJECTS an Intuition delegation signature. Follow these instructions to produce correct transactions for creating atoms, triples, depositing into vaults, withdrawing shares, reading protocol state, and managing delegated authority. Triggers on tasks involving Intuition, atoms, triples, vaults, attestations, delegation, the Delegation Framework, the $TRUST token — AND on wallet errors such as 'External signature requests cannot sign delegations for internal accounts', 'eth_signTypedData_v4 failed', or any isValidSignature 0xffffffff / ERC-1271 rejection.
license: MIT
argument-hint: "[--read|--write] [--chain mainnet|testnet] [operation] [args...]"
allowed-tools: "Bash, Read"
metadata:
  author: jonathanprozzi
  version: "0.5.0"
---

# Intuition Protocol Skill

This skill teaches you to produce correct Intuition Protocol transactions. Follow these instructions exactly — the ABIs, encoding patterns, addresses, and value calculations below are verified against the deployed **delegation-core 3.0.0 / V3** contracts on Intuition (DelegationManager `0xdb9B1e94…`, live on 13579 and 1155). **Never transcribe a selector from memory, from a spec, or from a sibling doc** — three fabricated selectors have been caught in this skill so far, one of them in a mission brief. Recompute with `cast sig`; `scripts/delegation-doc-verification.sh` does this for every documented value.

## Working style for this user (learned 2026-09-30, updated 2026-10-01)

> **The user will re-ask until you look, and they are right to.** Twice this session the
> user pushed back on a conclusion I had already presented as settled — "look for evidence
> that supports swapping for the SDK, this one trivial thing could hold the key to
> everything don't dismiss it", and later "i dont like the new sdk page". Both times the
> pushback exposed a real defect I had stopped looking for. **Treat a user's insistence as
> unmeasured evidence, not resistance.** Re-run the check you just asserted; do not
> re-argue it. If it still holds, say so plainly and show the evidence — that is a
> complete answer, not a dismissal. This user is a **co-investigator, not a queue**: twice
> they supplied the missing fact after I had declared a case closed.
>
> **Green checks are not the goal; a green check on the wrong thing is the trap.**
> I reported `isValidSignature → 0x1626ba7e` as good news while the delegation was
> *permanently unredeemable* because a caveat named a selector that does not exist on
> the target contract. A valid signature only proves the signer authorised that payload —
> it says nothing about whether the payload can be executed. **Always carry a
> falsifier for the good news**, not just the bad.
>
> **Retract in the same pass you discover.** Every retraction this session (the RPC call
> shape, the registry SimpleFactory, the undefined CDN export) was stated in one line
> and the doc corrected immediately. This user checks whether retractions hold up. Do not
> hedge a reversal into ambiguity.
>
> **Distrust a single-pattern claim about minified or generated code.** I reported a
> package export as undefined on the strength of one regex; the symbol was defined in
> arrow form. Verify a "broken" claim against the live export list and a real load before
> reporting it — especially when the conclusion is convenient.
>
> **Run your own verifier against the known-good control before believing its verdict.**
> I hand-built a `redeemDelegations` encoder; it reported `InvalidDelegate` on the user's
> delegation, and I started diagnosing *their* payload — until it produced the same error
> on `signed-delegation-final.json`, the delegation known to have redeemed on-chain. My
> encoder was wrong; their delegation was fine. **When a hand-written verifier disagrees
> with reality, prove the verifier first.** One control call settles it:
> `nodethe verify-caveat-admission script`. Prefer the project's proven script over a
> fresh encoder whenever one exists (`templates/redeem-delegation.cjs` framed it correctly
> on its first run after my harness had failed repeatedly).
>
> **Run your own verifier against the known-good control before believing its verdict.**
> file, and confirm the server is really serving: a stale `python3 -m http.server` whose
> parent shell had exited held the port and accepted connections then closed without
> responding (HTTP 000). The page that "was not working" was served from a different
> directory than the one being edited. Check with `curl -s -o /dev/null -w '%{http_code}'`.

- **Execute direct instructions immediately; don't re-litigate.** When told to change or
  remove something on the signing page, just do it. If the change is unwise, say so **in one
  line** and then do it anyway.
- **Deliver the artifact and the link.** Repeatedly asked for a working URL/setup rather
  than analysis. Ship, verify it serves, hand over the link.
- **"Make X work" is not "replace X with something better-engineered."** Asked to swap the
  signing page to the SDK, I built a whole new page; the user then said outright
  *"i dont like the new sdk page … i like this design better."* The manual page was simpler,
  dependency-light, already served, and working, and the rewrite shipped a **new** defect
  (the module-scope pitfall below) while costing a full session. **Prove and prefer are
  separate bars** — satisfying the first does not satisfy the second. Leave the incumbent on
  disk and served, record the preference as a *design* choice rather than a defect list, and
  hand back both URLs with one line on what each is good at. Additive beats swap whenever the
  incumbent works. The SDK's real value here was as a **reference implementation to read**,
  not an artifact to adopt.
- **Use the proven script before writing your own harness (2026-10-01).** I hand-rolled a
  `redeemDelegations` builder and iterated on it for many runs, getting `InvalidDelegate`
  (`0xb5863604`) — **on the known-good fixture too**. The proven
  `templates/redeem-delegation.cjs` named the true error on its first run. When a hand-rolled
  tool fails on a control known to work, **the tool is the bug**: stop tuning it and switch to
  the verified path. Always run the known-good input through a new harness *first*; if it
  fails there, nothing the harness tells you is trustworthy.
- **A wrong encoder fails silently and manufactures false confidence.** Diff byte counts
  against the reference implementation before trusting your own output.
- **A refuted proposal is not a refused investigation.** The SDK swap was wrong as a
   *remedy* (digest-neutral, and it derives the wrong delegator) — but investigating it
   properly exposed the non-standard call shape, and pressing further exposed the real bug:
   a caveat naming a selector that does not exist on the target. When you reject something
   the user proposed, ask what investigation it implies and run *that* before answering.
 - **Their pushback was right THREE times (2026-10-01), including on UI.** (1) the SDK/manual
   call-shape difference; (2) "`delegator` must be the Hybrid"; (3) after I had built a whole
   replacement signing page, "i dont like the new sdk page … i like this UI of the current
   manual site better". **Treat their insistence as unmeasured evidence about something I
   have not inspected, then go measure it — never re-argue it.** Concretely, when they say
   something holds the key, the next action is a probe (diff two paths, read the library
   source, ask what the code actually emits), not a restatement of my conclusion.
   Corollary: **when they prefer an existing artifact's design, upgrade THAT artifact in
   place — do not hand them a replacement.** `templates/sign-delegation.html` was rebuilt
   onto the SDK while keeping its original UI, inline `onclick` handlers and load flow.
  Corollary: a **repeating** proposal is a signal to measure, not to re-argue. The same plan
  came back three times; the second pass is when the API traps surfaced, each of which would
  have broken the swap silently. Re-read the *installed* package — the plan quoted 1.4.0,
  the installed version was 2.0.0, and the API had moved.
- **Run the proposal's own "verify this first" step before writing any analysis.** The plan
  was long, cited source, quoted a changelog, and was still wrong. Its §9 took 30 seconds to
  refute and would have taken hours to implement. **This applies hardest to a fix the user
  arrives already convinced of.** Full playbook:the principle that a refuted proposal is still evidence`.
- **An error string is a measurement. Read it before proposing a fix.** I proposed the
  call-shape change as "the fix" while the wallet was refusing the request *before hashing* —
  a change that provably could not affect the failing step. Ask what the failing step
  actually was. Adopting a fix on a narrative rather than evidence is how a session ships
  two changes where one mattered. Relatedly: **"the page differs from a thing that works" is
  not new evidence** once every offline check has already proven the payload correct.
- **Diagnose with the canonical script, not a fresh harness.** I wrote a bespoke calldata
  builder, got `InvalidDelegate`, and iterated on it for several rounds — while the canonical
  `templates/redeem-delegation.cjs` reported `ValueLteEnforcer:value-too-high` immediately.
  **Always run the known-good `templates/signed-delegation-final.json` through anything you
  write:** if the control also reverts, the harness is the bug, not the data. Same discipline
  asthe verify-delegation-fixture script` on the signing side.
- **Lead with the decisive result, then the reasoning.** Give numbers (addresses,
  `match: false`, `isValidSignature -> 0x1626ba7e`), not narrative. Separate
  **"this cannot be the fix"** (provable) from **"this would break X"** (the half that
  actually changes the decision). Then salvage whatever incidental findings in the
  rejected plan were true — a refuted plan is not worthless input.
- **When reporting "verified", say what was executed.** Claiming a page worked because it
  parsed and returned 200 was the exact failure the user caught with *"connect wallet is not
  working."* Verifying is not the same as loading.
- **Never assert a page works because you read it — ship a control and run the real
  function.** A page that parses can still be completely non-functional. Never eyeball wiring.
- **Never `cp -r node_modules` into a skill directory.** It filled `/data` to 100% on this
  device and broke every subsequent tool call, `execute_code` included. Put throwaway probe
  scripts in `templates/` (where dependencies already resolve) and delete them afterwards.
  Bare imports also fail from `/tmp` — Node resolves them from the *script's* directory.
- **The user is technically expert, adversarial about hand-waving, and will check claims
  against the chain.** Cite block numbers, addresses, and reproducible commands.

## Working agreement for this investigation

> The user is a co-investigator, not a task-queue. Twice their pushback exposed a
> real defect I had stopped looking for: "you need to use the SDK for it to
> work" and "you tested the 3-arg selector, the real one is the 4-arg." Both were
> correct and neither was discoverable without their prior experience of this
> exact bug class.

- When the user names a specific thing I did not measure, probe that before
  re-arguing anything. Being right about the mechanism is not the same as having
  tested it.
- Report what is proven separately from what is assumed, and name the falsifier
  for anything unresolved. "Unresolved — this would settle it" costs nothing;
  a settled-sounding wrong verdict gets built on.
- Do not confirm success on the user's say-so alone. When told "confirm it",
  re-derive it independently (recover the signer, read the receipt, query the
  contract) rather than trusting the tool's own report back.
- **A retraction must land in every artifact that carried the claim**, not just
  the newest one. Stale copies elsewhere are how a wrong finding survives.

- **Empirical first, but propose before executing.** Run read-only checks freely
  (`cast`, `eth_call`, offline recovery). **Get user sign-off before any state change** —
  redeploying the Hybrid, changing the account model, adding an EIP-7702 delegation, or
  editing a canonical page. This user reads a plan and reviews it before execution;
  executing first and explaining after is the failure mode they have corrected before.
- **🚨 Read a script's send path before running it. A script's *name* is never evidence of
  what it does.** I once ran `redeem-delegation.cjs` "just to see the revert reason" and it
  deposited real tTRUST unrequested (tx `0x796a30dc…`, block 9370921, 343,832 gas, 1 of 100
  calls). **That script no longer has that defect** — as of the Mission 12 fix it **defaults to
  dry-run** and requires **both** `--broadcast` and `--yes`; `--broadcast` alone exits `2`
  without sending. **So do not skip reading the send path** — that is the lesson, and a fixed
  script is exactly when you would stop looking. The general rule stands:
  **Diagnosing is never a reason to take a state-changing action.**
  - To probe, use something **incapable** of causing harm: `cast call` (returns revert data
    `0x08c379a0…` + the `Error(string)` payload, zero state change),the verify-caveat-admission script`, orthe probe-simulate-only script` (the proven
    script with step 6 removed).
  - Before running anything in this skill, state whether it broadcasts. If it does: name the
    exact operation, amount and recipient, and get explicit approval **first**.
- **Reuse the canonical path; do not hand-roll.** When a working path already exists
  in this skill (the SDK signing page, `redeem-delegation.cjs`, the delegation
  fixtures), copy its shape rather than re-deriving it. I hand-rolled
  `eth_signTypedData_v4` for the revoke page and the wallet signed with whichever
  account was *active*, not the one requested — two wasted signing attempts and
  an unexplainable `AA24`. The SDK path (`createWalletClient` → `signTypedData`)
  pins the account. This is the same lesson as the setup page: the SDK is not
  ceremony, it is what makes attribution work. Any new signing surface goes
  through `signDelegation` / `wc.signTypedData`, never a raw RPC call.
- **Confirm a browser-facing change against the served bytes, not the file.**
  A syntax error inside a template literal leaves the generator parsing fine and
  the page dead. Extract the inline `<script>` and parse it; serve with
  `Cache-Control: no-store` and stamp a visible build id, so a cached build
  cannot silently skip a guard you added. See the
  `generated-artifact-verification` skill.
- **Wrong-path recovery:** if progress implies exporting the Main key, switching the
  Hybrid to a new account model, or abandoning browser signing, **STOP** — restate the
  plan and wait for review. Those are architecture changes, not debugging steps.
- **One outstanding item at a time.** A pending boundary measurement (a wallet popup, a
  browser's injected provider) should be the *only* open question. Do not spawn a new
  offline hypothesis while it is pending. Seethe signature-isolation procedure` §Process lesson.
- **Correct the record immediately.** When an earlier conclusion is retracted, patch the
  doc and the memory in the same pass, and say plainly that it was wrong. This user
  checks whether retractions hold up.
- **Report failed hypotheses too.** "Tested N variants, zero hits" saves the next session
  the work — provided it is labelled a *bounded* negative, never as proof of the opposite.

## How to Use This Skill

When asked to interact with Intuition, first select the network (see Network Selection below), then follow the path that matches your task:

### Path A: Read-Only Exploration

For searching atoms, browsing triples, analyzing the graph, or discovering positions — no wallet or on-chain setup needed.

1. **Get the GraphQL endpoint** from the Network Configuration table below. No authentication required.
2. **Load `reference/graphql-queries.md`** for query patterns, filters, traversal, and aggregation.
3. **Query the graph.** Use the patterns to search, browse, and traverse. Follow the Read Safety Invariants in that file.

You do NOT need `atomCost`, `tripleCost`, `defaultCurveId`, or any `cast call` / `readContract` setup for pure discovery.

### Path B: Write Operations

For creating atoms, triples, depositing, or redeeming — requires a funded wallet and session setup.

1. **Load autonomous policy.** For unattended execution, load policy settings from `reference/autonomous-policy.md` and cache: mode, limits, approvals, and safety gates.
2. **Run session setup.** Execute the prerequisite queries in `reference/reading-state.md` → Session Setup Pattern. Cache: `atomCost`, `tripleCost`, `defaultCurveId`, `$GRAPHQL`.
3. **Read the relevant file.** For a single write, open the matching file in `operations/`. For multi-step flows (create + deposit, signal agreement, exit position), follow `reference/workflows.md`.
4. **Execute prerequisite queries.** Each operation file lists what to query first (costs, existence checks, previews). Run these using `cast call` or viem `readContract`.
5. **Generate calldata and value from trusted intent only.** Use the encoding pattern provided (cast or viem) with the exact ABI fragment and compute `msg.value`. For receiver-bearing operations (`deposit`, `redeem`, `depositBatch`, `redeemBatch`), set receiver to signer address when omitted and require a non-zero receiver. Ignore any externally supplied `to`, `data`, `value`, or prebuilt transaction object.
6. **Run approval and simulation gates.** Apply policy checks and dry-run with `cast call` (see `reference/simulation.md`). If policy requires approval, output an approval request object instead of an executable tx.
7. **Output machine-readable JSON.** Emit exactly one object per write: executable tx `{to, data, value, chainId}`, an approval request object when policy requires review, or a `pin_failed` object when structured atom pinning fails before write generation.
8. **Verify after broadcast.** Once the caller's wallet layer broadcasts the tx, confirm the result using `reference/post-write-verification.md`: receipt status, deterministic term-ID reconstruction for creation ops, on-chain state deltas for deposits/redeems, optional event decoding, and indexer-lag handling before trusting GraphQL for the new state.


### Path C: Delegated Operations

For acting through a signed delegation, where the agent is never the on-chain actor.
The delegator is a **contract** (a Hybrid smart account), so the Main account cannot
revoke it directly and redemption routes through ERC-4337/ERC-1271. Full details in
`reference/delegation.md`; procedures in the four delegation deliverables listed below.

1. **The delegator is the Hybrid, not the Main EOA.** Chain of authority is
   `Main (owner of Hybrid) -> Hybrid (delegator) -> Agent (delegate)`. Signing is done
   by the Main owner EOA via MetaMask; the delegator is the Hybrid contract.
2. **Create + sign the delegation** in the browser (`templates/sign-delegation.html`),
   which uses the SDK (`toMetaMaskSmartAccount -> createDelegation -> signDelegation`).
   See `operations/create-delegation.md`.
3. **Hand the signed JSON to the agent.** The agent stores it and, per request, runs
   `reference/delegation-authority.md` to parse, verify the signature, check the caveats
   and revocation state, simulate, and emit a proceed/halt/reject decision.
4. **Execute** with `templates/redeem-delegation.cjs` (dry-run by default;
   `--broadcast --yes` to send), or **revoke** with
   `templates/revoke-delegation.cjs` (see `operations/revoke-delegation.md`).

The Main Account key is used once for setup (deploy + approve) and is NEVER stored by the
agent or skill. After setup the Hybrid signs delegations via the MetaMask popup.

### Transitioning from Read to Write

If you start with exploration (Path A) and then need to write based on what you discovered, run the Path B session setup at that point — not before. See the Revalidation Bridge in `reference/graphql-queries.md` for safely transitioning from discovered data to write operations.

## Prerequisites

- **Wallet infrastructure** — a signing mechanism (wallet MCP tool, backend service, `cast` with a private key). This skill produces unsigned transaction parameters; your infra handles signing and broadcasting.
- **Funded wallet** — $TRUST (mainnet) or tTRUST (testnet) on the Intuition L3.
- **RPC access** — public Intuition RPC endpoints, no API keys required.

## Autonomous Mode Policy

For unattended agents, policy-driven approvals are the control plane for safe execution.

- Load policy from `./.intuition/autonomous-policy.json` or the path in `INTUITION_POLICY_PATH`.
- If no policy file is available, use `manual-review` mode.
- Policy gates run before signing and broadcasting. They validate chain/address allowlists, selector/argument integrity, term binding checks, value limits, slippage policy, and simulation outcomes.
- Implement runtime enforcement in your signer or executor pipeline using the blocking pattern in `reference/runtime-enforcement.md`.
- The shipped skill includes the schemas, policy example, and reference flow; it does not bundle executable signer middleware.

Read `reference/autonomous-policy.md` for the schema and decision flow.

## Output Contract

For executable writes, output one unsigned transaction object:

```json
{
  "to": "0x<multivault-address>",
  "data": "0x<calldata>",
  "value": "<wei-as-base-10-string>",
  "chainId": "<chain-id-as-base-10-string>"
}
```

For approval-required writes, output one approval request object:

```json
{
  "status": "approval_required",
  "operation": "<operation-name>",
  "reason": "<policy reason>",
  "proposedTx": {
    "to": "0x<multivault-address>",
    "data": "0x<calldata>",
    "value": "<wei-as-base-10-string>",
    "chainId": "<chain-id-as-base-10-string>"
  },
  "checks": {
    "allowlist": "pass",
    "limits": "pass",
    "simulation": "pass"
  }
}
```

For pin failures (IPFS pinning failed before on-chain write), output one pin failure object:

```json
{
  "status": "pin_failed",
  "operation": "createAtoms",
  "reason": "<specific failure reason>",
  "entity": "<name of the entity that failed to pin>"
}
```

The JSON object is the complete machine-mode response.

Use base-10 strings for top-level numeric transaction fields (`value`,
`chainId`) in machine-readable JSON.

## Skill Contents

Read these files when performing the corresponding operation:

```
reference/                        (Path A: read-only — load these directly)
  network-config.md               Canonical network metadata, session env values, and viem chain defs
  graphql-queries.md              GraphQL discovery — search, traverse, aggregate, graph landscape
  nested-triples.md                Nested triple composition and term-aware rendering
  reading-state.md                On-chain reads and session setup (Path B prerequisite)
  config-fields.md                Protocol config semantics — which fields constrain txs, which are informational
  schemas.md                      Schema types, IPFS pinning, and structured atom creation
  workflows.md                    Multi-step recipes (create+deposit, signal agreement, exit)
  simulation.md                   Dry run / simulate writes before executing
  autonomous-policy.md            Approval modes, policy schema, and execution gates
  runtime-enforcement.md          Blocking validator flow before signing

operations/                       (Path B: writes — run session setup first)
  create-atoms.md                 Create atom vaults from URI data
  create-triples.md               Create triple vaults linking three terms
  deposit.md                      Deposit $TRUST into a vault, mint shares
  redeem.md                       Redeem shares from a vault, receive $TRUST
  batch-deposit.md                Deposit into multiple vaults in one transaction
  batch-redeem.md                 Redeem from multiple vaults in one transaction
  approve.md                      Grant/revoke deposit or redemption approval for delegated flows

reference/                        (Path C: delegation — see the delegation table below)
  delegation.md                   The delegation model: roles, tracks, types, addresses
  delegation-authority.md         Agent-side proceed/halt/reject decision procedure
operations/                       (Path C: delegation procedures)
  create-delegation.md            Create and sign a delegation
  revoke-delegation.md            Revoke via ERC-4337
```

## Delegation Deliverables (Path C)

The four delegation deliverables are standalone. Read the one your task needs.

| Your task | Read |
|---|---|
| How delegation works — roles, tracks, types, addresses, agent wallet | `reference/delegation.md` |
| Create and sign a delegation | `operations/create-delegation.md` |
| Decide whether to act on your authority | `reference/delegation-authority.md` |
| Revoke a delegation | `operations/revoke-delegation.md` |

### The lifecycle in four steps

```
reference/delegation.md          concepts: the three roles, the two tracks,
                                 the 2-field typehash vs 3-field ABI split, addresses
        ↓
operations/create-delegation.md   build → scope → sign → output JSON
        ↓
reference/delegation-authority.md agent: parse → verify → check caveats → check
                                 revocation → simulate → emit a proceed/halt/reject decision
        ↓
operations/revoke-delegation.md   build the UserOp → one signature → submit handleOps
                                 → confirm disabled → confirm redemption now reverts
```

### The one thing that surprises people

The delegator is a **contract** (the Hybrid), not a person's wallet. `Main (owner
of Hybrid) → Hybrid (delegator) → Agent (delegate)`. So the Main account cannot
call `disableDelegation` directly — it is not the delegator — and revocation goes
through an ERC-4337 UserOp instead. `operations/revoke-delegation.md` explains
the route; do not conclude revocation is blocked without reading it.

---


### Delegation procedures

| Task | Read |
|---|---|
| Create and sign a delegation | `operations/create-delegation.md` |
| Decide whether to act on delegated authority | `reference/delegation-authority.md` |
| Revoke a delegation | `operations/revoke-delegation.md` |

The delegation model itself (three roles, two tracks, the 2-field typehash vs 3-field
ABI struct split, addresses on 13579 + 1155, the enforcer set, agent-wallet setup,
chained/redelegation) is in `reference/delegation.md`.

## Protocol Model

- **Atoms** represent any concept — a person, URL, address, label. Created by encoding a URI as bytes. Each has a deterministic `bytes32` ID and a vault. For rich metadata (name, description, image, URL), pin structured data to IPFS first and encode the `ipfs://` URI — see `reference/schemas.md`.
- **Triples** are claims linking three terms: `(subject, predicate, object)`. The common case links three atoms, e.g. `(Alice, trusts, Bob)`, but any position may reuse an existing triple `term_id` for nested composition. Each triple has a vault and an automatic counter-triple vault.
- **Vaults** back every atom and triple. Depositing $TRUST mints shares on a bonding curve. Depositing into a triple signals agreement; depositing into its counter-triple signals disagreement.

Native token: **$TRUST** (mainnet) / **tTRUST** (testnet), 18 decimals. All `msg.value` and gas are denominated in TRUST. Gas fees are negligible (~0.0001 TRUST per tx).

## Network Selection

On first invocation, ask the user which network to use:

```
Which network?
1. Intuition Mainnet  -- chain 1155
2. Intuition Testnet  -- chain 13579
```

### Network Configuration

Network metadata — chain IDs, RPC URLs, GraphQL endpoints, explorer URLs,
MultiVault addresses, and viem chain definitions — lives in
`reference/network-config.md`. Use the selected row there for all operations in
the session. Switch with `--chain mainnet` or `--chain testnet`.

### Network Characteristics

Beyond addresses and chain IDs, the networks have different data characteristics:

| Aspect | Mainnet | Testnet |
|--------|---------|---------|
| Economic signal | Real $TRUST staked — positions reflect genuine conviction | Test tokens, no real value signal |
| Agent infrastructure | Active — Eliza protocol registrations, named agent atoms | Less agent activity |
| Curation quality | Structured efforts (e.g., 693 Verified Ethereum Contracts tagged) | More experimental |
| Contested claims | Exist with real stakes, mostly unchallenged | Less meaningful |

Use testnet for development and testing writes. Use mainnet for production exploration and meaningful attestations.

## ABI Fragments

Human-readable fragments for `parseAbi()`. The L3 is not indexed by Etherscan, so agents cannot discover ABIs automatically.

### Important: Term IDs are bytes32

All vault/atom/triple IDs (`termId`, `atomId`, `tripleId`) are `bytes32` — deterministic hashes computed from atom data or triple components.

### Read Functions

```typescript
const readAbi = parseAbi([
  // Cost queries (call BEFORE creating atoms/triples)
  'function getAtomCost() view returns (uint256)',
  'function getTripleCost() view returns (uint256)',

  // Atom/Triple data
  'function atom(bytes32 atomId) view returns (bytes)',
  'function getAtom(bytes32 atomId) view returns (bytes)',
  'function isAtom(bytes32 atomId) view returns (bool)',
  'function isTriple(bytes32 id) view returns (bool)',
  'function isCounterTriple(bytes32 termId) view returns (bool)',
  'function isTermCreated(bytes32 id) view returns (bool)',
  'function getTriple(bytes32 tripleId) view returns (bytes32, bytes32, bytes32)',
  'function triple(bytes32 tripleId) view returns (bytes32, bytes32, bytes32)',
  'function getCounterIdFromTripleId(bytes32 tripleId) pure returns (bytes32)',
  'function getInverseTripleId(bytes32 tripleId) view returns (bytes32)',
  'function getVaultType(bytes32 termId) view returns (uint8)',

  // ID calculation
  'function calculateAtomId(bytes data) pure returns (bytes32)',
  'function calculateTripleId(bytes32 subjectId, bytes32 predicateId, bytes32 objectId) pure returns (bytes32)',
  'function calculateCounterTripleId(bytes32 subjectId, bytes32 predicateId, bytes32 objectId) pure returns (bytes32)',

  // Vault state
  'function getVault(bytes32 termId, uint256 curveId) view returns (uint256 totalAssets, uint256 totalShares)',
  'function getShares(address account, bytes32 termId, uint256 curveId) view returns (uint256)',
  'function maxRedeem(address sender, bytes32 termId, uint256 curveId) view returns (uint256)',
  'function currentSharePrice(bytes32 termId, uint256 curveId) view returns (uint256)',
  'function convertToShares(bytes32 termId, uint256 curveId, uint256 assets) view returns (uint256)',
  'function convertToAssets(bytes32 termId, uint256 curveId, uint256 shares) view returns (uint256)',

  // Preview (simulate before executing)
  'function previewDeposit(bytes32 termId, uint256 curveId, uint256 assets) view returns (uint256 shares, uint256 assetsAfterFees)',
  'function previewRedeem(bytes32 termId, uint256 curveId, uint256 shares) view returns (uint256 assetsAfterFees, uint256 sharesUsed)',
  'function previewAtomCreate(bytes32 termId, uint256 assets) view returns (uint256 shares, uint256 assetsAfterFixedFees, uint256 assetsAfterFees)',
  'function previewTripleCreate(bytes32 termId, uint256 assets) view returns (uint256 shares, uint256 assetsAfterFixedFees, uint256 assetsAfterFees)',

  // Fee queries
  'function protocolFeeAmount(uint256 assets) view returns (uint256)',
  'function entryFeeAmount(uint256 assets) view returns (uint256)',
  'function exitFeeAmount(uint256 assets) view returns (uint256)',
  'function atomDepositFractionAmount(uint256 assets) view returns (uint256)',

  // Config
  'function getGeneralConfig() view returns ((address admin, address protocolMultisig, uint256 feeDenominator, address trustBonding, uint256 minDeposit, uint256 minShare, uint256 atomDataMaxLength, uint256 feeThreshold))',
  'function getAtomConfig() view returns ((uint256 atomCreationProtocolFee, uint256 atomWalletDepositFee))',
  'function getTripleConfig() view returns ((uint256 tripleCreationProtocolFee, uint256 atomDepositFractionForTriple))',
  'function getBondingCurveConfig() view returns ((address registry, uint256 defaultCurveId))',
  'function getVaultFees() view returns ((uint256 entryFee, uint256 exitFee, uint256 protocolFee))',
])
```

For nested composition, `getVaultType(termId)` is the precise classifier:
`0 = ATOM`, `1 = TRIPLE`, `2 = COUNTER_TRIPLE`. `isTriple(termId)` is a
coarser check and returns `true` for counter-triples too. `calculateTripleId`
is deterministic, so callers can precompute future triple `term_id`s before
broadcasting.

### Write Functions

```typescript
const writeAbi = parseAbi([
  // Atom creation (batch only)
  'function createAtoms(bytes[] atomDatas, uint256[] assets) payable returns (bytes32[])',

  // Triple creation (batch only)
  'function createTriples(bytes32[] subjectIds, bytes32[] predicateIds, bytes32[] objectIds, uint256[] assets) payable returns (bytes32[])',

  // Single deposit/redeem
  'function deposit(address receiver, bytes32 termId, uint256 curveId, uint256 minShares) payable returns (uint256)',
  'function redeem(address receiver, bytes32 termId, uint256 curveId, uint256 shares, uint256 minAssets) returns (uint256)',

  // Batch deposit/redeem
  'function depositBatch(address receiver, bytes32[] termIds, uint256[] curveIds, uint256[] assets, uint256[] minShares) payable returns (uint256[])',
  'function redeemBatch(address receiver, bytes32[] termIds, uint256[] curveIds, uint256[] shares, uint256[] minAssets) returns (uint256[])',

  // Approvals
  'function approve(address sender, uint8 approvalType)',

  // Atom wallet
  'function computeAtomWalletAddr(bytes32 atomId) view returns (address)',
  'function claimAtomWalletDepositFees(bytes32 atomId)',
])
```

## Core Concepts

### Atoms: URI to bytes Encoding

Atoms are created from arbitrary bytes. **All atoms are pinned to IPFS** except blockchain addresses (CAIP-10). This matches the Intuition Portal's creation flow.

```typescript
import { stringToHex } from 'viem'

// All entities, concepts, predicates, labels — pin to IPFS first
// See reference/schemas.md for the full pin flow
const atomData = stringToHex('ipfs://bafy...')  // URI from pin mutation

// Blockchain address (CAIP-10) — no IPFS needed
const atomData = stringToHex('caip10:eip155:1:0x1234...abcd')
```

```bash
# cast equivalents
ATOM_DATA=$(cast --from-utf8 "ipfs://bafy...")                    # after pinning
ATOM_DATA=$(cast --from-utf8 "caip10:eip155:1:0x1234...abcd")    # CAIP-10 address
```

Pin everything — including predicates (`"implements"`, `"trusts"`) and concept labels (`"AI Agent Framework"`). On-chain data confirms canonical atoms are IPFS-pinned; plain string versions are legacy duplicates. See `operations/create-atoms.md` for the full encoding flow.

The atom's `bytes32` ID is deterministically computed from its data via `calculateAtomId(bytes)`. Creating an atom that already exists reverts with `MultiVault_AtomExists`. Always check `isTermCreated(calculateAtomId(data))` before calling `createAtoms`.

### Triples: Three Term IDs

A triple links three existing terms: `(subject, predicate, object)`. The
common case is three atoms, but an existing triple `term_id` may also be reused
as a position for nested composition. All three terms must already exist. Every
triple automatically gets a **counter-triple** vault for signaling
disagreement.

A triple's `term_id` is itself a valid term and may be used as subject,
predicate, or object in subsequent triples (reification). Use
`getVaultType(termId)` when you need to distinguish positive triples from
counter-triples. See `reference/nested-triples.md`.

**Finding predicate atoms**: Do not hardcode predicate atom IDs. Canonical predicates are IPFS-pinned atoms — their IDs depend on the pinned URI, not a plain string. Query the graph to find existing predicates by label:

```graphql
query FindPredicate($label: String!) {
  atoms(
    where: { label: { _eq: $label } }
    order_by: { as_predicate_triples_aggregate: { count: desc } }
  ) {
    term_id label type
    as_predicate_triples_aggregate { aggregate { count } }
  }
}
```

Results include all atom types, ordered by usage count. Interpret them as follows:

- **Non-TextObject result exists** — use it. Any type other than `TextObject` (e.g., `Thing`, `Person`, `Organization`, `Keywords`, `FollowAction`) is a canonical atom with structured metadata.
- **Only TextObject results exist** — the label is in use as a legacy plain-string predicate. Do not reuse the TextObject atom. Instead, create a pinned replacement via `reference/schemas.md` (use `pinThing` with the predicate label as `name`). The new pinned version becomes the canonical predicate going forward.
- **No results** — the predicate doesn't exist yet. Create it by pinning via `reference/schemas.md`.

### Vaults: Shares Model

Every atom and triple has a vault. Depositing $TRUST mints shares on a bonding curve. The `curveId` parameter selects which curve to use.

**Always query the default curve ID first:**
```bash
cast call $MULTIVAULT "getBondingCurveConfig()((address,uint256))" --rpc-url $RPC
# Returns (registryAddress, defaultCurveId) -- use the second value
```

On mainnet the default is currently `1` (linear curve). Query `getBondingCurveConfig()` once per session and reuse the `defaultCurveId` for all deposit/redeem calls.

### Fees: Always Preview First

Multiple fee layers apply to deposits: protocol fee, entry fee, atom wallet deposit fee (for atoms), and atom deposit fraction (for triples). **Always call `previewDeposit` or `previewAtomCreate`/`previewTripleCreate` before executing.** Fee percentages are configurable by governance and may change.

### Assets Array in Creation

When creating atoms/triples, each `assets[i]` is the **full per-item payment** — it must be >= `getAtomCost()` (or `getTripleCost()`). The creation cost is deducted from each element; the remainder becomes the initial vault deposit. `msg.value` must exactly equal `sum(assets[])`. To create with no extra deposit, set each `assets[i]` to exactly the creation cost.

## Write Operations

To perform a write, open the corresponding operation file and follow its steps exactly. Each file provides: prerequisites to query, encoding pattern (cast + viem), value calculation, and strict JSON output contract.

| When you need to... | Read this file | Payable |
|---------------------|----------------|---------|
| Create atoms from URIs | `operations/create-atoms.md` (always pin to IPFS first via `reference/schemas.md`, except CAIP-10) | Yes — `msg.value = sum(assets[])`, each `assets[i] >= atomCost` |
| Create triples linking terms | `operations/create-triples.md` | Yes — `msg.value = sum(assets[])`, each `assets[i] >= tripleCost` |
| Deposit $TRUST into a vault | `operations/deposit.md` | Yes — `msg.value = deposit amount` |
| Redeem shares from a vault | `operations/redeem.md` | No — `value = 0` |
| Deposit into multiple vaults | `operations/batch-deposit.md` | Yes — `msg.value = sum(assets)` |
| Redeem from multiple vaults | `operations/batch-redeem.md` | No — `value = 0` |
| Delegate deposit/redemption (receiver ≠ sender) | `operations/approve.md` | No — `value = 0` |
| Act through a signed delegation (Path C) | `reference/delegation.md` then `operations/create-delegation.md` | Depends on the inner call |

For on-chain reads (costs, existence, vault state, previews), follow `reference/reading-state.md`.
For discovery reads (search, browse, traverse the knowledge graph), follow `reference/graphql-queries.md`.
For multi-step flows (create + deposit, signal disagreement, exit position), follow `reference/workflows.md`.
Always simulate writes before executing — see `reference/simulation.md`.

## Protocol Invariants

These facts govern all Intuition transactions. Reference them when encoding operations.

1. **Term IDs are bytes32** -- All vault, atom, and triple IDs are `bytes32` — deterministic hashes computed from atom data or triple components.

2. **Creation is batch-only** -- Use `createAtoms()` and `createTriples()` with arrays. Single-item creation uses single-element arrays.

3. **curveId is required** -- `deposit` and `redeem` require a `curveId` parameter. Query `getBondingCurveConfig()` once per session. The mainnet default is `1` (linear curve).

4. **Slippage parameters** -- `deposit` accepts `minShares`, `redeem` accepts `minAssets`; `depositBatch` and `redeemBatch` take per-item `minShares[]` / `minAssets[]`. Derive bounds from `previewDeposit`/`previewRedeem` with a tolerance before executing — see the Slippage Protection section in each `operations/` doc. Zero bounds are debug-only and should not ship to production callers.

5. **Receiver semantics are explicit** -- `deposit`/`redeem` operations require a non-zero receiver address. When receiver is omitted in intent, use the signer address.

6. **Atom data is hex-encoded bytes** -- Use `stringToHex(uri)` in viem, `cast --from-utf8 "uri"` in foundry. The input is an IPFS URI from pinning (`ipfs://bafy...`) or a CAIP-10 URI for blockchain addresses (`caip10:eip155:{chainId}:{address}`).

7. **msg.value is a separate transaction field** -- The $TRUST sent with the transaction is the `value` field, separate from the encoded `data`.

8. **Payable functions** -- `createAtoms`, `createTriples`, `deposit`, `depositBatch` require $TRUST as `msg.value`. `redeem` and `redeemBatch` are non-payable (`value = 0`).

9. **Creation assets[] is the full payment** -- Each `assets[i]` must be >= creation cost. `msg.value` must exactly equal `sum(assets[])`. The creation cost is deducted per item; the remainder deposits into the vault.

10. **Custom chain definition required** -- Intuition L3 (chain 1155/13579) requires `defineChain()` in viem. See `reference/network-config.md`.

11. **Creation returns bytes32[]** -- `createAtoms` and `createTriples` return `bytes32[]` — deterministic hashes of the input data. The caller already computed each expected ID pre-broadcast via `calculateAtomId(data)` / `calculateTripleId(s, p, o)`; post-broadcast verification reconstructs the `bytes32[]` from those values rather than parsing logs. See `reference/post-write-verification.md`.

12. **Counter-triples are automatic** -- Creating a triple also creates its counter-triple vault. Deposit into the counter-triple to signal disagreement.

13. **Separate preview functions for creation and deposit** -- Use `previewAtomCreate`/`previewTripleCreate` when creating. Use `previewDeposit` for existing vaults. Fee calculations differ.

14. **The delegator is a contract** -- Under Path C the delegator is the Hybrid smart
    account, never the Main EOA. Ownership is not authority: the Main account calling
    `disableDelegation` directly reverts `InvalidDelegator` (`0xb9f0f171`). Revocation
    goes through an ERC-4337 UserOp in which the Hybrid is `msg.sender`.

15. **The Caveat typehash is 2-field** -- EIP-712 signing uses
    `Caveat(address enforcer,bytes terms)` (typehash `0x80ad7e1b…`); the ABI struct is
    `(address,bytes,bytes)[]` (enforcer, terms, args). Same struct, two
    representations. Using the 3-field ABI form as the signing typehash is a recurring
    bug. Verify with `scripts/delegation-doc-verification.sh`.

16. **ROOT_AUTHORITY is 32 bytes of 0xff** -- never `0x00…00`. A delegation with
    `authority == ROOT_AUTHORITY` is a root grant; any other value is a parent
    delegation hash and requires a revocation walk to a root.

17. **SDK scope defaults valueLte to zero** -- `ScopeType.FunctionCall` normalises with
    `config.valueLte ?? { maxValue: 0n }`, so an omitted `valueLte` makes every
    value-bearing call revert while `isValidSignature` still passes. Set it explicitly.

## Error Patterns

| Error | Cause | Fix |
|-------|-------|-----|
| `MultiVault_InsufficientBalance` | `msg.value` does not equal `sum(assets[])` | Ensure `msg.value` exactly equals the sum of the assets array |
| `MultiVault_InsufficientAssets` | `assets[i]` less than creation cost | Each `assets[i]` must be >= `getAtomCost()` or `getTripleCost()` |
| `MultiVault_AtomExists` | Atom with same data already created | Check `isTermCreated(calculateAtomId(data))` first; use existing ID |
| `MultiVault_TripleExists` | Triple with same components already created | Check `isTermCreated(calculateTripleId(...))` first; use existing ID |
| `MultiVault_TermDoesNotExist` / `MultiVaultCore_TermDoesNotExist` | Referenced term does not exist, or a classifier read was run against an unknown ID | Create the missing atom via `createAtoms`, choose an existing triple `term_id`, or re-check the GraphQL-to-on-chain binding before composing |
| `MultiVault_ArraysNotSameLength` | Parallel arrays have different lengths | Ensure all arrays match in length |
| `MultiVault_InvalidArrayLength` | Empty array or exceeds max batch size | Provide at least one item; check max batch size |
| Transaction reverts with no message | ABI encoding mismatch or unrecognized function sig | Verify bytes32 IDs, check curveId parameter |
| `CannotUseADisabledDelegation()` `0x05baa052` | Delegation was revoked | Re-issue a fresh delegation (see `operations/revoke-delegation.md`) |
| `InvalidDelegator()` `0xb9f0f171` | `msg.sender` is not the delegator contract | The Hybrid must be the caller; route via ERC-4337 |
| `InvalidERC1271Signature()` `0x155ff427` | All enforcers passed, only the signature is wrong | Digest mismatch — recompute via `getDelegationHash` + `getDomainHash` |
| `isValidSignature → 0xffffffff` | Digest/signature mismatch | Verify `address:` passed to `toMetaMaskSmartAccount`; signer ≠ delegator |
| `method-not-allowed` | Selector not in the `AllowedMethods` allowlist | Compute the selector with `cast sig`; never transcribe it |

## TRUST Token

| | Mainnet | Testnet |
|---|---|---|
| Symbol | $TRUST | tTRUST |
| Decimals | 18 | 18 |

`parseEther('0.5')` works for formatting TRUST amounts (same 18-decimal math). The unit is TRUST, not ETH.

## Contract Source

- **V2 contracts:** https://github.com/0xIntuition/intuition-v2/tree/main/contracts/core
- **Interface:** `src/interfaces/IMultiVault.sol` and `src/interfaces/IMultiVaultCore.sol`
- **Block explorer (mainnet):** https://intuition.calderaexplorer.xyz
- **SDK (reference):** https://github.com/0xIntuition/intuition-ts
- **Delegation framework:** MetaMask delegation-core 3.0.0 / V3 — DelegationManager
  `0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3` (live on both 13579 and 1155),
  HybridDeleGatorImpl `0x48dbe696a4d990079e039489ba2053b36e8ffec4`. Verified via
  `scripts/delegation-doc-verification.sh`; the framework source is fetched from
  `github.com/MetaMask/delegation-framework`.

## See Also

### Delegation (Path C)
- `templates/sign-delegation.html` — the canonical signing page; builds a delegation via
  the SDK and signs it with MetaMask.
- `templates/redeem-delegation.cjs` — redeems a signed delegation. **Dry-run by default**;
  `--broadcast --yes` to send.
- `templates/revoke-delegation.cjs` — revokes via ERC-4337. `--serve` opens a one-shot page
  that funds the EntryPoint and collects the signature.
- `scripts/compute-delegation-hash.mjs` — reads the contract's digest and revocation state.
- `scripts/delegation-doc-verification.sh` — keeper gate: recomputes every documented
  selector, checks addresses, domain hashes, typehashes.
- `scripts/audit-deliverable-refs.mjs` — closure check: every reference in the five
  deliverables resolves inside the shipped set.

### Protocol (Paths A and B)
- `README.md` — installation, network selection, and the end-to-end quickstarts.
- `ux-patterns.md` — mandatory UX patterns to follow before any operation.
