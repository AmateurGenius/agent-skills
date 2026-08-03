# Intuition Skill

Canonical skill for producing correct Intuition Protocol transaction parameters. The skill emits unsigned `{to,data,value,chainId}` objects; your wallet or backend handles signing and broadcast.

## Prerequisites

- `cast` (Foundry): query costs, previews, and build calldata.
- `curl`: call the public GraphQL API for read-only discovery.
- `jq`: extract `term_id`, `uri`, and unsigned tx fields.
- `bc`: do uint256-safe 5% tolerance math in shell quickstarts.
- RPC access: public Intuition L3 endpoints, no API keys.
- A host-provided pinning capability for structured atoms. The reference path is
  `@0xintuition/sdk` 3.0.1 or newer, configured in a trusted server or CLI
  runtime with an Intuition pinning API key.
- Funded wallet: tTRUST on testnet or $TRUST on mainnet. Bridge via https://app.intuition.systems/bridge.

## Installation

```bash
npx skills add 0xIntuition/agent-skills --skill intuition
```

To pin a published release instead of tracking `main`, install from a tag or SHA:

```bash
npx skills add 0xIntuition/agent-skills#<tag-or-sha> --skill intuition
```

## Network Selection

Use the session values in [reference/network-config.md](./reference/network-config.md). The quickstarts below use testnet.

## Pinning API Key Storage

The key authenticates Intuition's hosted metadata-pinning service. It is not an
RPC key, wallet secret, or part of the skill configuration.

- For agent-driven workflows, prefer a server-side tool or capability whose
  implementation owns the secret, so the model never receives the key.
- For local application development, store it as `INTUITION_PIN_API_KEY` in the
  consuming application's gitignored `.env.local` or `.env` file. Keep that
  file outside the installed skill directory, confirm Git ignores it, and
  restrict it to the local user (for example, mode `0600` on Unix systems).
- For CI and deployed services, store it in the platform's encrypted secret
  manager and inject it only into the trusted process that performs pinning.
- Never put it in a prompt, manifest, committed file, browser bundle,
  `NEXT_PUBLIC_*` / `VITE_*` variable, command-line argument, logs, or unsigned
  transaction output.

The application initializes the SDK; the skill never obtains or persists the
key:

```typescript
import { configureSdk } from '@0xintuition/sdk'

const pinApiKey = process.env.INTUITION_PIN_API_KEY
if (!pinApiKey) throw new Error('pinning_configuration_required')

configureSdk({ pinApiKey })
```

If the execution environment has no configured pinning capability, stop before
making a request and return the `pin_failed` output from
[reference/schemas.md](./reference/schemas.md) with a reason beginning
`pinning_configuration_required`.

## Quickstart A: Discovery -> Deposit

```bash
NETWORK="Intuition Testnet"
CHAIN_ID=13579
RPC="https://testnet.rpc.intuition.systems/http"
MULTIVAULT="0x2Ece8D4dEdcB9918A398528f3fa4688b1d2CAB91"
GRAPHQL="https://testnet.intuition.sh/v1/graphql"
export FOUNDRY_DISABLE_NIGHTLY_WARNING=1
RECEIVER="0x<share-recipient>"

SEARCH_BODY=$(jq -cn --arg searchTerm "%ethereum%" '{"query":"query SearchAtoms($searchTerm: String!, $limit: Int!) { atoms(where: { label: { _ilike: $searchTerm } }, limit: $limit, order_by: { created_at: desc }) { term_id label } }","variables":{"searchTerm":$searchTerm,"limit":1}}')
TERM_ID=$(curl -fsS -X POST "$GRAPHQL" -H "Content-Type: application/json" -d "$SEARCH_BODY" | jq -r '.data.atoms[0].term_id // empty')
test -n "$TERM_ID" || { echo "No matching atom found"; exit 1; }

CURVE_ID=$(cast call $MULTIVAULT "getBondingCurveConfig()((address,uint256))" --rpc-url $RPC | awk -F', ' '{print $2}' | tr -d ')')
MIN_DEPOSIT=$(cast call $MULTIVAULT "getGeneralConfig()((address,address,uint256,address,uint256,uint256,uint256,uint256))" --rpc-url $RPC | awk -F', ' '{print $5}' | awk '{print $1}')
DEPOSIT_WEI=$(cast --to-wei 0.002)
test "$DEPOSIT_WEI" -ge "$MIN_DEPOSIT" || { echo "Deposit is below minDeposit"; exit 1; }

EXPECTED_SHARES=$(cast call $MULTIVAULT "previewDeposit(bytes32,uint256,uint256)(uint256,uint256)" "$TERM_ID" "$CURVE_ID" "$DEPOSIT_WEI" --rpc-url $RPC | awk 'NR == 1 { print $1 }')
MIN_SHARES=$(printf '%s * 95 / 100\n' "$EXPECTED_SHARES" | bc)
CALLDATA=$(cast calldata "deposit(address,bytes32,uint256,uint256)" "$RECEIVER" "$TERM_ID" "$CURVE_ID" "$MIN_SHARES")

jq -n --arg to "$MULTIVAULT" --arg data "$CALLDATA" --arg value "$DEPOSIT_WEI" --arg chainId "$CHAIN_ID" '{to:$to,data:$data,value:$value,chainId:$chainId}'
```

