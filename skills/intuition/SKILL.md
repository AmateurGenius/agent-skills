---
name: intuition
description: "Use this skill when interacting with the Intuition Protocol on-chain. Follow these instructions to produce correct transactions for creating atoms, triples, depositing into vaults, reading protocol state, and managing delegated authority. Triggers on tasks involving Intuition, atoms, triples, vaults, attestations, delegation, the Delegation Framework, or the $TRUST token."
version: 0.6.2
author: jonathanprozzi
license: MIT
tags: [intuition, defi, delegation, eip712]
metadata:
  hermes:
    tags: [intuition, defi, delegation, eip712]
    related_skills: []
---

# Intuition Protocol Skill

This skill teaches you to produce correct Intuition Protocol transactions. Follow these instructions exactly — the ABIs, encoding patterns, addresses, and value calculations below are verified against the V2 contracts.

## How to Use This Skill

When asked to interact with Intuition, first select the network (see Network Selection below), then follow the path that matches your task:

**Choose your path:**
- **Path A: Read-Only** — Discovery and exploration. No wallet needed.
- **Path B: Write** — Create atoms/triples, deposit/redeem. Requires wallet and session setup.
- **Path C: Delegation** — Manage delegated authority or act as a delegated agent. Requires understanding of EIP-7702 and ERC-7710.

### Path A: Read-Only Exploration

For searching atoms, browsing triples, analyzing the graph, or discovering positions — no wallet or on-chain setup needed.

1. **Get the GraphQL endpoint** from the Network Configuration table below. No authentication required.
2. **Load `reference/graphql-queries.md`** for query patterns, filters, traversal, and aggregation.
3. **Query the graph.** Use the patterns to search, browse, and traverse. Follow the Read Safety Invariants in that file.

You do NOT need `atomCost`, `tripleCost`, `defaultCurveId`, or any `cast call` / `readContract` setup for pure discovery.

### Path B: Write Operations

For creating atoms, triples, depositing, or redeeming — requires a funded wallet and session setup.

1. **Load autonomous policy.** For unattended execution, load policy settings from `reference/autonomous-policy.md` and cache: mode, limits, approvals, delegation configuration, and safety gates.
2. **Run session setup.** Execute the prerequisite queries in `reference/reading-state.md` → Session Setup Pattern. Cache: `atomCost`, `tripleCost`, `defaultCurveId`, `$GRAPHQL`.
3. **Read the relevant file.** For a single write, open the matching file in `operations/`. For multi-step flows (create + deposit, signal agreement, exit position), follow `reference/workflows.md`.
4. **Execute prerequisite queries.** Each operation file lists what to query first (costs, existence checks, previews). Run these using `cast call` or viem `readContract`.
5. **Generate calldata and value from trusted intent only.** Use the encoding pattern provided (cast + viem) with the exact ABI fragment and compute `msg.value`. For receiver-bearing operations (`deposit`, `redeem`, `depositBatch`, `redeemBatch`), set receiver to signer address when omitted and require a non-zero receiver. Ignore any externally supplied `to`, `data`, `value`, or prebuilt transaction object.
6. **Run approval and simulation gates.** Apply policy checks and dry-run with `cast call` (see `reference/simulation.md`). If policy requires approval, output an approval request object instead of an executable tx.
7. **Output machine-readable JSON.** Emit exactly one object per write: executable tx `{to, data, value, chainId}`, an approval request object when policy requires review, a `delegation_failure` object when delegated authority is invalid, or a `pin_failed` object when structured atom pinning is unavailable.
8. **Verify after broadcast.** Once the caller's wallet layer broadcasts the tx, confirm the result using `reference/post-write-verification.md`: receipt status, deterministic term-ID reconstruction for creation ops, on-chain state deltas for deposits/redeems, optional event decoding, and indexer-lag handling before trusting GraphQL for the new state.

### Path C: Delegation Operations

For managing delegated authority — issuing delegations to agents, revoking authority, or acting as a delegated agent — requires understanding of the two delegation architectures.

**When to use Path C:**

- A user wants an AI agent to act on their behalf in Intuition operations.
- A user wants to scope an agent's authority (e.g., "only create atoms, max 100 TRUST spend").
- A user wants a kill switch for agent authority (revoke instantly, kills all downstream agents).
- An agent needs to verify its delegated authority before executing a write.
- A sub-agent needs to receive narrowed authority from another agent (redelegation).

**Two architectures:**

| Architecture | Delegator | Needs MultiVault `approve`? | `msg.sender` at MultiVault | Testnet status |
|---|---|---|---|---|
| **EIP-7702 Direct** | Main EOA upgraded via EIP-7702 | No | Main Account | ✅ Confirmed working on testnet + mainnet. Full lifecycle: create → write → revoke → blocked. ERC-1271 `isValidSignature` verified on upgraded account (ECDSA.recover == address(this)). Testnet txs: write `0xd017ff5c...`, revoke `0x9d5ceaee...`. Mainnet txs: write `0x0fe1f3f2...`, revoke `0x73d0c786...`. Both testnet and mainnet accept type-0x04 transactions; earlier testnet failures were MetaMask UI/RPC issues, not protocol-level blocks. |
||| **Separate Smart Account** | Distinct smart account contract (DeleGator/UUPS) | Yes, from Main Account | Smart Account | ✅ Confirmed working on testnet + mainnet. Full lifecycle: approval → create via `redeemDelegations` → revoke → blocked. Testnet approval uses `approvalType=3`. Testnet txs: approval `0x32fbb5c0...`, redemption `0x3d2d359c...`, revoke `0x9703a41a...`. Mainnet approval uses `approvalType=3` (not 255). Mainnet txs: approval `0x3f6bf183...`, redemption `0x0f48471f...`, revoke `0xb0778e08...`. Post-revoke error: `CannotUseADisabledDelegation()` (`0x05baa052`). Note: `isApprovedFor` view function exists on mainnet but not on testnet; on testnet call `approve` directly without checking first. |

**Quick Reference: Which Path?**

| Question | Answer |
|---|---|
| Main Account has `0xef0100...` code? | Path 1 (EIP-7702 Direct) |
| Main Account owns a separate Smart Account? | Path 2 (Separate Smart Account) |
| Need `approve` on MultiVault? | Path 2 only |
| Need to fund Smart Account? | Path 2 only (0.01–0.02 tTRUST + gas) |
| Agent submits txs, `msg.sender` is delegator? | Both paths |
| Always call `getDomainHash()` on-chain first? | Both paths |
| Always call `getDelegationHash()` on-chain for struct hash? | Both paths |
| Revocation kills all downstream delegations? | Both paths |

**For delegators (issuing authority):

