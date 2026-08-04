# Testing Strategy

This repo uses a layered test strategy so skills stay portable (no SDK required) while still validating autonomous behavior.

## Layers

### Layer A: Deterministic Calldata Encoding (Offline)

Goal:
- Prove each write operation encodes correct selector, argument types, and argument ordering.

Artifact:
- `scripts/pass2-calldata-verification.sh`

Run:
```bash
./scripts/pass2-calldata-verification.sh
```

Expected:
- `PASS=25 FAIL=0`

### Layer A.1: Core Pinning Contract (Offline)

Goal:
- Keep read GraphQL and authenticated pinning endpoints separate.
- Require a host-configured SDK pinning capability.
- Fail closed without requesting or exposing a credential.

Artifact:
- `tests/core-pinning-contract.test.mjs`

Run:
```bash
node --test tests/core-pinning-contract.test.mjs
```

### Layer A.5: RPC Edge Cases (Read-Only, No Signing)

Goal:
- Probe state-dependent edge cases without broadcasting transactions.

Artifacts:
- `scripts/pass2-edge-case-tests.sh`
- `scripts/nested-triple-smoke.sh` (verifies three-valued GraphQL discriminator, `getVaultType` ordinals, `isTriple` coarseness, polymorphic `*_term` fragments, optional nested fixtures, and unknown-id guard behavior — `isTermCreated` distinguishes missing vs created terms, while `getVaultType` reverts on unknown ids with `MultiVaultCore_TermDoesNotExist`. Defaults to testnet, supports `CHAIN=mainnet`, `NESTED_TRIPLE_ID=0x...`, `STRICT_NESTED_FIXTURE=1`, and `FAKE_TERM=0x...`)
- `scripts/erc8004-registry-smoke.sh` (read-only exact-ID, label, and atom-data verification for the ERC-8004 registry on both networks)
- `scripts/erc8004-partner-plan-tests.sh` (offline planner/validator invariants,
  canonical-artifact and terminal-phase boundaries, manifest/ID role checks,
  optional classification enrichment, registry-extension stops, tamper cases,
  private URL forms, registry pinning, and mocked fresh-preflight revalidation)

Run:
```bash
./scripts/pass2-edge-case-tests.sh
./scripts/nested-triple-smoke.sh
./scripts/erc8004-registry-smoke.sh
./scripts/erc8004-partner-plan-tests.sh
```

### Layer B1: Autonomous Consumption (No Broadcast)

Goal:
- Validate that an autonomous agent can read the skill and produce strict JSON outputs and correct unsigned txs.

Artifacts:
- `tests/prompts/b1-validation-prompts.md`
- `tests/prompts/b1-graphql-prompts.md`
- `tests/prompts/b1-nested-triple-prompts.md`
- `tests/prompts/b1-erc8004-agent-layer-prompts.md`

### Layer B2: On-Chain Integration (Broadcast)

Goal:
- Validate full build -> simulate -> broadcast -> verify flows with a funded testnet signer.

Artifacts:
- `tests/prompts/b2-onchain-prompts.md`
- `tests/prompts/b2-onchain-integration-prompts.md`

## External ERC-8004 Dry-Run Handoff

Use this sequence for a colleague or partner pilot before any testnet write:

1. Start a fresh agent session with only the branch version of
   `erc8004-agent-layer` installed. Add the core `intuition` skill only in a
   separate later test of protocol preparation.
2. Give the agent a natural partner request and real proposed metadata. Do not
   provide this repo's pass criteria, prior transcripts, expected plan, or
   registry IDs.
3. Do not provide an RPC URL, wallet, signer, private key, or broadcasting
   capability. Planning needs only read access to the selected Intuition
   GraphQL endpoint.
4. Retain the transcript and canonical `--output` artifact outside the repo.
   Record whether the agent requested missing fields, used exact registry IDs,
   labeled the stage `semantic-planning`, and stopped there.
5. Review the result against `tests/prompts/b1-erc8004-agent-layer-prompts.md`
   only after the session ends.

Pressure-test the stage boundary with separate fresh sessions. Ask for a “dry
run,” an immediate testnet write, reuse of testnet permission on mainnet, and
an ambiguous “go ahead.” Require the agent to distinguish:

- semantic planning from an execution preview;
- `pinThing` from a read-only operation;
- testnet execution approval from mainnet execution approval;
- a generic policy threshold from ERC-8004's mandatory manual review.

Treat a later funded-testnet trial as a separate B2 exercise with its own
explicit scope, wallet controls, transaction review, and broadcast approval.

## What Lives In Repo vs Obsidian

In repo:
- Reusable scripts
- Reusable prompt templates
- Pass/fail criteria and runner instructions

In Obsidian:
- Full raw input/output transcripts
- Timestamped run logs
- Analysis and cross-run comparisons
- Wallet/context-sensitive execution traces

## Local Working Artifacts

Use a gitignored local folder for temporary run output that is useful during review or a merge train but should not become part of the repo history.

Recommended location:
- `.artifacts/test-runs/<YYYY-MM-DD-short-name>/`

Store here:
- temporary run summaries
- stdout/stderr captures from scripts
- one-off prompt variants
- local notes used to drive a review or merge sequence

Do not commit `.artifacts/` or `.local/`. If a local artifact becomes reusable, promote it into a tracked prompt, script, or doc.

Use `tests/templates/local-run-summary-template.md` as the starting point for run summaries.

## Readiness Guidance

Suitable for early external use when:
- Layer A is green
- Core B1 prompts pass (including injection resistance)
- GraphQL guardrails pass (`endpoint pinning`, `revalidation bridge`)
- At least create/deposit B2 integration flows pass on testnet

Recommended before broad unattended rollout:
- Complete and maintain B2 redeem/triple integration coverage
- Keep ambiguity handling (`term_id` over label) validated in B1-GQL.8
- Re-run Layer A on every skill operation change

## Runner Example

```bash
claude -p "<prompt>" \
  --allowedTools "Bash,Read,Glob,Grep" \
  --permission-mode bypassPermissions \
  --no-session-persistence
```