## Quickstart B: Pin -> Encode -> Create

Pin through the trusted runtime's configured SDK first. SDK 3.0.1 and newer automatically
uses the gated pinning endpoint and attaches the key only to pinning requests:

```typescript
import { configureSdk, pinThing } from '@0xintuition/sdk'

const pinApiKey = process.env.INTUITION_PIN_API_KEY
if (!pinApiKey) throw new Error('pinning_configuration_required')

configureSdk({ pinApiKey })

const uri = await pinThing({
  name: 'README quickstart atom',
  description: 'Pinned from the Intuition skill README quickstart',
  image: '',
  url: '',
})

if (!uri.startsWith('ipfs://')) throw new Error('pin_failed: invalid URI')
console.log(uri)
```

Use the returned URI in the unsigned transaction flow:

```bash
NETWORK="Intuition Testnet"
CHAIN_ID=13579
RPC="https://testnet.rpc.intuition.systems/http"
MULTIVAULT="0x2Ece8D4dEdcB9918A398528f3fa4688b1d2CAB91"
export FOUNDRY_DISABLE_NIGHTLY_WARNING=1
URI="ipfs://<uri-returned-by-pinThing>"
test -n "$URI" && [[ "$URI" == ipfs://* ]] || { echo "Pin failed"; exit 1; }

ATOM_DATA=$(cast --from-utf8 "$URI")
ATOM_ID=$(cast call $MULTIVAULT "calculateAtomId(bytes)(bytes32)" "$ATOM_DATA" --rpc-url $RPC)
ATOM_COST=$(cast call $MULTIVAULT "getAtomCost()(uint256)" --rpc-url $RPC | awk '{print $1}')
cast call $MULTIVAULT "previewAtomCreate(bytes32,uint256)(uint256,uint256,uint256)" "$ATOM_ID" "$ATOM_COST" --rpc-url $RPC >/dev/null
CALLDATA=$(cast calldata "createAtoms(bytes[],uint256[])" "[$ATOM_DATA]" "[$ATOM_COST]")

jq -n --arg to "$MULTIVAULT" --arg data "$CALLDATA" --arg value "$ATOM_COST" --arg chainId "$CHAIN_ID" '{to:$to,data:$data,value:$value,chainId:$chainId}'
```

## What the Skill Installs

- `SKILL.md`: canonical machine-facing contract, invariants, and output shape.
- `operations/`: write-specific encoding flows for create, deposit, redeem, batch, and approvals.
- `reference/`: read queries, network config, GraphQL, pinning, config semantics, verification, and nested-triple composition guidance.
- `README.md`: operator-facing onboarding and first-success flows.

The skill also supports creating nested triples: triples whose subject,
predicate, or object reuses another triple's `term_id`. See
`reference/nested-triples.md`.

## Autonomous Mode

For unattended execution, policy guardrails and runtime validation live in [reference/autonomous-policy.md](./reference/autonomous-policy.md).

## Design Philosophy

- Canonical correctness over convenience shortcuts.
- On-chain reads and previews for safety-critical decisions; GraphQL for discovery.
- Wallet-agnostic output so the same skill works with local, hosted, and agentic signers.

## References

- [reference/network-config.md](./reference/network-config.md)
- [reference/schemas.md](./reference/schemas.md)
- [reference/post-write-verification.md](./reference/post-write-verification.md)
- [Intuition V2 Contracts](https://github.com/0xIntuition/intuition-v2/tree/main/contracts/core)

## License

MIT