1. **Determine architecture.** Use EIP-7702 Direct if the Main Account has signed an EIP-7702 authorization tuple. Use Separate Smart Account if the Main Account owns a distinct DeleGator/UUPS proxy.
2. **Load `reference/delegation.md`** for concepts, struct anatomy, contract addresses, signing flow, and agent wallet setup.
3. **For Separate Smart Account only:** Call `approve(SmartAccount, approvalType)` on MultiVault from the Main Account. See `reference/delegation.md` → Two Delegation Paths.
> **Pitfall:** `approvalType = 255` (`APPROVE_ALL`) reverts on mainnet. Use `approvalType = 3` (`APPROVE_DEPOSIT | APPROVE_REDEMPTION`) instead.
> **Pitfall:** `isApprovedFor(address,address)` exists on mainnet MultiVault but **not** on testnet. On testnet, call `approve(SmartAccount, 3)` directly without a pre-check. If already approved, the call may succeed or revert; either way proceed.
4. **Pre-flight check for testnet Path 2:** Before running the end-to-end flow on testnet, verify the Main Account balance >= 0.2 tTRUST. The flow requires funding the Smart Account (0.01–0.02 tTRUST) plus gas for upgrade, approval, redemption, and revocation. See `references/testnet-path2-prerequisites.md` for the exact check command and known blockers. If balance is insufficient, bridge more tTRUST or use a different funded testnet account.
4. **Follow `operations/create-delegation.md`** to build, sign, and output the Delegation object. Set caveats (operation allowlist, spend cap, call limit) to scope authority.
5. **Transmit the signed Delegation object to the Agent off-chain.** The Agent stores it in secure session state.
6. **To revoke, follow `operations/revoke-delegation.md`.** Revocation is on-chain, permanent, and propagates to all downstream redelegations.

**For agents (receiving and exercising authority):**

1. **Generate an agent wallet** using the pattern in `reference/delegation.md` → Agent Wallet Setup. Share the address with the delegator.
2. **Receive and store the Delegation object** in secure session state (`~/.intuition/agent-state.json`, permissions `0600`).
3. **Before every Path B write, run `reference/delegation-authority.md`.** This autonomous gate verifies: signature, revocation, expiry, caveats, MultiVault approval (Path 2 only), and receiver consistency.
4. **If the gate passes,** the agent wraps the Intuition calldata in `redeemDelegations()` targeting the DelegationManager. The outer transaction carries `value = 0`; all TRUST value lives in the inner transaction.
5. **If the gate fails,** the agent emits a `delegation_failure` object and halts. It does not reach economic limits, slippage checks, or simulation.
6. **For encoding rules:** Load `references/delegation-encoding-rules.md` for the exact encoding rules, kill switch proof, and verified addresses. Load `references/delegation-debugging.md` for the 7-layer debugging order, known testnet blocker, and diagnostic commands.

**Canonical Delegation Workflow (Layered Verification)**

When creating, verifying, or debugging a delegation, apply checks in this exact order:

1. **ERC-1271 probe (Layer 1)** — Call `isValidSignature(digest, signature)` on the delegator contract in isolation. Pass: returns `0x1626ba7e`. If this fails, fix the digest/signature before proceeding.
2. **Domain hash from-chain (Layer 2)** — Call `getDomainHash()` on the DelegationManager and use the returned `bytes32` directly in the EIP-712 digest. Pass: domain hash matches on-chain read.
3. **Struct hash verified on-chain (Layer 3)** — Compute `getDelegationHash()` off-chain, then call `getDelegationHash(delegation)` on-chain. Pass: `offChainHash === onChainHash`.
4. **Signature recovery (Layer 4)** — Run `ethers.recoverAddress(digest, signature)` and verify it equals `delegator` byte-for-byte. Pass: `recovered.toLowerCase() === DELEGATOR.toLowerCase()`.
5. **Encoding compliance (Layer 5)** — Verify: `_permissionContexts[i]` is `abi.encode(Delegation[], bytes32 delegationHash)`; `execCallData` is `solidityPacked(address,uint256,bytes)`; `AllowedMethodsEnforcer` terms are raw bytes4 selectors; `LimitedCallsEnforcer` terms are `abi.encode(uint256)`.
6. **Pre-compute atom/triple ID (Layer 6)** — Call the creation function via `provider.call({ to: MULTIVAULT, data, value, from: DELEGATOR })` to get the deterministic ID. On mainnet, always include `from: DELEGATOR` for value-carrying static calls.
7. **Systematic debugging (Layer 7)** — When `redeemDelegations` fails, rule out causes in this order: permission context encoding → execCallData packing → enforcer terms format → inner value field → delegator balance → bare direct call from delegator → atom/triple existence check.

**Critical rule:** The Agent is never the on-chain actor. `msg.sender` at MultiVault is the delegator's address (Main Account in EIP-7702; Smart Account in separate). The Agent is purely the transaction submitter and gas payer.

> **Mainnet Status (2026-08-14):** DelegationManager (`0xdb9B...`) and MultiVault (`0x6E35...`) are live on mainnet chain 1155. EIP-7702 delegated accounts (`0xef0100...` code) implement `isValidSignature` correctly (ECDSA.recover == address(this)). The previously reported ERC1271 validation gap is refuted by on-chain proof. Full Path 1 lifecycle is confirmed working on mainnet: create via `redeemDelegations` → revoke → post-revoke blocked. `getDomainHash()` now returns a value on mainnet: `0x44653bfc83c7c3f4ecd0ab2d76a7aff5e3478def6f0a290d939437b65d6fe1d5`. Delegation encoding is resolved: `getDelegationHash` uses **standard OpenZeppelin EIP-712 v4** (MetaMask Delegation Framework). Always call `getDelegationHash()` on-chain and use its returned `bytes32` directly for `_permissionContexts`. Do not recompute with standard EIP-712 libraries off-chain; the on-chain implementation is the only authoritative source. See `reference/delegation.md` and `references/delegation-debugging.md` for verification steps. The legacy `references/delegation-encoding.md` documents a now-superseded approach and should not be followed.

### Transitioning from Read to Write

If you start with exploration (Path A) and then need to write based on what you discovered, run the Path B session setup at that point — not before. See the Revalidation Bridge in `reference/graphql-queries.md` for safely transitioning from discovered data to write operations.

## Prerequisites

