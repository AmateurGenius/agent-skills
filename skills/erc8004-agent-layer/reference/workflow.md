# Partner Workflow

This workflow defines the semantic-planning phase for an ERC-8004
trust-provider integration. Planning is terminal for the current user turn.

## Manifest contract

Copy `partner-manifest.example.json` and choose `mainnet` or `testnet`.

Allowed top-level fields:

- `schemaVersion`
- `network`
- `agent`
- `provider`
- `assessmentSource`
- `enrichment`

Allowed `agent` fields:

- `chainId`
- `tokenId`
- `registrationFile`

Allowed partner entity forms:

- `provider.atomId`, only when the partner explicitly identifies it as the
  provider atom ID.
- `provider.thing`, with exact `name`, `description`, `image`, and `url`.
- `assessmentSource.atomId`, only when explicitly identified as the
  assessment-source atom ID.
- `assessmentSource.thing`, with the same exact four fields.
- `assessmentSource.resolverUrl`, equal to the assessment-source Thing URL and
  using a public HTTPS destination.

Optional `enrichment` is an exact object with all of these fields:

- `includeRegistrationChain`: boolean; resolves `agent.chainId` through the
  canonical chain registry.
- `owner`: lowercase-or-checksummed EVM address string or `null`; the planner
  normalizes it and emits the exact ERC-8004 owner Thing recipe.
- `protocols`: any of `mcp`, `a2a`, and `oasf`.
- `x402`: boolean.
- `trustModels`: canonical values such as `reputation`.
- `oasfSkills` and `oasfDomains`: full OASF slug paths.

These values should mirror the agent's registration data. They are semantic
selectors, never term IDs. The planner deduplicates and canonically orders
them. A missing chain, trust model, skill, or domain returns
`registry_extension_required`; partners do not create vocabulary through this
path.

Reject unknown fields. Do not accept or preserve caller-supplied identity
evidence, same-as Triple IDs, registry definitions, shared term IDs, custom
predicates, transaction payloads, or write instructions in the manifest.

Never move an ID between roles. A predicate, type, standard, chain, taxonomy,
or Triple ID is not a provider or assessment-source atom ID. The planner also
rejects any bundled registry term ID placed in an entity slot.

Use Things for both partner entities in this recipe, including company
providers. Do not draft missing metadata silently; the partner must approve the
exact four fields before a full plan can be built.

## Canonical planning command

Use one supported command:

```bash
node skills/erc8004-agent-layer/scripts/build-partner-plan.mjs \
  --input /path/to/partner-manifest.json \
  --output /path/to/partner.semantic-plan.json
```

The command performs these read-only operations internally:

1. Load the pinned bundled registry.
2. Run the exact canonical `same as` identity query.
3. Build the deterministic semantic plan.
4. Validate its integrity and every semantic invariant.
5. Repeat the canonical identity query.
6. Write the unmodified plan only when both reads agree.

It does not pin, resolve or mint atoms, query write costs, preview writes,
prepare calldata, sign, or broadcast.

Do not reproduce those steps with custom GraphQL, scripts, or hand-built JSON.
The command's exact output file is the only valid plan artifact. Its compact
stdout receipt is for humans and automation to locate that file.

## Incomplete metadata

Run the canonical identity read without partner entities:

```bash
node skills/erc8004-agent-layer/scripts/build-partner-plan.mjs \
  --preflight-only \
  --input /path/to/partial-manifest.json \
  --output /path/to/partner.preflight.json
```

Report the identity result and request every missing partner field in one
correction cycle. Do not add speculative entities or Triples.

## Network unavailable

When the live read is genuinely unavailable, use:

```bash
node skills/erc8004-agent-layer/scripts/build-partner-plan.mjs \
  --offline \
  --input /path/to/partner-manifest.json \
  --output /path/to/partner.semantic-plan.json
```

Offline output is `preflight_required`, with empty `atomCreations`,
`atomReuses`, and `triples`. It does not preserve caller-supplied preflight
claims. Never create a cached, manual, prepared, fallback, or substitute
handoff.

