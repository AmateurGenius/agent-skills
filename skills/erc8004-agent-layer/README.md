# ERC-8004 Agent Layer Skill

Prepares canonical Intuition graph plans for partners publishing discoverable,
mutable trust assessments about ERC-8004 agents. The full partner guide is at
[docs.intuition.systems/docs/erc-8004-agent-layer](https://docs.intuition.systems/docs/erc-8004-agent-layer).

The skill prevents the highest-cost integration failures:

- Duplicate shared predicates and type atoms.
- Raw-string agent identities that bypass the canonical agent layer.
- Agent minting before a `same as` preflight.
- Label-based selection in a graph where duplicate labels are valid.
- Incomplete or altered four-Triple trust patterns.
- Unclassified agents caused by omitting canonical discovery enrichment.
- Mainnet writes assembled before a dry run.

## Install

Install the ERC-8004 skill first:

```bash
npx skills add 0xintuition/agent-skills --skill erc8004-agent-layer
```

It is self-contained for semantic planning: canonical identity preflight,
shared-vocabulary resolution, classification, and the trust pattern need no
other skill, wallet, pinning key, or RPC write access.

Only after the partner reviews the returned plan and sends a new request to
continue into protocol preparation, install or invoke the core skill:

```bash
npx skills add 0xintuition/agent-skills --skill intuition
```

The core skill owns generic pinning, cost, calldata, and simulation mechanics;
the ERC-8004 approval ladder remains stricter. Neither skill signs or
broadcasts transactions.

## Use

Ask your agent:

```text
Use the erc8004-agent-layer skill. Prepare the canonical testnet semantic plan
that connects ERC-8004 agent 8453:1380 to my provider and assessment resolver.
Return the plan and stop before protocol preparation.
```

For direct planner use, copy `reference/partner-manifest.example.json`, fill in
the partner fields, and run:

```bash
node scripts/build-partner-plan.mjs \
  --input /path/to/manifest.json \
  --output /path/to/partner.semantic-plan.json
```

Use `--preflight-only` while partner metadata is still being approved. It runs
the live identity read without requiring provider or assessment fields and
never enables writes.

The planner performs one read-only exact identity preflight, records the
evidence, validates the complete plan, and repeats the live read before writing
the canonical artifact. Every ready plan contains the four trust Triples. A
missing agent also receives the three-edge identity floor. An optional
`enrichment` manifest section adds only registry-backed chain, owner, MCP, A2A,
OASF, x402, trust-model, skill, and domain edges. `--offline` emits the query
but cannot produce a semantic-plan-ready plan.

Entries under `atomCreations` are create-if-missing candidates, not a claim
that the atom is absent. In the later phase, each Thing must be pinned, resolved
by its returned `ipfs://` URI, and created only when that exact URI has no atom.

## Safety model

The bundled registry is resolve-only. Partners can create their provider and
assessment-source entities, plus identity-specific entities when an agent is
proven missing and the exact owner Thing when requested. They cannot create
predicates, types, standards, chains, trust models, or taxonomy entries through
this path. An unknown classification value returns
`registry_extension_required` for maintainer action.

The scripts are zero-dependency Node.js programs and never pin, prepare
transactions, sign, or broadcast. The planner's production path performs a
read-only identity preflight and a fresh identity recheck before output, while
`verify-registry.mjs` performs read-only GraphQL checks. The bundled registry
and its reviewed digests are pinned by both CLI and library paths. Together
they make the fragile semantic boundary deterministic while leaving protocol
execution to the core skill.

A `semantic_plan_ready` result means the semantic shape validates; it is not
approval to pin, resolve or mint atoms, query write costs, encode, sign, or
broadcast. The exact file written by `--output` is the only valid plan
artifact; stdout is only a compact receipt. Cached, manual, prepared, or
fallback handoffs are unsupported.

Every planning result is terminal for the current user turn and requires a new
explicit user request before protocol preparation. Provider metadata still
requires partner review, and the core skill must re-check live protocol state
and costs in that later phase.

The human-in-the-loop stop is intentional. A request to “complete the
integration” does not turn the initial planning turn into an autonomous write
session.

## Approval ladder

The target network never grants write authority. Use this progression:

1. Semantic plan: read-only GraphQL planning.
2. Protocol preview: unsigned preparation and simulation after a new request.
3. Metadata pinning: separate approval for exact Thing payloads.
4. Testnet execution: one-shot approval for the exact chain `13579` bundle.
5. Mainnet preview: fresh mainnet plan and simulation; testnet approval does
   not carry forward.
6. Mainnet execution: final one-shot approval for the exact chain `1155`
   bundle.

ERC-8004 writes always use manual review even when a generic core policy would
auto-approve a low-value transaction. Ambiguous phrases such as “go ahead” or
“do the same on mainnet” authorize no mutation. The skill produces no
signatures and holds no wallet authority. Pinning is allowed only after the
assistant presents the plan SHA and exact ordered Thing payloads and the user
explicitly approves that request in a later message; broad instructions to pin
whatever is missing are not approval.

The plan checksum detects accidental edits; it is not a signature. The
supported CLI path, fresh live validation, terminal planning phase, and
explicit partner review are the operational boundary. Intuition itself remains permissionless, so a caller who
changes or bypasses the skill code is outside this high-level safety contract.