- **Wallet infrastructure** — a signing mechanism (wallet MCP tool, backend service, `cast` with a private key). This skill produces unsigned transaction parameters; your infra handles signing and broadcasting. **ethers v6 note:** `wallet.signDigest()` was removed; use `new ethers.SigningKey(pk).sign(bytes).serialized` instead. Sign the 32-byte EIP-712 digest directly — do not double-hash it.
- **Funded wallet** — $TRUST (mainnet) or tTRUST (testnet) on the Intuition L3.
- **RPC access** — public Intuition RPC endpoints, no API keys required.
- **Pinning capability for structured atoms** — the consuming application's trusted server or CLI runtime owns configuration and credentials. Prefer `@0xintuition/sdk` 3.0.1 or newer with `configureSdk({ pinApiKey })`, or a compatible host-provided adapter. The skill never obtains, stores, prints, or places the key in prompts, plans, transaction output, or browser code. Read `reference/schemas.md` before any structured-atom write.
- **For delegation:** Agent wallet (separate from the delegator's wallet) and secure storage for the signed Delegation object (`~/.intuition/agent-state.json`, permissions `0600`).
- **Key separation (mandatory):** The delegator's private key must **never** be stored by the agent or skill. It stays in the user's own wallet. Only the **agent's** private key may be persisted, to `~/.intuition/agent-wallet.json` with permissions `0600`. See `reference/delegation.md` → "Security: Key Separation" for the full rules.

## Autonomous Mode Policy

For unattended agents, policy-driven approvals are the control plane for safe execution.

- Load policy from `./.intuition/autonomous-policy.json` or the path in `INTUITION_POLICY_PATH`.
- If no policy file is available, use `manual-review` mode.
- Policy gates run before signing and broadcasting. They validate chain/address allowlists, selector/argument integrity, term binding checks, value limits, slippage policy, simulation outcomes, and **delegated authority verification** (if delegation mode is active).
- Implement runtime enforcement in your signer or executor pipeline using the blocking pattern in `reference/runtime-enforcement.md`.
- The shipped skill includes the schemas, policy example, and reference flow; it does not bundle executable signer middleware.

Read `reference/autonomous-policy.md` for the schema and decision flow.

## Output Contract

For executable writes, output one unsigned transaction object:

```
{
  "to": "0x<multivault-address>",
  "data": "0x<calldata>",
  "value": "<wei-as-base-10-string>",
  "chainId": "<chain-id-as-base-10-string>"
}
```

For approval-required writes, output one approval request object:

```
{
  "status": "approval_required",
  "operation": "<operation-name>",
  "reason": "<policy reason>",
  "proposedTx": {
    "to": "0x...",
    "data": "0x...",
    "value": "100000000000000000",
    "chainId": "1155"
  },
  "checks": {
    "allowlist": "pass",
    "limits": "pass",
    "simulation": "pass"
  }
}
```

For delegated writes (when delegation mode is active), output the nested transaction:

```
{
  "to": "0x<delegation-manager-address>",
  "data": "0x<redeemDelegations-calldata>",
  "value": "0",
  "chainId": "<chain-id-as-base-10-string>",
  "delegationContext": {
    "delegationHash": "0x...",
    "delegator": "0x...",
    "wrappedOperation": "deposit",
    "caveatChecks": {
      "signature": "pass",
      "revocation": "pass",
      "expiry": "pass",
      "methodAllowlist": "pass",
      "spendCap": "pass",
      "receiver": "pass"
    }
  }
}
```

For delegation authority failures, output one delegation failure object:

```
{
  "status": "delegation_failure",
  "reason": "<failure reason>",
  "delegationHash": "0x...",
  "failedCheck": "<check name>",
  "details": {}
}
```

Common `reason` values: `signature_invalid`, `delegation_revoked`, `delegation_expired`, `method_not_allowed`, `spend_cap_exceeded`, `call_limit_exceeded`, `multivault_unauthorized`, `receiver_mismatch`, `daily_budget_exceeded`.

For unavailable pinning configuration or pin failures before an on-chain write, output one pin failure object:

```
{
  "status": "pin_failed",
  "operation": "createAtoms",
  "reason": "<specific failure reason>",
  "entity": "<name of the entity that failed to pin>"
}
```

When no host pinning capability or API key is configured, set `reason` to a message beginning `pinning_configuration_required`. Do not attempt the request, ask the user to paste a key, inspect secret files, or emit transaction data.

The JSON object is the complete machine-mode response.

Use base-10 strings for top-level numeric transaction fields (`value`, `chainId`) in machine-readable JSON.

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
  autonomous-policy.md            Approval modes, policy schema, execution gates, delegation policy
  runtime-enforcement.md          Blocking validator flow before signing
  delegation.md                   ERC-7710 concepts, Smart Account Kit integration, agent wallet setup,
                                  EIP-7702 vs separate Smart Account architectures, caveat types,
                                  signing flow, permission context encoding
  delegation-authority.md         Autonomous verification gate for delegated agents — signature,
                                  revocation, expiry, caveat compliance, MultiVault approval simulation,
                                  receiver binding, decision tree, nested transaction output
  delegation-encoding.md              Legacy custom EncoderLib notes (archived; do not follow)
  delegation-operations-corrected.md  Verified operation corrections: salt type, domain separator, verification gates, revocation propagation (archived)
  references/delegation-encoding-rules.md  Critical encoding rules, kill switch proof, and debugging order (network-agnostic)
  references/delegation-debugging.md       Layered verification debugging patterns: permission context encoding, ERC-1271 probe, inner value forwarding, bare direct call isolation
  references/testnet-path2-prerequisites.md Testnet Path 2 e2e prerequisites: funding requirements, pre-flight balance check, known blockers
  references/delegation-encoding-rules.md  Critical encoding rules, kill switch proof, and debugging order (network-agnostic)
  references/delegation-debugging.md       Layered verification debugging patterns: permission context encoding, ERC-1271 probe, inner value forwarding, bare direct call isolation
  references/testnet-path2-prerequisites.md Testnet Path 2 e2e prerequisites: funding requirements, pre-flight balance check, known blockers
  references/path1-e2e-proof.md  Confirmed Path 1 (EIP-7702 Direct) working on testnet: full lifecycle tx hashes, isolated ERC-1271 probe pattern, return-value padding gotcha
  references/path1-mainnet-proof.md  Confirmed Path 1 (EIP-7702 Direct) working on mainnet: full lifecycle tx hashes, domain hash, atom cost, pre-compute `from` quirk

operations/                       (Path B: writes — run session setup first)
  create-atoms.md                 Create atom vaults from URI data
  deposit-atom.md                  Deposit $TRUST into an existing atom vault, mint shares
  create-triples.md               Create triple vaults linking three terms
  deposit-triple.md               Deposit $TRUST into an existing triple vault, mint shares (signals agreement)
  deposit.md                      Deposit $TRUST into a vault, mint shares (generic reference)
  redeem.md                       Redeem shares from a vault, receive $TRUST
  batch-deposit.md                Deposit into multiple vaults in one transaction
  batch-redeem.md                 Redeem from multiple vaults in one transaction
  approve.md                      Grant/revoke deposit or redemption approval for delegated flows

operations/                       (Path C: delegation — read reference/delegation.md first)
  create-delegation.md            Build, sign, and output a Delegation object (off-chain)
  revoke-delegation.md            Revoke a delegation on-chain (permanent, propagates downstream)
```

## Protocol Model

- **Atoms** represent any concept — a person, URL, address, label. Created by encoding a URI as bytes. Each has a deterministic `bytes32` ID and a vault. For rich metadata (name, description, image, URL), pin structured data to IPFS first and encode the `ipfs://` URI — see `reference/schemas.md`.
- **Triples** are claims linking three terms: `(subject, predicate, object)`. The common case links three atoms, e.g. `(Alice, trusts, Bob)`, but any position may reuse an existing triple `term_id` for nested composition. Each triple has a vault and an automatic counter-triple vault.
- **Vaults** back every atom and triple. Depositing $TRUST mints shares on a bonding curve. Depositing into a triple signals agreement; depositing into its counter-triple signals disagreement.
- **Delegations** are signed, off-chain authorizations that grant an Agent scoped authority to execute Intuition operations on behalf of a delegator. The Agent is never the on-chain actor — `msg.sender` at MultiVault is the delegator's address. Delegations are validated by the DelegationManager at redemption time. Caveats enforce restrictions (operation allowlist, spend caps, call limits). Revocation is on-chain, permanent, and propagates to all downstream redelegations.

Native token: **$TRUST** (mainnet) / **tTRUST** (testnet), 18 decimals. All `msg.value` and gas are denominated in TRUST. Gas fees are negligible (~0.0001 TRUST per tx).

## Network Selection

On first invocation, ask the user which network to use:

```
Which network?
1. Intuition Mainnet  -- chain 1155
2. Intuition Testnet  -- chain 13579
```

### Network Configuration

Network metadata — chain IDs, RPC URLs, GraphQL endpoints, explorer URLs, MultiVault addresses, DelegationManager addresses, and viem chain definitions — lives in `reference/network-config.md`. Use the selected row there for all operations in the session. Switch with `--chain mainnet` or `--chain testnet`.

### Network Characteristics

Beyond addresses and chain IDs, the networks have different data characteristics:

| Aspect| Mainnet| Testnet|
| --- | --- | --- |
| Economic signal| Real $TRUST staked — positions reflect genuine conviction| Test tokens, no real value signal|
| Agent infrastructure| Active — Eliza protocol registries, named agent atoms| Less agent activity|
| Curation quality| Structured efforts (e.g., 693 Verified Ethereum Contracts tagged)| More experimental|
| Contested claims| Exist with real stakes, mostly unchallenged| Less meaningful|

Use testnet for development and testing writes. Use mainnet for production exploration and meaningful attestations.

## ABI Fragments

Human-readable fragments for `parseAbi()`. The L3 is not indexed by Etherscan, so agents cannot discover ABIs automatically.

### Important: Term IDs are bytes32

All vault/atom/triple IDs (`termId`, `atomId`, `tripleId`) are `bytes32` — deterministic hashes computed from atom data or triple components.

### Read Functions

```
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

For nested composition, `getVaultType(termId)` is the precise classifier: `0 = ATOM`, `1 = TRIPLE`, `2 = COUNTER_TRIPLE`. `isTriple(termId)` is a coarser check and returns `true` for counter-triples too. `calculateTripleId` is deterministic, so callers can precompute future triple `term_id`s before broadcasting.

### Write Functions

```
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

### Delegation Functions

```
const delegationAbi = parseAbi([
  'function redeemDelegations(bytes[] calldata _permissionContexts, bytes32[] calldata _modes, bytes[] calldata _executionCallData) external',
  'function disableDelegation((address delegator, address delegate, bytes32 authority, (address enforcer, bytes terms, bytes args)[] caveats, uint256 salt, bytes signature) delegation) external',
  'function enableDelegation((address delegator, address delegate, bytes32 authority, (address enforcer, bytes terms, bytes args)[] caveats, uint256 salt, bytes signature) delegation) external',
  'function disabledDelegations(bytes32 delegationHash) view returns (bool)',
  'function getDelegationHash((address delegator, address delegate, bytes32 authority, (address enforcer, bytes terms, bytes args)[] caveats, uint256 salt, bytes signature) delegation) view returns (bytes32)',
  'function getDomainHash() view returns (bytes32)',
  'function beforeHook(bytes calldata terms, bytes calldata args, bytes32 mode, bytes calldata executionCallData, bytes32 delegationHash) external',
  'function afterHook(bytes calldata terms, bytes calldata args, bytes32 mode, bytes calldata executionCallData, bytes32 delegationHash) external',
])
```

## Core Concepts

### Atoms: URI to bytes Encoding

Atoms are created from arbitrary bytes. **All atoms are pinned to IPFS** except blockchain addresses (CAIP-10). This matches the Intuition Portal's creation flow.

```
import { stringToHex } from 'viem'

// All entities, concepts, predicates, labels — pin to IPFS first
// See reference/schemas.md for the full pin flow
const atomData = stringToHex('ipfs://bafy...')  // URI from pin mutation

// Blockchain address (CAIP-10) — no IPFS needed
const atomData = stringToHex('caip10:eip155:1:0x1234...abcd')
```

```
# cast equivalents
ATOM_DATA=$(cast --from-utf8 "ipfs://bafy...")                    # after pinning
ATOM_DATA=$(cast --from-utf8 "caip10:eip155:1:0x1234...abcd")    # CAIP-10 address
```

Pin everything — including predicates (`"implements"`, `"trusts"`) and concept labels (`"AI Agent Framework"`). On-chain data confirms canonical atoms are IPFS-pinned; plain string versions are legacy duplicates. See `operations/create-atoms.md` for the full encoding flow.

The atom's `bytes32` ID is deterministically computed from its data via `calculateAtomId(bytes)`. Creating an atom that already exists reverts with `MultiVault_AtomExists`. Always check `isTermCreated(calculateAtomId(data))` before calling `createAtoms`.

### Triples: Three Term IDs

A triple links three existing terms: `(subject, predicate, object)`. The common case is three atoms, but an existing triple `term_id` may also be reused as a position for nested composition. All three terms must already exist. Every triple automatically gets a **counter-triple** vault for signaling disagreement.

A triple's `term_id` is itself a valid term and may be used as subject, predicate, or object in subsequent triples (reification). Use `getVaultType(termId)` when you need to distinguish positive triples from counter-triples. See `reference/nested-triples.md`.

**Finding predicate atoms**: Do not hardcode predicate atom IDs. Canonical predicates are IPFS-pinned atoms — their IDs depend on the pinned URI, not a plain string. Query the graph to find existing predicates by label:

```
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

```
cast call $MULTIVAULT "getBondingCurveConfig()((address,uint256))" --rpc-url $RPC
# Returns (registryAddress, defaultCurveId) — use the second value
```

On mainnet the default is currently `1` (linear curve). Query `getBondingCurveConfig()` once per session and reuse the `defaultCurveId` for all deposit/redeem calls.

### Fees: Always Preview First

Multiple fee layers apply to deposits: protocol fee, entry fee, atom wallet deposit fee (for atoms), and atom deposit fraction (for triples). **Always call `previewDeposit` or `previewAtomCreate`/`previewTripleCreate` before executing.** Fee percentages are configurable by governance and may change.

### Assets Array in Creation

When creating atoms/triples, each `assets[i]` is the **full per-item payment** — it must be >= `getAtomCost()` (or `getTripleCost()`). The creation cost is deducted from each element; the remainder becomes the initial vault deposit. `msg.value` must exactly equal `sum(assets[])`. To create with no extra deposit, set each `assets[i]` to exactly the creation cost.

### Delegation: Two Architectures

**EIP-7702 Direct Delegation** (confirmed working): The Main Account signs an EIP-7702 authorization tuple, upgrading its own address to execute smart contract logic. The Main Account then signs an ERC-7710 delegation directly to the Agent. No MultiVault `approve` is needed. `msg.sender` at MultiVault is the Main Account. All attribution (atoms, triples, shares) flows to the Main Account natively.

**EIP-7702 upgrade with cast:**
```bash
# Upgrade an EOA to EIP-7702 using the implementation address
cast send $MAIN_ACCOUNT \
  --auth $EIP7702_IMPLEMENTATION \
  --private-key $MAIN_PK \
  --rpc-url $RPC

# Verify upgrade succeeded
cast code $MAIN_ACCOUNT --rpc-url $RPC
# Upgraded: 0xef0100<implementation-address>...
```

**EIP-7702 upgrade verification:**
```bash
# Check if an address is EIP-7702 upgraded
cast code $ADDRESS --rpc-url $RPC | head -c 40
# 0xef010063c0c19a282a1b52b07dd5a65b58948a  ← upgraded
# 0x                                     ← still EOA
```

> **Status:** Both testnet and mainnet confirmed working. Earlier testnet `execution reverted` failures were caused by MetaMask UI / RPC transport limitations, not protocol-level blocks. The chain accepts type-0x04 transactions. ERC-1271 `isValidSignature` is implemented correctly on EIP-7702 upgraded accounts (ECDSA.recover == address(this)). If broadcast issues occur, verify with a zero-value `cast send <delegator> 0x --auth <implementation-address>` first or fall back to Path 2.

**EIP-7702 upgrade pitfalls:**
- `cast send $SMART "0x" --auth $IMPL` upgrades the smart account. `--auth` expects the **implementation address directly** (e.g., `0x63c0...ae32B`), NOT a prepended `0xef0100...` designator. Passing a designator causes `invalid value '0xef0100...': odd number of digits` because `cast` treats it as a raw hex address and the length is wrong.
- To verify: `cast code $SMART --rpc-url $RPC | head -c 42` should start with `0xef0100` followed by the implementation address (lowercase, no `0x` prefix on the impl part).
- In Node.js/ethers v6, when forming the designator string manually: use `"0xef0100" + IMPL.slice(3)` (strip `0x`), NOT `IMPL.slice(2)` which leaves the leading `x` and produces malformed hex.

**Separate Smart Account** (secondary): The Main Account owns a distinct Smart Account contract (UUPS proxy or DeleGator). The Main Account must call `approve(SmartAccount, approvalType)` on MultiVault. The Smart Account signs the ERC-7710 delegation to the Agent. `msg.sender` at MultiVault is the Smart Account. `createAtoms` and `createTriples` attribute to the Smart Account; `deposit`/`redeem` attribute to the Main Account via the `receiver` parameter.

In both architectures, the Agent is purely the transaction submitter and gas payer. The on-chain identity performing the action is the delegator's address. Approvals on MultiVault are **not transitive** — the Agent does not inherit them.

## Write Operations

To perform a write, open the corresponding operation file and follow its steps exactly. Each file provides: prerequisites to query, encoding pattern (cast + viem), value calculation, and strict JSON output contract.

| When you need to...| Read this file| Payable|
| --- | --- | --- |
| Create atoms from URIs| `operations/create-atoms.md` (always pin to IPFS first via `reference/schemas.md`, except CAIP-10)| Yes — `msg.value = sum(assets[])`, each `assets[i] >= atomCost`|
| Deposit into an atom vault| `operations/deposit-atom.md`| Yes — `msg.value = deposit amount`|
| Create triples linking terms| `operations/create-triples.md`| Yes — `msg.value = sum(assets[])`, each `assets[i] >= tripleCost`|
| Deposit into a triple vault| `operations/deposit-triple.md`| Yes — `msg.value = deposit amount`|
| Redeem shares from a vault| `operations/redeem.md`| No — `value = 0`|
| Deposit into multiple vaults| `operations/batch-deposit.md`| Yes — `msg.value = sum(assets)`|
| Redeem from multiple vaults| `operations/batch-redeem.md`| No — `value = 0`|
| Delegate deposit/redemption (receiver ≠ sender)| `operations/approve.md`| No — `value = 0`|

### Delegation Operations

| When you need to...| Read this file| Payable|
| --- | --- | --- |
| Issue a delegation to an Agent| `operations/create-delegation.md`| No — delegation is off-chain; output is a signed object|
| Revoke a delegation on-chain| `operations/revoke-delegation.md`| No — `value = 0`|
| Verify delegated authority before acting| `reference/delegation-authority.md`| N/A — autonomous gate, no tx output|
| Learn delegation concepts and setup| `reference/delegation.md`| N/A — reference only|
| Run full lifecycle: create → write → revoke → blocked| `templates/intuition-lifecycle.mjs` | Script — see templates directory|
| Run full lifecycle for EIP-7702 Direct (Path 1) | `templates/path1-e2e.mjs` | Script — confirmed working Path 1 lifecycle with ERC-1271 probe|
| Run full lifecycle for EIP-7702 Direct on mainnet | `templates/mainnet-path1.mjs` | Script — mainnet variant with mainnet MultiVault, domain hash, atom cost, and `from` quirk|
| Rebuild/build delegation tx with correct execCallData encoding | `templates/build-delegation-tx.mjs` | Script — builds outer `redeemDelegations` calldata from delegation params; outputs unsigned tx JSON |

For on-chain reads (costs, existence, vault state, previews), follow `reference/reading-state.md`.
For discovery reads (search, browse, traverse the knowledge graph), follow `reference/graphql-queries.md`.
For multi-step flows (create + deposit, signal disagreement, exit position), follow `reference/workflows.md`.
Always simulate writes before executing — see `reference/simulation.md`.

## Protocol Invariants

These facts govern all Intuition transactions. Reference them when encoding operations.

01. **Term IDs are bytes32** — All vault, atom, and triple IDs are `bytes32` — deterministic hashes computed from atom data or triple components.

02. **Creation is batch-only** — Use `createAtoms()` and `createTriples()` with arrays. Single-item creation uses single-element arrays.

03. **curveId is required** — `deposit` and `redeem` require a `curveId` parameter. Query `getBondingCurveConfig()` once per session. The mainnet default is `1` (linear curve).

04. **Slippage parameters** — `deposit` accepts `minShares`, `redeem` accepts `minAssets`; `depositBatch` and `redeemBatch` take per-item `minShares[]` / `minAssets[]`. Derive bounds from `previewDeposit`/`previewRedeem` with a tolerance before executing — see the Slippage Protection section in each `operations/` doc. Zero bounds are debug-only and should not ship to production callers.

05. **Receiver semantics are explicit** — `deposit`/`redeem` operations require a non-zero receiver address. When receiver is omitted in intent, use the signer address. Under delegation, receiver MUST be the Main Account address.

06. **Atom data is hex-encoded bytes** — Use `stringToHex(uri)` in viem, `cast --from-utf8 "uri"` in foundry. The input is an IPFS URI from pinning (`ipfs://bafy...`) or a CAIP-10 URI for blockchain addresses (`caip10:eip155:{chainId}:{address}`).

07. **msg.value is a separate transaction field** — The $TRUST sent with the transaction is the `value` field, separate from the encoded `data`.

08. **Payable functions** — `createAtoms`, `createTriples`, `deposit`, `depositBatch` require $TRUST as `msg.value`. `redeem` and `redeemBatch` are non-payable (`value = 0`).

09. **Creation assets[] is the full payment** — Each `assets[i]` must be >= creation cost. `msg.value` must exactly equal `sum(assets[])`. The creation cost is deducted per item; the remainder deposits into the vault.

10. **Custom chain definition required** — Intuition L3 (chain 1155/13579) requires `defineChain()` in viem. See `reference/network-config.md`.

11. **Creation returns bytes32[]** — `createAtoms` and `createTriples` return `bytes32[]` — deterministic hashes of the input data. The caller already computed each expected ID pre-broadcast via `calculateAtomId(data)` / `calculateTripleId(s, p, o)`; post-broadcast verification reconstructs the `bytes32[]` from those values rather than parsing logs. See `reference/post-write-verification.md`.

12. **Counter-triples are automatic** — Creating a triple also creates its counter-triple vault. Deposit into the counter-triple to signal disagreement.

13. **Separate preview functions for creation and deposit** — Use `previewAtomCreate`/`previewTripleCreate` when creating. Use `previewDeposit` for existing vaults. Fee calculations differ.

14. **The Agent is never the on-chain actor** — Under delegation, `msg.sender` at MultiVault is the delegator's address (Main Account or Smart Account), not the Agent. The Agent is purely the transaction submitter and gas payer.

15. **Approvals are not transitive** — The Agent does not inherit MultiVault approvals held by a separate Smart Account. The Smart Account holds the approval; the Agent triggers it.

16. **Nested value placement** — Under delegation, all `msg.value` lives in the inner transaction (the Intuition calldata). The outer `redeemDelegations` call carries `value = 0`. The inner execution tuple's `value` field must exactly equal `sum(assets[])` for creation operations. A mismatch causes `createAtoms` to revert with empty data, which surfaces as an `eth_estimateGas` failure on `redeemDelegations`.

17. **Delegator balance pays for writes** — When redeeming a delegation, the `msg.value` forwarded to the inner call comes from the **delegator's** on-chain balance, not the agent's. The agent only funds gas for the outer `redeemDelegations` call. Always verify the delegator holds enough tTRUST/$TRUST to cover `sum(assets[])` before attempting a delegated write.

18. **Receiver binding under delegation** — For operations with a `receiver` parameter (`deposit`, `redeem`, batch variants), `receiver` MUST be the Main Account address. For `createAtoms` and `createTriples`, attribution follows `msg.sender` (Main Account in EIP-7702; Smart Account in separate).

18. **EIP-7702 bypasses approve** — In EIP-7702 Direct Delegation, the Main Account cannot and need not approve itself on MultiVault. The `approve` prerequisite exists only for Separate Smart Account architecture.

19. **Cumulative vs periodic caps** — `NativeTokenTransferAmountEnforcer` caps total cumulative spend, not a rolling daily rate. Agents should implement self-enforced daily budgets if periodic limits are required.

20. **Revocation propagates downward** — Revoking a root delegation kills all redelegations that chain to it, regardless of depth. Revoking an intermediate node kills its subtree but leaves the parent chain intact.

21. **EIP-712 domain separator must be read from-chain** — The DelegationManager uses standard OpenZeppelin EIP-712 v4 (MetaMask Delegation Framework). Always call `getDomainHash()` first and use the returned `bytes32` directly in the signing digest. Never reconstruct the domain separator from guessed `name`/`version` literals, and prefer reading `getDelegationHash()` on-chain over recomputing the struct hash off-chain. Common pitfall: accidentally using the `EIP7702StatelessDeleGator` contract's domain constants (`name="EIP7702StatelessDeleGator"`, `version="1"`) instead of the DelegationManager's domain.

22. **enableDelegation is optional** — For the standard signature-based flow (delegator signs off-chain, Agent calls `redeemDelegations`), `enableDelegation` is not required. It is an optional caching alternative for delegators who do not want to provide an EIP-712 signature.

23. **Salt is uint256, not bytes32** — The on-chain `Delegation` struct uses `uint256 salt`. Passing `bytes32 salt` causes `abi.decode` failures.

24. **getDelegationHash** — `getDelegationHash(delegation)` computes the struct hash of the delegation fields excluding `signature`. `args` is excluded from each caveat's hash. Dynamic arrays like `Caveat[]` are hashed per-element. Always call `getDelegationHash()` on-chain and use its returned `bytes32` directly. Do not recompute with standard EIP-712 libraries or guessed algorithms; the on-chain implementation is the only authoritative source.

25. **redeemDelegations permissionContexts encoding** — `_permissionContexts[i]` must be `abi.encode(Delegation[], bytes32 delegationHash)`. It is NOT just `Delegation[]`. Omitting the `delegationHash` as the second element causes the entire batch to fail with empty revert data. Always build the outer calldata with the 2-element tuple. Use `cast calldata "redeemDelegations(bytes[],bytes32[],bytes[])" "[<struct_hex>]" ...` with both the struct array AND the delegation hash.

26. **Keccak-256, not NIST SHA3-256, for EVM selectors and hashes** — `crypto.createHash('sha3-256')` in Node.js produces NIST SHA3-256, which differs from Keccak-256 used by the EVM. Use `ethers.id(sig)`, `ethers.keccak256(ethers.toUtf8Bytes(sig))`, or `cast sig` to compute function selectors and struct hashes. A mismatch silently produces the wrong 4-byte selector and causes `method-not-allowed` reverts or calls to the wrong function.

27. **ERC-1271 `isValidSignature` returns padded `bytes4`** — The EIP-1271 magic value is `0x1626ba7e` (`bytes4`). When returned from a contract `call`, the EVM pads it to a full 32-byte word: `0x1626ba7e00000000000000000000000000000000000000000000000000000000`. Do not use strict equality against `0x1626ba7e`; use `startsWith("0x1626ba7e")` or slice the first 4 bytes.

28. **Contract source retrieval** — When investigating hash mismatches or unexpected behavior, fetch the verified source from the block explorer (`https://explorer.intuition.systems/api?module=contract&action=getsourcecode&address=<addr>`). The contract source reveals the actual struct layout and encoding logic, which may differ from interface declarations.

29. **Permission context encoding is fork-specific** — Intuition's DelegationManager fork customizes `getDelegationHash` relative to upstream Delegation Framework v1.3.0. Treat the Intuition verified source as the authoritative reference, not upstream docs or interface declarations.

30. **Debug delegation failures with a bare direct call first** — When `redeemDelegations` reverts with empty data or `require(false)`, test the inner operation as a bare direct call from the delegator's own key before changing networks or concluding the function is broken. If the bare direct call succeeds, the bug is in the delegation wrapper (encoding, value forwarding, or ERC1271). If it also fails, then investigate the inner function itself (existence checks, `msg.value` mismatch, term already exists).

31. **Verify ERC1271 support on-chain before assuming a blocker** — Do not conclude a delegation path is impossible based on documentation alone. Probe the delegator contract directly: `cast call <delegator> "isValidSignature(bytes32,bytes)(bytes4)" <digest> <signature> --rpc-url <rpc>`. If it returns `0x1626ba7e`, the ERC1271 path works. On-chain evidence supersedes assumed architectural gaps.

32. **Value-carrying static calls require `from` on mainnet** — On Intuition mainnet, `provider.call({ to: MULTIVAULT, data, value })` for `calculateAtomId` or other value-carrying reads must include `from: DELEGATOR`. Omitting `from` causes `insufficient funds for gas * price + value` because the estimation context executes from `0x000...000`, which has no balance. Testnet does not exhibit this quirk.

33. **Domain hash fallback for mainnet** — `getDomainHash()` previously reverted via `eth_call` on mainnet. Compute it off-chain from known constants if needed. **Current status (2026-08-17):** `getDomainHash()` now returns a value on mainnet: `0x44653bfc83c7c3f4ecd0ab2d76a7aff5e3478def6f0a290d939437b65d6fe1d5`. Always call on-chain first; fall back to off-chain computation only if the view reverts. See `references/ground-truth-verification.md` for the verification recipe.

## Critical Encoding Rules (Testnet-Proven)

These are non-negotiable for `redeemDelegations` to pass on-chain validation.

- **`_permissionContexts[i]` is a 2-element tuple**: `abi.encode(Delegation[] memory delegations, bytes32 delegationHash)`. It is NOT just `Delegation[]`. Omitting the `delegationHash` as the second element causes the entire batch to fail with empty revert data.
- **`execCallData` must be flat packed**: Use `ethers.solidityPacked(["address","uint256","bytes"], [target, value, innerCalldata])`. NEVER use `abi.encode((address,uint256,bytes))` — the tuple encoding adds a 32-byte offset pointer that shifts all fields, causing enforcers like `AllowedMethodsEnforcer` to read garbage.
- **`AllowedMethodsEnforcer` terms**: raw concatenated `bytes4` selectors (e.g., `"0x61403309"`), NOT an ABI-encoded `bytes4[]` array. `decodeSingle()` reads 4-byte chunks directly from `_terms`.
- **`LimitedCallsEnforcer` terms**: `abi.encode(uint256)` (e.g., `abi.encode([5])`), NOT raw bytes.
- **Caveat encoding in ethers v6**: When encoding caveats with `Interface.encodeFunctionData` or `AbiCoder`, pass explicit `[enforcer, terms, args]` arrays. Passing `{enforcer, terms, args}` objects triggers "cannot encode object for signature with missing names". Always map objects to arrays before encoding.
- **`authority` must equal on-chain `ROOT_AUTHORITY`** for the leaf delegation. From `cast call DelegationManager ROOT_AUTHORITY()`: `0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff`. Never use `0x0`.
- **`DELEGATE` must equal `msg.sender`** for EOA broadcasts. If `delegate != msg.sender && delegate != ANY_DELEGATE`, you get `InvalidDelegate()`.
- **`ModeCode` for simple single execution**: `0x0000000000000000000000000000000000000000000000000000000000000000` (32 bytes, all zeros = `ModeLib.encodeSimpleSingle()`).

## Verified Addresses and Values

```javascript
## Caveat encoding in ethers v6
When encoding caveats with `Interface.encodeFunctionData` or `AbiCoder`, pass explicit `[enforcer, terms, args]` arrays. Passing `{enforcer, terms, args}` objects triggers "cannot encode object for signature with missing names". Always map objects to arrays before encoding.

## Bytes4 concatenation with 0x prefix
`allowedMethodsTerms` must be raw concatenated bytes4 selectors with `0x` prefix:
`"0x" + selector1.slice(2) + selector2.slice(2)`
Not `selector1 + selector2` (missing 0x prefix causes `invalid BytesLike value`).

## `createAtoms` ABI fragment
Use `function createAtoms(bytes[] atomDatas, uint256[] assets) payable returns (bytes32[])`.
When a contract instance lacks this ABI, create a standalone `new ethers.Interface(["function createAtoms(...)"])`.

## `disabledDelegations` boolean parsing
When calling `provider.call` directly, parse the boolean return explicitly:
```js
const result = await provider.call({ to: DELEGATION_MANAGER, data: calldata });
const isDisabled = result === "0x...01" || parseInt(result, 16) === 1;
```

## Standalone Interface for missing ABIs
If `contract.interface.encodeFunctionData` throws "unknown function", create a standalone
`new ethers.Interface(["function signature"])` with the exact signature. This bypasses
incomplete ABI loading on contract instances.

## Verified testnet addresses
DELEGATION_MANAGER = 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3
MULTIVAULT = 0x2Ece8D4dEdcB9918A398528f3fa4688b1d2CAB91
ALLOWED_METHODS_ENFORCER = 0x2c21fD0Cb9DC8445CB3fb0DC5E7Bb0Aca01842B5
LIMITED_CALLS_ENFORCER = 0x04658B29F6b82ed55274221a06Fc97D318E25416

## Verified addresses
// Mainnet
const DELEGATION_MANAGER = "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3";
const MULTIVAULT = "0x6E35cF57A41fA15eA0EaE9C33e751b01A784Fe7e";
const ALLOWED_METHODS_ENFORCER = "0x2c21fD0Cb9DC8445CB3fb0DC5E7Bb0Aca01842B5";
const LIMITED_CALLS_ENFORCER = "0x04658B29F6b82ed55274221a06Fc97D318E25416";
const CHAIN_ID = 1155;
```

**Verified costs on mainnet:**
- `getAtomCost()` = `100000000001000000` wei (`1e17` = 0.1 $TRUST)
- `getDomainHash()` = `0x44653bfc83c7c3f4ecd0ab2d76a7aff5e3478def6f0a290d939437b65d6fe1d5`

**Verified costs on testnet:**
- `getAtomCost()` = `1000000001000000` wei (`1e15` = 0.001 tTRUST)
- `getDomainHash()` = `0x0b7c642afd2411ce211542a0e154e558e357f3b7f4738eb327ae086bfc659f15`

## Kill Switch Proof (Testnet)

The delegation revocation flow is live and working on Intuition testnet:

1. **Write succeeded** — tx `0x0191ae3943c1ab1dcaff1dd6819a257f2bbb9bf000d49ee37660d106c10a123d` (block 9365664). Created atom via `redeemDelegations` using delegation hash `0x223ce0df...`.
2. **Revoked** — tx `0xbabc67d4aaba80d98d8e08a7cbaef0074cdbd9279ba12a89610ca42bcb9b90b9` (block 9365665). Called `DelegationManager.disableDelegation` with the same delegation struct.
3. **Write blocked** — attempted same delegation again. Reverted with `0x05baa052` = `CannotUseADisabledDelegation()`.

## Debugging Delegation Failures

Use `cast call` or `cast send --data` simulation before broadcasting to reveal exact error selectors without burning gas:

```bash
# For simple calls
cast call $DELEGATION_MANAGER "$DATA" \
  --from $DELEGATOR \
  --rpc-url $RPC

# For complex tuple calldata where cast call parser fails, use cast send --data
# (simulates without broadcasting when RPC supports eth_estimateGas)
cast send $DELEGATION_MANAGER \
  --private-key $PK \
  --rpc-url $RPC \
  --data "$(cat /path/to/calldata.hex)"
```

Common revert selectors:
- `0xb5863604` = `InvalidDelegate()` — `delegate != msg.sender && delegate != ANY_DELEGATE`
- `0xb4856ebc` = `MultiVault_AtomExists` — atom data already created
- `0x05baa052` = `CannotUseADisabledDelegation()` — delegation was revoked
- `0x155ff427` = `InvalidERC1271Signature()` — Note: this selector is also returned when a delegation has been revoked and you attempt `redeemDelegations` with it. If you see this after calling `disableDelegation`, the delegation is simply disabled — create a new one.
- `0x` (empty) — usually `abi.encode(tuple)` offset corruption or `_permissionContexts` missing the delegationHash tuple element

## Pre-Flight Checklist

Before broadcasting any delegation transaction, verify each item:

- [ ] **Domain hash read on-chain** — `getDomainHash()` was called and its `bytes32` result was used directly in the signing digest. No `name`/`version` literals were guessed. On mainnet, if `getDomainHash()` reverts, compute from constants instead.
- [ ] **Salt type** — `uint256 salt`, not `bytes32 salt`.
- [ ] **Signature recovery** — recovered address matches delegator.
- [ ] **Permission context** — `_permissionContexts[i]` = `abi.encode(Delegation[], bytes32 delegationHash)`. The `delegationHash` must equal the on-chain `getDelegationHash(delegation)` result.
- [ ] **execCallData packing** — uses `solidityPacked(address,uint256,bytes)`, not `abi.encode(tuple)`.
- [ ] **AllowedMethodsEnforcer terms** — raw concatenated bytes4 selectors.
- [ ] **LimitedCallsEnforcer terms** — `abi.encode(uint256)`.
- [ ] **Authority** — equals on-chain `ROOT_AUTHORITY` for leaf delegation.
- [ ] **DELEGATE equals msg.sender** for EOA broadcasts.
- [ ] **Network match** — addresses, chain IDs, and RPC endpoints match the intended network.

## Error Patterns

| Error| Cause| Fix|
| [keep existing error patterns table, add new entries below]|
| `MultiVault_InsufficientBalance`| `msg.value` does not equal `sum(assets[])`| Ensure `msg.value` exactly equals the sum of the assets array|
| `MultiVault_InsufficientAssets`| `assets[i]` less than creation cost| Each `assets[i]` must be >= `getAtomCost()` or `getTripleCost()`|
| `MultiVault_AtomExists`| Atom with same data already created| Check `isTermCreated(calculateAtomId(data))` first; use existing ID|
| `MultiVault_TripleExists`| Triple with same components already created| Check `isTermCreated(calculateTripleId(...))` first; use existing ID|
| `MultiVault_TermDoesNotExist` / `MultiVaultCore_TermDoesNotExist`| Referenced term does not exist, or a classifier read was run against an unknown ID| Create the missing atom via `createAtoms`, choose an existing triple `term_id`, or re-check the GraphQL-to-on-chain binding before composing|
| `MultiVault_ArraysNotSameLength`| Parallel arrays have different lengths| Ensure all arrays match in length|
| `MultiVault_InvalidArrayLength`| Empty array or exceeds max batch size| Provide at least one item; check max batch size|
| Transaction reverts with no message| ABI encoding mismatch or unrecognized function sig| Verify bytes32 IDs, check curveId parameter|
| `DelegationManager_AlreadyEnabled` | `enableDelegation` was called but the delegation is already active (`disabledDelegations` returns `false`) | Skip `enableDelegation` if `disabledDelegations(hash)` is `false`. It is only needed for re-enabling a previously disabled delegation. |
| `DelegationManager_InvalidSignature`| EIP-712 signature does not recover to delegator| Read `getDomainHash()` on-chain and use that value directly in the signing digest. Do not reconstruct the domain separator from guessed `name`/`version` literals. Common pitfall: using `EIP7702StatelessDeleGator` domain constants instead of DelegationManager's. Verify signing key. For contract delegators, check `isValidSignature` returns `0x1626ba7e`|
| `DelegationManager_InvalidERC1271Signature`| `isValidSignature` on the delegator returned a value other than `0x1626ba7e`| The delegator contract either does not implement ERC1271, or the digest/signature passed to it is malformed. Verify with a direct `cast call` to the delegator's `isValidSignature` using the exact digest and signature your script produces. Do not assume missing implementation — EIP-7702 upgraded accounts have been verified to implement it correctly. Note: this error also occurs when attempting to use a **revoked** delegation via `redeemDelegations`. If you see `0x155ff427` after revocation, the delegation is simply disabled — create a new one.|
| `DelegationManager_DelegationDisabled` | Delegation has been disabled/revoked on-chain (`disabledDelegations` returns true) | The delegator must create a new delegation. Revocation is permanent. |
| `DelegationManager_InvalidStruct` | The struct passed to `disableDelegation` or `enableDelegation` does not match the stored hash, or the permission context passed to `redeemDelegations` was computed off-chain with standard ABI encoding instead of read from `getDelegationHash()` on-chain | Call `getDelegationHash(delegation)` on-chain and use its returned `bytes32` directly as the permission context hash. Do not recompute `keccak256(abi.encode(...))` off-chain. Use `uint256 salt`, not `bytes32 salt`. Ensure `_permissionContexts[i]` is `abi.encode(Delegation[], bytes32 delegationHash)`, not just the hash. |
| `DelegationManager_InvalidDelegate` | `delegate != msg.sender && delegate != ANY_DELEGATE` in `redeemDelegations`, or authority/delegate chain mismatch in nested delegations | For EOA broadcasts, set `DELEGATE = DELEGATOR`. For nested delegations, ensure `delegation_.delegator == nextDelegate_` in the chain. |
| `MultiVault_SelectorMismatch` | Wrong function selector in inner calldata (e.g., `0x7a2c1c88` from NIST SHA3-256 instead of Keccak-256 `0x61403309`) | Use `ethers.id("createAtoms(bytes[],uint256[])")` or `cast calldata` to compute selectors. Never use Node.js `crypto.createHash('sha3-256')` — it produces NIST SHA3-256, not Keccak-256. |
| `MultiVault_AtomExists` | Atom with same data already created | Check `isTermCreated(calculateAtomId(data))` first; use existing ID or change atom data. |
| Transaction reverts with no data / `require(false)` during `redeemDelegations` gas estimation | Usually one of: (1) `_permissionContexts[i]` missing the `delegationHash` tuple element; (2) `execCallData` uses `abi.encode(tuple)` instead of `solidityPacked`; (3) `AllowedMethodsEnforcer` terms are ABI-encoded `bytes4[]` instead of raw bytes4; (4) inner execution `value` != `sum(assets[])`; (5) ERC1271 validation failing because delegator delegates to a contract without `isValidSignature`; (6) `createAtoms` called with `msg.value` mismatch or term already exists | Rule out in order: check permission context encoding → check execCallData packing → verify terms format per enforcer → check inner `value` = `sum(assets[])` → verify delegator balance → test bare direct call → check `isTermCreated` for the atom data → verify inner selector against actual MultiVault implementation. Do not conclude the inner function is broken until a bare direct call from the delegator also fails. |

## TRUST Token

| | Mainnet| Testnet|
| --- | --- | --- |
| Symbol| $TRUST| tTRUST|
| Decimals| 18| 18|

`parseEther('0.5')` works for formatting TRUST amounts (same 18-decimal math). The unit is TRUST, not ETH.

## Contract Source

- **V2 contracts:** https://github.com/0xIntuition/intuition-v2/tree/main/contracts/core
- **Interface:** `src/interfaces/IMultiVault.sol` and `src/interfaces/IMultiVaultCore.sol`
- **Block explorer (mainnet):** https://intuition.calderaexplorer.xyz
- **SDK (reference):** https://github.com/0xIntuition/intuition-ts

## ethers v6 Workarounds

### Standalone Interface for missing ABIs
If `contract.interface.encodeFunctionData` throws "unknown function", create a standalone interface:
```js
const iface = new ethers.Interface([
  "function createAtoms(bytes[] atomDatas, uint256[] assets) payable returns (bytes32[])",
]);
const calldata = iface.encodeFunctionData("createAtoms(bytes[],uint256[])", [data, assets]);
```

### Caveat tuple mapping
Objects must be mapped to arrays before encoding:
```js
// WRONG: triggers "cannot encode object for signature with missing names"
const caveats = [{enforcer, terms, args}];

// RIGHT: map to explicit arrays
const caveats = [{enforcer, terms, args}].map(c => [c.enforcer, c.terms, c.args]);
```

### Boolean returns from provider.call
When calling view functions via `provider.call`, parse booleans explicitly:
```js
const result = await provider.call({to: DELEGATION_MANAGER, data: calldata});
const isDisabled = result === "0x...01" || parseInt(result, 16) === 1;
```