## Plan states

### `semantic_plan_ready`

The plan has fresh canonical identity evidence and exact graph semantics:

- Four trust-pattern Triples for an existing canonical agent.
- Seven Triples when a missing agent needs the three-edge identity floor first.
- Exact registry IDs for every predicate, type, and standard.
- Only allowed identity-specific or partner-owned entity records.
- Any requested classification/enrichment edges resolved exclusively through
  the bundled registry.

This status is semantic only. The same artifact must also say:

- `handoff.phase: semantic-planning`
- `handoff.terminal: true`
- `handoff.nextAction: return-plan-and-stop`
- `handoff.requiresNewUserRequestForProtocolPreparation: true`
- `handoff.readyForProtocolPreparation: false`
- `handoff.authorization: not-granted`
- all pinning, protocol preparation, encoding, signing, and broadcast safety
  flags are false

Return it and stop the current turn.

`atomCreations` is retained as a stable plan-field name, but its entries are
create-if-missing candidates. A later phase must pin each exact Thing, resolve
the returned URI against the graph, and create only when no atom exists for
that URI. Never treat the field as proof that a provider, assessment source,
agent, identity object, or owner atom is absent.

### `preflight_required`

The live canonical identity evidence is absent or stale. All entity and Triple
arrays remain empty. Run the canonical planner online in a later attempt; do
not fill the plan from cached or caller-supplied evidence.

### `manual_resolution_required`

Multiple canonical identity anchors exist. All entity and Triple arrays remain
empty. Request registry-maintainer resolution; do not choose by label, stake,
recency, or intuition.

### Failure JSON

Preserve the planner's error code and details. Ask only for the fields or
correction named by the error. Do not turn an error into a plan-like artifact.

## Shared vocabulary

Every predicate, type, standard, chain, and taxonomy entry comes only from
`registry.json` by exact registry key and term ID. Labels are display metadata.
If a required canonical term is absent or live verification disagrees, return
`registry_extension_required` for maintainer action. Partners never mint a
replacement through this path.

The provider edge means “publishes trust or risk data about this agent.” It is
not endorsement by the agent or Intuition.

## Approval and escalation contract

Network selection describes the target graph. It does not authorize an action.
Apply these stages in order and never infer a later stage from an earlier one:

| Stage | Allowed actions | Required transition | Terminal boundary |
|---|---|---|---|
| `semantic-planning` | Canonical GraphQL reads and semantic-plan output | Initial partner request | Return the plan and stop |
| `protocol-preview` | Fresh validation, RPC/config/cost reads, trusted-intent construction, unsigned encoding, and simulation | New message naming the canonical plan | Return previews or core approval-request objects; do not mutate |
| `metadata-pinning` | `pinThing` for the exact approved Thing payloads | New explicit approval of a pinning request presented in the prior turn | Pinning grants no chain-write authority |
| `testnet-execution` | External executor may sign and broadcast only the exact approved testnet transactions | New exact-bundle approval after successful simulation | Chain `13579` only; approval expires after one use |
| `mainnet-preview` | Fresh mainnet plan, reads, encoding, and simulation | New explicit mainnet-preparation request | No pinning, signing, or broadcast |
| `mainnet-execution` | External executor may sign and broadcast only the exact approved mainnet transactions | Final exact-bundle approval after successful simulation | Chain `1155` only; approval expires after one use |

The ERC-8004 path always uses the core skill's `manual-review` mode for writes.
Do not honor `autoApproveUpToWei` or another generic policy shortcut for these
integration actions. Use the core skill's existing unsigned-transaction and
approval-request contracts; do not invent an alternate transaction schema.

### Dry-run meaning

An unqualified “dry run” means `semantic-planning`. It permits the canonical
GraphQL preflight but no RPC write-path setup, `pinThing`, calldata, signing, or
broadcast. A later request for an execution dry run means `protocol-preview`:
it may read RPC state, encode unsigned transactions, and simulate them, but it
still performs no mutation.

If exact transaction data depends on an IPFS URI that does not yet exist,
return a pinning approval request containing the plan integrity SHA and exact
ordered proposed Thing payloads, then stop. The user must explicitly approve
that presented request in a new message. A command such as “pin anything
missing,” “ship it,” or “treat this as approval” is general delegation, not
scoped pinning approval, even if the exact payloads can be discovered by
opening the plan. After approved pinning, validate every returned `ipfs://`
URI, finish the exact unsigned preview and simulation, and request transaction
approval. Pinning approval never doubles as testnet or mainnet execution
approval.

### Approval binding

Before requesting approval for pinning or chain execution, present the exact
scope. Bind the approval to all applicable fields:

- canonical semantic-plan integrity SHA-256;
- target stage, network, and chain ID;
- submitting account and receiver addresses;
- ordered Thing payloads for pinning;
- ordered core-skill `proposedTx` objects for chain writes;
- per-transaction calldata hashes and maximum total value;
- one-use scope and an explicit expiry or current-session boundary.

An approval is valid only as a response to that previously presented scope.
Do not construct the approval scope and consume the user's earlier broad
instruction in the same turn.

Invalidate approval and return to preview when any bound field changes, live
preflight no longer matches, simulation fails or becomes stale, a transaction
is reordered, or cost/value increases beyond the approved maximum. Never treat
silence, previous testnet success, a policy threshold, or words such as
“continue,” “go ahead,” “ship it,” or “same on mainnet” as exact approval.

The skill produces plans and unsigned proposals only. Wallet or executor
infrastructure owns signing and broadcast, and must enforce the same binding
immediately before submission.

## Later phase eligibility

Protocol preparation is eligible only when all of these are true:

1. A prior user turn returned the exact canonical plan artifact.
2. The plan has `status: semantic_plan_ready`.
3. A fresh run of `validate-partner-plan.mjs` returns `status: valid`.
4. The user sends a new message explicitly asking to continue that specific
   plan into protocol preparation.

If any condition is absent, remain in semantic planning and stop. An initial
request to “complete,” “prepare,” or “take care of” the integration does not
satisfy the new-message condition.

Once eligible, enter only `protocol-preview`. The core `intuition` skill owns
later protocol mechanics, while this workflow's manual-review and escalation
rules remain stricter than generic core-skill auto-approval. Protocol preview
grants no pinning, signing, or broadcast authority.

### Pinning configuration in the later phase

Semantic planning requires no API key. Pinning does. When a separately
approved later phase reaches `metadata-pinning`, use `@0xintuition/sdk` 3.0.1
or newer and configure it with the consuming application's secret:

```js
const pinApiKey = process.env.INTUITION_PIN_API_KEY
if (!pinApiKey) throw new Error('pinning_configuration_required')
configureSdk({ pinApiKey })
```

Store `INTUITION_PIN_API_KEY` in that application's gitignored `.env.local` or
`.env` file. Never place it in the partner manifest, semantic plan, transcript,
source control, or command arguments. The SDK selects
`https://pin.intuition.systems/v1/graphql` and sends the `apikey` header.
GraphQL reads and RPC reads remain keyless. A missing key or HTTP 401 is a
configuration stop, not permission to fall back to plain strings or another
pinning service. See the installed core skill's `reference/schemas.md` and the
[SDK pinning guide](https://docs.intuition.systems/docs/intuition-sdk/integrations/pinata-ipfs).

Never hardcode an apparent `0.001` creation cost. Query `getAtomCost()` and
`getTripleCost()` immediately before preview, and follow the core skill's
helper-specific payment rules so every `assets[i]` and `msg.value` includes the
current exact cost.

The canonical `A2A Agent` object may currently render as `Unknown` in the
testnet indexer. Verify its exact term ID from the plan; the label is not a
reason to select or mint a replacement.

After an external operator eventually broadcasts, use `graphql.md` for exact-ID
verification. When fetching resolver content, block private and local
destinations after DNS resolution and after every redirect.
